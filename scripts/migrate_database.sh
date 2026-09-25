#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

docker compose -f "$PROJECT_DIR/compose.yaml" up -d postgres

for migration in "$PROJECT_DIR"/database/migrations/*.sql; do
  echo "Aplicando $(basename "$migration")"
  docker compose -f "$PROJECT_DIR/compose.yaml" exec -T postgres \
    psql -v ON_ERROR_STOP=1 \
      -U "${POSTGRES_USER:-recommendations}" \
      -d "${POSTGRES_DB:-recommendations}" < "$migration"
done

echo "Migrations aplicadas."
