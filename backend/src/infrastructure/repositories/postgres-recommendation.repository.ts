import { Injectable } from '@nestjs/common';
import type { Category, MediaType } from '../../domain/entities/catalog.js';
import type { PreferenceValue } from '../../domain/entities/preference.js';
import type {
  EnrichedPreference,
  InteractionEventInput,
  PreferenceSummaryData,
  RecommendationList,
  RecommendationQuery,
  RecommendationReason,
  RecommendationStatus,
  RecommendedItem,
  SimilarItemsQuery,
} from '../../domain/entities/recommendation.js';
import { RecommendationRepository } from '../../domain/repositories/recommendation.repository.js';
import { DatabaseService } from '../database/database.service.js';

interface ActiveVersionRow {
  model_version_id: string;
  model_name: string;
  activated_at: Date;
}

interface RecommendationRow {
  id: string;
  type: MediaType;
  title: string;
  description: string | null;
  release_year: number | null;
  average_rating: string | null;
  ratings_count: string | null;
  image_url: string | null;
  categories: Category[];
  score: string | number;
  reasons: RecommendationReason[] | null;
  strategy?: RecommendationList['strategy'];
  generated_at?: Date;
  nearest_like_title?: string | null;
  nearest_like?: string | number | null;
  collaborative_affinity?: string | number | null;
  collaborative_conflict?: string | number | null;
  collaborative_supporters?: string | number | null;
  title_affinity?: string | number | null;
  category_affinity?: string | number | null;
  theme_affinity?: string | number | null;
  entity_affinity?: string | number | null;
  title_conflict?: string | number | null;
  category_conflict?: string | number | null;
  theme_conflict?: string | number | null;
  entity_conflict?: string | number | null;
  shared_title?: string | null;
  shared_theme?: string | null;
  shared_entity?: string | null;
  franchise_terms?: string[] | null;
}

interface PreferenceRow extends Omit<RecommendationRow, 'score' | 'reasons'> {
  preference: PreferenceValue;
  updated_at: Date;
  original_language: string;
  themes: string[];
}

interface ProfileStateRow {
  stale: boolean;
  has_materialized: boolean;
}

interface PreferenceCountsRow {
  likes: string;
  dislikes: string;
  latest_like_type: MediaType | null;
}

interface StatusRow {
  model_version_id: string | null;
  model_name: string | null;
  activated_at: Date | null;
  last_run_status: string | null;
  last_run_at: Date | null;
  neural_model_active: boolean;
}

const CATEGORIES_SQL = `COALESCE((
  SELECT JSON_AGG(
    JSON_BUILD_OBJECT('id', category.category_id, 'name', category.name)
    ORDER BY ARRAY_POSITION(item.category_ids, category.category_id)
  )
  FROM catalog.categories AS category
  WHERE category.category_id = ANY(item.category_ids)
), '[]'::JSON)`;

const normalizedTextSql = (expression: string) => `TRIM(TRANSLATE(
  LOWER(${expression}),
  'áàâãäéèêëíìîïóòôõöúùûüç',
  'aaaaaeeeeiiiiooooouuuuc'
))`;

const titleTermsSql = (expression: string) => `ARRAY(
  SELECT DISTINCT word.term
  FROM REGEXP_SPLIT_TO_TABLE(
    ${normalizedTextSql(expression)},
    '[^a-z0-9]+'
  ) AS word(term)
  WHERE LENGTH(word.term) >= 4
    AND word.term !~ '^[ivxlcdm]+$'
    AND word.term <> ALL(ARRAY[
      'adult', 'book', 'edition', 'filme', 'from', 'into', 'livro',
      'movie', 'para', 'parte', 'part', 'sobre', 'volume', 'with'
    ]::TEXT[])
)`;

const franchiseTermsSql = (
  titleExpression: string,
  entitiesExpression: string,
) => `ARRAY(
  SELECT DISTINCT title_term.term
  FROM UNNEST(${titleTermsSql(titleExpression)}) AS title_term(term)
  WHERE EXISTS (
    SELECT 1
    FROM UNNEST(${entitiesExpression}) AS entity(value)
    CROSS JOIN LATERAL REGEXP_SPLIT_TO_TABLE(
      ${normalizedTextSql('entity.value')},
      '[^a-z0-9]+'
    ) AS entity_term(term)
    WHERE entity_term.term = title_term.term
  )
)`;

@Injectable()
export class PostgresRecommendationRepository extends RecommendationRepository {
  constructor(private readonly database: DatabaseService) {
    super();
  }

