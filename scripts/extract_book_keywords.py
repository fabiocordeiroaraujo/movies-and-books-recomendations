#!/usr/bin/env python3
"""Compatibilidade: extrai keywords de um CSV de livros usando LLM."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path)
    args = parser.parse_args()
    extractor = Path(__file__).with_name("extract_keywords_llm.py")
    os.execv(
        sys.executable,
        [
            sys.executable,
            str(extractor),
            "--kind",
            "books",
            "--input",
            str(args.csv),
            "--output",
            str(args.csv),
        ],
    )


if __name__ == "__main__":
    main()
