#!/usr/bin/env python3
"""Baixa metadados de filmes da API do TMDB e gera um arquivo CSV."""

from __future__ import annotations

import argparse
import csv
import json
import os
import random
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


API_BASE_URL = "https://api.themoviedb.org/3"
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = PROJECT_ROOT / "csv" / "Original_TMDB_movies.csv"
DEFAULT_ENV_FILE = PROJECT_ROOT / ".env"
MAX_API_PAGES = 500
USER_AGENT = "movies-and-books-recommendations/1.0"

CSV_FIELDS = (
    "tmdb_id",
    "title",
    "original_title",
    "original_language",
    "overview",
    "release_date",
    "release_year",
    "adult",
    "video",
    "popularity",
    "vote_average",
    "vote_count",
    "genre_ids",
    "genre_names",
    "poster_path",
    "poster_url",
    "backdrop_path",
    "backdrop_url",
    "tmdb_url",
    "fetched_at",
)


class TmdbApiError(RuntimeError):
    """Erro retornado ou provocado durante uma consulta ao TMDB."""


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Baixa filmes do endpoint Discover do TMDB e gera um CSV com "
            "URLs completas de pôster e backdrop."
        )
    )
    parser.add_argument(
        "--pages",
        type=int,
        default=100,
        help="Quantidade de páginas do Discover (1–500; padrão: 100).",
    )
    parser.add_argument(
        "--language",
        default="pt-BR",
        help="Idioma dos metadados (padrão: pt-BR).",
    )
    parser.add_argument(
        "--region",
        default="BR",
        help="Região usada nas datas de lançamento; vazio desabilita (padrão: BR).",
    )
    parser.add_argument(
        "--sort-by",
        default="popularity.desc",
        help="Ordenação aceita pelo Discover (padrão: popularity.desc).",
    )
    parser.add_argument(
        "--min-votes",
        type=int,
        default=0,
        help="Quantidade mínima de votos (padrão: 0).",
    )
    parser.add_argument(
        "--include-adult",
        action="store_true",
        help="Inclui títulos classificados como conteúdo adulto.",
    )
    parser.add_argument(
        "--include-without-poster",
        action="store_true",
        help="Mantém filmes sem poster_path. Por padrão eles são descartados.",
    )
    parser.add_argument(
        "--poster-size",
        default="w500",
        help="Tamanho de pôster informado por /configuration (padrão: w500).",
    )
    parser.add_argument(
        "--backdrop-size",
        default="w780",
        help="Tamanho de backdrop informado por /configuration (padrão: w780).",
    )
    parser.add_argument(
        "--request-delay",
        type=float,
        default=0.25,
        help="Espera entre páginas, em segundos (padrão: 0.25).",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=30.0,
        help="Timeout de cada requisição, em segundos (padrão: 30).",
    )
    parser.add_argument(
        "--max-retries",
        type=int,
        default=5,
        help="Tentativas para 429, 5xx e falhas transitórias (padrão: 5).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Arquivo CSV de saída (padrão: {DEFAULT_OUTPUT}).",
    )
    parser.add_argument(
        "--env-file",
        type=Path,
        default=DEFAULT_ENV_FILE,
        help=f"Arquivo que contém TMDB_READ_ACCESS_TOKEN (padrão: {DEFAULT_ENV_FILE}).",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Substitui o arquivo de saída se ele já existir.",
    )

    args = parser.parse_args()
    if not 1 <= args.pages <= MAX_API_PAGES:
        parser.error("--pages deve estar entre 1 e 500")
    if args.min_votes < 0:
        parser.error("--min-votes não pode ser negativo")
    if args.request_delay < 0:
        parser.error("--request-delay não pode ser negativo")
    if args.timeout <= 0:
        parser.error("--timeout deve ser maior que zero")
    if args.max_retries < 0:
        parser.error("--max-retries não pode ser negativo")
    return args


def read_token(env_file: Path) -> str:
    token = os.environ.get("TMDB_READ_ACCESS_TOKEN", "").strip()
    if token:
        return token

    if env_file.is_file():
        for raw_line in env_file.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            if key.strip() == "TMDB_READ_ACCESS_TOKEN":
                token = value.strip().strip("\"").strip("'")
                if token:
                    return token

    raise TmdbApiError(
        "TMDB_READ_ACCESS_TOKEN não foi definido. Copie .env.example para .env, "
        "preencha o API Read Access Token e execute novamente."
    )


