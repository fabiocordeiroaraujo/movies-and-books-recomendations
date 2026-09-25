from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path
from typing import Sequence
from uuid import uuid4

import numpy as np

from .scoring import normalized


@dataclass(frozen=True)
class InteractionExample:
    user_id: int
    occurred_at: object
    item_type: str
    user_history: np.ndarray
    user_features: np.ndarray
    item_embedding: np.ndarray
    item_features: np.ndarray
    label: float


@dataclass(frozen=True)
class NeuralTrainingResult:
    artifact_uri: str
    checksum: str
    validation_metrics: dict[str, float]
    test_metrics: dict[str, float]


def build_temporal_examples(rows: Sequence[dict[str, object]]) -> list[InteractionExample]:
    """Build examples using only interactions strictly before the target event."""
    histories: dict[int, list[np.ndarray]] = {}
    examples: list[InteractionExample] = []
    ordered = sorted(rows, key=lambda row: (row["occurred_at"], row["event_id"]))
    for row in ordered:
        user_id = int(row["user_id"])
        embedding = np.asarray(row["embedding"], dtype=np.float32)
        prior = histories.setdefault(user_id, [])
        if prior:
            history = normalized(np.mean(prior, axis=0))
            examples.append(
                InteractionExample(
                    user_id=user_id,
                    occurred_at=row["occurred_at"],
                    item_type=str(row["type"]),
                    user_history=history,
                    user_features=np.asarray(row["user_features"], dtype=np.float32),
                    item_embedding=embedding,
                    item_features=np.asarray(row["features"], dtype=np.float32),
                    label=1.0 if row["preference"] == "LIKE" else 0.0,
                )
            )
        if row["preference"] == "LIKE":
            prior.append(embedding)
    return examples


def train_two_tower(
    examples: Sequence[InteractionExample], artifact_dir: str, seed: int = 41
) -> NeuralTrainingResult:
    import tensorflow as tf

    if len(examples) < 10:
        raise ValueError("At least 10 leakage-free examples are required")
    tf.keras.utils.set_random_seed(seed)
    split_train = max(1, int(len(examples) * 0.8))
    split_validation = max(split_train + 1, int(len(examples) * 0.9))

    def arrays(part: Sequence[InteractionExample]):
        return (
            {
                "user_history": np.stack([example.user_history for example in part]),
                "user_features": np.stack([example.user_features for example in part]),
                "item_embedding": np.stack([example.item_embedding for example in part]),
                "item_features": np.stack([example.item_features for example in part]),
            },
            np.asarray([example.label for example in part], dtype=np.float32),
        )

    training = examples[:split_train]
    validation = examples[split_train:split_validation]
    testing = examples[split_validation:]
    if not validation or not testing:
        raise ValueError("Temporal validation and test sets must not be empty")

    user_input = tf.keras.Input((384,), name="user_history")
    user_feature_input = tf.keras.Input((1,), name="user_features")
    item_input = tf.keras.Input((384,), name="item_embedding")
    feature_input = tf.keras.Input((4,), name="item_features")
    user_tower = tf.keras.layers.Concatenate()([user_input, user_feature_input])
    user_tower = tf.keras.layers.Dense(128, activation="relu")(user_tower)
    user_tower = tf.keras.layers.Dense(64, name="user_tower")(user_tower)
    item_tower = tf.keras.layers.Concatenate()([item_input, feature_input])
    item_tower = tf.keras.layers.Dense(128, activation="relu")(item_tower)
    item_tower = tf.keras.layers.Dense(64, name="item_tower")(item_tower)
    similarity = tf.keras.layers.Dot(axes=1, normalize=True)([user_tower, item_tower])
    output = tf.keras.layers.Dense(1, activation="sigmoid", name="score")(similarity)
    model = tf.keras.Model(
        [user_input, user_feature_input, item_input, feature_input], output
    )
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
        loss="binary_crossentropy",
        metrics=[tf.keras.metrics.AUC(name="auc")],
    )
    model.fit(*arrays(training), validation_data=arrays(validation), epochs=12, verbose=0)
    validation_metrics = model.evaluate(*arrays(validation), return_dict=True, verbose=0)
    test_metrics = model.evaluate(*arrays(testing), return_dict=True, verbose=0)
    validation_input, validation_labels = arrays(validation)
    test_input, test_labels = arrays(testing)
    validation_predictions = model.predict(validation_input, verbose=0).reshape(-1)
    test_predictions = model.predict(test_input, verbose=0).reshape(-1)
    baseline_scores = np.sum(
        validation_input["user_history"] * validation_input["item_embedding"], axis=1
    )
    baseline_auc = tf.keras.metrics.AUC()
    baseline_auc.update_state(validation_labels, baseline_scores)
    validation_metrics["baseline_auc"] = float(baseline_auc.result())
    validation_metrics.update(_ranking_metrics(validation, validation_predictions))
    validation_metrics.update(
        {
            f"baseline_{key}": value
            for key, value in _ranking_metrics(validation, baseline_scores).items()
        }
    )
    test_metrics.update(_ranking_metrics(testing, test_predictions))

    destination = Path(artifact_dir)
    destination.mkdir(parents=True, exist_ok=True)
    temporary_path = destination / f"two-tower-candidate-{uuid4().hex}.keras"
    model.save(temporary_path)
    checksum = hashlib.sha256(temporary_path.read_bytes()).hexdigest()
    path = destination / f"two-tower-{checksum}.keras"
    if path.exists():
        temporary_path.unlink()
    else:
        temporary_path.replace(path)
    return NeuralTrainingResult(
        artifact_uri=str(path),
        checksum=checksum,
        validation_metrics={key: float(value) for key, value in validation_metrics.items()},
        test_metrics={key: float(value) for key, value in test_metrics.items()},
    )


