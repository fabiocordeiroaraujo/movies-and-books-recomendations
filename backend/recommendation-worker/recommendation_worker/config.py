from __future__ import annotations

from dataclasses import dataclass
import os


@dataclass(frozen=True)
class Settings:
    db_host: str = os.getenv("DB_HOST", "localhost")
    db_port: int = int(os.getenv("DB_PORT", "5432"))
    db_name: str = os.getenv("DB_NAME", "recommendations")
    db_user: str = os.getenv("DB_USER", "recommendations")
    db_password: str = os.getenv("DB_PASSWORD", "recommendations_dev")
    embedding_model: str = "intfloat/multilingual-e5-small"
    embedding_revision: str = "614241f622f53c4eeff9890bdc4f31cfecc418b3"
    embedding_dimensions: int = 384
    document_version: str = "canonical-item-v1"
    feature_schema_version: str = "hybrid-features-v5"
    batch_size: int = int(os.getenv("EMBEDDING_BATCH_SIZE", "64"))
    recommendation_limit: int = int(os.getenv("RECOMMENDATION_LIMIT", "20"))
    candidate_limit: int = int(os.getenv("RECOMMENDATION_CANDIDATES", "600"))
    collaborative_minimum_similarity: float = float(
        os.getenv("COLLABORATIVE_MINIMUM_SIMILARITY", "0.65")
    )
    collaborative_max_neighbors: int = int(
        os.getenv("COLLABORATIVE_MAX_NEIGHBORS", "25")
    )
    minimum_coverage: float = float(os.getenv("MINIMUM_EMBEDDING_COVERAGE", "0.99"))
    minimum_neural_interactions: int = int(os.getenv("MINIMUM_NEURAL_INTERACTIONS", "1000"))
    minimum_neural_users: int = int(os.getenv("MINIMUM_NEURAL_USERS", "100"))
    artifact_dir: str = os.getenv("MODEL_ARTIFACT_DIR", "/artifacts")
    advisory_lock_key: int = 728_341_991

    @property
    def connection_string(self) -> str:
        return (
            f"host={self.db_host} port={self.db_port} dbname={self.db_name} "
            f"user={self.db_user} password={self.db_password}"
        )