def retry_delay(error: HTTPError, attempt: int) -> float:
    retry_after = error.headers.get("Retry-After")
    if retry_after:
        try:
            return min(float(retry_after), 60.0)
        except ValueError:
            pass
    return min(2**attempt + random.uniform(0.0, 0.5), 60.0)


def request_json(
    path: str,
    token: str,
    *,
    params: dict[str, Any] | None = None,
    timeout: float,
    max_retries: int,
) -> dict[str, Any]:
    query = f"?{urlencode(params)}" if params else ""
    url = f"{API_BASE_URL}{path}{query}"
    request = Request(
        url,
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {token}",
            "User-Agent": USER_AGENT,
        },
        method="GET",
    )

    for attempt in range(max_retries + 1):
        try:
            with urlopen(request, timeout=timeout) as response:
                payload = json.load(response)
            if not isinstance(payload, dict):
                raise TmdbApiError(f"Resposta inesperada em {path}: não é um objeto JSON")
            return payload
        except HTTPError as error:
            retryable = error.code == 429 or 500 <= error.code <= 599
            if retryable and attempt < max_retries:
                delay = retry_delay(error, attempt)
                print(
                    f"TMDB respondeu HTTP {error.code}; nova tentativa em {delay:.1f}s...",
                    file=sys.stderr,
                )
                time.sleep(delay)
                continue
            try:
                body = error.read().decode("utf-8", errors="replace")[:500]
            except Exception:
                body = ""
            raise TmdbApiError(
                f"Falha HTTP {error.code} ao consultar {path}. {body}"
            ) from error
        except (TimeoutError, URLError, json.JSONDecodeError) as error:
            if attempt < max_retries:
                delay = min(2**attempt + random.uniform(0.0, 0.5), 60.0)
                print(
                    f"Falha transitória em {path}; nova tentativa em {delay:.1f}s...",
                    file=sys.stderr,
                )
                time.sleep(delay)
                continue
            raise TmdbApiError(f"Não foi possível consultar {path}: {error}") from error

    raise AssertionError("fluxo de repetição terminou sem resposta")


def validate_image_size(requested: str, available: list[str], image_type: str) -> str:
    if requested not in available:
        choices = ", ".join(available)
        raise TmdbApiError(
            f"Tamanho {requested!r} não disponível para {image_type}. "
            f"Valores aceitos: {choices}"
        )
    return requested


def image_url(base_url: str, size: str, file_path: str | None) -> str:
    if not file_path:
        return ""
    return f"{base_url.rstrip('/')}/{size}/{file_path.lstrip('/')}"


def movie_to_row(
    movie: dict[str, Any],
    *,
    genres: dict[int, str],
    image_base_url: str,
    poster_size: str,
    backdrop_size: str,
    fetched_at: str,
) -> dict[str, Any]:
    genre_ids = [int(value) for value in movie.get("genre_ids") or []]
    release_date = str(movie.get("release_date") or "")
    release_year = release_date[:4] if re.fullmatch(r"\d{4}-\d{2}-\d{2}", release_date) else ""
    poster_path = str(movie.get("poster_path") or "")
    backdrop_path = str(movie.get("backdrop_path") or "")
    tmdb_id = int(movie["id"])

    return {
        "tmdb_id": tmdb_id,
        "title": movie.get("title") or "",
        "original_title": movie.get("original_title") or "",
        "original_language": movie.get("original_language") or "",
        "overview": movie.get("overview") or "",
        "release_date": release_date,
        "release_year": release_year,
        "adult": str(bool(movie.get("adult"))).lower(),
        "video": str(bool(movie.get("video"))).lower(),
        "popularity": movie.get("popularity") if movie.get("popularity") is not None else "",
        "vote_average": movie.get("vote_average") if movie.get("vote_average") is not None else "",
        "vote_count": movie.get("vote_count") if movie.get("vote_count") is not None else "",
        "genre_ids": "|".join(str(value) for value in genre_ids),
        "genre_names": "|".join(genres.get(value, str(value)) for value in genre_ids),
        "poster_path": poster_path,
        "poster_url": image_url(image_base_url, poster_size, poster_path),
        "backdrop_path": backdrop_path,
        "backdrop_url": image_url(image_base_url, backdrop_size, backdrop_path),
        "tmdb_url": f"https://www.themoviedb.org/movie/{tmdb_id}",
        "fetched_at": fetched_at,
    }


