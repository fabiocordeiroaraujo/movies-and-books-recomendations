from __future__ import annotations

from dataclasses import dataclass
import hashlib
import re
from typing import Iterable


_WHITESPACE = re.compile(r"\s+")


def _clean(value: object | None) -> str:
    return _WHITESPACE.sub(" ", str(value or "")).strip()


def _join(values: Iterable[object] | None) -> str:
    return "; ".join(value for value in (_clean(item) for item in values or []) if value)


@dataclass(frozen=True)
class CanonicalItem:
    item_id: int
    item_type: str
    title: str
    subtitle: str | None
    original_title: str | None
    original_language: str
    authors: tuple[str, ...]
    categories: tuple[str, ...]
    original_category: str | None
    themes: tuple[str, ...]
    entities: tuple[str, ...]
    description: str | None
    completeness: float


def canonical_document(item: CanonicalItem) -> str:
    media_label = "livro" if item.item_type == "BOOK" else "filme"
    fields = [
        ("tipo", media_label),
        ("título", item.title),
        ("subtítulo", item.subtitle),
        ("título original", item.original_title),
        ("idioma", item.original_language),
        ("autores", _join(item.authors)),
        ("categorias", _join(item.categories)),
        ("categoria original", item.original_category),
        ("temas", _join(item.themes)),
        ("entidades", _join(item.entities)),
        ("descrição", item.description),
    ]
    lines = [f"{label}: {_clean(value)}" for label, value in fields if _clean(value)]
    return "passage: " + "\n".join(lines)


def content_hash(document: str, document_version: str) -> str:
    payload = f"{document_version}\0{document}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()
