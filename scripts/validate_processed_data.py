#!/usr/bin/env python3
"""Valida os CSVs processados contra as fontes originais antes da publicação."""

from __future__ import annotations

import argparse
import json
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from pipeline_support import PipelineError, read_csv, require_columns, run_main


BOOK_MUTABLE_COLUMNS = {"average_rating", "original_language", "keywords"}
MOVIE_MUTABLE_COLUMNS = {"original_language", "keywords"}


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--original-books", type=Path, required=True)
    parser.add_argument("--original-movies", type=Path, required=True)
    parser.add_argument("--processed-books", type=Path, required=True)
    parser.add_argument("--processed-movies", type=Path, required=True)
    return parser.parse_args()


def valid_language(value: str) -> bool:
    return (
        len(value) == 2
        and value.isascii()
        and value.isalpha()
        and value == value.lower()
    )


def validate_keywords(raw: str, key: str) -> None:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise PipelineError(f"keywords inválidas em {key}") from error
    if not isinstance(value, dict) or set(value) != {"entidades", "temas"}:
        raise PipelineError(f"contrato de keywords inválido em {key}")
    for name, limit in (("entidades", 8), ("temas", 6)):
        terms = value[name]
        if not isinstance(terms, list) or len(terms) > limit:
            raise PipelineError(f"limite ou tipo de {name} inválido em {key}")
        if any(not isinstance(term, str) or not term.strip() for term in terms):
            raise PipelineError(f"{name} contém termo vazio ou não textual em {key}")
        if len({term.casefold() for term in terms}) != len(terms):
            raise PipelineError(f"{name} contém duplicações em {key}")


def compare_unchanged_fields(
    original: dict[str, str],
    processed: dict[str, str],
    mutable: set[str],
    key: str,
) -> None:
    for column, value in original.items():
        if column not in mutable and processed.get(column) != value:
            raise PipelineError(f"coluna {column} foi alterada indevidamente em {key}")


def validate_books(original_path: Path, processed_path: Path) -> tuple[int, int]:
    original_fields, originals = read_csv(original_path)
    processed_fields, processed = read_csv(processed_path)
    require_columns(
        processed_fields,
        (*original_fields, "original_language", "keywords"),
        processed_path,
    )
    if len(originals) != len(processed):
        raise PipelineError("a quantidade de livros mudou durante a pipeline")

    missing_ratings = 0
    seen: set[str] = set()
    for source, result in zip(originals, processed, strict=True):
        key = (source.get("isbn13") or "").strip()
        if not key or key in seen or result.get("isbn13") != key:
            raise PipelineError(f"ordem, ISBN ou unicidade inválida no livro {key!r}")
        seen.add(key)
        compare_unchanged_fields(source, result, BOOK_MUTABLE_COLUMNS, key)

        language = (result.get("original_language") or "").strip()
        if not valid_language(language):
            raise PipelineError(f"original_language inválido no livro {key}: {language!r}")

        source_rating = (source.get("average_rating") or "").strip()
        result_rating = (result.get("average_rating") or "").strip()
        if not source_rating:
            missing_ratings += 1
            if result_rating:
                raise PipelineError(f"nota ausente foi inventada no livro {key}")
        else:
            try:
                expected = Decimal(source_rating) * Decimal("2")
                actual = Decimal(result_rating)
            except InvalidOperation as error:
                raise PipelineError(f"nota inválida no livro {key}") from error
            if actual != expected or not Decimal("0") <= actual <= Decimal("10"):
                raise PipelineError(f"nota não normalizada corretamente no livro {key}")
        validate_keywords(result.get("keywords") or "", key)
    return len(processed), missing_ratings


def validate_movies(original_path: Path, processed_path: Path) -> int:
    original_fields, originals = read_csv(original_path)
    processed_fields, processed = read_csv(processed_path)
    require_columns(processed_fields, (*original_fields, "keywords"), processed_path)
    if len(originals) != len(processed):
        raise PipelineError("a quantidade de filmes mudou durante a pipeline")

    seen: set[str] = set()
    for source, result in zip(originals, processed, strict=True):
        key = (source.get("tmdb_id") or "").strip()
        if not key or key in seen or result.get("tmdb_id") != key:
            raise PipelineError(f"ordem, TMDB ID ou unicidade inválida no filme {key!r}")
        seen.add(key)
        compare_unchanged_fields(source, result, MOVIE_MUTABLE_COLUMNS, key)

        source_language = (source.get("original_language") or "").strip().lower()
        result_language = (result.get("original_language") or "").strip()
        if source_language and result_language != source_language:
            raise PipelineError(f"idioma informado pelo TMDB foi alterado no filme {key}")
        if not valid_language(result_language):
            raise PipelineError(f"original_language inválido no filme {key}")
        validate_keywords(result.get("keywords") or "", key)
    return len(processed)


def main() -> int:
    args = parse_arguments()
    books, missing_ratings = validate_books(
        args.original_books,
        args.processed_books,
    )
    movies = validate_movies(args.original_movies, args.processed_movies)
    print(
        f"Validação concluída: {books} livros ({missing_ratings} sem nota) e "
        f"{movies} filmes; IDs, idiomas, notas e keywords estão consistentes."
    )
    return 0


if __name__ == "__main__":
    run_main(main)
