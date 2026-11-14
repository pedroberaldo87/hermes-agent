"""Dashboard profile actions with a skill-registered passthrough on a multiplexed host.

Regression for #147694 / #130663: ``skills update``, ``doctor`` and ``backup`` spawned from the
dashboard of a multiplexed gateway died with ``UnscopedSecretError`` as soon as a skill had
registered an ``env_vars`` credential for passthrough, because the child env was scrubbed with
no profile secret scope bound. The fix must also keep the launch profile's value out of a
child that targets another profile.
"""

import pytest

from agent import secret_scope
from tools import env_passthrough
from tui_gateway import launch_profile_policy

SKILL_TOKEN = "SKILL_DASHBOARD_ACTION_TOKEN"


@pytest.mark.parametrize("env_only", [False, True], ids=["dotenv", "service-environment"])
def test_skill_passthrough_profile_action_under_multiplex(tmp_path, monkeypatch, env_only):
    from hermes_cli.web_server_gateway import _profile_action_environment

    root = tmp_path / "hermes"
    alpha = root / "profiles" / "alpha"
    alpha.mkdir(parents=True)
    for home in (root, alpha):
        (home / "config.yaml").write_text("{}\n", encoding="utf-8")
    (root / ".env").write_text(
        "" if env_only else f"{SKILL_TOKEN}=launch-secret\n", encoding="utf-8",
    )
    monkeypatch.setenv("HERMES_HOME", str(root))
    monkeypatch.setenv(SKILL_TOKEN, "launch-secret")
    monkeypatch.setattr(env_passthrough, "_allowed_env_vars", set())
    # The same call skills_tool makes for a skill's declared ``env_vars``.
    env_passthrough.register_env_passthrough([SKILL_TOKEN])
    assert env_passthrough.is_env_passthrough(SKILL_TOKEN)
    launch_profile_policy.activate_multi_profile_hosting()
    assert secret_scope.is_multiplex_active()
    # Dashboard request threads carry no routed profile scope.
    assert secret_scope.current_secret_scope() is None

    for argv in (["skills", "update"], ["doctor"], ["backup", "create"]):
        env = _profile_action_environment(["-p", "alpha", *argv])
        assert env["HERMES_HOME"] == str(alpha)
        assert SKILL_TOKEN not in env
    assert secret_scope.current_secret_scope() is None
