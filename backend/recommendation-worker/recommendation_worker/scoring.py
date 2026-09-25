from __future__ import annotations

from dataclasses import dataclass
import math
import re
from typing import Iterable, Literal, Mapping
import unicodedata

import numpy as np


HYBRID_WEIGHTS = {
    "taste_similarity": 0.04,
    "nearest_like": 0.04,
    "collaborative_affinity": 0.12,
    "title_affinity": 0.24,
    "category_affinity": 0.17,
    "theme_affinity": 0.17,
    "entity_affinity": 0.17,
    "quality": 0.05,
    "dislike_similarity_penalty": 0.10,
    "collaborative_conflict_penalty": 0.15,
    "title_conflict_penalty": 0.25,
    "category_conflict_penalty": 0.35,
    "theme_conflict_penalty": 0.20,
    "entity_conflict_penalty": 0.20,
}

TITLE_STOPWORDS = frozenset(
    {
        "adult",
        "book",
        "edition",
        "filme",
        "from",
        "into",
        "livro",
        "movie",
        "para",
        "parte",
        "part",
        "sobre",
        "volume",
        "with",
    }
)


def normalized_text(value: str) -> str:
    normalized_value = "".join(
        character
        for character in unicodedata.normalize("NFKD", value.casefold())
        if not unicodedata.combining(character)
    )
    return re.sub(r"\s+", " ", normalized_value).strip()


def title_terms(title: str) -> tuple[str, ...]:
    normalized_title = normalized_text(title)
    terms = {
        term
        for term in re.findall(r"[a-z0-9]+", normalized_title)
        if len(term) >= 4
        and term not in TITLE_STOPWORDS
        and not term.isdigit()
        and not re.fullmatch(r"[ivxlcdm]+", term)
    }
    return tuple(sorted(terms))


def franchise_terms(title: str, entities: Iterable[str]) -> tuple[str, ...]:
    entity_terms = {
        term
        for entity in entities
        for term in re.findall(r"[a-z0-9]+", normalized_text(entity))
    }
    return tuple(sorted(set(title_terms(title)) & entity_terms))


def normalized(vector: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(vector))
    return vector / norm if norm > 0 else vector


def user_vector(
    positive: Iterable[np.ndarray],
    negative: Iterable[np.ndarray],
    negative_weight: float = 0.35,
) -> np.ndarray | None:
    positives = list(positive)
    if not positives:
        return None
    center = np.mean(positives, axis=0)
    negatives = list(negative)
    if negatives:
        center = center - negative_weight * np.mean(negatives, axis=0)
    return normalized(center)


def cosine(left: np.ndarray, right: np.ndarray) -> float:
    denominator = float(np.linalg.norm(left) * np.linalg.norm(right))
    if denominator == 0:
        return 0.0
    return float(np.dot(left, right) / denominator)


def bayesian_quality(rating: float | None, votes: int | None) -> float:
    if rating is None:
        return 0.35
    confidence = min(1.0, math.log1p(max(0, votes or 0)) / math.log1p(50_000))
    return max(0.0, min(1.0, (rating / 10.0) * (0.55 + 0.45 * confidence)))


def structured_affinity(
    values: Iterable[object],
    positive_counts: Mapping[object, int],
    negative_counts: Mapping[object, int],
    aggregation: Literal["mean", "max"] = "mean",
) -> tuple[float, float]:
    """Return positive affinity and explicit conflict for structured signals."""
    unique_values = set(values)
    if not unique_values:
        return 0.0, 0.0

    all_values = set(positive_counts) | set(negative_counts)
    positive_support = {
        value: max(
            0.0,
            float(positive_counts.get(value, 0))
            - 1.25 * float(negative_counts.get(value, 0)),
        )
        for value in all_values
    }
    negative_support = {
        value: max(
            0.0,
            float(negative_counts.get(value, 0))
            - float(positive_counts.get(value, 0)),
        )
        for value in all_values
    }
    positive_ceiling = max(positive_support.values(), default=0.0)
    negative_ceiling = max(negative_support.values(), default=0.0)
    normalized_positive = (
        [
            positive_support.get(value, 0.0) / positive_ceiling
            for value in unique_values
        ]
        if positive_ceiling > 0
        else []
    )
    affinity = (
        max(normalized_positive)
        if aggregation == "max" and normalized_positive
        else sum(normalized_positive) / len(unique_values)
        if normalized_positive
        else 0.0
    )
    conflict = (
        max(negative_support.get(value, 0.0) / negative_ceiling for value in unique_values)
        if negative_ceiling > 0
        else 0.0
    )
    return min(1.0, affinity), min(1.0, conflict)


def collaborative_affinity(
    positive_weight: float, negative_weight: float
) -> tuple[float, float]:
    """Return confidence-shrunk support and conflict from similar users."""
    positive = max(0.0, positive_weight)
    negative = max(0.0, negative_weight)
    denominator = 1.0 + positive + negative
    affinity = max(positive - 1.25 * negative, 0.0) / denominator
    conflict = max(negative - positive, 0.0) / denominator
    return min(1.0, affinity), min(1.0, conflict)


@dataclass(frozen=True)
class ScoreComponents:
    taste_similarity: float
    nearest_like: float
    collaborative_affinity: float
    title_affinity: float
    category_affinity: float
    theme_affinity: float
    entity_affinity: float
    quality: float
    dislike_similarity: float
    collaborative_conflict: float
    title_conflict: float
    category_conflict: float
    theme_conflict: float
    entity_conflict: float

    @property
    def total(self) -> float:
        value = (
            HYBRID_WEIGHTS["taste_similarity"] * self.taste_similarity
            + HYBRID_WEIGHTS["nearest_like"] * self.nearest_like
            + HYBRID_WEIGHTS["collaborative_affinity"]
            * self.collaborative_affinity
            + HYBRID_WEIGHTS["title_affinity"] * self.title_affinity
            + HYBRID_WEIGHTS["category_affinity"] * self.category_affinity
            + HYBRID_WEIGHTS["theme_affinity"] * self.theme_affinity
            + HYBRID_WEIGHTS["entity_affinity"] * self.entity_affinity
            + HYBRID_WEIGHTS["quality"] * self.quality
            - HYBRID_WEIGHTS["dislike_similarity_penalty"]
            * self.dislike_similarity
            - HYBRID_WEIGHTS["collaborative_conflict_penalty"]
            * self.collaborative_conflict
            - HYBRID_WEIGHTS["title_conflict_penalty"] * self.title_conflict
            - HYBRID_WEIGHTS["category_conflict_penalty"] * self.category_conflict
            - HYBRID_WEIGHTS["theme_conflict_penalty"] * self.theme_conflict
            - HYBRID_WEIGHTS["entity_conflict_penalty"] * self.entity_conflict
        )
        return max(0.0, min(1.0, value))
