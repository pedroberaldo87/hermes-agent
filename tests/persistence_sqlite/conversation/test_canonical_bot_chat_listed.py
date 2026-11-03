"""The canonical Bot Chat is listed, though it stays hidden.

A bot's canonical chat is the bot's whole conversation; it is listed in the session sidebar like any
other, captioned by the bot on the desktop. It keeps ``hidden = 1``: the rename guard, Bot Mode's
born-hidden creation and the desktop hide sweep all key on that flag. Every other hidden row (room
plumbing, side surfaces) stays unlisted.
"""
import pytest

from persistence.sqlite.conversation._store.compression import publish_compression_child
from persistence.sqlite.conversation._store.messages import append_message
from persistence.sqlite.conversation._store.sessions import (
    create_session, get_session, list_sessions_rich, set_session_archived, set_session_hidden,
)
from persistence.sqlite.conversation._store.titles import set_session_title


@pytest.fixture
def store(backend, scope_a):
    return backend.open(scope_a)


@pytest.fixture
def db(store):
    return store.holder()


def _compress(store, db, parent, child):
    holder = f"holder-{child}"
    assert store.coordination.try_acquire_compression_lock(session_id=parent, holder=holder, ttl_seconds=60)
    publish_compression_child(
        db, parent_session_id=parent, child_session_id=child, source="tui", system_prompt="p",
        messages=[{"role": "user", "content": f"summary for {child}"}], compression_lock_holder=holder)


def _listed_ids(db, **kwargs):
    return [row["id"] for row in list_sessions_rich(db, limit=50, order_by_last_active=True, **kwargs)]


def test_a_compressed_canonical_bot_chat_is_listed_at_its_tip_and_stays_hidden(store, db):
    create_session(db, "root", source="tui")
    append_message(db, "root", "user", "hello")
    assert set_session_title(db, "root", "Bot Chat")
    _compress(store, db, "root", "tip")
    assert set_session_title(db, "tip", "Bot Chat")
    assert set_session_hidden(db, "tip", True)

    assert _listed_ids(db) == ["tip"]
    assert get_session(db, "tip")["hidden"] == 1
    with pytest.raises(ValueError, match="canonical Bot Chat"):
        set_session_title(db, "tip", "Renamed")


def test_other_hidden_rows_stay_unlisted(db):
    create_session(db, "chat", source="tui")
    append_message(db, "chat", "user", "hello")
    assert set_session_title(db, "chat", "Bot Chat")
    assert set_session_hidden(db, "chat", True)
    create_session(db, "room", source="tui")
    append_message(db, "room", "user", "plumbing")
    assert set_session_hidden(db, "room", True)
    create_session(db, "plain", source="tui")
    append_message(db, "plain", "user", "hi")

    assert sorted(_listed_ids(db)) == ["chat", "plain"]
    assert sorted(_listed_ids(db, include_pinned=True)) == ["chat", "plain"]


def test_an_archived_canonical_bot_chat_is_not_listed(db):
    create_session(db, "chat", source="tui")
    append_message(db, "chat", "user", "hello")
    assert set_session_title(db, "chat", "Bot Chat")
    assert set_session_hidden(db, "chat", True)
    assert set_session_archived(db, "chat", True)[0]

    assert _listed_ids(db) == []