  async listForUser(
    userId: number,
    query: RecommendationQuery,
  ): Promise<RecommendationList> {
    const version = await this.activeVersion();
    if (!version) {
      return this.popularityFallback(query.type, query.limit, true, userId);
    }

    const stateRows = await this.database.query<ProfileStateRow>(
      `SELECT
         COALESCE(profile.stale, TRUE) AS stale,
         EXISTS (
           SELECT 1 FROM recommendation.user_recommendations AS result
           WHERE result.user_id = $1
             AND result.model_version_id = $2
             AND result.track = $3
             AND result.expires_at > CURRENT_TIMESTAMP
         ) AS has_materialized
       FROM (SELECT 1) AS seed
       LEFT JOIN recommendation.user_profiles AS profile
         ON profile.user_id = $1 AND profile.model_version_id = $2`,
      [userId, Number(version.model_version_id), query.type],
    );
    const state = stateRows[0] ?? { stale: true, has_materialized: false };
    if (!state.stale && state.has_materialized) {
      return this.materialized(userId, query, version);
    }
    return this.dynamic(userId, query, version, state.stale);
  }

  async getPreferenceSummary(userId: number): Promise<PreferenceSummaryData> {
    const rows = await this.database.query<PreferenceRow>(
      `SELECT
           item.item_id AS id,
           item.type,
           item.title,
           item.description,
           item.year AS release_year,
           item.vote_average AS average_rating,
           item.vote_count AS ratings_count,
           item.image_url,
           item.original_language,
           item.temas AS themes,
           ${CATEGORIES_SQL} AS categories,
           preference.preference,
           preference.updated_at
         FROM app.user_preferences AS preference
         JOIN catalog.recommendation_items AS item
           ON item.type = preference.item_type
          AND item.item_id = COALESCE(preference.movie_id, preference.book_id)
         WHERE preference.user_id = $1
         ORDER BY preference.updated_at DESC`,
      [userId],
    );
    const categoryCounts = new Map<number, { name: string; count: number }>();
    const themeCounts = new Map<string, number>();
    const languageCounts = new Map<string, number>();
    const media = { BOOK: 0, MOVIE: 0 };
    let likeCount = 0;
    let dislikeCount = 0;

    for (const row of rows) {
      if (row.preference === 'DISLIKE') {
        dislikeCount += 1;
        continue;
      }
      likeCount += 1;
      media[row.type] += 1;
      for (const category of row.categories) {
        const current = categoryCounts.get(category.id);
        categoryCounts.set(category.id, {
          name: category.name,
          count: (current?.count ?? 0) + 1,
        });
      }
      for (const theme of row.themes) {
        themeCounts.set(theme, (themeCounts.get(theme) ?? 0) + 1);
      }
      languageCounts.set(
        row.original_language,
        (languageCounts.get(row.original_language) ?? 0) + 1,
      );
    }

    return {
      taste: {
        likeCount,
        dislikeCount,
        categories: [...categoryCounts.entries()]
          .map(([id, value]) => ({ id, ...value }))
          .sort((left, right) => right.count - left.count)
          .slice(0, 8),
        themes: this.sortedCounts(themeCounts).map(([name, count]) => ({
          name,
          count,
        })),
        languages: this.sortedCounts(languageCounts).map(([code, count]) => ({
          code,
          count,
        })),
        media,
        coldStart: likeCount < 3,
      },
      preferences: rows.map((row) => this.mapPreference(row)),
    };
  }

  async listSimilar(query: SimilarItemsQuery): Promise<RecommendationList> {
    const version = await this.activeVersion();
    if (!version) {
      return this.popularityFallback(
        query.targetType ?? query.itemType,
        query.limit,
        true,
      );
    }
    const rows = await this.database.query<RecommendationRow>(
      `WITH source AS (
         SELECT content_embedding
         FROM recommendation.item_embeddings
         WHERE model_version_id = $1 AND item_type = $2 AND item_id = $3
           AND content_embedding IS NOT NULL
       )
       SELECT
         item.item_id AS id,
         item.type,
         item.title,
         item.description,
         item.year AS release_year,
         item.vote_average AS average_rating,
         item.vote_count AS ratings_count,
         item.image_url,
         ${CATEGORIES_SQL} AS categories,
         GREATEST(0, 1 - (embedding.content_embedding <=> source.content_embedding)) AS score,
         '[]'::JSON AS reasons
       FROM source
       JOIN recommendation.item_embeddings AS embedding
         ON embedding.model_version_id = $1 AND embedding.content_embedding IS NOT NULL
       JOIN catalog.recommendation_items AS item
         ON item.type = embedding.item_type AND item.item_id = embedding.item_id
       WHERE NOT (item.type = $2 AND item.item_id = $3)
         AND ($4::TEXT IS NULL OR item.type = $4)
       ORDER BY embedding.content_embedding <=> source.content_embedding,
                item.vote_count DESC NULLS LAST
       LIMIT $5`,
      [
        Number(version.model_version_id),
        query.itemType,
        query.itemId,
        query.targetType ?? null,
        query.limit,
      ],
    );
    const crossMedia = query.targetType && query.targetType !== query.itemType;
    return {
      items: rows.map((row) => ({
        ...this.mapRecommendation(row),
        reasons: [
          {
            code: crossMedia ? 'CROSS_MEDIA_DISCOVERY' : 'SHARED_THEME',
            label: crossMedia
              ? 'Uma descoberta na outra mídia com conteúdo semelhante'
              : 'Conteúdo semanticamente semelhante',
          },
        ],
      })),
      generatedAt: new Date().toISOString(),
      strategy: 'CONTENT_HYBRID',
      modelVersion: version.model_version_id,
      stale: false,
    };
  }

