from __future__ import annotations

import unittest

from recommendation_worker.canonical import (
    CanonicalItem,
    canonical_document,
    content_hash,
)


class CanonicalDocumentTest(unittest.TestCase):
    def item(self) -> CanonicalItem:
        return CanonicalItem(
            item_id=1,
            item_type="BOOK",
            title="  Gilead ",
            subtitle=None,
            original_title=None,
            original_language="en",
            authors=("Marilynne   Robinson",),
            categories=("Drama",),
            original_category="Fiction",
            themes=("família", "fé"),
            entities=("John Ames", "Iowa"),
            description="Uma   descrição\n determinística.",
            completeness=1.0,
        )

    def test_builds_a_deterministic_e5_passage(self) -> None:
        document = canonical_document(self.item())
        self.assertTrue(document.startswith("passage: tipo: livro"))
        self.assertIn("autores: Marilynne Robinson", document)
        self.assertNotIn("  ", document)
        self.assertEqual(
            content_hash(document, "v1"), content_hash(document, "v1")
        )

    def test_hash_changes_with_semantic_content_or_contract(self) -> None:
        document = canonical_document(self.item())
        changed = document.replace("Gilead", "Housekeeping")
        self.assertNotEqual(content_hash(document, "v1"), content_hash(changed, "v1"))
        self.assertNotEqual(content_hash(document, "v1"), content_hash(document, "v2"))


if __name__ == "__main__":
    unittest.main()
