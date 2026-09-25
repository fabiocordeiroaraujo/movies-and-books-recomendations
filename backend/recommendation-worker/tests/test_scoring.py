from __future__ import annotations

import unittest

import numpy as np

from recommendation_worker.scoring import (
    ScoreComponents,
    collaborative_affinity,
    franchise_terms,
    normalized_text,
    structured_affinity,
    title_terms,
    user_vector,
)


class ScoringTest(unittest.TestCase):
    @staticmethod
    def components(**overrides: float) -> ScoreComponents:
        values = {
            "taste_similarity": 0.0,
            "nearest_like": 0.0,
            "collaborative_affinity": 0.0,
            "title_affinity": 0.0,
            "category_affinity": 0.0,
            "theme_affinity": 0.0,
            "entity_affinity": 0.0,
            "quality": 0.0,
            "dislike_similarity": 0.0,
            "collaborative_conflict": 0.0,
            "title_conflict": 0.0,
            "category_conflict": 0.0,
            "theme_conflict": 0.0,
            "entity_conflict": 0.0,
        }
        values.update(overrides)
        return ScoreComponents(**values)

    def test_user_vector_requires_a_positive_signal(self) -> None:
        self.assertIsNone(user_vector([], [np.asarray([1.0, 0.0])]))

    def test_dislike_moves_the_profile_away_from_rejected_content(self) -> None:
        positive = np.asarray([1.0, 1.0], dtype=np.float32)
        rejected = np.asarray([0.0, 1.0], dtype=np.float32)
        vector = user_vector([positive], [rejected])
        self.assertIsNotNone(vector)
        assert vector is not None
        self.assertGreater(vector[0], vector[1])
        self.assertAlmostEqual(float(np.linalg.norm(vector)), 1.0, places=5)

    def test_score_is_calibrated_to_zero_one(self) -> None:
        score = self.components(
            taste_similarity=1,
            nearest_like=1,
            collaborative_affinity=1,
            title_affinity=1,
            category_affinity=1,
            theme_affinity=1,
            entity_affinity=1,
            quality=1,
        ).total
        self.assertGreaterEqual(score, 0)
        self.assertLessEqual(score, 1)

    def test_positive_weights_add_up_to_one(self) -> None:
        score = self.components(
            taste_similarity=1,
            nearest_like=1,
            collaborative_affinity=1,
            title_affinity=1,
            category_affinity=1,
            theme_affinity=1,
            entity_affinity=1,
            quality=1,
        ).total
        self.assertAlmostEqual(score, 1.0)

    def test_matching_title_or_franchise_has_largest_positive_weight(self) -> None:
        score = self.components(title_affinity=1).total
        self.assertAlmostEqual(score, 0.24)

    def test_similar_users_have_confidence_shrunk_influence(self) -> None:
        affinity, conflict = collaborative_affinity(0.8, 0.0)
        self.assertAlmostEqual(affinity, 0.8 / 1.8)
        self.assertEqual(conflict, 0.0)

    def test_similar_user_dislikes_override_weaker_support(self) -> None:
        affinity, conflict = collaborative_affinity(0.2, 0.8)
        self.assertEqual(affinity, 0.0)
        self.assertGreater(conflict, 0.0)

    def test_title_terms_connect_narnia_across_languages(self) -> None:
        english = set(title_terms("The Chronicles of Narnia (adult)"))
        portuguese = set(title_terms("As Crônicas de Nárnia: Príncipe Caspian"))
        self.assertIn("narnia", english & portuguese)

    def test_entities_ignore_case_and_diacritics(self) -> None:
        self.assertEqual(normalized_text("Nárnia"), normalized_text("NARNIA"))

    def test_franchise_terms_require_support_from_named_entities(self) -> None:
        terms = franchise_terms(
            "Harry Potter e as Relíquias da Morte - Parte 2",
            ["Harry Potter", "Lorde Voldemort"],
        )
        self.assertEqual(terms, ("harry", "potter"))

    def test_matching_character_or_entity_has_seventeen_percent_weight(self) -> None:
        score = self.components(entity_affinity=1).total
        self.assertAlmostEqual(score, 0.17)

    def test_exact_entity_match_is_not_diluted_by_other_entities(self) -> None:
        affinity, conflict = structured_affinity(
            ["Narnia", "Aslan", "White Witch"],
            {"Narnia": 1},
            {},
            aggregation="max",
        )
        self.assertEqual(affinity, 1.0)
        self.assertEqual(conflict, 0.0)

    def test_rejected_category_creates_a_strong_conflict(self) -> None:
        affinity, conflict = structured_affinity(
            [878, 27],
            {878: 21, 27: 0},
            {878: 0, 27: 2},
        )
        self.assertGreater(affinity, 0)
        self.assertEqual(conflict, 1.0)


if __name__ == "__main__":
    unittest.main()