  async getStatus(): Promise<RecommendationStatus> {
    const rows = await this.database.query<StatusRow>(
      `SELECT
         content.model_version_id,
         content.model_name,
         content.activated_at,
         run.status AS last_run_status,
         run.finished_at AS last_run_at,
         EXISTS (
           SELECT 1 FROM recommendation.model_versions
           WHERE model_type = 'NEURAL_RANKER' AND status = 'ACTIVE'
         ) AS neural_model_active
       FROM (SELECT 1) AS seed
       LEFT JOIN recommendation.model_versions AS content
         ON content.model_type = 'CONTENT_EMBEDDING' AND content.status = 'ACTIVE'
       LEFT JOIN LATERAL (
         SELECT status, finished_at
         FROM recommendation.training_runs
         ORDER BY started_at DESC LIMIT 1
       ) AS run ON TRUE`,
    );
    const row = rows[0];
    return {
      available: Boolean(row?.model_version_id),
      modelVersion: row?.model_version_id ?? null,
      modelName: row?.model_name ?? null,
      generatedAt: row?.activated_at?.toISOString() ?? null,
      lastRunStatus: row?.last_run_status ?? null,
      lastRunAt: row?.last_run_at?.toISOString() ?? null,
      neuralModelActive: row?.neural_model_active ?? false,
    };
  }

  async recordEvents(
    userId: number,
    events: InteractionEventInput[],
  ): Promise<number> {
    const rows = await this.database.query<{ interaction_event_id: string }>(
      `INSERT INTO app.interaction_events (
         user_id, event_type, item_type, item_id,
         recommendation_model_version_id, context
       )
       SELECT
         $1,
         event.event_type,
         event.item_type,
         event.item_id,
         version.model_version_id,
         event.context
       FROM JSONB_TO_RECORDSET($2::JSONB) AS event(
         event_type TEXT,
         item_type TEXT,
         item_id BIGINT,
         model_version BIGINT,
         context JSONB
       )
       LEFT JOIN recommendation.model_versions AS version
         ON version.model_version_id = event.model_version
       WHERE EXISTS (
         SELECT 1 FROM catalog.recommendation_items AS item
         WHERE item.type = event.item_type AND item.item_id = event.item_id
       )
       RETURNING interaction_event_id`,
      [
        userId,
        JSON.stringify(
          events.map((event) => ({
            event_type: event.eventType,
            item_type: event.itemType,
            item_id: event.itemId,
            model_version: event.modelVersion ?? null,
            context: event.context ?? {},
          })),
        ),
      ],
    );
    return rows.length;
  }

  private async materialized(
    userId: number,
    query: RecommendationQuery,
    version: ActiveVersionRow,
  ): Promise<RecommendationList> {
    const rows = await this.database.query<RecommendationRow>(
      `SELECT
         item.item_id AS id,
         item.type,
         item.title,
         item.description,
         item.year AS release_year,
         item.vote_average AS average_rating,
         item.vote_count AS ratings_count,
         item.image_url,
         ${CATEGORIES_SQL} AS categories,
         result.score,
         result.reason_codes AS reasons,
         result.strategy,
         result.generated_at
       FROM recommendation.user_recommendations AS result
       JOIN catalog.recommendation_items AS item
         ON item.type = result.item_type AND item.item_id = result.item_id
       WHERE result.user_id = $1 AND result.model_version_id = $2
         AND result.track = $3 AND result.expires_at > CURRENT_TIMESTAMP
       ORDER BY result.rank
       LIMIT $4`,
      [userId, Number(version.model_version_id), query.type, query.limit],
    );
    return {
      items: rows.map((row) => this.mapRecommendation(row)),
      generatedAt:
        rows[0]?.generated_at?.toISOString() ??
        version.activated_at.toISOString(),
      strategy: rows[0]?.strategy ?? 'POPULARITY_FALLBACK',
      modelVersion: version.model_version_id,
      stale: false,
    };
  }

