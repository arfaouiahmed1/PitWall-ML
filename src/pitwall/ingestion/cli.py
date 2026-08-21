"""CLI entry for ingestion."""


def main():
    # delegated to pipelines.ingest
    from pipelines.ingest import main as ingest_main

    ingest_main()


if __name__ == "__main__":
    main()
