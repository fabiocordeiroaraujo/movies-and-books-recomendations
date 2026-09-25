from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
import hashlib
import json
import logging
import math
from pathlib import Path
import resource
import time
from typing import Iterable

import numpy as np
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from sentence_transformers import SentenceTransformer

from .canonical import CanonicalItem, canonical_document, content_hash
from .config import Settings
from .neural import build_temporal_examples, train_two_tower
from .scoring import (
    HYBRID_WEIGHTS,
    ScoreComponents,
    bayesian_quality,
    collaborative_affinity,
    cosine,
    franchise_terms,
    normalized_text,
    structured_affinity,
    user_vector,
)


LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class EmbeddedPreference:
    item_id: int
    item_type: str
    title: str
    preference: str
    updated_at: datetime
    vector: np.ndarray
    category_ids: tuple[int, ...]
    themes: tuple[str, ...]
    entities: tuple[str, ...]
    language: str


@dataclass(frozen=True)
class CollaborativeSignal:
    affinity: float
    conflict: float
    supporters: int


class DailyRecommendationJob:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or Settings()

    def run(self) -> None:
        started = time.monotonic()
        cpu_started = time.process_time()
        with psycopg.connect(
            self.settings.connection_string, autocommit=True, row_factory=dict_row
        ) as connection:
            if not self._acquire_lock(connection):
                LOGGER.info("Another recommendation job already holds the advisory lock")
                return
            run_id = self._create_run(connection)
            candidate_version_id: int | None = None
            try:
                active_version_id = self._active_content_version(connection)
                candidate_version_id = self._create_content_candidate(connection)
                self._set_candidate_on_run(connection, run_id, candidate_version_id)
                item_metrics = self._update_embeddings(
                    connection, active_version_id, candidate_version_id
                )
                profile_data = self._rebuild_profiles(connection, candidate_version_id)
                neural = self._train_neural_if_eligible(connection, candidate_version_id)
                recommendation_count = self._materialize_recommendations(
                    connection, candidate_version_id, profile_data, neural
                )
                self._activate_content_version(
                    connection, candidate_version_id, active_version_id
                )
                interaction_count, user_count = self._interaction_counts(connection)
                status = (
                    "SKIPPED_INSUFFICIENT_DATA"
                    if neural["status"] == "SKIPPED_INSUFFICIENT_DATA"
                    else "SUCCEEDED"
                )
                metrics = {
                    **item_metrics,
                    "profiles": len(profile_data),
                    "recommendations": recommendation_count,
                    "neural": neural,
                    "worker_cpu_seconds": round(time.process_time() - cpu_started, 3),
                    "worker_max_rss_kb": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                }
                self._finish_run(
                    connection,
                    run_id,
                    status,
                    candidate_version_id,
                    metrics,
                    interaction_count,
                    user_count,
                    int((time.monotonic() - started) * 1000),
                )
                LOGGER.info("Recommendation job %s finished: %s", run_id, metrics)
            except BaseException as error:
                LOGGER.exception("Recommendation job %s failed", run_id)
                if candidate_version_id is not None:
                    connection.execute(
                        "UPDATE recommendation.model_versions SET status = 'REJECTED' "
                        "WHERE model_version_id = %s AND status = 'CANDIDATE'",
                        (candidate_version_id,),
                    )
                connection.execute(
                    """UPDATE recommendation.training_runs
                       SET status = 'FAILED', finished_at = CURRENT_TIMESTAMP,
                           duration_ms = %s, failure_message = %s
                       WHERE training_run_id = %s""",
                    (int((time.monotonic() - started) * 1000), str(error)[:2000], run_id),
                )
                raise
            finally:
                connection.execute(
                    "SELECT pg_advisory_unlock(%s)", (self.settings.advisory_lock_key,)
                )

    def _acquire_lock(self, connection: psycopg.Connection) -> bool:
        row = connection.execute(
            "SELECT pg_try_advisory_lock(%s) AS acquired",
            (self.settings.advisory_lock_key,),
        ).fetchone()
        return bool(row and row["acquired"])

    def _create_run(self, connection: psycopg.Connection) -> int:
        row = connection.execute(
            """INSERT INTO recommendation.training_runs (
                   catalog_watermark, preference_watermark, item_count,
                   user_count, interaction_count
               )
               SELECT
                   GREATEST(
                       COALESCE((SELECT MAX(created_at) FROM catalog.books), '-infinity'),
                       COALESCE((SELECT MAX(created_at) FROM catalog.movies), '-infinity')
                   ),
                   (SELECT MAX(updated_at) FROM app.user_preferences),
                   (SELECT COUNT(*) FROM catalog.recommendation_items),
                   (SELECT COUNT(*) FROM app.users),
                   (SELECT COUNT(*) FROM app.interaction_events)
               RETURNING training_run_id"""
        ).fetchone()
        return int(row["training_run_id"])

    def _active_content_version(self, connection: psycopg.Connection) -> int | None:
        row = connection.execute(
            """SELECT model_version_id
               FROM recommendation.model_versions
               WHERE model_type = 'CONTENT_EMBEDDING' AND status = 'ACTIVE'"""
        ).fetchone()
        return int(row["model_version_id"]) if row else None

    def _create_content_candidate(self, connection: psycopg.Connection) -> int:
        row = connection.execute(
            """INSERT INTO recommendation.model_versions (
                   model_type, model_name, model_revision, document_version,
                   feature_schema_version, dimensions, hyperparameters
               ) VALUES ('CONTENT_EMBEDDING', %s, %s, %s, %s, %s, %s)
               RETURNING model_version_id""",
            (
                self.settings.embedding_model,
                self.settings.embedding_revision,
                self.settings.document_version,
                self.settings.feature_schema_version,
                self.settings.embedding_dimensions,
                Jsonb({
                    "normalize_embeddings": True,
                    "batch_size": self.settings.batch_size,
                    "similarity": "cosine",
                    "candidate_limit": self.settings.candidate_limit,
                    "collaborative_minimum_similarity": (
                        self.settings.collaborative_minimum_similarity
                    ),
                    "collaborative_max_neighbors": (
                        self.settings.collaborative_max_neighbors
                    ),
                    "ranking_weights": HYBRID_WEIGHTS,
                }),
            ),
        ).fetchone()
        return int(row["model_version_id"])

    def _set_candidate_on_run(
        self, connection: psycopg.Connection, run_id: int, version_id: int
    ) -> None:
        connection.execute(
            "UPDATE recommendation.training_runs SET candidate_version_id = %s "
            "WHERE training_run_id = %s",
            (version_id, run_id),
        )

    def _load_items(self, connection: psycopg.Connection) -> list[dict[str, object]]:
        return list(
            connection.execute(
                """SELECT item_id, type, title, subtitle, original_title,
                          original_language, authors, original_category, description,
                          entidades, temas, category_ids, content_completeness,
                          ARRAY(
                              SELECT category.name
                              FROM catalog.categories AS category
                              WHERE category.category_id = ANY(item.category_ids)
                              ORDER BY ARRAY_POSITION(item.category_ids, category.category_id)
                          ) AS categories
                   FROM catalog.recommendation_items AS item
                   ORDER BY type, item_id"""
            ).fetchall()
        )

    def _update_embeddings(
        self,
        connection: psycopg.Connection,
        active_version_id: int | None,
        candidate_version_id: int,
    ) -> dict[str, object]:
        items = self._load_items(connection)
        active_hashes: dict[tuple[str, int], str] = {}
        if active_version_id is not None:
            rows = connection.execute(
                """SELECT item_type, item_id, content_hash
                   FROM recommendation.item_embeddings
                   WHERE model_version_id = %s AND content_embedding IS NOT NULL""",
                (active_version_id,),
            ).fetchall()
            active_hashes = {
                (str(row["item_type"]), int(row["item_id"])): str(row["content_hash"])
                for row in rows
            }

        pending: list[tuple[dict[str, object], str, str]] = []
        reused = 0
        for row in items:
            item = self._to_canonical_item(row)
            document = canonical_document(item)
            digest = content_hash(document, self.settings.document_version)
            key = (item.item_type, item.item_id)
            if active_version_id is not None and active_hashes.get(key) == digest:
                connection.execute(
                    """INSERT INTO recommendation.item_embeddings (
                           model_version_id, item_type, item_id, movie_id, book_id,
                           content_hash, content_embedding, content_completeness
                       )
                       SELECT %s, item_type, item_id, movie_id, book_id, content_hash,
                              content_embedding, content_completeness
                       FROM recommendation.item_embeddings
                       WHERE model_version_id = %s AND item_type = %s AND item_id = %s""",
                    (candidate_version_id, active_version_id, *key),
                )
                reused += 1
            else:
                pending.append((row, document, digest))

        updated = 0
        failed = 0
        if pending:
            model = SentenceTransformer(
                self.settings.embedding_model,
                revision=self.settings.embedding_revision,
            )
            for offset in range(0, len(pending), self.settings.batch_size):
                batch = pending[offset : offset + self.settings.batch_size]
                try:
                    vectors = model.encode(
                        [entry[1] for entry in batch],
                        batch_size=self.settings.batch_size,
                        normalize_embeddings=True,
                        show_progress_bar=False,
                    )
                    for entry, vector in zip(batch, vectors, strict=True):
                        self._insert_embedding(
                            connection,
                            candidate_version_id,
                            entry[0],
                            entry[2],
                            np.asarray(vector, dtype=np.float32),
                        )
                        updated += 1
                    LOGGER.info(
                        "Embedding progress: %s/%s items",
                        updated + reused + failed,
                        len(items),
                    )
                except Exception as batch_error:
                    LOGGER.warning("Embedding batch failed; retrying item by item: %s", batch_error)
                    for entry in batch:
                        try:
                            vector = model.encode(
                                [entry[1]], normalize_embeddings=True, show_progress_bar=False
                            )[0]
                            self._insert_embedding(
                                connection,
                                candidate_version_id,
                                entry[0],
                                entry[2],
                                np.asarray(vector, dtype=np.float32),
                            )
                            updated += 1
                        except Exception as item_error:
                            self._insert_embedding_error(
                                connection,
                                candidate_version_id,
                                entry[0],
                                entry[2],
                                str(item_error),
                            )
                            failed += 1
                    LOGGER.info(
                        "Embedding progress: %s/%s items",
                        updated + reused + failed,
                        len(items),
                    )

        coverage = (updated + reused) / len(items) if items else 0.0
        if coverage < self.settings.minimum_coverage:
            raise RuntimeError(
                f"Embedding coverage {coverage:.4f} is below {self.settings.minimum_coverage:.4f}"
            )
        coverage_rows = connection.execute(
            """SELECT item_type, COUNT(*) AS total,
                      COUNT(*) FILTER (WHERE content_embedding IS NOT NULL) AS embedded
               FROM recommendation.item_embeddings
               WHERE model_version_id = %s
               GROUP BY item_type""",
            (candidate_version_id,),
        ).fetchall()
        coverage_by_type = {
            str(row["item_type"]): round(
                int(row["embedded"]) / int(row["total"]) if row["total"] else 0.0,
                6,
            )
            for row in coverage_rows
        }
        return {
            "items": len(items),
            "items_updated": updated,
            "items_reused": reused,
            "items_failed": failed,
            "embedding_coverage": round(coverage, 6),
            "embedding_coverage_by_type": coverage_by_type,
        }

    def _to_canonical_item(self, row: dict[str, object]) -> CanonicalItem:
        return CanonicalItem(
            item_id=int(row["item_id"]),
            item_type=str(row["type"]),
            title=str(row["title"]),
            subtitle=self._optional_string(row["subtitle"]),
            original_title=self._optional_string(row["original_title"]),
            original_language=str(row["original_language"]),
            authors=tuple(str(value) for value in row["authors"] or []),
            categories=tuple(str(value) for value in row["categories"] or []),
            original_category=self._optional_string(row["original_category"]),
            themes=tuple(str(value) for value in row["temas"] or []),
            entities=tuple(str(value) for value in row["entidades"] or []),
            description=self._optional_string(row["description"]),
            completeness=float(row["content_completeness"]),
        )

    @staticmethod
    def _optional_string(value: object | None) -> str | None:
        return str(value) if value is not None else None

    def _insert_embedding(
        self,
        connection: psycopg.Connection,
        version_id: int,
        row: dict[str, object],
        digest: str,
        vector: np.ndarray,
    ) -> None:
        if vector.shape != (self.settings.embedding_dimensions,) or not np.isfinite(vector).all():
            raise ValueError("Embedding has an invalid dimension or non-finite values")
        item_type = str(row["type"])
        item_id = int(row["item_id"])
        connection.execute(
            """INSERT INTO recommendation.item_embeddings (
                   model_version_id, item_type, item_id, movie_id, book_id,
                   content_hash, content_embedding, content_completeness
               ) VALUES (%s, %s, %s, %s, %s, %s, %s::vector, %s)""",
            (
                version_id,
                item_type,
                item_id,
                item_id if item_type == "MOVIE" else None,
                item_id if item_type == "BOOK" else None,
                digest,
                self._vector_literal(vector),
                float(row["content_completeness"]),
            ),
        )

    def _insert_embedding_error(
        self,
        connection: psycopg.Connection,
        version_id: int,
        row: dict[str, object],
        digest: str,
        message: str,
    ) -> None:
        item_type = str(row["type"])
        item_id = int(row["item_id"])
        connection.execute(
            """INSERT INTO recommendation.item_embeddings (
                   model_version_id, item_type, item_id, movie_id, book_id,
                   content_hash, content_completeness, error_message
               ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                version_id,
                item_type,
                item_id,
                item_id if item_type == "MOVIE" else None,
                item_id if item_type == "BOOK" else None,
                digest,
                float(row["content_completeness"]),
                message[:2000],
            ),
        )

    def _load_preferences(
        self, connection: psycopg.Connection, version_id: int
    ) -> dict[int, list[EmbeddedPreference]]:
        rows = connection.execute(
            """SELECT preference.user_id, preference.preference, preference.updated_at,
                      preference.item_type, item.item_id, item.title,
                      item.category_ids, item.temas, item.entidades,
                      item.original_language,
                      embedding.content_embedding::TEXT AS embedding
               FROM app.user_preferences AS preference
               JOIN catalog.recommendation_items AS item
                 ON item.type = preference.item_type
                AND item.item_id = COALESCE(preference.movie_id, preference.book_id)
               JOIN recommendation.item_embeddings AS embedding
                 ON embedding.model_version_id = %s
                AND embedding.item_type = item.type AND embedding.item_id = item.item_id
               WHERE embedding.content_embedding IS NOT NULL
               ORDER BY preference.user_id, preference.updated_at DESC""",
            (version_id,),
        ).fetchall()
        grouped: dict[int, list[EmbeddedPreference]] = defaultdict(list)
        for row in rows:
            grouped[int(row["user_id"])].append(
                EmbeddedPreference(
                    item_id=int(row["item_id"]),
                    item_type=str(row["item_type"]),
                    title=str(row["title"]),
                    preference=str(row["preference"]),
                    updated_at=row["updated_at"],
                    vector=self._parse_vector(row["embedding"]),
                    category_ids=tuple(int(value) for value in row["category_ids"] or []),
                    themes=tuple(str(value) for value in row["temas"] or []),
                    entities=tuple(str(value) for value in row["entidades"] or []),
                    language=str(row["original_language"]),
                )
            )
        return grouped

    def _rebuild_profiles(
        self, connection: psycopg.Connection, version_id: int
    ) -> dict[int, dict[str, object]]:
        preferences = self._load_preferences(connection, version_id)
        users = connection.execute(
            """SELECT user_id,
                      FLOOR(
                        LEAST(100, EXTRACT(YEAR FROM AGE(CURRENT_DATE, birth_date))) / 10.0
                      ) / 100.0 AS age_band_feature
               FROM app.users ORDER BY user_id"""
        ).fetchall()
        profiles: dict[int, dict[str, object]] = {}
        for user in users:
            user_id = int(user["user_id"])
            items = preferences.get(user_id, [])
            positives = [item for item in items if item.preference == "LIKE"]
            negatives = [item for item in items if item.preference == "DISLIKE"]
            vector = user_vector(
                [item.vector for item in positives], [item.vector for item in negatives]
            )
            category_counts = Counter(
                category for item in positives for category in item.category_ids
            )
            rejected_category_counts = Counter(
                category for item in negatives for category in item.category_ids
            )
            theme_counts = Counter(theme for item in positives for theme in item.themes)
            rejected_theme_counts = Counter(
                theme for item in negatives for theme in item.themes
            )
            entity_counts = Counter(entity for item in positives for entity in item.entities)
            rejected_entity_counts = Counter(
                entity for item in negatives for entity in item.entities
            )
            language_counts = Counter(item.language for item in positives)
            media_counts = Counter(item.item_type for item in positives)
            summary = {
                "likeCount": len(positives),
                "dislikeCount": len(negatives),
                "categoryIds": [value for value, _ in category_counts.most_common(8)],
                "themes": [value for value, _ in theme_counts.most_common(8)],
                "languages": [value for value, _ in language_counts.most_common(5)],
                "media": dict(media_counts),
                "rankingSignals": {
                    "positiveCategories": dict(category_counts),
                    "negativeCategories": dict(rejected_category_counts),
                    "positiveThemes": dict(theme_counts),
                    "negativeThemes": dict(rejected_theme_counts),
                    "positiveEntities": dict(entity_counts),
                    "negativeEntities": dict(rejected_entity_counts),
                },
            }
            watermark = max((item.updated_at for item in items), default=None)
            connection.execute(
                """INSERT INTO recommendation.user_profiles (
                       user_id, model_version_id, preference_watermark,
                       behavioral_embedding, taste_summary, feature_schema_version, stale
                   ) VALUES (%s, %s, %s, %s::vector, %s, %s, FALSE)
                   ON CONFLICT (user_id, model_version_id) DO UPDATE SET
                       preference_watermark = EXCLUDED.preference_watermark,
                       behavioral_embedding = EXCLUDED.behavioral_embedding,
                       taste_summary = EXCLUDED.taste_summary,
                       feature_schema_version = EXCLUDED.feature_schema_version,
                       calculated_at = CURRENT_TIMESTAMP,
                       stale = FALSE""",
                (
                    user_id,
                    version_id,
                    watermark,
                    self._vector_literal(vector) if vector is not None else None,
                    Jsonb(summary),
                    self.settings.feature_schema_version,
                ),
            )
            profiles[user_id] = {
                "vector": vector,
                "preferences": items,
                "summary": summary,
                "userFeatures": np.asarray(
                    [float(user["age_band_feature"])],
                    dtype=np.float32,
                ),
            }
        return profiles

    def _materialize_recommendations(
        self,
        connection: psycopg.Connection,
        version_id: int,
        profiles: dict[int, dict[str, object]],
        neural: dict[str, object],
    ) -> int:
        neural_model = None
        if neural.get("use_for_ranking") and neural.get("artifactUri"):
            import tensorflow as tf

            neural_model = tf.keras.models.load_model(str(neural["artifactUri"]))
        total = 0
        for user_id, profile in profiles.items():
            connection.execute(
                "DELETE FROM recommendation.user_recommendations "
                "WHERE user_id = %s AND model_version_id = %s",
                (user_id, version_id),
            )
            preferences = list(profile["preferences"])
            positive = [item for item in preferences if item.preference == "LIKE"]
            negative = [item for item in preferences if item.preference == "DISLIKE"]
            collaborative_signals = self._collaborative_signals(user_id, profiles)
            collaborative_items = {
                key
                for key, signal in collaborative_signals.items()
                if signal.affinity > 0
            }
            cross_type = None
            if positive:
                cross_type = "BOOK" if positive[0].item_type == "MOVIE" else "MOVIE"
            for track, target_type in (
                ("MOVIE", "MOVIE"),
                ("BOOK", "BOOK"),
                ("CROSS_MEDIA", cross_type),
            ):
                candidates = self._candidate_rows(
                    connection,
                    version_id,
                    user_id,
                    profile["vector"],
                    target_type,
                    collaborative_items,
                )
                ranked = self._rank_candidates(
                    candidates,
                    positive,
                    negative,
                    profile["vector"],
                    profile["userFeatures"],
                    neural_model,
                    collaborative_signals,
                )
                strategy = self._strategy(positive, negative, neural_model is not None)
                for rank, candidate in enumerate(ranked[: self.settings.recommendation_limit], 1):
                    item_type = str(candidate["type"])
                    item_id = int(candidate["item_id"])
                    reasons = list(candidate["reasons"])
                    if track == "CROSS_MEDIA" and reasons:
                        first_reason = dict(reasons[0])
                        original_code = first_reason["code"]
                        original_label = str(first_reason["label"])
                        first_reason["code"] = "CROSS_MEDIA_DISCOVERY"
                        first_reason["label"] = (
                            "Uma descoberta na outra mídia a partir de "
                            + original_label.removeprefix("Porque você curtiu ")
                            if original_code == "SIMILAR_TO_LIKED"
                            else "Descoberta na outra mídia · " + original_label
                        )
                        reasons[0] = first_reason
                    connection.execute(
                        """INSERT INTO recommendation.user_recommendations (
                               user_id, model_version_id, track, item_type, item_id,
                               movie_id, book_id, rank, score, score_components,
                               reason_codes, strategy, expires_at
                           ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                                     CURRENT_TIMESTAMP + INTERVAL '36 hours')""",
                        (
                            user_id,
                            version_id,
                            track,
                            item_type,
                            item_id,
                            item_id if item_type == "MOVIE" else None,
                            item_id if item_type == "BOOK" else None,
                            rank,
                            candidate["score"],
                            Jsonb(candidate["components"]),
                            Jsonb(reasons),
                            strategy,
                        ),
                    )
                    total += 1
        return total

    def _collaborative_signals(
        self,
        user_id: int,
        profiles: dict[int, dict[str, object]],
    ) -> dict[tuple[str, int], CollaborativeSignal]:
        target_vector = profiles[user_id]["vector"]
        if not isinstance(target_vector, np.ndarray):
            return {}

        minimum = self.settings.collaborative_minimum_similarity
        scale = max(1e-6, 1.0 - minimum)
        neighbors: list[tuple[float, int, dict[str, object]]] = []
        for neighbor_id, neighbor_profile in profiles.items():
            if neighbor_id == user_id:
                continue
            neighbor_vector = neighbor_profile["vector"]
            if not isinstance(neighbor_vector, np.ndarray):
                continue
            similarity = cosine(target_vector, neighbor_vector)
            if similarity < minimum:
                continue
            weight = min(1.0, max(0.0, (similarity - minimum) / scale))
            if weight > 0:
                neighbors.append((weight, neighbor_id, neighbor_profile))
        neighbors.sort(key=lambda neighbor: neighbor[0], reverse=True)

        support: dict[tuple[str, int], dict[str, object]] = defaultdict(
            lambda: {"positive": 0.0, "negative": 0.0, "supporters": set()}
        )
        for weight, neighbor_id, neighbor_profile in neighbors[
            : self.settings.collaborative_max_neighbors
        ]:
            for preference in list(neighbor_profile["preferences"]):
                key = (preference.item_type, preference.item_id)
                if preference.preference == "LIKE":
                    support[key]["positive"] = float(support[key]["positive"]) + weight
                    supporters = support[key]["supporters"]
                    if isinstance(supporters, set):
                        supporters.add(neighbor_id)
                else:
                    support[key]["negative"] = float(support[key]["negative"]) + weight

        signals: dict[tuple[str, int], CollaborativeSignal] = {}
        for key, values in support.items():
            affinity, conflict = collaborative_affinity(
                float(values["positive"]), float(values["negative"])
            )
            supporters = values["supporters"]
            signals[key] = CollaborativeSignal(
                affinity=affinity,
                conflict=conflict,
                supporters=len(supporters) if isinstance(supporters, set) else 0,
            )
        return signals

    def _candidate_rows(
        self,
        connection: psycopg.Connection,
        version_id: int,
        user_id: int,
        profile_vector: object,
        target_type: str | None,
        collaborative_items: set[tuple[str, int]],
    ) -> list[dict[str, object]]:
        vector_literal = (
            self._vector_literal(profile_vector)
            if isinstance(profile_vector, np.ndarray)
            else None
        )
        collaborative_movie_ids = sorted(
            item_id
            for item_type, item_id in collaborative_items
            if item_type == "MOVIE"
        )
        collaborative_book_ids = sorted(
            item_id
            for item_type, item_id in collaborative_items
            if item_type == "BOOK"
        )
        return list(
            connection.execute(
                """SELECT item.item_id, item.type, item.title, item.category_ids,
                          item.temas, item.entidades, item.original_language, item.vote_average,
                          item.vote_count, item.popularity, item.content_completeness,
                          embedding.content_embedding::TEXT AS embedding,
                          CASE WHEN %s::TEXT IS NULL THEN NULL
                               ELSE 1 - (embedding.content_embedding <=> %s::vector)
                          END AS taste_similarity
                   FROM recommendation.item_embeddings AS embedding
                   JOIN catalog.recommendation_items AS item
                     ON item.type = embedding.item_type AND item.item_id = embedding.item_id
                   WHERE embedding.model_version_id = %s
                     AND embedding.content_embedding IS NOT NULL
                     AND (%s::TEXT IS NULL OR item.type = %s)
                     AND NOT EXISTS (
                         SELECT 1 FROM app.user_preferences AS preference
                         WHERE preference.user_id = %s
                           AND preference.item_type = item.type
                           AND COALESCE(preference.movie_id, preference.book_id) = item.item_id
                     )
                   ORDER BY
                     CASE WHEN
                       (item.type = 'MOVIE' AND item.item_id = ANY(%s::BIGINT[])) OR
                       (item.type = 'BOOK' AND item.item_id = ANY(%s::BIGINT[]))
                     THEN 0 ELSE 1 END,
                     CASE WHEN %s::TEXT IS NULL THEN NULL
                          ELSE embedding.content_embedding <=> %s::vector END,
                     item.vote_count DESC NULLS LAST,
                     item.vote_average DESC NULLS LAST
                   LIMIT %s""",
                (
                    vector_literal,
                    vector_literal,
                    version_id,
                    target_type,
                    target_type,
                    user_id,
                    collaborative_movie_ids,
                    collaborative_book_ids,
                    vector_literal,
                    vector_literal,
                    self.settings.candidate_limit,
                ),
            ).fetchall()
        )

    def _rank_candidates(
        self,
        candidates: Iterable[dict[str, object]],
        positive: list[EmbeddedPreference],
        negative: list[EmbeddedPreference],
        profile_vector: object,
        user_features: object,
        neural_model: object | None,
        collaborative_signals: dict[tuple[str, int], CollaborativeSignal],
    ) -> list[dict[str, object]]:
        positive_categories = Counter(
            category for item in positive for category in item.category_ids
        )
        negative_categories = Counter(
            category for item in negative for category in item.category_ids
        )
        positive_themes = Counter(
            normalized_text(theme)
            for item in positive
            for theme in item.themes
            if normalized_text(theme)
        )
        negative_themes = Counter(
            normalized_text(theme)
            for item in negative
            for theme in item.themes
            if normalized_text(theme)
        )
        positive_entities = Counter(
            normalized_text(entity)
            for item in positive
            for entity in item.entities
            if normalized_text(entity)
        )
        negative_entities = Counter(
            normalized_text(entity)
            for item in negative
            for entity in item.entities
            if normalized_text(entity)
        )
        positive_title_terms = Counter(
            term
            for item in positive
            for term in franchise_terms(item.title, item.entities)
        )
        negative_title_terms = Counter(
            term
            for item in negative
            for term in franchise_terms(item.title, item.entities)
        )
        favorite_categories = {
            value
            for value, count in positive_categories.items()
            if int(count) > int(negative_categories.get(value, 0))
        }
        favorite_themes = {
            value
            for value, count in positive_themes.items()
            if int(count) > int(negative_themes.get(value, 0))
        }
        favorite_entities = {
            value
            for value, count in positive_entities.items()
            if int(count) > int(negative_entities.get(value, 0))
        }
        scored: list[dict[str, object]] = []
        for row in candidates:
            vector = self._parse_vector(row["embedding"])
            nearest_like_item, nearest_like = self._nearest(vector, positive)
            _, nearest_dislike = self._nearest(vector, negative)
            categories = set(row["category_ids"] or [])
            raw_themes = set(str(value) for value in row["temas"] or [])
            raw_entities = set(str(value) for value in row["entidades"] or [])
            themes = {
                normalized_text(value)
                for value in raw_themes
                if normalized_text(value)
            }
            entities = {
                normalized_text(value)
                for value in raw_entities
                if normalized_text(value)
            }
            candidate_title_terms = set(
                franchise_terms(str(row["title"]), raw_entities)
            )
            collaborative = collaborative_signals.get(
                (str(row["type"]), int(row["item_id"])),
                CollaborativeSignal(0.0, 0.0, 0),
            )
            title_affinity, title_conflict = structured_affinity(
                candidate_title_terms,
                positive_title_terms,
                negative_title_terms,
                aggregation="max",
            )
            category_affinity, category_conflict = structured_affinity(
                categories, positive_categories, negative_categories
            )
            theme_affinity, theme_conflict = structured_affinity(
                themes, positive_themes, negative_themes
            )
            entity_affinity, entity_conflict = structured_affinity(
                entities,
                positive_entities,
                negative_entities,
                aggregation="max",
            )
            taste_similarity = (
                max(0.0, cosine(profile_vector, vector))
                if isinstance(profile_vector, np.ndarray)
                else 0.0
            )
            components = ScoreComponents(
                taste_similarity=taste_similarity,
                nearest_like=max(0.0, nearest_like),
                collaborative_affinity=collaborative.affinity,
                title_affinity=title_affinity,
                category_affinity=category_affinity,
                theme_affinity=theme_affinity,
                entity_affinity=entity_affinity,
                quality=bayesian_quality(
                    float(row["vote_average"]) if row["vote_average"] is not None else None,
                    int(row["vote_count"]) if row["vote_count"] is not None else None,
                ),
                dislike_similarity=max(0.0, nearest_dislike),
                collaborative_conflict=collaborative.conflict,
                title_conflict=title_conflict,
                category_conflict=category_conflict,
                theme_conflict=theme_conflict,
                entity_conflict=entity_conflict,
            )
            structured_reasons: list[tuple[float, dict[str, str]]] = []
            shared_category = next(iter(categories & favorite_categories), None)
            if shared_category is not None and category_conflict < 0.5:
                structured_reasons.append(
                    (
                        category_affinity,
                        {
                            "code": "SHARED_CATEGORY",
                            "label": "Categoria alinhada às suas preferências",
                        },
                    )
                )
            shared_theme = next(
                (
                    value
                    for value in raw_themes
                    if normalized_text(value) in favorite_themes
                ),
                None,
            )
            if shared_theme and theme_conflict < 0.5:
                structured_reasons.append(
                    (
                        theme_affinity,
                        {
                            "code": "SHARED_THEME",
                            "label": f"Tema em comum: {shared_theme}",
                        },
                    )
                )
            shared_entity = next(
                (
                    value
                    for value in raw_entities
                    if normalized_text(value) in favorite_entities
                ),
                None,
            )
            if shared_entity and entity_conflict < 0.5:
                structured_reasons.append(
                    (
                        entity_affinity,
                        {
                            "code": "SHARED_ENTITY",
                            "label": f"Personagem ou entidade em comum: {shared_entity}",
                        },
                    )
                )
            structured_reasons.sort(key=lambda reason: reason[0], reverse=True)
            reasons: list[dict[str, str]] = []
            title_like_item = max(
                (
                    item
                    for item in positive
                    if candidate_title_terms
                    & set(franchise_terms(item.title, item.entities))
                ),
                key=lambda item: len(
                    candidate_title_terms
                    & set(franchise_terms(item.title, item.entities))
                ),
                default=None,
            )
            if title_like_item is not None and title_conflict < 0.5:
                reasons.append({
                    "code": "SIMILAR_TO_LIKED",
                    "label": f"Porque você curtiu {title_like_item.title}",
                })
            elif (
                collaborative.affinity >= 0.25
                and collaborative.conflict < 0.5
                and collaborative.supporters > 0
            ):
                reasons.append({
                    "code": "SIMILAR_USERS_LIKED",
                    "label": "Usuários parecidos com você gostaram disto",
                })
            elif (
                nearest_like_item is not None
                and nearest_like > 0.88
                and max(
                    title_conflict,
                    category_conflict,
                    theme_conflict,
                    entity_conflict,
                ) < 0.5
            ):
                reasons.append({
                    "code": "SIMILAR_TO_LIKED",
                    "label": f"Porque você curtiu {nearest_like_item.title}",
                })
            reasons.extend(
                reason
                for _, reason in structured_reasons[: 2 - len(reasons)]
            )
            if not reasons:
                reasons.append({
                    "code": "QUALITY_FALLBACK",
                    "label": "Popular entre obras bem avaliadas",
                })
            scored.append(
                {
                    **row,
                    "score": components.total,
                    "components": {
                        "tasteSimilarity": round(components.taste_similarity, 6),
                        "nearestLike": round(components.nearest_like, 6),
                        "collaborativeAffinity": round(
                            components.collaborative_affinity, 6
                        ),
                        "collaborativeSupporters": collaborative.supporters,
                        "titleAffinity": round(components.title_affinity, 6),
                        "categoryAffinity": round(components.category_affinity, 6),
                        "themeAffinity": round(components.theme_affinity, 6),
                        "entityAffinity": round(components.entity_affinity, 6),
                        "quality": round(components.quality, 6),
                        "dislikeSimilarity": round(components.dislike_similarity, 6),
                        "collaborativeConflict": round(
                            components.collaborative_conflict, 6
                        ),
                        "titleConflict": round(components.title_conflict, 6),
                        "categoryConflict": round(components.category_conflict, 6),
                        "themeConflict": round(components.theme_conflict, 6),
                        "entityConflict": round(components.entity_conflict, 6),
                    },
                    "reasons": reasons[:2],
                }
            )
        if neural_model is not None and scored and isinstance(profile_vector, np.ndarray):
            item_vectors = np.stack(
                [self._parse_vector(item["embedding"]) for item in scored]
            )
            item_features = np.asarray(
                [
                    [
                        1.0 if item["type"] == "MOVIE" else 0.0,
                        float(item["vote_average"] or 0) / 10.0,
                        min(
                            1.0,
                            math.log1p(int(item["vote_count"] or 0))
                            / math.log1p(50_000),
                        ),
                        float(item["content_completeness"]),
                    ]
                    for item in scored
                ],
                dtype=np.float32,
            )
            predictions = neural_model.predict(
                {
                    "user_history": np.repeat(
                        profile_vector[np.newaxis, :], len(scored), axis=0
                    ),
                    "user_features": np.repeat(
                        np.asarray(user_features, dtype=np.float32)[np.newaxis, :],
                        len(scored),
                        axis=0,
                    ),
                    "item_embedding": item_vectors,
                    "item_features": item_features,
                },
                verbose=0,
            ).reshape(-1)
            for item, prediction in zip(scored, predictions, strict=True):
                baseline_score = float(item["score"])
                neural_score = max(0.0, min(1.0, float(prediction)))
                item["score"] = 0.3 * neural_score + 0.7 * baseline_score
                item["components"]["neuralScore"] = round(neural_score, 6)
        scored.sort(key=lambda item: (-float(item["score"]), -int(item["vote_count"] or 0)))
        relevance_floor = float(scored[0]["score"]) * 0.40 if scored else 0.0
        relevant = [item for item in scored if float(item["score"]) >= relevance_floor]
        return self._diversify(relevant)

    @staticmethod
    def _nearest(
        vector: np.ndarray, preferences: list[EmbeddedPreference]
    ) -> tuple[EmbeddedPreference | None, float]:
        if not preferences:
            return None, 0.0
        item = max(preferences, key=lambda preference: cosine(vector, preference.vector))
        return item, cosine(vector, item.vector)

    def _diversify(self, scored: list[dict[str, object]]) -> list[dict[str, object]]:
        remaining = scored.copy()
        selected: list[dict[str, object]] = []
        category_counts: Counter[int] = Counter()
        franchise_counts: Counter[str] = Counter()
        media_counts: Counter[str] = Counter()
        while remaining and len(selected) < self.settings.recommendation_limit:
            def diversified_score(item: dict[str, object]) -> float:
                repeated_categories = sum(
                    category_counts[int(category)] for category in item["category_ids"] or []
                )
                repeated_franchise = max(
                    (
                        franchise_counts[term]
                        for term in franchise_terms(
                            str(item["title"]),
                            (str(value) for value in item["entidades"] or []),
                        )
                    ),
                    default=0,
                )
                return (
                    float(item["score"])
                    - min(0.09, repeated_categories * 0.015)
                    - min(0.30, repeated_franchise * 0.10)
                    - min(0.04, media_counts[str(item["type"])] * 0.003)
                )

            chosen = max(remaining, key=diversified_score)
            remaining.remove(chosen)
            selected.append(chosen)
            category_counts.update(int(value) for value in chosen["category_ids"] or [])
            franchise_counts.update(
                franchise_terms(
                    str(chosen["title"]),
                    (str(value) for value in chosen["entidades"] or []),
                )
            )
            media_counts.update([str(chosen["type"])])
        return selected

    @staticmethod
    def _strategy(
        positive: list[EmbeddedPreference],
        negative: list[EmbeddedPreference],
        use_neural: bool,
    ) -> str:
        if use_neural and len(positive) >= 3:
            return "NEURAL_TWO_TOWER"
        if len(positive) >= 3:
            return "CONTENT_HYBRID"
        if positive:
            return "NEIGHBOR_FALLBACK"
        if negative:
            return "ONLY_DISLIKES_FALLBACK"
        return "POPULARITY_FALLBACK"

    def _train_neural_if_eligible(
        self, connection: psycopg.Connection, content_version_id: int
    ) -> dict[str, object]:
        interaction_count, user_count = self._interaction_counts(connection)
        active_artifact = self._active_neural_artifact(connection)
        if (
            interaction_count < self.settings.minimum_neural_interactions
            or user_count < self.settings.minimum_neural_users
        ):
            return {
                "status": "SKIPPED_INSUFFICIENT_DATA",
                "interactions": interaction_count,
                "activeUsers": user_count,
                "minimumInteractions": self.settings.minimum_neural_interactions,
                "minimumUsers": self.settings.minimum_neural_users,
                "use_for_ranking": active_artifact is not None,
                "artifactUri": active_artifact,
            }
        rows = connection.execute(
            """SELECT event.interaction_event_id AS event_id, event.user_id,
                      event.event_type AS preference, event.occurred_at,
                      embedding.content_embedding::TEXT AS embedding,
                      item.type, item.vote_average, item.vote_count,
                      item.content_completeness,
                      ARRAY[
                        FLOOR(
                          LEAST(
                            100,
                            EXTRACT(YEAR FROM AGE(event.occurred_at::DATE, app_user.birth_date))
                          ) / 10.0
                        ) / 100.0
                      ] AS user_features
               FROM app.interaction_events AS event
               JOIN app.users AS app_user ON app_user.user_id = event.user_id
               JOIN recommendation.item_embeddings AS embedding
                 ON embedding.model_version_id = %s
                AND embedding.item_type = event.item_type
                AND embedding.item_id = event.item_id
               JOIN catalog.recommendation_items AS item
                 ON item.type = event.item_type AND item.item_id = event.item_id
               WHERE (
                   event.event_type IN ('LIKE', 'DISLIKE')
                   OR (
                     event.event_type = 'IMPRESSION'
                     AND event.occurred_at < CURRENT_TIMESTAMP - INTERVAL '24 hours'
                     AND MOD(event.interaction_event_id, 5) = 0
                     AND NOT EXISTS (
                       SELECT 1 FROM app.interaction_events AS later
                       WHERE later.user_id = event.user_id
                         AND later.item_type = event.item_type
                         AND later.item_id = event.item_id
                         AND later.event_type = 'LIKE'
                         AND later.occurred_at > event.occurred_at
                     )
                   )
                 )
                 AND embedding.content_embedding IS NOT NULL
               ORDER BY event.occurred_at, event.interaction_event_id""",
            (content_version_id,),
        ).fetchall()
        prepared = [
            {
                **row,
                "embedding": self._parse_vector(row["embedding"]),
                "features": [
                    1.0 if row["type"] == "MOVIE" else 0.0,
                    float(row["vote_average"] or 0) / 10.0,
                    min(1.0, math.log1p(int(row["vote_count"] or 0)) / math.log1p(50_000)),
                    float(row["content_completeness"]),
                ],
            }
            for row in rows
        ]
        examples = build_temporal_examples(prepared)
        try:
            result = train_two_tower(examples, self.settings.artifact_dir)
        except Exception as error:
            LOGGER.exception("Neural candidate training failed; keeping the active ranker")
            return {
                "status": "TRAINING_FAILED",
                "failure": str(error)[:500],
                "interactions": interaction_count,
                "activeUsers": user_count,
                "use_for_ranking": active_artifact is not None,
                "artifactUri": active_artifact,
            }
        neural_ndcg = result.validation_metrics.get("ndcg_at_10", 0.0)
        baseline_ndcg = result.validation_metrics.get("baseline_ndcg_at_10", 0.0)
        neural_precision = result.validation_metrics.get("precision_at_10", 0.0)
        baseline_precision = result.validation_metrics.get(
            "baseline_precision_at_10", 0.0
        )
        promoted = (
            neural_ndcg >= baseline_ndcg + 0.01
            or neural_precision >= baseline_precision + 0.01
        )
        status = "ACTIVE" if promoted else "REJECTED"
        with connection.transaction():
            if promoted:
                connection.execute(
                    """UPDATE recommendation.model_versions
                       SET status = 'RETIRED'
                       WHERE model_type = 'NEURAL_RANKER' AND status = 'ACTIVE'"""
                )
            connection.execute(
                """INSERT INTO recommendation.model_versions (
                       model_type, model_name, model_revision, document_version,
                       feature_schema_version, dimensions, hyperparameters,
                       validation_metrics, test_metrics, artifact_uri,
                       artifact_checksum, status, activated_at
                   ) VALUES ('NEURAL_RANKER', 'reel-and-read-two-tower', '1', %s,
                             %s, 64, %s, %s, %s, %s, %s, %s,
                             CASE WHEN %s = 'ACTIVE' THEN CURRENT_TIMESTAMP ELSE NULL END)""",
                (
                    self.settings.document_version,
                    self.settings.feature_schema_version,
                    Jsonb({"epochs": 12, "seed": 41, "promotionMinRankingGain": 0.01}),
                    Jsonb(result.validation_metrics),
                    Jsonb(result.test_metrics),
                    result.artifact_uri,
                    result.checksum,
                    status,
                    status,
                ),
            )
        artifact_uri = result.artifact_uri if promoted else active_artifact
        return {
            "status": "PROMOTED" if promoted else "REJECTED_NO_GAIN",
            "validation": result.validation_metrics,
            "test": result.test_metrics,
            "use_for_ranking": artifact_uri is not None,
            "artifactUri": artifact_uri,
        }

    def _active_neural_artifact(self, connection: psycopg.Connection) -> str | None:
        row = connection.execute(
            """SELECT artifact_uri, artifact_checksum
               FROM recommendation.model_versions
               WHERE model_type = 'NEURAL_RANKER'
                 AND status = 'ACTIVE'
                 AND feature_schema_version = %s
                 AND artifact_uri IS NOT NULL""",
            (self.settings.feature_schema_version,),
        ).fetchone()
        if not row:
            return None
        artifact_uri = str(row["artifact_uri"])
        if not Path(artifact_uri).is_file():
            LOGGER.warning("Active neural artifact is unavailable: %s", artifact_uri)
            return None
        checksum = hashlib.sha256(Path(artifact_uri).read_bytes()).hexdigest()
        if checksum != str(row["artifact_checksum"]):
            LOGGER.error("Active neural artifact checksum does not match: %s", artifact_uri)
            return None
        return artifact_uri

    @staticmethod
    def _interaction_counts(connection: psycopg.Connection) -> tuple[int, int]:
        row = connection.execute(
            """SELECT COUNT(*) AS interactions, COUNT(DISTINCT user_id) AS users
               FROM app.interaction_events
               WHERE event_type IN ('LIKE', 'DISLIKE')
                  OR (
                    event_type = 'IMPRESSION'
                    AND occurred_at < CURRENT_TIMESTAMP - INTERVAL '24 hours'
                    AND MOD(interaction_event_id, 5) = 0
                  )"""
        ).fetchone()
        return int(row["interactions"]), int(row["users"])

    def _activate_content_version(
        self,
        connection: psycopg.Connection,
        candidate_version_id: int,
        active_version_id: int | None,
    ) -> None:
        with connection.transaction():
            if active_version_id is not None:
                connection.execute(
                    """UPDATE recommendation.model_versions
                       SET status = 'RETIRED'
                       WHERE model_version_id = %s AND status = 'ACTIVE'""",
                    (active_version_id,),
                )
            connection.execute(
                """UPDATE recommendation.model_versions
                   SET status = 'ACTIVE', activated_at = CURRENT_TIMESTAMP
                   WHERE model_version_id = %s AND status = 'CANDIDATE'""",
                (candidate_version_id,),
            )

    def _finish_run(
        self,
        connection: psycopg.Connection,
        run_id: int,
        status: str,
        version_id: int,
        metrics: dict[str, object],
        interaction_count: int,
        user_count: int,
        duration_ms: int,
    ) -> None:
        connection.execute(
            """UPDATE recommendation.training_runs
               SET status = %s, finished_at = CURRENT_TIMESTAMP, duration_ms = %s,
                   items_updated = %s, items_reused = %s, items_failed = %s,
                   user_count = %s, interaction_count = %s, metrics = %s,
                   promoted_version_id = %s
               WHERE training_run_id = %s""",
            (
                status,
                duration_ms,
                metrics["items_updated"],
                metrics["items_reused"],
                metrics["items_failed"],
                user_count,
                interaction_count,
                Jsonb(metrics),
                version_id,
                run_id,
            ),
        )

    @staticmethod
    def _parse_vector(value: object) -> np.ndarray:
        if isinstance(value, (list, tuple)):
            return np.asarray(value, dtype=np.float32)
        return np.fromstring(str(value).strip("[]"), sep=",", dtype=np.float32)

    @staticmethod
    def _vector_literal(vector: object) -> str:
        array = np.asarray(vector, dtype=np.float32)
        return "[" + ",".join(f"{float(value):.9g}" for value in array) + "]"
