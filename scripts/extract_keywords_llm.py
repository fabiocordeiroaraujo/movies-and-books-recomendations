#!/usr/bin/env python3
"""Extrai entidades e temas com LLM e grava a coluna keywords."""

from __future__ import annotations

import argparse
import json
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
    chunks,
    content_hash,
    read_csv,
    require_columns,
    run_main,
    write_csv_atomic,
)


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CACHE = PROJECT_ROOT / "csv" / ".pipeline-work" / "codex_cache.sqlite3"
DEFAULT_PROMPTS = {
    "books": PROJECT_ROOT / "prompts" / "keywords-books.md",
    "movies": PROJECT_ROOT / "prompts" / "keywords-movies.md",
}


@dataclass
class PendingKeywords:
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
    parser.add_argument("--prompt", type=Path)
    parser.add_argument("--batch-size", type=int, default=12)
    parser.add_argument("--max-text-chars", type=int, default=6_000)
    return parser.parse_args()


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
                        "entidades": {
                            "type": "array",
                            "maxItems": 8,
                            "items": {"type": "string"},
                        },
                        "temas": {
                            "type": "array",
                            "maxItems": 6,
                            "items": {"type": "string"},
                        },
                    },
                    "required": ["key", "entidades", "temas"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["items"],
        "additionalProperties": False,
    }


def clean_terms(value: Any, *, limit: int, label: str, key: str) -> list[str]:
    if not isinstance(value, list):
        raise PipelineError(f"{label} de {key} não é um array")
    result: list[str] = []
    seen: set[str] = set()
    for term in value:
        if not isinstance(term, str):
            raise PipelineError(f"{label} de {key} contém valor que não é texto")
        cleaned = " ".join(term.split()).strip(" ,.;:")
        normalized = cleaned.casefold()
        if not cleaned or normalized in seen:
            continue
        seen.add(normalized)
        result.append(cleaned)
        if len(result) == limit:
            break
    return result


def clean_keywords(value: Any, key: str) -> dict[str, list[str]]:
    if not isinstance(value, dict):
        raise PipelineError(f"keywords de {key} não é um objeto")
    return {
        "entidades": clean_terms(
            value.get("entidades"), limit=8, label="entidades", key=key
        ),
        "temas": clean_terms(value.get("temas"), limit=6, label="temas", key=key),
    }


def validate_batch_response(
    payload: Any,
    expected_keys: list[str],
) -> dict[str, dict[str, list[str]]]:
    if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
        raise PipelineError("resposta de keywords não possui o array items")
    result: dict[str, dict[str, list[str]]] = {}
    for item in payload["items"]:
        if not isinstance(item, dict):
            raise PipelineError("item de keywords não é um objeto")
        key = item.get("key")
        if key not in expected_keys or key in result:
            raise PipelineError(f"chave ausente, duplicada ou inesperada na resposta: {key}")
        result[key] = clean_keywords(item, key)
    if set(result) != set(expected_keys):
        missing = sorted(set(expected_keys) - set(result))
        raise PipelineError(f"resposta sem keywords para: {', '.join(missing)}")
    return result


def model_input(kind: str, row: dict[str, str], max_text_chars: int) -> dict[str, str]:
    title = (row.get("title") or "").strip()
    if kind == "books":
        return {
            "title": title,
            "subtitle": (row.get("subtitle") or "").strip(),
            "description": (row.get("description") or "").strip()[:max_text_chars],
        }
    return {
        "title": title,
        "original_title": (row.get("original_title") or "").strip(),
        "overview": (row.get("overview") or "").strip()[:max_text_chars],
    }


def process(args: argparse.Namespace) -> tuple[int, int]:
    if args.batch_size < 1:
        raise PipelineError("--batch-size deve ser maior que zero")
    if args.max_text_chars < 1:
        raise PipelineError("--max-text-chars deve ser maior que zero")
    prompt_path = args.prompt or DEFAULT_PROMPTS[args.kind]
    if not prompt_path.is_file():
        raise PipelineError(f"prompt não encontrado: {prompt_path}")
    prompt = prompt_path.read_text(encoding="utf-8").strip()

    fieldnames, rows = read_csv(args.input)
    if args.kind == "books":
        require_columns(
            fieldnames,
            ("isbn13", "title", "subtitle", "description", "original_language"),
            args.input,
        )
        key_column = "isbn13"
    else:
        require_columns(
            fieldnames,
            ("tmdb_id", "title", "original_title", "overview", "original_language"),
            args.input,
        )
        key_column = "tmdb_id"
    fieldnames = [column for column in fieldnames if column != "keywords"] + ["keywords"]

    stage = f"keywords:{args.kind}:v3"
    pending: list[PendingKeywords] = []
    cached = 0
    with ResponseCache(args.cache) as cache:
        for row in rows:
            key = (row.get(key_column) or "").strip()
            if not key:
                raise PipelineError(f"registro sem identificador {key_column}")
            item_input = model_input(args.kind, row, args.max_text_chars)
            item_hash = content_hash(
                {
                    "engine": LLM_ENGINE,
                    "prompt": prompt,
                    "model": MODEL,
                    "reasoning_effort": REASONING_EFFORT,
                    "input": item_input,
                }
            )
            cached_result = cache.get(stage, key, item_hash)
            if cached_result is not None:
                row["keywords"] = json.dumps(
                    clean_keywords(cached_result, key),
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
                cached += 1
                continue
            pending.append(PendingKeywords(row, key, item_hash, item_input))

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
                    schema_name="keywords_batch",
                    schema=response_schema(keys),
                )
                keywords_by_key = validate_batch_response(payload, keys)
                for item in batch:
                    keywords = keywords_by_key[item.key]
                    item.row["keywords"] = json.dumps(
                        keywords,
                        ensure_ascii=False,
                        separators=(",", ":"),
                    )
                cache.put_many(
                    stage,
                    (
                        (item.key, item.input_hash, keywords_by_key[item.key])
                        for item in batch
                    ),
                )
                completed += len(batch)
                print(
                    f"{args.kind}: {completed}/{len(pending)} itens consultados no modelo."
                )

    write_csv_atomic(args.output, fieldnames, rows)
    return len(rows), cached


def main() -> int:
    args = parse_arguments()
    rows, cached = process(args)
    print(
        f"{args.kind}: keywords geradas para {rows} registros "
        f"({cached} recuperados do cache)."
    )
    return 0


if __name__ == "__main__":
    run_main(main)
