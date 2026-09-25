#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
readonly CSV_DIR="${PROJECT_DIR}/csv"
readonly WORK_DIR="${CSV_DIR}/.pipeline-work"
readonly CACHE_FILE="${WORK_DIR}/codex_cache.sqlite3"
readonly ORIGINAL_BOOKS="${CSV_DIR}/Original_Books.csv"
readonly ORIGINAL_MOVIES="${CSV_DIR}/Original_TMDB_movies.csv"
readonly LANGUAGE_BOOKS="${WORK_DIR}/01_books_with_language.csv"
readonly LANGUAGE_MOVIES="${WORK_DIR}/01_movies_with_language.csv"
readonly RATING_BOOKS="${WORK_DIR}/02_books_with_normalized_ratings.csv"
readonly RATING_MOVIES="${WORK_DIR}/02_movies_with_normalized_ratings.csv"
readonly READY_BOOKS="${WORK_DIR}/03_books_with_keywords.csv"
readonly READY_MOVIES="${WORK_DIR}/03_movies_with_keywords.csv"
readonly FINAL_BOOKS="${CSV_DIR}/Books.csv"
readonly FINAL_MOVIES="${CSV_DIR}/TMDB_movies.csv"

readonly LANGUAGE_BATCH_SIZE="${LANGUAGE_BATCH_SIZE:-50}"
readonly KEYWORD_BATCH_SIZE="${KEYWORD_BATCH_SIZE:-12}"

if (($# > 0)); then
    case "$1" in
        -h|--help)
            printf '%s\n' \
                'Uso: scripts/run_data_pipeline.sh' \
                '' \
                'Lê csv/Original_Books.csv e csv/Original_TMDB_movies.csv, executa' \
                'idioma -> notas -> keywords -> validação e publica os CSVs processados.' \
                '' \
                'Pré-requisito: Codex CLI instalado e autenticado nesta máquina.' \
                '' \
                'Variáveis:' \
                '  LANGUAGE_BATCH_SIZE  padrão 50' \
                '  KEYWORD_BATCH_SIZE   padrão 12'
            exit 0
            ;;
        *)
            printf 'Erro: opção desconhecida: %s\n' "$1" >&2
            exit 2
            ;;
    esac
fi

command -v python3 >/dev/null 2>&1 || {
    printf '%s\n' 'Erro: Python 3 não encontrado no PATH.' >&2
    exit 1
}
command -v codex >/dev/null 2>&1 || {
    printf '%s\n' 'Erro: Codex CLI não encontrado no PATH.' >&2
    exit 1
}

[[ -s "${ORIGINAL_BOOKS}" ]] || {
    printf 'Erro: fonte ausente ou vazia: %s\n' "${ORIGINAL_BOOKS}" >&2
    exit 1
}
[[ -s "${ORIGINAL_MOVIES}" ]] || {
    printf 'Erro: fonte ausente ou vazia: %s\n' "${ORIGINAL_MOVIES}" >&2
    exit 1
}

mkdir -p -- "${WORK_DIR}"

printf '%s\n' 'Etapa 1/4 — estimando idiomas ausentes a partir dos títulos...'
PYTHONDONTWRITEBYTECODE=1 python3 "${SCRIPT_DIR}/estimate_languages.py" \
    --kind books \
    --input "${ORIGINAL_BOOKS}" \
    --output "${LANGUAGE_BOOKS}" \
    --cache "${CACHE_FILE}" \
    --batch-size "${LANGUAGE_BATCH_SIZE}"
PYTHONDONTWRITEBYTECODE=1 python3 "${SCRIPT_DIR}/estimate_languages.py" \
    --kind movies \
    --input "${ORIGINAL_MOVIES}" \
    --output "${LANGUAGE_MOVIES}" \
    --cache "${CACHE_FILE}" \
    --batch-size "${LANGUAGE_BATCH_SIZE}"

printf '%s\n' 'Etapa 2/4 — normalizando somente as notas dos livros para 0–10...'
PYTHONDONTWRITEBYTECODE=1 python3 "${SCRIPT_DIR}/normalize_ratings.py" \
    --books-input "${LANGUAGE_BOOKS}" \
    --movies-input "${LANGUAGE_MOVIES}" \
    --books-output "${RATING_BOOKS}" \
    --movies-output "${RATING_MOVIES}"

printf '%s\n' 'Etapa 3/4 — extraindo entidades e temas por LLM...'
PYTHONDONTWRITEBYTECODE=1 python3 "${SCRIPT_DIR}/extract_keywords_llm.py" \
    --kind books \
    --input "${RATING_BOOKS}" \
    --output "${READY_BOOKS}" \
    --cache "${CACHE_FILE}" \
    --batch-size "${KEYWORD_BATCH_SIZE}"
PYTHONDONTWRITEBYTECODE=1 python3 "${SCRIPT_DIR}/extract_keywords_llm.py" \
    --kind movies \
    --input "${RATING_MOVIES}" \
    --output "${READY_MOVIES}" \
    --cache "${CACHE_FILE}" \
    --batch-size "${KEYWORD_BATCH_SIZE}"

printf '%s\n' 'Etapa 4/4 — validando e publicando os CSVs processados...'
PYTHONDONTWRITEBYTECODE=1 python3 "${SCRIPT_DIR}/validate_processed_data.py" \
    --original-books "${ORIGINAL_BOOKS}" \
    --original-movies "${ORIGINAL_MOVIES}" \
    --processed-books "${READY_BOOKS}" \
    --processed-movies "${READY_MOVIES}"

cp -- "${READY_BOOKS}" "${FINAL_BOOKS}.tmp"
cp -- "${READY_MOVIES}" "${FINAL_MOVIES}.tmp"
mv -- "${FINAL_BOOKS}.tmp" "${FINAL_BOOKS}"
mv -- "${FINAL_MOVIES}.tmp" "${FINAL_MOVIES}"

printf '%s\n' \
    'Pipeline concluída.' \
    "Arquivo de livros: ${FINAL_BOOKS}" \
    "Arquivo de filmes: ${FINAL_MOVIES}" \
    "Cache reutilizável: ${CACHE_FILE}"
