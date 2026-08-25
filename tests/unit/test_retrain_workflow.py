from pathlib import Path

import yaml

WORKFLOW_PATH = Path(__file__).parents[2] / ".github" / "workflows" / "retrain.yml"
WORKFLOW = yaml.load(WORKFLOW_PATH.read_text(encoding="utf-8"), Loader=yaml.BaseLoader)
DETECT_STEPS = WORKFLOW["jobs"]["detect"]["steps"]
TRAIN_STEPS = WORKFLOW["jobs"]["train"]["steps"]
PROMOTE_STEPS = WORKFLOW["jobs"]["promote"]["steps"]


def _promote_step(name: str) -> dict:
    return next(step for step in PROMOTE_STEPS if step.get("name") == name)


def _step(steps: list[dict], name: str) -> dict:
    return next(step for step in steps if step.get("name") == name)


def test_candidate_download_path_matches_promotion_cli_candidate() -> None:
    # Given: the candidate download and promotion steps
    download_step = _promote_step("Download candidate artifact")
    promotion_run = _promote_step("Promote candidate through gates")["run"]

    # When: their cross-job paths are compared
    downloaded_path = download_step["with"]["path"]

    # Then: the CLI consumes the exact directory populated by the download
    assert downloaded_path == "artifacts/candidate"
    assert f"--candidate {downloaded_path}" in promotion_run


def test_seeded_champion_exists_name_matches_promotion_guard() -> None:
    # Given: the champion seed and promotion scripts
    seed_run = _promote_step("Seed champion state")["run"]
    promotion_run = _promote_step("Promote candidate through gates")["run"]

    # When: the environment variable contract is inspected
    seeded_values = {
        'echo "CHAMPION_EXISTS=true" >> "$GITHUB_ENV"',
        'echo "CHAMPION_EXISTS=false" >> "$GITHUB_ENV"',
    }

    # Then: both branches write the uppercase variable read by promotion
    assert all(value in seed_run for value in seeded_values)
    assert 'if [ "$CHAMPION_EXISTS" != "true" ]' in promotion_run


def test_promote_restores_exact_trained_silver_cache_before_cli() -> None:
    # Given: the promote job steps
    restore_steps = [
        step for step in PROMOTE_STEPS if step.get("uses") == "actions/cache/restore@v4"
    ]

    # When: its cache restore contract is located
    assert len(restore_steps) == 1
    restore_step = restore_steps[0]
    restore_settings = restore_step["with"]

    # Then: promotion sees the exact silver snapshot produced by training
    assert PROMOTE_STEPS.index(restore_step) < PROMOTE_STEPS.index(
        _promote_step("Promote candidate through gates")
    )
    assert restore_settings["path"] == "data/silver/laps"
    assert restore_settings["key"] == "${{ needs.train.outputs.silver_cache_key }}"
    assert restore_settings["fail-on-cache-miss"] == "true"


def test_registry_dir_matches_uploaded_decisions_artifact() -> None:
    # Given: the promotion CLI and decisions upload steps
    promotion_run = _promote_step("Promote candidate through gates")["run"]
    upload_step = _promote_step("Upload decisions log")

    # When: their registry paths are inspected
    registry_dir = "artifacts/champion"

    # Then: the CLI writes the file uploaded by the workflow
    assert f"--registry-dir {registry_dir}" in promotion_run
    assert upload_step["with"]["path"] == f"{registry_dir}/decisions.jsonl"


def test_detect_bootstraps_and_validates_seed_before_counting_missing_races() -> None:
    # Given: a fresh runner with no silver cache
    cache_restore = _step(DETECT_STEPS, "Restore silver cache")
    bootstrap = _step(DETECT_STEPS, "Bootstrap silver seed")
    validate = _step(DETECT_STEPS, "Validate complete silver lake")
    detect = _step(DETECT_STEPS, "Detect missing races")

    # Then: cache miss -> verified seed -> completeness gate -> detection
    assert cache_restore["id"] == "silver-cache"
    assert bootstrap["if"] == "steps.silver-cache.outputs.cache-hit != 'true'"
    assert "--config configs/silver_seed.json" in bootstrap["run"]
    assert "--download" in bootstrap["run"]
    assert "--validate-only" in validate["run"]
    assert DETECT_STEPS.index(validate) < DETECT_STEPS.index(detect)


def test_train_fails_closed_after_ingest_if_silver_lake_is_partial() -> None:
    # Given: training restored or bootstrapped a silver lake
    validate = _step(TRAIN_STEPS, "Validate complete silver lake")
    train = _step(TRAIN_STEPS, "Train candidate")

    # Then: validation must run before the production trainer
    assert "--validate-only" in validate["run"]
    assert TRAIN_STEPS.index(validate) < TRAIN_STEPS.index(train)
    assert "--require-real-data" in train["run"]


def test_seed_cache_key_is_content_addressed() -> None:
    # Given: seed bootstrap cache-save steps
    save_steps = [step for step in DETECT_STEPS if step.get("uses") == "actions/cache/save@v4"]

    # Then: the seed cache key changes when its checked-in manifest changes
    assert len(save_steps) == 1
    assert "hashFiles('configs/silver_seed.json')" in save_steps[0]["with"]["key"]
