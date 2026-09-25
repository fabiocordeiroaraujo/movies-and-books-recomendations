from __future__ import annotations

from datetime import datetime, timedelta, timezone
import unittest

import numpy as np

from recommendation_worker.neural import build_temporal_examples


class TemporalExamplesTest(unittest.TestCase):
    def test_target_is_not_part_of_its_own_user_history(self) -> None:
        first = np.zeros(384, dtype=np.float32)
        first[0] = 1
        target = np.zeros(384, dtype=np.float32)
        target[1] = 1
        started = datetime(2026, 1, 1, tzinfo=timezone.utc)
        rows = [
            {
                "event_id": 1,
                "user_id": 7,
                "occurred_at": started,
                "preference": "LIKE",
                "type": "MOVIE",
                "embedding": first,
                "features": [1, 0.8, 0.5, 1],
                "user_features": [0.04],
            },
            {
                "event_id": 2,
                "user_id": 7,
                "occurred_at": started + timedelta(days=1),
                "preference": "LIKE",
                "type": "BOOK",
                "embedding": target,
                "features": [0, 0.7, 0.4, 1],
                "user_features": [0.04],
            },
        ]

        examples = build_temporal_examples(rows)

        self.assertEqual(len(examples), 1)
        np.testing.assert_array_equal(examples[0].user_history, first)
        self.assertFalse(np.array_equal(examples[0].user_history, target))


if __name__ == "__main__":
    unittest.main()
