"""``hermes update --no-pull`` installs the checked-out commit without fetching or merging.

A deploy tool (Pedro's hermes-sync) checks out the exact commit it validated, then needs the rest
of the update (deps, plugins, migrations, Desktop rebuild, gateway restart) for THAT commit. Without
``--no-pull`` the update fetches and, with ``updates.parked_branch_strategy: update_in_place``,
merges the newest ``origin/main`` into the checked-out branch: on 2026-11-12 that merge pulled 86
unvalidated upstream commits onto one Mac and conflicted on the other (receipt ``merge_conflict``).

Real git repositories (no mocked subprocess), same harness as test_update_parked_branch_guard.py.
"""

import argparse
import json
import subprocess
from types import SimpleNamespace

import pytest

from hermes_cli import main as hermes_main
from hermes_cli import main_install_repair
from hermes_cli import main_web_build
from hermes_cli import update_cmd
from hermes_cli.subcommands.update import build_update_parser


def _git(cwd, *args, check=True):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=check)


def _rev(repo, ref="HEAD"):
    return _git(repo, "rev-parse", ref).stdout.strip()


@pytest.fixture()
def repo_pair(tmp_path):
    """Clone parked on ``tars/integration`` (c1 + a local commit); origin/main has c2, c3 already
    fetched and c4 published upstream but not fetched yet."""
    origin = tmp_path / "origin"
    origin.mkdir()
    _git(origin, "init", "-q", "-b", "main")
    _git(origin, "config", "user.email", "test@example.com")
    _git(origin, "config", "user.name", "Test")
    (origin / "a.txt").write_text("one\n", encoding="utf-8")
    _git(origin, "add", "a.txt")
    _git(origin, "commit", "-qm", "c1")
    clone = tmp_path / "clone"
    _git(tmp_path, "clone", "-q", str(origin), str(clone))
    _git(clone, "config", "user.email", "test@example.com")
    _git(clone, "config", "user.name", "Test")
    _git(clone, "checkout", "-qb", "tars/integration")
    (clone / "patch.txt").write_text("local patch\n", encoding="utf-8")
    _git(clone, "add", "patch.txt")
    _git(clone, "commit", "-qm", "local patch")
    for name, text in (("a.txt", "two\n"), ("b.txt", "three\n")):
        (origin / name).write_text(text, encoding="utf-8")
        _git(origin, "add", name)
        _git(origin, "commit", "-qm", f"upstream {name}")
    _git(clone, "fetch", "-q", "origin", "main")
    (origin / "c.txt").write_text("unfetched\n", encoding="utf-8")
    _git(origin, "add", "c.txt")
    _git(origin, "commit", "-qm", "c4 not fetched")
    return clone


@pytest.fixture()
def update_flow(repo_pair, monkeypatch):
    """Point ``cmd_update`` at the clone with update_in_place configured; capture the completion
    request (and the open receipt) instead of running the dependency/restart tail."""
    import hermes_cli.config as hermes_config

    # The fixture repo is not the interpreter's own checkout: never hand off to that one's updater.
    monkeypatch.setattr("hermes_cli.update_owning_install.retarget_to_owning_install", lambda *_: None)
    monkeypatch.setattr(hermes_config, "load_config",
                        lambda: {"updates": {"parked_branch_strategy": "update_in_place"}})
    monkeypatch.setattr(hermes_main, "PROJECT_ROOT", repo_pair)
    monkeypatch.setattr(hermes_main, "_resolve_update_branch", lambda args: "main")
    monkeypatch.setattr(hermes_main, "_is_windows", lambda: False)
    monkeypatch.setattr(main_install_repair, "_is_windows", lambda: False)
    monkeypatch.setattr(hermes_main, "_get_origin_url",
                        lambda *a, **k: "https://github.com/NousResearch/hermes-agent.git")
    monkeypatch.setattr(update_cmd, "_is_fork", lambda *a, **k: False)
    monkeypatch.setattr(update_cmd, "_discard_lockfile_churn", lambda *a, **k: None)
    monkeypatch.setattr(update_cmd, "_normalize_managed_eol", lambda *a, **k: None)
    monkeypatch.setattr(hermes_main, "_clear_bytecode_cache", lambda *a, **k: 0)
    monkeypatch.setattr(hermes_main, "_record_bytecode_fingerprint", lambda *a, **k: None)
    monkeypatch.setattr(main_web_build, "_record_bytecode_fingerprint", lambda *a, **k: None)
    monkeypatch.setattr(hermes_main, "_run_pre_update_backup", lambda *a, **k: None)
    monkeypatch.setattr(hermes_main, "_pause_windows_gateways_for_update", lambda: None)
    monkeypatch.setattr(hermes_main, "_resume_windows_gateways_after_update", lambda *a, **k: None)
    completed = []

    def fake_complete(request):
        current = update_cmd._completion_receipt._current.get()
        completed.append({"request": dict(request), "receipt": dict(current.data) if current else {}})

    monkeypatch.setattr(update_cmd, "_complete_source_update", fake_complete)
    return repo_pair, completed