  private async dynamic(
    userId: number,
    query: RecommendationQuery,
    version: ActiveVersionRow,
    stale: boolean,
  ): Promise<RecommendationList> {
    const countRows = await this.database.query<PreferenceCountsRow>(
      `SELECT
         COUNT(*) FILTER (WHERE preference = 'LIKE') AS likes,
         COUNT(*) FILTER (WHERE preference = 'DISLIKE') AS dislikes,
         (ARRAY_AGG(item_type ORDER BY updated_at DESC)
           FILTER (WHERE preference = 'LIKE'))[1] AS latest_like_type
       FROM app.user_preferences WHERE user_id = $1`,
      [userId],
    );
    const counts = countRows[0] ?? {
      likes: '0',
      dislikes: '0',
      latest_like_type: null,
    };
    const likes = Number(counts.likes);
    const dislikes = Number(counts.dislikes);
    let targetType: MediaType | null = null;
    if (query.type !== 'CROSS_MEDIA') targetType = query.type;
    else if (counts.latest_like_type) {
      targetType = counts.latest_like_type === 'MOVIE' ? 'BOOK' : 'MOVIE';
    }
    const rows = await this.database.query<RecommendationRow>(
      `WITH preference_embeddings AS (
         SELECT preference.preference, item.title, item.category_ids,
                item.temas, item.entidades,
                ${franchiseTermsSql('item.title', 'item.entidades')} AS title_terms,
                embedding.content_embedding
         FROM app.user_preferences AS preference
         JOIN recommendation.item_embeddings AS embedding
           ON embedding.model_version_id = $2
          AND embedding.item_type = preference.item_type
          AND embedding.item_id = COALESCE(preference.movie_id, preference.book_id)
         JOIN catalog.recommendation_items AS item
           ON item.type = preference.item_type
          AND item.item_id = COALESCE(preference.movie_id, preference.book_id)
         WHERE preference.user_id = $1 AND embedding.content_embedding IS NOT NULL
       ), profile AS (
         SELECT AVG(content_embedding) FILTER (WHERE preference = 'LIKE') AS vector
         FROM preference_embeddings
       ), similar_users AS (
         SELECT neighbor.user_id,
                GREATEST(0, LEAST(1,
                  ((1 - (neighbor.behavioral_embedding <=> profile.vector)) - 0.65)
                    / 0.35
                )) AS similarity_weight
         FROM recommendation.user_profiles AS neighbor
         CROSS JOIN profile
         WHERE neighbor.model_version_id = $2
           AND neighbor.user_id <> $1
           AND neighbor.behavioral_embedding IS NOT NULL
           AND neighbor.stale = FALSE
           AND profile.vector IS NOT NULL
           AND 1 - (neighbor.behavioral_embedding <=> profile.vector) >= 0.65
         ORDER BY neighbor.behavioral_embedding <=> profile.vector
         LIMIT 25
       ), collaborative_support AS (
         SELECT preference.item_type,
                COALESCE(preference.movie_id, preference.book_id) AS item_id,
                COALESCE(SUM(neighbor_user.similarity_weight)
                  FILTER (WHERE preference.preference = 'LIKE'), 0)
                  AS positive_weight,
                COALESCE(SUM(neighbor_user.similarity_weight)
                  FILTER (WHERE preference.preference = 'DISLIKE'), 0)
                  AS negative_weight,
                COUNT(DISTINCT neighbor_user.user_id)
                  FILTER (WHERE preference.preference = 'LIKE') AS supporters
         FROM similar_users AS neighbor_user
         JOIN app.user_preferences AS preference
           ON preference.user_id = neighbor_user.user_id
         GROUP BY preference.item_type,
                  COALESCE(preference.movie_id, preference.book_id)
       ), collaborative_votes AS (
         SELECT item_type, item_id, supporters,
                GREATEST(positive_weight - 1.25 * negative_weight, 0)
                  / (1 + positive_weight + negative_weight) AS affinity,
                GREATEST(negative_weight - positive_weight, 0)
                  / (1 + positive_weight + negative_weight) AS conflict
         FROM collaborative_support
       ), title_counts AS (
         SELECT value.term,
                COUNT(*) FILTER (WHERE preference.preference = 'LIKE')::DOUBLE PRECISION
                  AS positive_count,
                COUNT(*) FILTER (WHERE preference.preference = 'DISLIKE')::DOUBLE PRECISION
                  AS negative_count
         FROM preference_embeddings AS preference
         CROSS JOIN LATERAL UNNEST(preference.title_terms) AS value(term)
         GROUP BY value.term
       ), title_scale AS (
         SELECT
           GREATEST(COALESCE(MAX(GREATEST(
             positive_count - 1.25 * negative_count, 0
           )), 0), 1) AS positive_max,
           GREATEST(COALESCE(MAX(GREATEST(
             negative_count - positive_count, 0
           )), 0), 1) AS negative_max
         FROM title_counts
       ), category_counts AS (
         SELECT value.category_id,
                COUNT(*) FILTER (WHERE preference.preference = 'LIKE')::DOUBLE PRECISION
                  AS positive_count,
                COUNT(*) FILTER (WHERE preference.preference = 'DISLIKE')::DOUBLE PRECISION
                  AS negative_count
         FROM preference_embeddings AS preference
         CROSS JOIN LATERAL UNNEST(preference.category_ids) AS value(category_id)
         GROUP BY value.category_id
       ), category_scale AS (
         SELECT
           GREATEST(COALESCE(MAX(GREATEST(
             positive_count - 1.25 * negative_count, 0
           )), 0), 1) AS positive_max,
           GREATEST(COALESCE(MAX(GREATEST(
             negative_count - positive_count, 0
           )), 0), 1) AS negative_max
         FROM category_counts
       ), theme_counts AS (
         SELECT ${normalizedTextSql('value.theme')} AS theme,
                COUNT(*) FILTER (WHERE preference.preference = 'LIKE')::DOUBLE PRECISION
                  AS positive_count,
                COUNT(*) FILTER (WHERE preference.preference = 'DISLIKE')::DOUBLE PRECISION
                  AS negative_count
         FROM preference_embeddings AS preference
         CROSS JOIN LATERAL UNNEST(preference.temas) AS value(theme)
         GROUP BY ${normalizedTextSql('value.theme')}
       ), theme_scale AS (
         SELECT
           GREATEST(COALESCE(MAX(GREATEST(
             positive_count - 1.25 * negative_count, 0
           )), 0), 1) AS positive_max,
           GREATEST(COALESCE(MAX(GREATEST(
             negative_count - positive_count, 0
           )), 0), 1) AS negative_max
         FROM theme_counts
       ), entity_counts AS (
         SELECT ${normalizedTextSql('value.entity')} AS entity,
                COUNT(*) FILTER (WHERE preference.preference = 'LIKE')::DOUBLE PRECISION
                  AS positive_count,
                COUNT(*) FILTER (WHERE preference.preference = 'DISLIKE')::DOUBLE PRECISION
                  AS negative_count
         FROM preference_embeddings AS preference
         CROSS JOIN LATERAL UNNEST(preference.entidades) AS value(entity)
         GROUP BY ${normalizedTextSql('value.entity')}
       ), entity_scale AS (
         SELECT
           GREATEST(COALESCE(MAX(GREATEST(
             positive_count - 1.25 * negative_count, 0
           )), 0), 1) AS positive_max,
           GREATEST(COALESCE(MAX(GREATEST(
             negative_count - positive_count, 0
           )), 0), 1) AS negative_max
         FROM entity_counts
       )
       SELECT
         item.item_id AS id,
         item.type,
         item.title,
         item.description,
         item.year AS release_year,
         item.vote_average AS average_rating,
         item.vote_count AS ratings_count,
         item.image_url,
         ${CATEGORIES_SQL} AS categories,
         LEAST(1, GREATEST(0,
           0.04 * CASE WHEN profile.vector IS NULL THEN 0
             ELSE GREATEST(0, 1 - (embedding.content_embedding <=> profile.vector)) END
           + 0.04 * COALESCE(liked.similarity, 0)
           + 0.12 * COALESCE(collaborative.affinity, 0)
           + 0.24 * title_signal.affinity
           + 0.17 * category_signal.affinity
           + 0.17 * theme_signal.affinity
           + 0.17 * entity_signal.affinity
           + 0.05 * CASE WHEN item.vote_average IS NULL THEN 0.35 ELSE
               GREATEST(0, LEAST(1,
                 item.vote_average / 10.0 * (
                   0.55 + 0.45 * LEAST(
                     1, LN(1 + GREATEST(COALESCE(item.vote_count, 0), 0)) / LN(50001)
                   )
                 )
               ))
             END
           - 0.10 * COALESCE(disliked.similarity, 0)
           - 0.15 * COALESCE(collaborative.conflict, 0)
           - 0.25 * title_signal.conflict
           - 0.35 * category_signal.conflict
           - 0.20 * theme_signal.conflict
           - 0.20 * entity_signal.conflict
         )) AS score,
         liked.title AS nearest_like_title,
         liked.similarity AS nearest_like,
         COALESCE(collaborative.affinity, 0) AS collaborative_affinity,
         COALESCE(collaborative.conflict, 0) AS collaborative_conflict,
         COALESCE(collaborative.supporters, 0) AS collaborative_supporters,
         title_signal.affinity AS title_affinity,
         category_signal.affinity AS category_affinity,
         theme_signal.affinity AS theme_affinity,
         entity_signal.affinity AS entity_affinity,
         title_signal.conflict AS title_conflict,
         category_signal.conflict AS category_conflict,
         theme_signal.conflict AS theme_conflict,
         entity_signal.conflict AS entity_conflict,
         title_like.title AS shared_title,
         theme_signal.matched_value AS shared_theme,
         entity_signal.matched_value AS shared_entity,
         candidate_title.terms AS franchise_terms,
         '[]'::JSON AS reasons
       FROM recommendation.item_embeddings AS embedding
       JOIN catalog.recommendation_items AS item
         ON item.type = embedding.item_type AND item.item_id = embedding.item_id
       CROSS JOIN profile
       LEFT JOIN LATERAL (
         SELECT preference.title,
                GREATEST(0, 1 - (embedding.content_embedding <=> preference.content_embedding)) AS similarity
         FROM preference_embeddings AS preference
         WHERE preference.preference = 'LIKE'
         ORDER BY embedding.content_embedding <=> preference.content_embedding
         LIMIT 1
       ) AS liked ON TRUE
       LEFT JOIN LATERAL (
         SELECT GREATEST(0, 1 - (embedding.content_embedding <=> preference.content_embedding)) AS similarity
         FROM preference_embeddings AS preference
         WHERE preference.preference = 'DISLIKE'
         ORDER BY embedding.content_embedding <=> preference.content_embedding
         LIMIT 1
       ) AS disliked ON TRUE
       LEFT JOIN collaborative_votes AS collaborative
         ON collaborative.item_type = item.type
        AND collaborative.item_id = item.item_id
       LEFT JOIN LATERAL (
         SELECT ${franchiseTermsSql('item.title', 'item.entidades')} AS terms
       ) AS candidate_title ON TRUE
       LEFT JOIN LATERAL (
         SELECT
           COALESCE(MAX(
             GREATEST(counts.positive_count - 1.25 * counts.negative_count, 0)
               / scale.positive_max
           ), 0) AS affinity,
           COALESCE(MAX(
             GREATEST(counts.negative_count - counts.positive_count, 0)
               / scale.negative_max
           ), 0) AS conflict
         FROM UNNEST(candidate_title.terms) AS candidate(term)
         LEFT JOIN title_counts AS counts USING (term)
         CROSS JOIN title_scale AS scale
       ) AS title_signal ON TRUE
       LEFT JOIN LATERAL (
         SELECT preference.title
         FROM preference_embeddings AS preference
         WHERE preference.preference = 'LIKE'
           AND preference.title_terms && candidate_title.terms
         ORDER BY (
           SELECT COUNT(*)
           FROM UNNEST(preference.title_terms) AS liked_term(term)
           WHERE liked_term.term = ANY(candidate_title.terms)
         ) DESC, preference.title
         LIMIT 1
       ) AS title_like ON TRUE
       LEFT JOIN LATERAL (
         SELECT
           COALESCE(AVG(
             GREATEST(counts.positive_count - 1.25 * counts.negative_count, 0)
               / scale.positive_max
           ), 0) AS affinity,
           COALESCE(MAX(
             GREATEST(counts.negative_count - counts.positive_count, 0)
               / scale.negative_max
           ), 0) AS conflict
         FROM (SELECT DISTINCT UNNEST(item.category_ids) AS category_id) AS candidate
         LEFT JOIN category_counts AS counts USING (category_id)
         CROSS JOIN category_scale AS scale
       ) AS category_signal ON TRUE
       LEFT JOIN LATERAL (
         SELECT
           COALESCE(AVG(
             GREATEST(counts.positive_count - 1.25 * counts.negative_count, 0)
               / scale.positive_max
           ), 0) AS affinity,
           COALESCE(MAX(
             GREATEST(counts.negative_count - counts.positive_count, 0)
               / scale.negative_max
           ), 0) AS conflict,
           (ARRAY_AGG(candidate.raw_theme ORDER BY
             GREATEST(counts.positive_count - 1.25 * counts.negative_count, 0) DESC
           ) FILTER (
             WHERE counts.positive_count - 1.25 * counts.negative_count > 0
           ))[1] AS matched_value
         FROM (
           SELECT DISTINCT value.theme AS raw_theme,
                  ${normalizedTextSql('value.theme')} AS theme
           FROM UNNEST(item.temas) AS value(theme)
         ) AS candidate
         LEFT JOIN theme_counts AS counts USING (theme)
         CROSS JOIN theme_scale AS scale
       ) AS theme_signal ON TRUE
       LEFT JOIN LATERAL (
         SELECT
           COALESCE(MAX(
             GREATEST(counts.positive_count - 1.25 * counts.negative_count, 0)
               / scale.positive_max
           ), 0) AS affinity,
           COALESCE(MAX(
             GREATEST(counts.negative_count - counts.positive_count, 0)
               / scale.negative_max
           ), 0) AS conflict,
           (ARRAY_AGG(candidate.raw_entity ORDER BY
             GREATEST(counts.positive_count - 1.25 * counts.negative_count, 0) DESC
           ) FILTER (
             WHERE counts.positive_count - 1.25 * counts.negative_count > 0
           ))[1] AS matched_value
         FROM (
           SELECT DISTINCT value.entity AS raw_entity,
                  ${normalizedTextSql('value.entity')} AS entity
           FROM UNNEST(item.entidades) AS value(entity)
         ) AS candidate
         LEFT JOIN entity_counts AS counts USING (entity)
         CROSS JOIN entity_scale AS scale
       ) AS entity_signal ON TRUE
       WHERE embedding.model_version_id = $2
         AND embedding.content_embedding IS NOT NULL
         AND ($3::TEXT IS NULL OR item.type = $3)
         AND NOT EXISTS (
           SELECT 1 FROM app.user_preferences AS preference
           WHERE preference.user_id = $1 AND preference.item_type = item.type
             AND COALESCE(preference.movie_id, preference.book_id) = item.item_id
         )
       ORDER BY score DESC, item.vote_count DESC NULLS LAST
       LIMIT LEAST($4::INTEGER * 5, 100)`,
      [userId, Number(version.model_version_id), targetType, query.limit],
    );
    const strategy = this.strategy(likes, dislikes);
    const diversifiedRows = this.diversifyDynamic(rows, query.limit);
    return {
      items: diversifiedRows.map((row) => {
        const item = this.mapRecommendation(row);
        const similarity = Number(row.nearest_like ?? 0);
        const conflicts = [
          Number(row.collaborative_conflict ?? 0),
          Number(row.title_conflict ?? 0),
          Number(row.category_conflict ?? 0),
          Number(row.theme_conflict ?? 0),
          Number(row.entity_conflict ?? 0),
        ];
        const structuredReasons: Array<{
          affinity: number;
          reason: RecommendationReason;
        }> = [];
        if (
          Number(row.category_affinity ?? 0) > 0 &&
          Number(row.category_conflict ?? 0) < 0.5
        ) {
          structuredReasons.push({
            affinity: Number(row.category_affinity),
            reason: {
              code: 'SHARED_CATEGORY',
              label: 'Categoria alinhada às suas preferências',
            },
          });
        }
        if (
          Number(row.theme_affinity ?? 0) > 0 &&
          Number(row.theme_conflict ?? 0) < 0.5 &&
          row.shared_theme
        ) {
          structuredReasons.push({
            affinity: Number(row.theme_affinity),
            reason: {
              code: 'SHARED_THEME',
              label: `Tema em comum: ${row.shared_theme}`,
            },
          });
        }
        if (
          Number(row.entity_affinity ?? 0) > 0 &&
          Number(row.entity_conflict ?? 0) < 0.5 &&
          row.shared_entity
        ) {
          structuredReasons.push({
            affinity: Number(row.entity_affinity),
            reason: {
              code: 'SHARED_ENTITY',
              label: `Personagem ou entidade em comum: ${row.shared_entity}`,
            },
          });
        }
        structuredReasons.sort((left, right) => right.affinity - left.affinity);
        item.reasons = [];
        if (
          row.shared_title &&
          Number(row.title_affinity ?? 0) > 0 &&
          Number(row.title_conflict ?? 0) < 0.5
        ) {
          item.reasons.push({
            code: 'SIMILAR_TO_LIKED',
            label: `Porque você curtiu ${row.shared_title}`,
          });
        } else if (
          Number(row.collaborative_affinity ?? 0) >= 0.25 &&
          Number(row.collaborative_conflict ?? 0) < 0.5 &&
          Number(row.collaborative_supporters ?? 0) > 0
        ) {
          item.reasons.push({
            code: 'SIMILAR_USERS_LIKED',
            label: 'Usuários parecidos com você gostaram disto',
          });
        } else if (
          row.nearest_like_title &&
          similarity > 0.88 &&
          Math.max(...conflicts) < 0.5
        ) {
          item.reasons.push({
            code: 'SIMILAR_TO_LIKED',
            label: `Porque você curtiu ${row.nearest_like_title}`,
          });
        }
        item.reasons.push(
          ...structuredReasons
            .slice(0, 2 - item.reasons.length)
            .map(({ reason }) => reason),
        );
        if (item.reasons.length === 0) {
          item.reasons.push({
            code: 'QUALITY_FALLBACK',
            label: 'Popular entre obras bem avaliadas',
          });
        }
        if (query.type === 'CROSS_MEDIA') {
          item.reasons[0] = {
            code: 'CROSS_MEDIA_DISCOVERY',
            label: `Descoberta na outra mídia · ${item.reasons[0].label}`,
          };
        }
        return item;
      }),
      generatedAt: new Date().toISOString(),
      strategy,
      modelVersion: version.model_version_id,
      stale,
    };
  }