def write_csv(rows: list[dict[str, Any]], output: Path, overwrite: bool) -> None:
    output = output.expanduser().resolve()
    if output.exists() and not overwrite:
        raise TmdbApiError(
            f"O arquivo {output} já existe. Use --overwrite para substituí-lo."
        )

    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f".{output.name}.tmp")
    try:
        with temporary.open("w", encoding="utf-8", newline="") as csv_file:
            writer = csv.DictWriter(csv_file, fieldnames=CSV_FIELDS, lineterminator="\n")
            writer.writeheader()
            writer.writerows(rows)
        os.replace(temporary, output)
    finally:
        if temporary.exists():
            temporary.unlink()


def main() -> int:
    args = parse_arguments()
    if args.output.expanduser().exists() and not args.overwrite:
        raise TmdbApiError(
            f"O arquivo {args.output.expanduser().resolve()} já existe. "
            "Use --overwrite para substituí-lo."
        )
    token = read_token(args.env_file.expanduser())

    configuration = request_json(
        "/configuration",
        token,
        timeout=args.timeout,
        max_retries=args.max_retries,
    )
    images = configuration.get("images") or {}
    image_base_url = str(images.get("secure_base_url") or "")
    if not image_base_url:
        raise TmdbApiError("A configuração do TMDB não retornou secure_base_url")

    poster_size = validate_image_size(
        args.poster_size,
        list(images.get("poster_sizes") or []),
        "pôster",
    )
    backdrop_size = validate_image_size(
        args.backdrop_size,
        list(images.get("backdrop_sizes") or []),
        "backdrop",
    )

    genre_payload = request_json(
        "/genre/movie/list",
        token,
        params={"language": args.language},
        timeout=args.timeout,
        max_retries=args.max_retries,
    )
    genres = {
        int(item["id"]): str(item["name"])
        for item in genre_payload.get("genres") or []
        if "id" in item and "name" in item
    }

    base_params: dict[str, Any] = {
        "include_adult": str(args.include_adult).lower(),
        "include_video": "false",
        "language": args.language,
        "sort_by": args.sort_by,
        "vote_count.gte": args.min_votes,
    }
    if args.region:
        base_params["region"] = args.region

    fetched_at = datetime.now(timezone.utc).isoformat()
    movies_by_id: dict[int, dict[str, Any]] = {}
    without_poster = 0
    pages_to_fetch = args.pages

    for page in range(1, args.pages + 1):
        if page > pages_to_fetch:
            break
        params = {**base_params, "page": page}
        payload = request_json(
            "/discover/movie",
            token,
            params=params,
            timeout=args.timeout,
            max_retries=args.max_retries,
        )

        if page == 1:
            available_pages = min(int(payload.get("total_pages") or 1), MAX_API_PAGES)
            pages_to_fetch = min(args.pages, available_pages)
            print(
                f"TMDB informou {available_pages} página(s); "
                f"serão consultadas {pages_to_fetch}.",
                file=sys.stderr,
            )

        results = payload.get("results") or []
        if not results:
            print(f"Página {page} sem resultados; coleta encerrada.", file=sys.stderr)
            break

        for movie in results:
            if not isinstance(movie, dict) or "id" not in movie:
                continue
            if not movie.get("poster_path") and not args.include_without_poster:
                without_poster += 1
                continue
            row = movie_to_row(
                movie,
                genres=genres,
                image_base_url=image_base_url,
                poster_size=poster_size,
                backdrop_size=backdrop_size,
                fetched_at=fetched_at,
            )
            movies_by_id[int(row["tmdb_id"])] = row

        print(
            f"Página {page}/{pages_to_fetch}: {len(movies_by_id)} filme(s) único(s).",
            file=sys.stderr,
        )
        if page < pages_to_fetch and args.request_delay:
            time.sleep(args.request_delay)

    rows = sorted(
        movies_by_id.values(),
        key=lambda row: (-float(row["popularity"] or 0), int(row["tmdb_id"])),
    )
    write_csv(rows, args.output, args.overwrite)
    print(
        f"Concluído: {len(rows)} filme(s) gravados em {args.output.expanduser().resolve()}. "
        f"Registros sem pôster descartados: {without_poster}.",
        file=sys.stderr,
    )
    print(
        "Próximo passo: execute `./scripts/run_data_pipeline.sh` antes de carregar o banco.",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (TmdbApiError, KeyboardInterrupt) as error:
        message = "operação interrompida" if isinstance(error, KeyboardInterrupt) else str(error)
        print(f"Erro: {message}", file=sys.stderr)
        raise SystemExit(1) from None
