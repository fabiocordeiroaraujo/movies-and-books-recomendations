from __future__ import annotations

import argparse
import logging
import signal

from .runner import DailyRecommendationJob


def _interrupt(signum: int, _frame: object) -> None:
    raise InterruptedError(f"Worker interrupted by signal {signum}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Reel & Read recommendation worker")
    parser.add_argument("command", choices=["daily"])
    args = parser.parse_args()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    signal.signal(signal.SIGTERM, _interrupt)
    if args.command == "daily":
        DailyRecommendationJob().run()


if __name__ == "__main__":
    main()