def _ranking_metrics(
    examples: Sequence[InteractionExample], scores: np.ndarray, k: int = 10
) -> dict[str, float]:
    metrics = _ranking_metrics_base(examples, scores, k)
    for item_type in ("BOOK", "MOVIE"):
        positions = [
            index for index, example in enumerate(examples) if example.item_type == item_type
        ]
        if not positions:
            continue
        subset = [examples[index] for index in positions]
        subset_scores = np.asarray([scores[index] for index in positions])
        metrics.update({
            f"{item_type.lower()}_{key}": value
            for key, value in _ranking_metrics_base(subset, subset_scores, k).items()
        })
    return metrics


def _ranking_metrics_base(
    examples: Sequence[InteractionExample], scores: np.ndarray, k: int
) -> dict[str, float]:
    by_user: dict[int, list[tuple[float, float]]] = {}
    for example, score in zip(examples, scores, strict=True):
        by_user.setdefault(example.user_id, []).append((float(score), example.label))
    precisions: list[float] = []
    recalls: list[float] = []
    ndcgs: list[float] = []
    for values in by_user.values():
        ranked = sorted(values, key=lambda value: value[0], reverse=True)[:k]
        precisions.append(sum(label for _, label in ranked) / min(k, len(values)))
        relevant = sum(label for _, label in values)
        recalls.append(
            sum(label for _, label in ranked) / relevant if relevant > 0 else 0.0
        )
        dcg = sum(
            label / np.log2(position + 2)
            for position, (_, label) in enumerate(ranked)
        )
        ideal_labels = sorted((label for _, label in values), reverse=True)[:k]
        ideal = sum(
            label / np.log2(position + 2)
            for position, label in enumerate(ideal_labels)
        )
        ndcgs.append(float(dcg / ideal) if ideal > 0 else 0.0)
    return {
        "precision_at_10": float(np.mean(precisions)) if precisions else 0.0,
        "recall_at_10": float(np.mean(recalls)) if recalls else 0.0,
        "ndcg_at_10": float(np.mean(ndcgs)) if ndcgs else 0.0,
    }
