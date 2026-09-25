#!/usr/bin/env python3
"""Converte notas de livros de 0–5 para 0–10 e preserva notas de filmes."""

from __future__ import annotations

import argparse
from decimal import Decimal, InvalidOperation
from pathlib import Path

from pipeline_support import (
    PipelineError,
    read_csv,
    require_columns,
    run_main,
    write_csv_atomic,
)


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--books-input", type=Path, required=True)
    parser.add_argument("--movies-input", type=Path, required=True)
    parser.add_argument("--books-output", type=Path, required=True)
    parser.add_argument("--movies-output", type=Path, required=True)
    return parser.parse_args()


def parse_rating(raw: str, *, key: str, column: str) -> Decimal:
    try:
        return Decimal(raw)
    except InvalidOperation as error:
        raise PipelineError(f"nota inválida em {key}, coluna {column}: {raw!r}") from error


def decimal_text(value: Decimal) -> str:
    text = format(value.normalize(), "f")
    return "0" if text == "-0" else text


def normalize_books(input_path: Path, output_path: Path) -> tuple[int, int, int]:
    fieldnames, rows = read_csv(input_path)
    require_columns(fieldnames, ("isbn13", "average_rating"), input_path)
    normalized = 0
    missing = 0
    for row in rows:
        raw = (row.get("average_rating") or "").strip()
        if not raw:
            row["average_rating"] = ""
            missing += 1
            continue
        key = (row.get("isbn13") or "").strip()
        rating = parse_rating(raw, key=key, column="average_rating")
        if not Decimal("0") <= rating <= Decimal("5"):
            raise PipelineError(f"nota de livro fora da escala 0–5 em {key}: {rating}")
        row["average_rating"] = decimal_text(rating * Decimal("2"))
        normalized += 1
    write_csv_atomic(output_path, fieldnames, rows)
    return len(rows), normalized, missing


def preserve_movies(input_path: Path, output_path: Path) -> int:
    fieldnames, rows = read_csv(input_path)
    require_columns(fieldnames, ("tmdb_id", "vote_average"), input_path)
    for row in rows:
        raw = (row.get("vote_average") or "").strip()
        if not raw:
            raise PipelineError(f"filme {row.get('tmdb_id')} sem vote_average")
        rating = parse_rating(
            raw,
            key=(row.get("tmdb_id") or "").strip(),
            column="vote_average",
        )
        if not Decimal("0") <= rating <= Decimal("10"):
            raise PipelineError(
                f"nota de filme fora da escala 0–10 em {row.get('tmdb_id')}: {rating}"
            )
    write_csv_atomic(output_path, fieldnames, rows)
    return len(rows)


def main() -> int:
    args = parse_arguments()
    book_rows, normalized, missing = normalize_books(
        args.books_input,
        args.books_output,
    )
    movie_rows = preserve_movies(args.movies_input, args.movies_output)
    print(
        f"Livros: {book_rows} registros, {normalized} notas multiplicadas por 2 e "
        f"{missing} ausências preservadas."
    )
    print(f"Filmes: {movie_rows} notas já estavam em 0–10 e foram preservadas.")
    return 0


if __name__ == "__main__":
    run_main(main)
