"""A refused turn-admission RPC leaves its reason in the gateway log.

The desktop's queue drain swallows a refused ``prompt.submit`` as a bare ``false`` and retries;
after four tries it shows "Queued message not sent" with no cause anywhere. The gateway log is
the one place the refusal's code and reason can survive."""

from __future__ import annotations

import logging

from tui_gateway import server


def _refusals(caplog) -> list[str]:
    return [r.getMessage() for r in caplog.records if r.getMessage().startswith("rpc refused:")]


def test_a_refused_prompt_submit_is_logged_with_its_code(caplog):
    caplog.set_level(logging.INFO)
    resp = server.handle_request({"id": "1", "method": "prompt.submit",
                                  "params": {"session_id": "no-such-session", "text": "hello", "queued": True}})
    assert "error" in resp, resp
    code = resp["error"]["code"]
    [line] = _refusals(caplog)
    assert "method=prompt.submit" in line
    assert "session=no-such-session" in line
    assert f"code={code}" in line
    assert "queued=True" in line


def test_the_refusal_line_never_carries_the_prompt_text(caplog):
    caplog.set_level(logging.INFO)
    server.handle_request({"id": "1", "method": "prompt.submit",
                           "params": {"session_id": "no-such-session", "text": "my private words"}})
    assert _refusals(caplog)
    assert all("my private words" not in line for line in _refusals(caplog))


def test_a_refused_session_resume_is_logged(caplog):
    caplog.set_level(logging.INFO)
    resp = server.handle_request({"id": "1", "method": "session.resume",
                                  "params": {"session_id": "20000101_000000_nosuch"}})
    assert "error" in resp, resp
    [line] = _refusals(caplog)
    assert "method=session.resume" in line


def test_other_methods_and_successes_stay_quiet(caplog):
    caplog.set_level(logging.INFO)
    server.handle_request({"id": "1", "method": "image.attach", "params": {"session_id": "no-such-session"}})
    assert _refusals(caplog) == []
