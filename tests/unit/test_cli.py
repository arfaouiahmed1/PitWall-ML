from types import SimpleNamespace

import pitwall.cli as cli


def test_cli_without_command_prints_help(capsys) -> None:
    assert cli.app([]) == 0
    assert "Run PitWall ML" in capsys.readouterr().out


def test_cli_forwards_workflow_arguments(monkeypatch) -> None:
    calls: list[tuple[list[str], bool]] = []

    def fake_run(command: list[str], *, check: bool) -> SimpleNamespace:
        calls.append((command, check))
        return SimpleNamespace(returncode=7)

    monkeypatch.setattr(cli.subprocess, "run", fake_run)

    assert cli.app(["features", "--season", "2025"]) == 7
    assert calls == [([cli.sys.executable, "-m", "pipelines.features", "--season", "2025"], False)]
