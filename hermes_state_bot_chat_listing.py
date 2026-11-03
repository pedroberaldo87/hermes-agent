"""The session listing's hidden filter, which also admits the canonical Bot Chat.

A profile's canonical Bot Chat is the bot's whole conversation and is listed like one. It stays
``hidden`` (its rename guard, Bot Mode's born-hidden creation and the desktop hide sweep all key on
that flag); only the listing's filter admits it. Local divergence from the upstream Bot Mode
contract (``apps/desktop/src/AGENTS.md``: canonical Bot Chats are never listed).
"""
from __future__ import annotations

from typing import Any


def listed_visibility_clause(db: Any) -> tuple[str, list[Any]]:
    """``s.hidden = 0``, or that plus this store's canonical Bot Chat lineage ROOT — the row a listing
    projects to the live tip. UNIQUE(title) makes the lookup one indexed read."""
    row = db._read_one(
        "SELECT id FROM sessions WHERE title = ? AND archived = 0 LIMIT 1",
        (db.CANONICAL_BOT_CHAT_TITLE,),
    )
    if row is None:
        return "s.hidden = 0", []
    lineage = db.get_compression_lineage(row[0]) or [row[0]]
    return "(s.hidden = 0 OR s.id = ?)", [lineage[0]]
