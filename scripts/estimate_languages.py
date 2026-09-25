#!/usr/bin/env python3
"""Preenche original_language a partir do título, sem alterar valores existentes."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pipeline_support import (
    LLM_ENGINE,
    MODEL,
    REASONING_EFFORT,
    CodexExecClient,
    PipelineError,
    ResponseCache,
    add_column_after,
    chunks,
    content_hash,
    read_csv,
    require_columns,
    run_main,
    write_csv_atomic,
)


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PROMPT = PROJECT_ROOT / "prompts" / "language-estimation.md"
DEFAULT_CACHE = PROJECT_ROOT / "csv" / ".pipeline-work" / "codex_cache.sqlite3"


@dataclass
class PendingLanguage:
    row: dict[str, str]
    key: str
    input_hash: str
    model_input: dict[str, str]


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kind", choices=("books", "movies"), required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--prompt", type=Path, default=DEFAULT_PROMPT)
    parser.add_argument("--batch-size", type=int, default=50)
    return parser.parse_args()


def is_language_code(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 2
        and value.isascii()
        and value.isalpha()
        and value == value.lower()
    )


def response_schema(keys: list[str]) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "minItems": len(keys),
                "maxItems": len(keys),
                "items": {
                    "type": "object",
                    "properties": {
                        "key": {"type": "string", "enum": keys},
                        "original_language": {
                            "type": "string",
                            "pattern": "^[a-z]{2}$",
                        },
                    },
                    "required": ["key", "original_language"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["items"],
        "additionalProperties": False,
    }


def validate_batch_response(payload: Any, expected_keys: list[str]) -> dict[str, str]:
    if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
        raise PipelineError("resposta de idiomas não possui o array items")
    result: dict[str, str] = {}
    for item in payload["items"]:
        if not isinstance(item, dict):
            raise PipelineError("item de idioma não é um objeto")
        key = item.get("key")
        language = item.get("original_language")
        if key not in expected_keys or key in result:
            raise PipelineError(f"chave ausente, duplicada ou inesperada na resposta: {key}")
        if not is_language_code(language):
            raise PipelineError(f"idioma inválido para {key}: {language}")
        result[key] = language
    if set(result) != set(expected_keys):
        missing = sorted(set(expected_keys) - set(result))
        raise PipelineError(f"resposta sem idioma para: {', '.join(missing)}")
    return result


def prepare_model_input(kind: str, row: dict[str, str]) -> dict[str, str]:
    if kind == "books":
        return {
            "title": (row.get("title") or "").strip(),
            "subtitle": (row.get("subtitle") or "").strip(),
        }
    return {
        "original_title": (row.get("original_title") or "").strip(),
        "title": (row.get("title") or "").strip(),
    }


def process(args: argparse.Namespace) -> tuple[int, int, int]:
    if args.batch_size < 1:
        raise PipelineError("--batch-size deve ser maior que zero")
    if not args.prompt.is_file():
        raise PipelineError(f"prompt não encontrado: {args.prompt}")
    prompt = args.prompt.read_text(encoding="utf-8").strip()

    fieldnames, rows = read_csv(args.input)
    if args.kind == "books":
        require_columns(fieldnames, ("isbn13", "title", "subtitle"), args.input)
        key_column = "isbn13"
        fieldnames = add_column_after(fieldnames, "original_language", "title")
    else:
        require_columns(
            fieldnames,
            ("tmdb_id", "title", "original_title", "original_language"),
            args.input,
        )
        key_column = "tmdb_id"

    stage = f"language:{args.kind}:v2"
    pending: list[PendingLanguage] = []
    preserved = 0
    cached = 0

    with ResponseCache(args.cache) as cache:
        for row in rows:
            current = (row.get("original_language") or "").strip().lower()
            if current:
                if not is_language_code(current):
                    raise PipelineError(
                        f"original_language inválido para {row.get(key_column)}: {current}"
                    )
                row["original_language"] = current
                preserved += 1
                continue

            key = (row.get(key_column) or "").strip()
            if not key:
                raise PipelineError(f"registro sem identificador {key_column}")
            model_input = prepare_model_input(args.kind, row)
            item_hash = content_hash(
                {
                    "engine": LLM_ENGINE,
                    "prompt": prompt,
                    "model": MODEL,
                    "reasoning_effort": REASONING_EFFORT,
                    "input": model_input,
                }
            )
            cached_result = cache.get(stage, key, item_hash)
            if cached_result is not None:
                language = cached_result.get("original_language")
                if not is_language_code(language):
                    raise PipelineError(f"cache de idioma inválido para {key}")
                row["original_language"] = language
                cached += 1
                continue
            pending.append(PendingLanguage(row, key, item_hash, model_input))

        if pending:
            client = CodexExecClient()
            completed = 0
            for batch in chunks(pending, args.batch_size):
                keys = [item.key for item in batch]
                payload = client.create_structured_response(
                    instructions=prompt,
                    input_data={
                        "media_type": args.kind,
                        "items": [
                            {"key": item.key, **item.model_input} for item in batch
                        ],
                    },
                    schema_name="language_estimation_batch",
                    schema=response_schema(keys),
                )
                languages = validate_batch_response(payload, keys)
                for item in batch:
                    language = languages[item.key]
                    item.row["original_language"] = language
                cache.put_many(
                    stage,
                    (
                        (
                            item.key,
                            item.input_hash,
                            {"original_language": languages[item.key]},
                        )
                        for item in batch
                    ),
                )
                completed += len(batch)
                print(
                    f"{args.kind}: {completed}/{len(pending)} idiomas consultados no modelo."
                )

    write_csv_atomic(args.output, fieldnames, rows)
    return len(rows), preserved, cached


def main() -> int:
    args = parse_arguments()
    rows, preserved, cached = process(args)
    estimated = rows - preserved
    print(
        f"{args.kind}: {rows} registros; {preserved} idiomas preservados; "
        f"{estimated} estimados ({cached} recuperados do cache)."
    )
    return 0


if __name__ == "__main__":
    run_main(main)
