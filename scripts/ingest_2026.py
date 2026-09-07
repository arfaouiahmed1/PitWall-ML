"""Ingest all 2026 OpenF1 sessions (practice, quali, sprint, race) into Bronze.

Resumable: completed sessions are detected by existing bronze filesystem paths,
so interruptions (rate limits, timeout) do not re-ingest.
"""
from __future__ import annotations

import pathlib
import time

import httpx
import polars as pl

from pitwall.ingest.openf1 import ingest_session_bronze

OUT = pathlib.Path("data/bronze")
RATE_LIMIT_ATTEMPTS = 5


def passed_sessions() -> pl.DataFrame:
    client = httpx.Client(timeout=20)
    r = client.get("https://api.openf1.org/v1/sessions?year=2026")
    r.raise_for_status()
    df = pl.DataFrame(r.json())
    return df.filter(pl.col("date_start") <= "2026-09-07").sort("date_start")


def event_name(location: str) -> str:
    return location.replace(" ", "_")


def already_ingested(sk: int, event: str, stype: str) -> bool:
    p = OUT / "year=2026" / f"event={event}" / f"session_type={stype}"
    return (p / "laps.parquet").exists() and (p / "stints.parquet").exists()

def main() -> None:
    sessions = passed_sessions()
    print(f"2026 sessions passed: {len(sessions)}")

    completed = 0
    skipped = 0
    failed_sk: list[int] = []

    for row in sessions.iter_rows(named=True):
        sk = row["session_key"]
        sname = row.get("session_name") or row.get("session_type") or "Race"
        stype = sname if sname == "Day_1" or sname == "Day_2" or sname == "Day_3" else sname.replace(" ", "_")
        event = event_name(row.get("location", "Unknown"))

        if already_ingested(sk, event, stype):
            skipped += 1
            continue

        for attempt in range(RATE_LIMIT_ATTEMPTS):
            try:
                written = ingest_session_bronze(
                    session_key=sk,
                    year=row["year"],
                    event_name=event,
                    session_type=stype,
                    output_dir=str(OUT),
                )
                if written:
                    completed += 1
                break
            except RuntimeError as e:
                if "rate limit" in str(e).lower():
                    wait = 15 * (attempt + 1)
                    print(f"  rate limited on {sk}, backing off {wait}s...")
                    time.sleep(wait)
                    continue
                print(f"  FAILED {event}/{stype} ({sk}): {e}")
                failed_sk.append(sk)
                break
            except Exception as e:
                print(f"  FAILED {event}/{stype} ({sk}): {e}")
                failed_sk.append(sk)
                break
        else:
            print(f"  DROPPED {event}/{stype} ({sk}) after {RATE_LIMIT_ATTEMPTS} rate-limit retries")
            failed_sk.append(sk)

        time.sleep(1.0)

    print(f"\nCompleted: {completed}   Skipped(existing): {skipped}   Failed: {len(failed_sk)}")


if __name__ == "__main__":
    main()