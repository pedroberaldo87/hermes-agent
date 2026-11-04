"""A cloned profile gets its memory provider identity from ``create_profile`` itself, whatever the
entry point (CLI, ``POST /api/profiles``, Desktop Bot Mode ``profiles.create``), and in the
``honcho.json`` the new profile actually reads.

Regression: only the CLI called Honcho's ``clone_honcho_for_profile``, and it wrote the host block
into the launch home's file, while the clone already carried its own ``honcho.json`` copy. A profile
made by Bot Mode wrote the user's words as ``uid-501``.
"""

import json
from pathlib import Path

import pytest

from hermes_cli.profiles import create_profile

# A minimal stand-in for the catalog Honcho plugin: same entry point, same file semantics
# (read and write ``$HERMES_HOME/honcho.json``, add ``hosts.hermes_<profile>``).
_PLUGIN_INIT = "from agent.memory_provider import MemoryProvider  # noqa: F401\n"
_PLUGIN_CLI = '''
import json
from hermes_constants import get_hermes_home


class ConfigWriteRefused(Exception):
    pass


def clone_honcho_for_profile(profile_name):
    path = get_hermes_home() / "honcho.json"
    cfg = json.loads(path.read_text()) if path.exists() else {}
    if cfg.get("explode"):
        raise RuntimeError("honcho unreachable")
    host = f"hermes_{profile_name}"
    if host in cfg.setdefault("hosts", {}):
        return False
    cfg["hosts"][host] = {"aiPeer": profile_name, "peerName": cfg["hosts"]["hermes"]["peerName"]}
    path.write_text(json.dumps(cfg))
    return True
'''
_HONCHO = {"hosts": {"hermes": {"peerName": "890796724", "pinPeerName": True}}}


@pytest.fixture()
def home(tmp_path, monkeypatch):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    default = tmp_path / ".hermes"
    plugin = default / "plugins" / "honcho"
    plugin.mkdir(parents=True)
    (plugin / "__init__.py").write_text(_PLUGIN_INIT)
    (plugin / "cli.py").write_text(_PLUGIN_CLI)
    (default / "config.yaml").write_text("memory:\n  provider: honcho\n")
    (default / "honcho.json").write_text(json.dumps(_HONCHO))
    monkeypatch.setenv("HERMES_HOME", str(default))
    return default


def _hosts(path: Path) -> dict:
    return json.loads(path.read_text())["hosts"]


def test_api_clone_writes_the_block_into_the_profiles_own_honcho_json(home):
    """The dashboard / Bot Mode call shape: create_profile(clone_from=...), no CLI around it."""
    profile = create_profile("tio", clone_from="default", clone_config=True, no_alias=True)

    assert _hosts(profile / "honcho.json")["hermes_tio"] == {"aiPeer": "tio", "peerName": "890796724"}
    assert "hermes_tio" not in _hosts(home / "honcho.json")


def test_clone_all_gets_the_block_too(home):
    profile = create_profile("tio", clone_from="default", clone_all=True, no_alias=True)

    assert "hermes_tio" in _hosts(profile / "honcho.json")


def test_profile_without_its_own_copy_gets_the_block_in_the_default_file(home):
    """A source that reads the default's honcho.json gives the clone no copy; the clone then reads
    the default's file too, so that is where its block must land."""
    create_profile("base", clone_from="default", clone_config=True, no_alias=True).joinpath("honcho.json").unlink()

    profile = create_profile("tio", clone_from="base", clone_config=True, no_alias=True)

    assert not (profile / "honcho.json").exists()
    assert "hermes_tio" in _hosts(home / "honcho.json")


def test_other_provider_is_left_alone(home):
    (home / "config.yaml").write_text("memory:\n  provider: hindsight\n")

    profile = create_profile("tio", clone_from="default", clone_config=True, no_alias=True)

    assert not (profile / "honcho.json").exists()
    assert "hermes_tio" not in _hosts(home / "honcho.json")


def _strip_block(path: Path, host: str) -> None:
    cfg = json.loads(path.read_text())
    del cfg["hosts"][host]
    path.write_text(json.dumps(cfg))


def test_update_backfill_reaches_the_profiles_own_honcho_json(home):
    """A profile made before this fix carries its own honcho.json without its block; ``hermes update``
    used to add the block to the default's file, which that profile never reads."""
    from hermes_cli.profile_memory_identity import backfill_memory_provider_identities
    tio = create_profile("tio", clone_from="default", clone_config=True, no_alias=True)
    _strip_block(tio / "honcho.json", "hermes_tio")
    other = create_profile("other", clone_from="default", clone_config=True, no_alias=True)
    _strip_block(other / "honcho.json", "hermes_other")
    (other / "config.yaml").write_text("memory:\n  provider: hindsight\n")

    assert backfill_memory_provider_identities() == ["tio"]
    assert _hosts(tio / "honcho.json")["hermes_tio"]["peerName"] == "890796724"
    assert "hermes_other" not in _hosts(other / "honcho.json")
    assert set(_hosts(home / "honcho.json")) == {"hermes"}
    assert backfill_memory_provider_identities() == []


def test_a_failing_provider_hook_does_not_fail_creation(home):
    (home / "honcho.json").write_text(json.dumps({**_HONCHO, "explode": True}))

    profile = create_profile("tio", clone_from="default", clone_config=True, no_alias=True)

    assert profile.is_dir()
    assert "hermes_tio" not in _hosts(profile / "honcho.json")
