BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS recommendation;

COMMENT ON SCHEMA recommendation IS
    'Artefatos versionados, execucoes e resultados do sistema de recomendacao.';

CREATE TABLE IF NOT EXISTS app.schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE app.users
    ADD COLUMN IF NOT EXISTS use_optional_profile_features BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS recommendation.model_versions (
    model_version_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    model_type TEXT NOT NULL,
    model_name TEXT NOT NULL,
    model_revision TEXT NOT NULL,
    document_version TEXT NOT NULL,
    feature_schema_version TEXT NOT NULL,
    dimensions INTEGER NOT NULL,
    hyperparameters JSONB NOT NULL DEFAULT '{}'::JSONB,
    validation_metrics JSONB NOT NULL DEFAULT '{}'::JSONB,
    test_metrics JSONB NOT NULL DEFAULT '{}'::JSONB,
    artifact_uri TEXT,
    artifact_checksum TEXT,
    status TEXT NOT NULL DEFAULT 'CANDIDATE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    activated_at TIMESTAMPTZ,
    CONSTRAINT model_versions_type CHECK (
        model_type IN ('CONTENT_EMBEDDING', 'NEURAL_RANKER')
    ),
    CONSTRAINT model_versions_status CHECK (
        status IN ('CANDIDATE', 'ACTIVE', 'REJECTED', 'RETIRED')
    ),
    CONSTRAINT model_versions_dimensions_positive CHECK (dimensions > 0),
    CONSTRAINT model_versions_activation_consistent CHECK (
        (status = 'ACTIVE' AND activated_at IS NOT NULL) OR status <> 'ACTIVE'
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS model_versions_one_active_per_type
    ON recommendation.model_versions (model_type)
    WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS recommendation.training_runs (
    training_run_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMPTZ,
    duration_ms BIGINT,
    catalog_watermark TIMESTAMPTZ,
    preference_watermark TIMESTAMPTZ,
    item_count INTEGER NOT NULL DEFAULT 0,
    user_count INTEGER NOT NULL DEFAULT 0,
    interaction_count INTEGER NOT NULL DEFAULT 0,
    items_updated INTEGER NOT NULL DEFAULT 0,
    items_reused INTEGER NOT NULL DEFAULT 0,
    items_failed INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'RUNNING',
    metrics JSONB NOT NULL DEFAULT '{}'::JSONB,
    failure_message TEXT,
    candidate_version_id BIGINT
        REFERENCES recommendation.model_versions (model_version_id) ON DELETE SET NULL,
    promoted_version_id BIGINT
        REFERENCES recommendation.model_versions (model_version_id) ON DELETE SET NULL,
    CONSTRAINT training_runs_status CHECK (
        status IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED_INSUFFICIENT_DATA')
    )
);

CREATE TABLE IF NOT EXISTS recommendation.item_embeddings (
    item_embedding_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    model_version_id BIGINT NOT NULL
        REFERENCES recommendation.model_versions (model_version_id) ON DELETE CASCADE,
    item_type TEXT NOT NULL,
    item_id BIGINT NOT NULL,
    movie_id BIGINT REFERENCES catalog.movies (movie_id) ON DELETE CASCADE,
    book_id BIGINT REFERENCES catalog.books (book_id) ON DELETE CASCADE,
    content_hash CHAR(64) NOT NULL,
    content_embedding VECTOR(384),
    content_completeness NUMERIC(5, 4) NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    error_message TEXT,
    CONSTRAINT item_embeddings_type CHECK (item_type IN ('MOVIE', 'BOOK')),
    CONSTRAINT item_embeddings_target CHECK (
        (item_type = 'MOVIE' AND movie_id = item_id AND book_id IS NULL)
        OR
        (item_type = 'BOOK' AND book_id = item_id AND movie_id IS NULL)
    ),
    CONSTRAINT item_embeddings_result CHECK (
        (content_embedding IS NOT NULL AND error_message IS NULL)
        OR (content_embedding IS NULL AND error_message IS NOT NULL)
    ),
    CONSTRAINT item_embeddings_completeness CHECK (
        content_completeness BETWEEN 0 AND 1
    ),
    CONSTRAINT item_embeddings_unique UNIQUE (model_version_id, item_type, item_id)
);

CREATE INDEX IF NOT EXISTS item_embeddings_item_idx
    ON recommendation.item_embeddings (item_type, item_id, model_version_id);

CREATE TABLE IF NOT EXISTS recommendation.user_profiles (
    user_id BIGINT NOT NULL REFERENCES app.users (user_id) ON DELETE CASCADE,
    model_version_id BIGINT NOT NULL
        REFERENCES recommendation.model_versions (model_version_id) ON DELETE CASCADE,
    preference_watermark TIMESTAMPTZ,
    behavioral_embedding VECTOR(384),
    neural_embedding VECTOR(64),
    taste_summary JSONB NOT NULL DEFAULT '{}'::JSONB,
    feature_schema_version TEXT NOT NULL,
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    stale BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (user_id, model_version_id)
);

CREATE TABLE IF NOT EXISTS recommendation.user_recommendations (
    user_recommendation_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES app.users (user_id) ON DELETE CASCADE,
    model_version_id BIGINT NOT NULL
        REFERENCES recommendation.model_versions (model_version_id) ON DELETE CASCADE,
    track TEXT NOT NULL,
    item_type TEXT NOT NULL,
    item_id BIGINT NOT NULL,
    movie_id BIGINT REFERENCES catalog.movies (movie_id) ON DELETE CASCADE,
    book_id BIGINT REFERENCES catalog.books (book_id) ON DELETE CASCADE,
    rank INTEGER NOT NULL,
    score NUMERIC(8, 7) NOT NULL,
    score_components JSONB NOT NULL DEFAULT '{}'::JSONB,
    reason_codes JSONB NOT NULL DEFAULT '[]'::JSONB,
    strategy TEXT NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT user_recommendations_track CHECK (
        track IN ('MOVIE', 'BOOK', 'CROSS_MEDIA')
    ),
    CONSTRAINT user_recommendations_type CHECK (item_type IN ('MOVIE', 'BOOK')),
    CONSTRAINT user_recommendations_target CHECK (
        (item_type = 'MOVIE' AND movie_id = item_id AND book_id IS NULL)
        OR
        (item_type = 'BOOK' AND book_id = item_id AND movie_id IS NULL)
    ),
    CONSTRAINT user_recommendations_rank_positive CHECK (rank > 0),
    CONSTRAINT user_recommendations_score_range CHECK (score BETWEEN 0 AND 1),
    CONSTRAINT user_recommendations_unique_item
        UNIQUE (user_id, track, item_type, item_id, model_version_id),
    CONSTRAINT user_recommendations_unique_rank
        UNIQUE (user_id, track, rank, model_version_id)
);

CREATE INDEX IF NOT EXISTS user_recommendations_read_idx
    ON recommendation.user_recommendations
    (user_id, model_version_id, track, rank);

CREATE TABLE IF NOT EXISTS recommendation.api_request_metrics (
    api_request_metric_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    endpoint TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    fallback_used BOOLEAN NOT NULL DEFAULT FALSE,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT api_request_metrics_duration_nonnegative CHECK (duration_ms >= 0)
);

CREATE INDEX IF NOT EXISTS api_request_metrics_time_idx
    ON recommendation.api_request_metrics (recorded_at DESC, endpoint);

CREATE TABLE IF NOT EXISTS app.interaction_events (
    interaction_event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES app.users (user_id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    item_type TEXT NOT NULL,
    item_id BIGINT NOT NULL,
    recommendation_model_version_id BIGINT
        REFERENCES recommendation.model_versions (model_version_id) ON DELETE SET NULL,
    context JSONB NOT NULL DEFAULT '{}'::JSONB,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT interaction_events_type CHECK (
        event_type IN ('IMPRESSION', 'OPEN_DETAILS', 'LIKE', 'DISLIKE', 'REMOVE_PREFERENCE')
    ),
    CONSTRAINT interaction_events_item_type CHECK (item_type IN ('MOVIE', 'BOOK'))
);

CREATE INDEX IF NOT EXISTS interaction_events_user_time_idx
    ON app.interaction_events (user_id, occurred_at DESC);

INSERT INTO app.interaction_events (
    user_id, event_type, item_type, item_id, context, occurred_at
)
SELECT
    preference.user_id,
    preference.preference,
    preference.item_type,
    COALESCE(preference.movie_id, preference.book_id),
    JSONB_BUILD_OBJECT(
        'source', 'MIGRATION_BACKFILL',
        'preferenceId', preference.preference_id
    ),
    preference.updated_at
FROM app.user_preferences AS preference
WHERE NOT EXISTS (
    SELECT 1
    FROM app.interaction_events AS event
    WHERE event.context ->> 'source' = 'MIGRATION_BACKFILL'
      AND event.context ->> 'preferenceId' = preference.preference_id::TEXT
);

CREATE OR REPLACE FUNCTION recommendation.mark_user_profile_stale()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    affected_user_id BIGINT;
    affected_item_type TEXT;
    affected_item_id BIGINT;
    affected_event TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        affected_user_id := OLD.user_id;
        affected_item_type := OLD.item_type;
        affected_item_id := COALESCE(OLD.movie_id, OLD.book_id);
    ELSE
        affected_user_id := NEW.user_id;
        affected_item_type := NEW.item_type;
        affected_item_id := COALESCE(NEW.movie_id, NEW.book_id);
    END IF;

    UPDATE recommendation.user_profiles
    SET stale = TRUE
    WHERE user_id = affected_user_id;

    affected_event := CASE
        WHEN TG_OP = 'DELETE' THEN 'REMOVE_PREFERENCE'
        WHEN NEW.preference = 'LIKE' THEN 'LIKE'
        ELSE 'DISLIKE'
    END;

    INSERT INTO app.interaction_events (user_id, event_type, item_type, item_id)
    VALUES (affected_user_id, affected_event, affected_item_type, affected_item_id);
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_preferences_mark_profile_stale
    ON app.user_preferences;
CREATE TRIGGER user_preferences_mark_profile_stale
AFTER INSERT OR UPDATE OR DELETE ON app.user_preferences
FOR EACH ROW EXECUTE FUNCTION recommendation.mark_user_profile_stale();

DROP VIEW IF EXISTS catalog.recommendation_items;
CREATE VIEW catalog.recommendation_items AS
SELECT
    book.book_id AS item_id,
    book.isbn13::TEXT AS source_id,
    'BOOK'::TEXT AS type,
    ARRAY(
        SELECT assignment.category_id
        FROM catalog.book_category_assignments AS assignment
        WHERE assignment.book_id = book.book_id
        ORDER BY assignment.category_order
    ) AS category_ids,
    ARRAY(
        SELECT assignment.category_id
        FROM catalog.book_category_assignments AS assignment
        WHERE assignment.book_id = book.book_id
        ORDER BY assignment.category_order
    ) AS categorie_ids,
    book.title,
    book.subtitle,
    NULL::TEXT AS original_title,
    book.original_language,
    ARRAY(
        SELECT author.name
        FROM catalog.book_authors AS relation
        JOIN catalog.authors AS author ON author.author_id = relation.author_id
        WHERE relation.book_id = book.book_id
        ORDER BY relation.author_order
    ) AS authors,
    (
        SELECT assignment.source_category
        FROM catalog.book_category_assignments AS assignment
        WHERE assignment.book_id = book.book_id
        ORDER BY assignment.category_order
        LIMIT 1
    ) AS original_category,
    book.description,
    ARRAY(SELECT JSONB_ARRAY_ELEMENTS_TEXT(book.keywords -> 'entidades')) AS entidades,
    ARRAY(SELECT JSONB_ARRAY_ELEMENTS_TEXT(book.keywords -> 'temas')) AS temas,
    book.release_year AS year,
    book.average_rating AS vote_average,
    book.ratings_count AS vote_count,
    NULL::NUMERIC AS popularity,
    book.image_url,
    (
        (book.title IS NOT NULL)::INTEGER
        + (book.description IS NOT NULL)::INTEGER
        + (book.original_language IS NOT NULL)::INTEGER
        + (book.subtitle IS NOT NULL)::INTEGER
        + (EXISTS (SELECT 1 FROM catalog.book_authors ba WHERE ba.book_id = book.book_id))::INTEGER
        + (EXISTS (SELECT 1 FROM catalog.book_category_assignments bca WHERE bca.book_id = book.book_id))::INTEGER
        + COALESCE((JSONB_ARRAY_LENGTH(book.keywords -> 'temas') > 0)::INTEGER, 0)
    )::NUMERIC / 7 AS content_completeness
FROM catalog.books AS book
UNION ALL
SELECT
    movie.movie_id AS item_id,
    movie.tmdb_id::TEXT AS source_id,
    'MOVIE'::TEXT AS type,
    ARRAY(
        SELECT assignment.category_id
        FROM catalog.movie_category_assignments AS assignment
        WHERE assignment.movie_id = movie.movie_id
        ORDER BY assignment.category_order
    ) AS category_ids,
    ARRAY(
        SELECT assignment.category_id
        FROM catalog.movie_category_assignments AS assignment
        WHERE assignment.movie_id = movie.movie_id
        ORDER BY assignment.category_order
    ) AS categorie_ids,
    movie.title,
    NULL::TEXT AS subtitle,
    movie.original_title,
    movie.original_language,
    ARRAY[]::TEXT[] AS authors,
    NULL::TEXT AS original_category,
    movie.description,
    ARRAY(SELECT JSONB_ARRAY_ELEMENTS_TEXT(movie.keywords -> 'entidades')) AS entidades,
    ARRAY(SELECT JSONB_ARRAY_ELEMENTS_TEXT(movie.keywords -> 'temas')) AS temas,
    movie.release_year AS year,
    movie.average_rating AS vote_average,
    movie.ratings_count AS vote_count,
    movie.popularity,
    movie.image_url,
    (
        (movie.title IS NOT NULL)::INTEGER
        + (movie.description IS NOT NULL)::INTEGER
        + (movie.original_language IS NOT NULL)::INTEGER
        + (movie.original_title IS NOT NULL)::INTEGER
        + (EXISTS (SELECT 1 FROM catalog.movie_category_assignments mca WHERE mca.movie_id = movie.movie_id))::INTEGER
        + COALESCE((JSONB_ARRAY_LENGTH(movie.keywords -> 'entidades') > 0)::INTEGER, 0)
        + COALESCE((JSONB_ARRAY_LENGTH(movie.keywords -> 'temas') > 0)::INTEGER, 0)
    )::NUMERIC / 7 AS content_completeness
FROM catalog.movies AS movie;

COMMENT ON VIEW catalog.recommendation_items IS
    'Contrato canonico de entrada do recomendador; categorie_ids e alias temporario legado.';

INSERT INTO app.schema_migrations (version)
VALUES ('001_recommendation_foundation')
ON CONFLICT (version) DO NOTHING;

COMMIT;
