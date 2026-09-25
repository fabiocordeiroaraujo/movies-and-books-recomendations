#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DB="${POSTGRES_DB:-recommendations}"
DB_USER="${POSTGRES_USER:-recommendations}"
RESTORE_DB="recommendations_restore_check_$$"
BACKUP_FILE="$(mktemp /tmp/reel-read-backup.XXXXXX.dump)"

cleanup() {
  docker compose -f "$PROJECT_DIR/compose.yaml" exec -T postgres \
    dropdb --if-exists -U "$DB_USER" "$RESTORE_DB" >/dev/null 2>&1 || true
  rm -f "$BACKUP_FILE"
}
trap cleanup EXIT

docker compose -f "$PROJECT_DIR/compose.yaml" exec -T postgres \
  pg_dump -U "$DB_USER" -d "$SOURCE_DB" -Fc > "$BACKUP_FILE"

docker compose -f "$PROJECT_DIR/compose.yaml" exec -T postgres \
  createdb -U "$DB_USER" "$RESTORE_DB"

docker compose -f "$PROJECT_DIR/compose.yaml" exec -T postgres \
  pg_restore -U "$DB_USER" -d "$RESTORE_DB" --no-owner < "$BACKUP_FILE"

RESULT="$(docker compose -f "$PROJECT_DIR/compose.yaml" exec -T postgres \
  psql -U "$DB_USER" -d "$RESTORE_DB" -Atc \
  "SELECT (SELECT extversion FROM pg_extension WHERE extname = 'vector'),
          (SELECT COUNT(*) FROM catalog.books),
          (SELECT COUNT(*) FROM catalog.movies),
          (SELECT COUNT(*) FROM app.users),
          (SELECT COUNT(*) FROM app.user_preferences),
          (SELECT COUNT(*) FROM recommendation.item_embeddings
             WHERE content_embedding IS NOT NULL),
          (SELECT COUNT(*) FROM recommendation.model_versions
             WHERE model_type = 'CONTENT_EMBEDDING' AND status = 'ACTIVE'),
          (SELECT COUNT(*) FROM recommendation.user_recommendations
             WHERE model_version_id = (
               SELECT model_version_id FROM recommendation.model_versions
               WHERE model_type = 'CONTENT_EMBEDDING' AND status = 'ACTIVE'
             ));")"

echo "Restauração validada (pgvector|livros|filmes|usuarios|preferencias|vetores|versoes_ativas|recomendacoes): $RESULT"
