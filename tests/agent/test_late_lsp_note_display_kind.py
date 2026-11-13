"""The late language-server note is Hermes talking, not the user.

``apply_stop_gates`` sends the model back with a role=user ``[System note: the language server
reported problems …]`` row. Persisted untyped, every consumer that reads "role=user, no
display_kind" as the person's words took it for them: the Desktop/TUI transcript painted it as a
user bubble, the turn receipt bound an optimistic bubble to it, and memory audits flagged it as a
user message missing from external memory. Typed ``hidden``, it stays out of every human view while
the model keeps reading it byte-for-byte, on the live turn and on every replay.

Through a real ``AIAgent`` + ``SessionDB`` against the loopback model.
"""

import os
from pathlib import Path

import pytest

from tests.fakes.fake_llm_provider import FakeLLMServer, Text

ATTEMPT = "Edited app.py, all done."
FIXED = "Fixed the undefined name in app.py."
VERDICT = "app.py:3: error: name 'deploy' is not defined"


def _agent(server, db, session_id: str):
    from run_agent import AIAgent

    return AIAgent(base_url=server.base_url, api_key="sk-fake-e2e", provider="custom", model="fake-model",
                   quiet_mode=True, skip_context_files=True, skip_memory=True, enabled_toolsets=["todo"],
                   session_id=session_id, session_db=db)


@pytest.fixture
def lsp_turn(tmp_path, monkeypatch):
    """One turn whose first answer a late LSP verdict sends back: ``(result, server, db, note_row)``."""
    from agent.lsp import deferred
    from hermes_state import SessionDB

    verdicts = [[("app.py", VERDICT)]]
    monkeypatch.setattr(deferred, "settle_for_agent", lambda agent, **_: verdicts.pop() if verdicts else [])
    with FakeLLMServer([Text(ATTEMPT), Text(FIXED), Text("You're welcome.")]) as server:
        db = SessionDB(db_path=tmp_path / "lsp.db")
        try:
            result = _agent(server, db, "lsp-note").run_conversation("fix app.py")
            notes = [m for m in db.get_messages("lsp-note")
                     if m["role"] == "user" and "language server reported problems" in str(m["content"])]
            assert len(notes) == 1, notes
            yield result, server, db, notes[0]
        finally:
            db.close()


def test_late_lsp_note_is_persisted_as_hidden_not_as_the_users_words(lsp_turn):
    result, _, _, note = lsp_turn
    assert result["final_response"] == FIXED
    assert note["display_kind"] == "hidden"
    # Memory sync / audits key on the persisted kind: "" and "steer" are the only human kinds.
    assert note["display_kind"] not in (None, "", "steer")


def test_memory_sync_treats_the_persisted_note_as_not_the_user(lsp_turn):
    from agent import memory_provider

    # The helper ships with the external-memory fix, not with every base this patch applies to.
    is_synthetic = getattr(memory_provider, "is_synthetic_notification_turn", None)
    if is_synthetic is None:
        pytest.skip("agent.memory_provider has no is_synthetic_notification_turn on this base")
    _, _, _, note = lsp_turn
    assert is_synthetic(note["content"], display_kind=note["display_kind"])


def test_late_lsp_note_renders_as_no_user_bubble(lsp_turn):
    from gateway.session_controls import display_projection
    from hermes_cli.web_routers.sessions import _project_for_display
    from tui_gateway.server import _history_to_messages

    _, _, db, _ = lsp_turn
    stored = db.get_messages("lsp-note")
    home = Path(os.environ["HERMES_HOME"])
    # Gateway session view, Desktop REST transcript, TUI/Desktop resume history.
    for view in (display_projection(stored, home), _project_for_display(stored), _history_to_messages(stored)):
        view = [row for row in view if row.get("display_kind") != "hidden"]
        users = [row for row in view if row.get("role") == "user"]
        assert [str(row.get("text") or row.get("content")) for row in users] == ["fix app.py"], users


def test_late_lsp_note_reaches_the_model_unchanged_live_and_on_replay(lsp_turn):
    _, server, db, note = lsp_turn
    live = server.main_requests()[1]["messages"]
    sent = [m for m in live if m["role"] == "user" and VERDICT in str(m.get("content"))]
    assert len(sent) == 1 and sent[0]["content"] == note["content"]
    assert "display_kind" not in sent[0]

    resumed = _agent(server, db, "lsp-note")
    resumed.run_conversation("thanks", conversation_history=db.get_messages_as_conversation("lsp-note"))
    replay = server.main_requests()[2]["messages"]
    # The cached prefix is byte-identical: the note rides again exactly as the live turn sent it.
    assert replay[:len(live)] == live