  private diversifyDynamic(
    rows: RecommendationRow[],
    limit: number,
  ): RecommendationRow[] {
    const bestScore = Math.max(0, ...rows.map((row) => Number(row.score)));
    const relevanceFloor = bestScore * 0.4;
    const remaining = rows.filter((row) => Number(row.score) >= relevanceFloor);
    const selected: RecommendationRow[] = [];
    const categoryCounts = new Map<number, number>();
    const franchiseCounts = new Map<string, number>();
    const mediaCounts = new Map<MediaType, number>();

    while (remaining.length > 0 && selected.length < limit) {
      let chosenIndex = 0;
      let bestAdjustedScore = Number.NEGATIVE_INFINITY;
      for (const [index, row] of remaining.entries()) {
        const repeatedCategories = row.categories.reduce(
          (total, category) => total + (categoryCounts.get(category.id) ?? 0),
          0,
        );
        const repeatedFranchise = Math.max(
          0,
          ...(row.franchise_terms ?? []).map(
            (term) => franchiseCounts.get(term) ?? 0,
          ),
        );
        const adjustedScore =
          Number(row.score) -
          Math.min(0.09, repeatedCategories * 0.015) -
          Math.min(0.3, repeatedFranchise * 0.1) -
          Math.min(0.04, (mediaCounts.get(row.type) ?? 0) * 0.003);
        if (adjustedScore > bestAdjustedScore) {
          bestAdjustedScore = adjustedScore;
          chosenIndex = index;
        }
      }

      const [chosen] = remaining.splice(chosenIndex, 1);
      selected.push(chosen);
      for (const category of chosen.categories) {
        categoryCounts.set(
          category.id,
          (categoryCounts.get(category.id) ?? 0) + 1,
        );
      }
      for (const term of chosen.franchise_terms ?? []) {
        franchiseCounts.set(term, (franchiseCounts.get(term) ?? 0) + 1);
      }
      mediaCounts.set(chosen.type, (mediaCounts.get(chosen.type) ?? 0) + 1);
    }

    return selected;
  }

