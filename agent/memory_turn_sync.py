"""External memory receives the user's own words, all of them, and nothing Hermes said in their place.

Captured on entry, sent on success:

- the user's words are captured when Hermes accepts them: the turn's message (``capture_turn_words``, at
  ``run_conversation``'s entry) and each /steer or correction as it is delivered (``capture_mid_turn_words``);
- a completed human turn sends everything captured for its conversation, in order, with its reply
  (``sync_external_memory_for_turn``). A turn that ends without one (interrupted, failed, raised, returned
  early) sends nothing: its words simply wait for the next completed turn. No exit path needs handling, and the
  partial reply never reaches memory (#15218);
- a turn Hermes started itself (process / delegation notices, goal continuations, /loop wakeups, hidden sends)
  is not the user talking: it captures nothing, sends nothing, and leaves the captured words in place;
- a bot-authored turn (``turn_author`` with ``is_bot``) is synced as itself and never takes the human's words. A
  human author (the gateway names every sender) is the user: its words are captured and sent under its id, so in
  a group one person's words never ride another's turn;
- a prompt a ``pre_llm_call`` hook vetoed is discarded and /undo drops what it rewound; a compression rotation
  carries the words into the new session (``MemoryManager.on_session_switch``);
- a conversation the user leaves (/new, /resume, /branch, an idle or daily reset) while it still holds their words
  sends them on its own: user rows with no reply, in its own name. Where the switch reaches the memory manager
  (CLI, TUI, Desktop) that happens before the providers switch; the gateway ends the old session without one, so
  the first turn of the conversation that replaced it sends them, found through state.db's parent chain
  (``_send_words_left_behind``).

The words are held by the process per profile, not by one agent, so a gateway replacing a conversation's agent
(/stop, /model, idle eviction) keeps them for the next turn. Known gaps: a restart drops them; a native codex
app-server ``turn/steer`` is not captured; a gateway chat left with words pending and never used again keeps them
until the process exits.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any, Optional

from agent.codex_responses_adapter import _summarize_user_message_for_log
from agent.memory_provider import is_synthetic_notification_turn, is_trivial_prompt
from agent.skill_commands import extract_user_instruction_from_skill_message
from gateway.steer_origin import without_origin

logger = logging.getLogger(__name__)

# How far up state.db's parent chain a new conversation looks for one the user left with words pending
# (/new right after /new leaves an empty conversation in between).
_MAX_LEFT_CONVERSATIONS = 5


def _clean(text: Any) -> str:
    """The user's instruction as memory keeps it: multimodal flattened, slash-skill scaffolding and the gateway's
    routing block (on a /steer, a correction, or one requeued as the next turn) removed, otherwise as typed."""
    flat = _summarize_user_message_for_log(text, sep="\n") if text else ""
    return extract_user_instruction_from_skill_message(without_origin(flat)) or ""


def _is_bot(author: Optional[dict]) -> bool:
    return bool(author) and (bool(author.get("is_bot")) or str(author.get("id") or "").startswith("bot:"))


def capture_turn_words(agent: Any, message: Any, *, display_kind: Optional[str], turn_author: Any) -> None:
    """First thing every turn does: capture the message when it is the human's own words, and record whether this
    turn may send the captured words (``_turn_sends_user_words``) and whose they are. Never raises into the turn."""
    from agent.turn_author import parse_turn_author

    agent._turn_sends_user_words = False
    agent._turn_memory_token = agent._turn_words_author = agent._turn_words_author_info = None
    manager = getattr(agent, "_memory_manager", None)
    if not manager:
        return
    try:
        _send_words_left_behind(agent, manager)
    except Exception:  # health: allow BLE001 -- memory sync is best-effort; it never fails the turn
        logger.warning("external memory: words of a left conversation not sent (session %s)",
                       getattr(agent, "session_id", ""), exc_info=True)
    author = parse_turn_author(turn_author)
    if _is_bot(author):
        return
    try:
        kind = display_kind or getattr(message, "display_kind", None)  # the CLI types a TimelineNotification
        if not message or is_synthetic_notification_turn(message, display_kind=kind):
            return
        agent._turn_sends_user_words = True
        agent._turn_memory_token = uuid.uuid4().hex
        agent._turn_words_author = (author or {}).get("id") or (author or {}).get("name")
        agent._turn_words_author_info = author
        manager.capture_user_words(_clean(message), session_id=agent.session_id or "", token=agent._turn_memory_token,
                                   author=agent._turn_words_author, author_info=author)
    except Exception:  # health: allow BLE001 -- memory capture is best-effort; it never fails the turn
        logger.warning("external memory capture failed for session %s", getattr(agent, "session_id", ""), exc_info=True)


def capture_mid_turn_words(agent: Any, text: str) -> None:
    """A /steer or correction the user typed, captured as it is delivered into the turn, whatever the turn's author
    or kind: the user typed it (the turn's human when it has one). An undelivered one is requeued and captured where
    it finally lands."""
    manager = getattr(agent, "_memory_manager", None)
    if manager and text:
        manager.capture_user_words(_clean(text), session_id=getattr(agent, "session_id", None) or "",
                                   author=getattr(agent, "_turn_words_author", None),
                                   author_info=getattr(agent, "_turn_words_author_info", None))


def _send_words_left_behind(agent: Any, manager: Any) -> None:
    """Send what a conversation the user left still holds, when this turn's conversation replaced it: the gateway's
    /new and idle/daily reset end a session and name it as the new one's parent in state.db, with no memory manager
    in sight. Only ended ancestors: an open one (a /branch parent) may still send them with its own next reply."""
    session_id = getattr(agent, "session_id", None) or ""
    pending = manager.pending_user_word_sessions() - {session_id}
    db = getattr(agent, "_session_db", None)
    if not (pending and session_id and db is not None):
        return
    row = db.get_session(session_id)
    for _ in range(_MAX_LEFT_CONVERSATIONS):
        parent = (row or {}).get("parent_session_id")
        if not parent:
            return
        row = db.get_session(parent)
        if not row or not row.get("ended_at"):
            return
        if parent in pending:
            manager.send_left_conversation_words(parent)


def sync_external_memory_for_turn(agent: Any, *, original_user_message: Any, final_response: Any,
                                  interrupted: bool, messages: Optional[list] = None) -> None:
    """Send the conversation's captured words with this turn's reply (``sync_all``) and queue the next recall
    (``queue_prefetch_all``). A turn without a durable reply sends nothing. Never raises into the turn."""
    manager = getattr(agent, "_memory_manager", None)
    if not (manager and original_user_message):
        return
    try:
        _mirror(agent, manager, original_user_message, final_response, interrupted, messages)
    except Exception:  # health: allow BLE001 -- memory mirroring is best-effort; a provider failure never fails the turn
        logger.warning("external memory sync failed for session %s", getattr(agent, "session_id", ""), exc_info=True)


def _mirror(agent: Any, manager: Any, original_user_message: Any, final_response: Any, interrupted: bool,
            messages: Optional[list]) -> None:
    response_text = _summarize_user_message_for_log(final_response, sep="\n") if final_response else ""
    if interrupted or not response_text:
        return  # the captured words wait for the next completed turn
    session_id = agent.session_id or ""
    # Stashed by build_turn_context() for this turn, None on a human turn.
    turn_author = getattr(agent, "_turn_author", None)
    sync_kwargs: dict[str, Any] = {"session_id": session_id}
    if turn_author is not None:
        sync_kwargs["turn_author"] = turn_author
    if _is_bot(turn_author):
        if is_synthetic_notification_turn(original_user_message):
            return
        user_side = _clean(original_user_message)
    elif getattr(agent, "_turn_sends_user_words", False):
        taken = manager.take_user_words(session_id, author=getattr(agent, "_turn_words_author", None))
        user_side = "\n\n".join(text for text in taken if text.strip())
    else:
        return  # a turn Hermes injected: not the user's words, and the captured ones stay
    if not user_side:
        return
    if messages is not None:
        sync_kwargs["messages"] = messages
    manager.sync_all(user_side, response_text, **sync_kwargs)
    # Sibling of the build_turn_context() prefetch gate: don't key recall on zero-signal prompts.
    user_text = _clean(original_user_message)
    if not is_trivial_prompt(user_text):
        manager.queue_prefetch_all(user_text, session_id=session_id)
