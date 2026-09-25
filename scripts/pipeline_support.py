#!/usr/bin/env python3
"""Infraestrutura compartilhada pela pipeline de preparação dos CSVs."""

from __future__ import annotations

import csv
import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Any


MODEL = "gpt-5.6-luna"
REASONING_EFFORT = "medium"
LLM_ENGINE = "codex-cli"


class PipelineError(RuntimeError):
    """Erro esperado e apresentável da preparação dos dados."""


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    if not path.is_file():
        raise PipelineError(f"arquivo não encontrado: {path}")
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        if not reader.fieldnames:
            raise PipelineError(f"CSV sem cabeçalho: {path}")
        fieldnames = list(reader.fieldnames)
        rows = list(reader)
    return fieldnames, rows


def write_csv_atomic(
    path: Path,
    fieldnames: Sequence[str],
    rows: Iterable[dict[str, Any]],
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    try:
        with temporary.open("w", encoding="utf-8", newline="") as target:
            writer = csv.DictWriter(
                target,
                fieldnames=fieldnames,
                extrasaction="raise",
                lineterminator="\n",
            )
            writer.writeheader()
            writer.writerows(rows)
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def require_columns(
    fieldnames: Sequence[str],
    required: Sequence[str],
    path: Path,
) -> None:
    missing = [column for column in required if column not in fieldnames]
    if missing:
        raise PipelineError(
            f"{path} não contém a(s) coluna(s) obrigatória(s): {', '.join(missing)}"
        )


def add_column_after(
    fieldnames: Sequence[str],
    column: str,
    after: str,
) -> list[str]:
    result = [name for name in fieldnames if name != column]
    if after not in result:
        raise PipelineError(f"não foi possível posicionar {column}: coluna {after} ausente")
    result.insert(result.index(after) + 1, column)
    return result


def content_hash(value: Any) -> str:
    serialized = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def chunks(values: Sequence[Any], size: int) -> Iterable[Sequence[Any]]:
    if size < 1:
        raise PipelineError("o tamanho do lote deve ser maior que zero")
    for start in range(0, len(values), size):
        yield values[start : start + size]


class ResponseCache:
    """Cache por item; mudanças no conteúdo ou no prompt invalidam a entrada."""

    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(path)
        self.connection.execute(
            """
            CREATE TABLE IF NOT EXISTS llm_responses (
                stage TEXT NOT NULL,
                item_key TEXT NOT NULL,
                input_hash TEXT NOT NULL,
                model TEXT NOT NULL,
                reasoning_effort TEXT NOT NULL,
                response_json TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (
                    stage,
                    item_key,
                    input_hash,
                    model,
                    reasoning_effort
                )
            )
            """
        )
        self.connection.commit()

    def get(self, stage: str, item_key: str, input_hash: str) -> Any | None:
        row = self.connection.execute(
            """
            SELECT response_json
            FROM llm_responses
            WHERE stage = ?
              AND item_key = ?
              AND input_hash = ?
              AND model = ?
              AND reasoning_effort = ?
            """,
            (stage, item_key, input_hash, MODEL, REASONING_EFFORT),
        ).fetchone()
        return json.loads(row[0]) if row else None

    def put(self, stage: str, item_key: str, input_hash: str, value: Any) -> None:
        self.put_many(stage, ((item_key, input_hash, value),))

    def put_many(
        self,
        stage: str,
        entries: Iterable[tuple[str, str, Any]],
    ) -> None:
        parameters = [
            (
                stage,
                item_key,
                input_hash,
                MODEL,
                REASONING_EFFORT,
                json.dumps(value, ensure_ascii=False, separators=(",", ":")),
            )
            for item_key, input_hash, value in entries
        ]
        self.connection.executemany(
            """
            INSERT OR REPLACE INTO llm_responses (
                stage,
                item_key,
                input_hash,
                model,
                reasoning_effort,
                response_json
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            parameters,
        )
        self.connection.commit()

    def close(self) -> None:
        self.connection.close()

    def __enter__(self) -> "ResponseCache":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


class CodexExecClient:
    """Executa o modelo pela instalação local do Codex CLI."""

    def __init__(self, *, timeout: float = 600.0) -> None:
        self.binary = shutil.which("codex")
        if not self.binary:
            raise PipelineError("Codex CLI não foi encontrado no PATH.")
        self.timeout = timeout

    def create_structured_response(
        self,
        *,
        instructions: str,
        input_data: Any,
        schema_name: str,
        schema: dict[str, Any],
    ) -> Any:
        prompt = (
            f"{instructions}\n\n"
            "Não use ferramentas, não leia arquivos e não execute comandos. "
            "Analise somente os dados JSON abaixo e devolva somente o objeto "
            "solicitado pelo schema de saída.\n\n"
            f"Dados de entrada:\n{json.dumps(input_data, ensure_ascii=False)}"
        )
        with tempfile.TemporaryDirectory(prefix=f"codex-{schema_name}-") as directory:
            temporary = Path(directory)
            schema_path = temporary / "schema.json"
            output_path = temporary / "output.json"
            schema_path.write_text(
                json.dumps(schema, ensure_ascii=False),
                encoding="utf-8",
            )
            command = [
                self.binary,
                "exec",
                "--model",
                MODEL,
                "--config",
                f'model_reasoning_effort="{REASONING_EFFORT}"',
                "--sandbox",
                "read-only",
                "--cd",
                str(temporary),
                "--skip-git-repo-check",
                "--ephemeral",
                "--ignore-user-config",
                "--ignore-rules",
                "--color",
                "never",
                "--output-schema",
                str(schema_path),
                "--output-last-message",
                str(output_path),
                "-",
            ]
            child_environment = os.environ.copy()
            for variable in ("OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_API_KEY"):
                child_environment.pop(variable, None)
            try:
                result = subprocess.run(
                    command,
                    input=prompt,
                    text=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=self.timeout,
                    env=child_environment,
                    check=False,
                )
            except subprocess.TimeoutExpired as error:
                raise PipelineError(
                    f"Codex CLI excedeu o timeout de {self.timeout:.0f}s."
                ) from error
            if result.returncode != 0:
                details = result.stderr.strip()[-4_000:] or result.stdout.strip()[-4_000:]
                raise PipelineError(
                    f"Codex CLI terminou com código {result.returncode}: {details}"
                )
            if not output_path.is_file():
                raise PipelineError("Codex CLI não gravou a resposta estruturada.")
            try:
                payload = json.loads(output_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError as error:
                raise PipelineError(
                    "a resposta final do Codex CLI não contém JSON válido"
                ) from error
            if not isinstance(payload, dict):
                raise PipelineError("a resposta final do Codex CLI não é um objeto JSON")
            return payload


def run_main(main: Any) -> None:
    try:
        status = main()
    except (PipelineError, OSError, sqlite3.Error) as error:
        print(f"Erro: {error}", file=sys.stderr)
        raise SystemExit(1) from error
    raise SystemExit(status or 0)