  private async popularityFallback(
    track: RecommendationQuery['type'] | MediaType,
    limit: number,
    stale: boolean,
    userId: number | null = null,
  ): Promise<RecommendationList> {
    const targetType = track === 'CROSS_MEDIA' ? null : track;
    const rows = await this.database.query<RecommendationRow>(
      `SELECT
         item.item_id AS id,
         item.type,
         item.title,
         item.description,
         item.year AS release_year,
         item.vote_average AS average_rating,
         item.vote_count AS ratings_count,
         item.image_url,
         ${CATEGORIES_SQL} AS categories,
         LEAST(1, COALESCE(item.vote_average, 3.5) / 10.0) AS score,
         '[]'::JSON AS reasons
       FROM catalog.recommendation_items AS item
       WHERE ($1::TEXT IS NULL OR item.type = $1)
         AND ($3::BIGINT IS NULL OR NOT EXISTS (
           SELECT 1 FROM app.user_preferences AS preference
           WHERE preference.user_id = $3 AND preference.item_type = item.type
             AND COALESCE(preference.movie_id, preference.book_id) = item.item_id
         ))
       ORDER BY item.vote_count DESC NULLS LAST,
                item.vote_average DESC NULLS LAST, item.item_id
       LIMIT $2`,
      [targetType, limit, userId],
    );
    return {
      items: rows.map((row) => ({
        ...this.mapRecommendation(row),
        reasons: [
          {
            code: 'QUALITY_FALLBACK',
            label: 'Popular entre obras bem avaliadas',
          },
        ],
      })),
      generatedAt: new Date().toISOString(),
      strategy: 'POPULARITY_FALLBACK',
      modelVersion: null,
      stale,
    };
  }