def _run_traced(repo, tmp_path, monkeypatch, args):
    """Run ``cmd_update`` with git's trace2 on; return every git argv the update started."""
    trace = tmp_path / "trace2.json"
    monkeypatch.setenv("GIT_TRACE2_EVENT", str(trace))
    try:
        hermes_main.cmd_update(args)
    finally:
        monkeypatch.delenv("GIT_TRACE2_EVENT")
    if not trace.exists():
        return []
    events = [json.loads(line) for line in trace.read_text(encoding="utf-8").splitlines() if line.strip()]
    return [e["argv"] for e in events if e.get("event") == "start"]


def _args(**overrides):
    base = dict(branch=None, yes=True, force=False, force_venv=False, no_pull=True)
    base.update(overrides)
    return SimpleNamespace(**base)


@pytest.mark.parametrize("detached", [False, True], ids=["parked-branch-update-in-place", "detached-head"])
def test_no_pull_installs_head_without_fetch_or_merge(update_flow, tmp_path, monkeypatch, capsys, detached):
    repo, completed = update_flow
    if detached:
        _git(repo, "checkout", "-q", "--detach", "HEAD")
    head, origin_main = _rev(repo), _rev(repo, "origin/main")
    branch = _git(repo, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip()

    started = _run_traced(repo, tmp_path, monkeypatch, _args())

    # The checkout never moved: same commit, same branch (or still detached), no upstream file.
    assert _rev(repo) == head
    assert _git(repo, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip() == branch
    assert not (repo / "b.txt").exists()
    assert (repo / "a.txt").read_text(encoding="utf-8") == "one\n"
    # Nothing was fetched or merged: origin/main still predates c4, no fetch/merge/pull ran.
    assert _rev(repo, "origin/main") == origin_main
    verbs = {argv[1] for argv in started if len(argv) > 1}
    assert "rev-parse" in verbs  # the trace saw the update's git calls
    assert not verbs & {"fetch", "merge", "pull", "reset", "switch", "checkout", "stash"}, sorted(verbs)
    # ...and the post-code tail still ran, pinned to HEAD, with the receipt saying it did not pull.
    assert len(completed) == 1
    assert completed[0]["request"]["expected_sha"] == head
    assert completed[0]["receipt"].get("pulled") is False
    assert "pull" in [s["name"] for s in completed[0]["receipt"].get("skips", [])]
    assert "--no-pull" in capsys.readouterr().out


@pytest.mark.parametrize("flag", [{"branch": "main"}, {"channel": "stable"}, {"switch_branch": True}])
def test_no_pull_refuses_a_flag_that_picks_another_target(update_flow, tmp_path, monkeypatch, capsys, flag):
    repo, completed = update_flow
    head = _rev(repo)

    with pytest.raises(SystemExit) as exc_info:
        hermes_main.cmd_update(_args(**flag))

    assert exc_info.value.code == 2
    assert completed == []
    assert _rev(repo) == head
    assert "--no-pull" in capsys.readouterr().out


def test_update_help_lists_no_pull():
    """hermes-sync probes support with `hermes update --help | grep -q -- --no-pull`."""
    parser = argparse.ArgumentParser(prog="hermes")
    sub = parser.add_subparsers()
    build_update_parser(sub, cmd_update=lambda args: None)
    assert "--no-pull" in sub.choices["update"].format_help()
    assert parser.parse_args(["update", "--no-pull"]).no_pull is True
    assert parser.parse_args(["update"]).no_pull is False
