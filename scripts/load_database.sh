#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
readonly COMPOSE_FILE="${PROJECT_DIR}/compose.yaml"
readonly BOOKS_CSV="${PROJECT_DIR}/csv/Books.csv"
readonly MOVIES_CSV="${PROJECT_DIR}/csv/TMDB_movies.csv"
readonly LOAD_SQL="${PROJECT_DIR}/database/load/01_reload_all.sql"

assume_yes=false

usage() {
    printf '%s\n' \
        'Uso: scripts/load_database.sh [--yes]' \
        '' \
        'Carrega Books.csv e TMDB_movies.csv no PostgreSQL do Docker Compose.' \
        'A carga esvazia e repovoa os schemas staging e catalog.' \
        '' \
        'Opções:' \
        '  -y, --yes   não solicitar confirmação' \
        '  -h, --help  mostrar esta ajuda'
}

fail() {
    printf 'Erro: %s\n' "$1" >&2
    exit 1
}

while (($# > 0)); do
    case "$1" in
        -y|--yes)
            assume_yes=true
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            usage >&2
            fail "opção desconhecida: $1"
            ;;
    esac
    shift
done

command -v docker >/dev/null 2>&1 || fail 'Docker não encontrado no PATH.'
docker compose version >/dev/null 2>&1 || fail 'Docker Compose v2 não está disponível.'

[[ -f "${COMPOSE_FILE}" ]] || fail "arquivo não encontrado: ${COMPOSE_FILE}"
[[ -s "${BOOKS_CSV}" ]] || fail "arquivo ausente ou vazio: ${BOOKS_CSV}"
[[ -s "${MOVIES_CSV}" ]] || fail "arquivo ausente ou vazio: ${MOVIES_CSV}"
[[ -s "${LOAD_SQL}" ]] || fail "arquivo ausente ou vazio: ${LOAD_SQL}"

csv_has_column() {
    local csv_file="$1"
    local column="$2"
    local header
    IFS= read -r header < "${csv_file}"
    header="${header%$'\r'}"
    [[ ",${header}," == *",${column},"* ]]
}

csv_has_column "${BOOKS_CSV}" 'original_language' ||
    fail 'Books.csv não contém original_language; execute ./scripts/run_data_pipeline.sh.'
csv_has_column "${BOOKS_CSV}" 'keywords' ||
    fail 'Books.csv não contém keywords; execute ./scripts/run_data_pipeline.sh.'
csv_has_column "${MOVIES_CSV}" 'original_language' ||
    fail 'TMDB_movies.csv não contém original_language; execute ./scripts/run_data_pipeline.sh.'
csv_has_column "${MOVIES_CSV}" 'keywords' ||
    fail 'TMDB_movies.csv não contém keywords; execute ./scripts/run_data_pipeline.sh.'

if [[ "${assume_yes}" == false ]]; then
    if [[ ! -t 0 ]]; then
        fail 'a confirmação exige um terminal; use --yes em execuções não interativas.'
    fi

    printf '%s\n' \
        'Esta operação substituirá os dados atuais dos schemas staging e catalog.' \
        'Banco padrão: recommendations (ou o valor de POSTGRES_DB definido em .env).'
    read -r -p 'Continuar? [s/N] ' confirmation

    case "${confirmation}" in
        s|S|sim|SIM|Sim)
            ;;
        *)
            printf '%s\n' 'Carga cancelada.'
            exit 0
            ;;
    esac
fi

cd -- "${PROJECT_DIR}"

printf '%s\n' 'Iniciando o PostgreSQL e aguardando o banco ficar disponível...'
docker compose -f "${COMPOSE_FILE}" up -d --wait postgres

database_name="$({
    docker compose -f "${COMPOSE_FILE}" exec -T postgres printenv POSTGRES_DB
} | tr -d '\r\n')"

database_user="$({
    docker compose -f "${COMPOSE_FILE}" exec -T postgres printenv POSTGRES_USER
} | tr -d '\r\n')"

schema_is_current="$({
    docker compose -f "${COMPOSE_FILE}" exec -T postgres \
        psql --tuples-only --no-align \
        --username "${database_user}" \
        --dbname "${database_name}" \
        --command "
            SELECT
                to_regclass('catalog.category_classification_rules') IS NOT NULL
                AND to_regclass('catalog.recommendation_items') IS NOT NULL
                AND EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = 'catalog'
                      AND table_name = 'books'
                      AND column_name = 'original_language'
                      AND data_type = 'character varying'
                )
                AND (
                    SELECT COUNT(*) = 3
                    FROM information_schema.columns AS view_column
                    WHERE view_column.table_schema = 'catalog'
                      AND view_column.table_name = 'recommendation_items'
                      AND (
                            (view_column.column_name = 'categorie_ids'
                             AND view_column.udt_name = '_int4')
                         OR (view_column.column_name IN ('entidades', 'temas')
                             AND view_column.udt_name = '_text')
                      )
                )
                AND COUNT(*) = 4
            FROM information_schema.columns
            WHERE column_name = 'keywords'
              AND (
                    (table_schema = 'staging'
                     AND table_name IN ('books_csv', 'tmdb_movies_csv')
                     AND data_type = 'text')
                 OR (table_schema = 'catalog'
                     AND table_name IN ('books', 'movies')
                     AND data_type = 'jsonb')
              );"
} | tr -d '[:space:]')"

if [[ "${schema_is_current}" != 't' ]]; then
    printf '%s\n' \
        'Erro: o volume contém uma versão antiga do modelo de dados.' \
        'A versão atual exige idioma nos livros, notas 0–10 e keywords por LLM.' \
        'Como o banco é reconstruído a partir dos CSVs, recrie o volume e tente novamente:' \
        '  docker compose down -v' \
        '  ./scripts/load_database.sh' >&2
    exit 1
fi

printf 'Carregando os CSVs no banco %s...\n' "${database_name}"
docker compose -f "${COMPOSE_FILE}" exec -T postgres \
    psql -v ON_ERROR_STOP=1 --username "${database_user}" --dbname "${database_name}" \
    < "${LOAD_SQL}"

printf 'Carga concluída com sucesso no banco %s.\n' "${database_name}"