  private activeVersion(): Promise<ActiveVersionRow | null> {
    return this.database
      .query<ActiveVersionRow>(
        `SELECT model_version_id, model_name, activated_at
         FROM recommendation.model_versions
         WHERE model_type = 'CONTENT_EMBEDDING' AND status = 'ACTIVE'`,
      )
      .then((rows) => rows[0] ?? null);
  }

  private mapRecommendation(row: RecommendationRow): RecommendedItem {
    return {
      id: Number(row.id),
      type: row.type,
      title: row.title,
      description: row.description,
      releaseYear: row.release_year,
      averageRating:
        row.average_rating === null ? null : Number(row.average_rating),
      ratingScale: 10,
      ratingsCount:
        row.ratings_count === null ? null : Number(row.ratings_count),
      imageUrl: row.image_url,
      categories: row.categories,
      score: Number(row.score),
      reasons: row.reasons ?? [],
    };
  }

  private mapPreference(row: PreferenceRow): EnrichedPreference {
    return {
      id: Number(row.id),
      type: row.type,
      title: row.title,
      description: row.description,
      releaseYear: row.release_year,
      averageRating:
        row.average_rating === null ? null : Number(row.average_rating),
      ratingScale: 10,
      ratingsCount:
        row.ratings_count === null ? null : Number(row.ratings_count),
      imageUrl: row.image_url,
      categories: row.categories,
      preference: row.preference,
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private sortedCounts(counts: Map<string, number>): Array<[string, number]> {
    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 8);
  }

  private strategy(
    likes: number,
    dislikes: number,
  ): RecommendationList['strategy'] {
    if (likes >= 3) return 'CONTENT_HYBRID';
    if (likes > 0) return 'NEIGHBOR_FALLBACK';
    if (dislikes > 0) return 'ONLY_DISLIKES_FALLBACK';
    return 'POPULARITY_FALLBACK';
  }
}
