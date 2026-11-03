"""A hidden conversation stays hidden through compression.

The sidebar admits a compression lineage by its ROOT's ``hidden`` flag, while the canonical Bot Chat
rename guard and the desktop keep-list read the TIP's. A continuation published with ``hidden=0`` under a
hidden root made one conversation both hidden and visible: the canonical "Bot Chat" tip lost its rename
guard, and a lineage hidden at the root vanished from every listing while its live tip read as visible.
"""
import pytest

from persistence.conversation.lineage import CompressionChild
from persistence.conversation.messages import NewMessage
from persistence.conversation.sessions import CANONICAL_BOT_CHAT_TITLE, SessionOrder, SessionQuery, SessionWindow
from persistence_assembly import open_persistence, profile_scope
from tests.fixtures.storage_holder import raw_holder
from tests.fixtures.storage_seed import seed_messages, seed_session


@pytest.fixture
def db(tmp_path):
    store = open_persistence(profile_scope(home=tmp_path))
    yield store
    store.close()


def _compress(db, parent, child):
    holder = f"holder-{child}"
    assert db.coordination.try_acquire_compression_lock(session_id=parent, holder=holder, ttl_seconds=60)
    db.lineage.publish_compression_child(
        parent, CompressionChild(session_id=child, source="tui", system_prompt="p"),
        [NewMessage.from_live({"role": "user", "content": f"summary for {child}"})],
        compression_lock_holder=holder)


def _hidden(db, *ids):
    return {sid: int(db.sessions.get(sid).hidden) for sid in ids}


def _listed(db, **query):
    return [entry.as_list_row() for entry in db.sessions.list_sessions(
        SessionQuery(order=SessionOrder.LAST_ACTIVE, **query), SessionWindow(limit=50))]


def test_canonical_bot_chat_keeps_its_identity_through_compression(db):
    seed_session(db, "root", "tui")
    seed_messages(db, "root", {"role": "user", "content": "hello"})
    assert db.sessions.set_title("root", CANONICAL_BOT_CHAT_TITLE)
    assert db.sessions.set_hidden("root", True)

    for parent, child in (("root", "mid"), ("mid", "tip")):
        _compress(db, parent, child)
        # The rotating agent carries the title onto the child after publishing it.
        assert db.sessions.set_title(child, CANONICAL_BOT_CHAT_TITLE)

    assert _hidden(db, "root", "mid", "tip") == {"root": 1, "mid": 1, "tip": 1}
    with pytest.raises(ValueError, match="canonical Bot Chat"):
        db.sessions.set_title("tip", "Renamed")
    listed = _listed(db, include_hidden=True)
    assert [row["id"] for row in listed if row.get("_lineage_root_id") == "root"] == ["tip"]


def test_a_mixed_lineage_heals_at_its_next_compression(db):
    """Stores written before the fix hold visible segments under a hidden root."""
    seed_session(db, "root", "tui")
    seed_messages(db, "root", {"role": "user", "content": "hello"})
    assert db.sessions.set_hidden("root", True)
    _compress(db, "root", "mid")
    raw_holder(db)._execute_write(lambda conn: conn.execute("UPDATE sessions SET hidden = 0 WHERE id = 'mid'"))

    _compress(db, "mid", "tip")

    assert _hidden(db, "tip") == {"tip": 1}


def test_a_visible_chat_stays_visible(db):
    seed_session(db, "root", "tui")
    seed_messages(db, "root", {"role": "user", "content": "hello"})
    _compress(db, "root", "tip")

    assert _hidden(db, "root", "tip") == {"root": 0, "tip": 0}
    assert [row["id"] for row in _listed(db)] == ["tip"]
