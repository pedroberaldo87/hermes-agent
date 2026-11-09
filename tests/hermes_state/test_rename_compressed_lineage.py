"""A rename sent to a compressed conversation lands on its live tip.

Desktop's rename is ``PATCH /api/sessions/{id}`` -> ``session.mutate`` operation ``sidebar``. A
client still holding the id of an ended segment (a tab opened before the rotation, a restored
sidebar row) used to write the title onto that dead segment. The listing shows the TIP's title and
falls back to an ancestor's only when the tip is untitled, so the tip's automatic title kept
winning and the user's name looked reverted.
"""
from contextlib import closing

import hermes_state_runtime as rt
from hermes_state import SessionDB


def _rotated(db, *, root_title=None):
    """``chat`` compressed into ``chat-2``; the tip carries the conversation's automatic title."""
    db.create_session("chat", source="desktop")
    db.append_message("chat", "user", "vamos criar um plugin")
    if root_title:
        assert db.set_session_title("chat", root_title)
    db.publish_compression_child(parent_session_id="chat", child_session_id="chat-2", source="desktop",
                                 messages=[{"role": "user", "content": "[summary]"}],
                                 require_compression_lease=False)
    assert db.set_auto_title("chat-2", "Plugin para sessoes", source="llm")


def _rename(db, session_id, title):
    epoch = rt.begin_runtime_epoch(db, instance_id="owner")
    rt.mutate_runtime_session(db, epoch=epoch, principal_id="human", session_id=session_id,
                              request_id=f"rename-{title}", expected_revision=0, operation="sidebar",
                              payload={"title": title})


def _listed_title(db):
    rows = [r for r in db.list_sessions_rich(order_by_last_active=True, include_pinned=True)
            if r.get("_lineage_root_id") == "chat" or r["id"] in ("chat", "chat-2")]
    assert len(rows) == 1
    return rows[0]["title"]


def test_rename_sent_to_an_ended_segment_lands_on_the_live_tip(tmp_path):
    with closing(SessionDB(db_path=tmp_path / "state.db")) as db:
        _rotated(db)
        _rename(db, "chat", "SESSION TALK")
        tip = db.get_session("chat-2")
        assert (tip["title"], tip["title_source"]) == ("SESSION TALK", "user")
        assert _listed_title(db) == "SESSION TALK"


def test_rename_to_the_name_a_dead_segment_already_holds_moves_it_to_the_tip(tmp_path):
    """Stores written before the fix hold the user's name on the ended root; renaming again with
    that same name must not collide with it."""
    with closing(SessionDB(db_path=tmp_path / "state.db")) as db:
        _rotated(db)
        db._conn.execute("UPDATE sessions SET title = 'SESSION TALK', title_source = 'user' WHERE id = 'chat'")
        db._conn.commit()
        _rename(db, "chat", "SESSION TALK")
        assert db.get_session("chat-2")["title"] == "SESSION TALK"
        assert db.get_session("chat")["title"] is None
        assert _listed_title(db) == "SESSION TALK"


def test_rename_of_an_uncompressed_session_is_unchanged(tmp_path):
    with closing(SessionDB(db_path=tmp_path / "state.db")) as db:
        db.create_session("solo", source="desktop")
        _rename(db, "solo", "Meu nome")
        row = db.get_session("solo")
        assert (row["title"], row["title_source"]) == ("Meu nome", "user")
