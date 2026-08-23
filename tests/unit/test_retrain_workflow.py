from pathlib import Path

import yaml

WORKFLOW_PATH = Path(__file__).parents[2] / ".github" / "workflows" / "retrain.yml"
WORKFLOW = yaml.load(WORKFLOW_PATH.read_text(encoding="utf-8"), Loader=yaml.BaseLoader)
PROMOTE_STEPS = WORKFLOW["jobs"]["promote"]["steps"]


def _promote_step(name: str) -> dict:
    return next(step for step in PROMOTE_STEPS if step.get("name") == name)


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
    assert restore_settings["key"] == "silver-laps-${{ needs.train.outputs.n_silver_files_actual }}"
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
