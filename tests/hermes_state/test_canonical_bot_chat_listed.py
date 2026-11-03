"""The canonical Bot Chat is listed, though it stays hidden.

A bot's canonical chat is the bot's whole conversation; it is listed in the session sidebar like any
other, captioned by the bot on the desktop. It keeps ``hidden = 1``: the rename guard, Bot Mode's
born-hidden creation and the desktop hide sweep all key on that flag. Every other hidden row (room
plumbing, side surfaces) stays unlisted.
"""
import pytest

from hermes_state import SessionDB


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "home"))
    return SessionDB(tmp_path / "state.db")


def _compress(db, parent, child):
    holder = f"holder-{child}"
    assert db.try_acquire_compression_lock(parent, holder, ttl_seconds=60)
    db.publish_compression_child(
        parent_session_id=parent, child_session_id=child, source="tui", system_prompt="p",
        messages=[{"role": "user", "content": f"summary for {child}"}], compression_lock_holder=holder)


def _listed_ids(db, **kwargs):
    return [row["id"] for row in db.list_sessions_rich(limit=50, order_by_last_active=True, **kwargs)]


def test_a_compressed_canonical_bot_chat_is_listed_at_its_tip_and_stays_hidden(db):
    db.create_session("root", "tui")
    db.append_message("root", "user", "hello")
    assert db.set_session_title("root", "Bot Chat")
    _compress(db, "root", "tip")
    assert db.set_session_title("tip", "Bot Chat")
    assert db.set_session_hidden("tip", True)

    assert _listed_ids(db) == ["tip"]
    assert db.get_session("tip")["hidden"] == 1
    with pytest.raises(ValueError, match="canonical Bot Chat"):
        db.set_session_title("tip", "Renamed")


def test_other_hidden_rows_stay_unlisted(db):
    db.create_session("chat", "tui")
    db.append_message("chat", "user", "hello")
    assert db.set_session_title("chat", "Bot Chat")
    assert db.set_session_hidden("chat", True)
    db.create_session("room", "tui")
    db.append_message("room", "user", "plumbing")
    assert db.set_session_hidden("room", True)
    db.create_session("plain", "tui")
    db.append_message("plain", "user", "hi")

    assert sorted(_listed_ids(db)) == ["chat", "plain"]
    assert sorted(_listed_ids(db, include_pinned=True)) == ["chat", "plain"]


def test_an_archived_canonical_bot_chat_is_not_listed(db):
    db.create_session("chat", "tui")
    db.append_message("chat", "user", "hello")
    assert db.set_session_title("chat", "Bot Chat")
    assert db.set_session_hidden("chat", True)
    assert db.set_session_archived("chat", True)

    assert _listed_ids(db) == []
