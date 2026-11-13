"""The clarify explanation travels inside the call: a required ``context`` argument.

Claude models (Opus 5.5, Fable 5.2) that call ``clarify`` after earlier tool calls in the same turn
write the user-facing explanation into a second *thinking* block instead of a text block (0/68
controlled runs produced text). Thinking is not shown to the user, so Telegram got bare buttons.
With a required ``context`` argument whose description says it is the only text the user sees, the
model put the full report into ``context`` 13/13. These tests pin that contract: the schema, the
refusal of a call without a usable ``context`` (on every surface), and each surface carrying the
context above the questions — Telegram/messaging as a normal message sent BEFORE the buttons.
"""

from __future__ import annotations

import asyncio
import json
import threading
import types
from types import SimpleNamespace

import pytest

from agent.inline_tool_executors import INLINE_TOOL_EXECUTORS, InlineToolContext
from gateway.platforms.base import BasePlatformAdapter, SendResult
from tools import clarify_gateway as cm
from tools.clarify_tool import CLARIFY_SCHEMA

QUESTIONS = [{"question": "Apply the fix?", "choices": ["Yes", "No"]}]
REPORT = ("**Found:** the sync only declares a conflict after the merge.\n\n"
          "1. `deploy` waits for every adapter\n2. stale entries are ignored\n3. dry run passed")
CONTEXT_DESCRIPTION = (
    "Required. The COMPLETE message the user reads above the buttons. It is the ONLY text the user sees for "
    "this question: your thinking and anything you wrote earlier in this turn are NOT shown. Put the full "
    "result, findings and every numbered item here (markdown ok), not a pointer like 'items above'.")


def _incident_transcript() -> list[dict]:
    """The shape of infra state.db rows 25761/25763 (2026-11-12): an assistant row with empty content,
    the explanation only in reasoning, and a lone clarify{questions} call."""
    call = {"id": "toolu_1", "type": "function",
            "function": {"name": "clarify", "arguments": json.dumps({"questions": QUESTIONS})}}
    return [
        {"role": "user", "content": "adiciona pras tuas considerações"},
        {"role": "assistant", "content": "", "tool_calls": [
            {"id": "t1", "type": "function", "function": {"name": "terminal", "arguments": "{}"}}]},
        {"role": "tool", "tool_call_id": "t1", "content": "{\"output\": \"ok\"}"},
        {"role": "assistant", "content": "", "reasoning": "I'm adding an adapters_wait step ... (explained here only)",
         "reasoning_content": "I'm adding an adapters_wait step ...", "finish_reason": "tool_calls",
         "tool_calls": [call]},
    ]


def _run(args: dict, messages=None, **agent_attrs):
    asked: list = []

    def callback(questions):
        asked.append(questions)
        return {"answers": {"q0": "Yes"}, "outcome": "submitted"}

    agent = SimpleNamespace(clarify_callback=callback, **agent_attrs)
    ctx = InlineToolContext(effective_task_id="t", tool_call_id="toolu_1", messages=messages or [])
    return json.loads(INLINE_TOOL_EXECUTORS["clarify"](agent, args, ctx)), asked


def _refused_with_hint(result: dict, asked: list) -> bool:
    error = str(result.get("error", ""))
    return not asked and "`context`" in error and "full explanation" in error


# --- schema ---------------------------------------------------------------------------------


def test_schema_has_context_first_and_required_with_the_probe_description():
    params = CLARIFY_SCHEMA["parameters"]
    assert next(iter(params["properties"])) == "context"
    assert params["required"] == ["context", "questions"]
    assert params["properties"]["context"] == {"type": "string", "description": CONTEXT_DESCRIPTION}


# --- refusal: every surface, not only messaging ------------------------------------------------


@pytest.mark.parametrize("surface", ["cli", "messaging"])
def test_the_incident_call_without_context_is_refused_with_the_hint(surface):
    """Rows 25761/25763: [thinking, tool_use(clarify{questions})], no text, no context -> no buttons."""
    attrs = {"_clarify_requires_preamble": True} if surface == "messaging" else {}
    result, asked = _run({"questions": QUESTIONS}, _incident_transcript(), **attrs)
    assert _refused_with_hint(result, asked), result


@pytest.mark.parametrize("blank", ["", "   \n\t "])
def test_a_blank_context_is_refused(blank):
    result, asked = _run({"questions": QUESTIONS, "context": blank})
    assert _refused_with_hint(result, asked), result


def test_a_non_string_context_is_refused():
    result, asked = _run({"questions": QUESTIONS, "context": None})
    assert _refused_with_hint(result, asked), result


def test_with_context_the_incident_shape_asks_and_the_callback_gets_the_context():
    from tools.clarify_tool import clarify_call_context

    result, asked = _run({"questions": QUESTIONS, "context": f"  {REPORT}\n"}, _incident_transcript())
    assert result["outcome"] == "submitted"
    assert len(asked) == 1
    assert [q["question"] for q in asked[0]] == ["Apply the fix?"]  # still a plain list of entries
    assert clarify_call_context(asked[0]) == REPORT  # stripped, markdown kept


def test_text_earlier_in_the_turn_no_longer_matters():
    """The old history heuristic is gone: visible text without ``context`` is still refused,
    and a context is enough without any text."""
    messages = [{"role": "user", "content": "fix it"},
                {"role": "assistant", "content": "Found the bug; patch below.", "tool_calls": []}]
    assert _refused_with_hint(*_run({"questions": QUESTIONS}, messages, _clarify_requires_preamble=True))
    result, asked = _run({"questions": QUESTIONS, "context": REPORT}, [{"role": "user", "content": "go"}],
                         _clarify_requires_preamble=True)
    assert asked and result["outcome"] == "submitted"


def test_context_is_redacted_like_the_question_text(monkeypatch):
    from tools.clarify_tool import clarify_call_context

    secret = "sk-proj-" + "A" * 40
    _result, asked = _run({"questions": QUESTIONS, "context": f"Token {secret} leaked; rotate?"})
    assert asked and secret not in clarify_call_context(asked[0])


def test_callbacks_that_ignore_the_context_keep_working():
    """Third-party callbacks receive a plain list subclass; copying it is harmless."""
    from tools.clarify_tool import clarify_tool

    seen: list = []
    reply = json.loads(clarify_tool(QUESTIONS, REPORT, callback=lambda qs: seen.append(list(qs)) or {
        "answers": {"q0": "No"}, "outcome": "submitted"}))
    assert reply["responses"][0]["user_response"] == "No"
    assert isinstance(seen[0], list) and seen[0][0]["question"] == "Apply the fix?"


# --- Telegram / messaging: the context goes out BEFORE the buttons --------------------------------


class _TelegramLike(BasePlatformAdapter):
    """Native card override (Telegram-shaped); records text sends and cards in one ordered log,
    answers each card at once."""

    def __init__(self, answers=("Yes",)):
        self.log: list[tuple[str, str]] = []
        self.metadata: list = []
        self._answers = list(answers)

    def pause_typing_for_chat(self, chat_id):
        return None

    def resume_typing_for_chat(self, chat_id):
        return None

    async def send(self, chat_id, content, reply_to=None, metadata=None):
        self.log.append(("text", content))
        self.metadata.append(metadata)
        return SendResult(success=True, message_id=f"t{len(self.log)}")

    async def send_clarify(self, **kwargs):
        self.log.append(("card", kwargs["question"]))
        cm.resolve_gateway_clarify(kwargs["clarify_id"], self._answers.pop(0))
        return SendResult(success=True, message_id="c1")

    async def retire_clarify_card(self, clarify_id, notice):
        return None

    async def connect(self):
        return True

    async def disconnect(self):
        return None

    async def get_chat_info(self, chat_id):
        return {}


@pytest.fixture
def loop():
    loop = asyncio.new_event_loop()
    thread = threading.Thread(target=loop.run_forever, daemon=True)
    thread.start()
    yield loop
    loop.call_soon_threadsafe(loop.stop)
    thread.join(timeout=5)


def _telegram_runner(adapter, loop, monkeypatch):
    from gateway.config import Platform
    from gateway.run_turn_runner import TurnRunner
    from gateway.session import SessionSource

    runner = object.__new__(TurnRunner)
    runner._approval_owner = None
    runner._ctx = SimpleNamespace(
        _status_adapter=adapter, _status_chat_id="42", _status_thread_metadata=None, session_key="sk-msg",
        stream_consumer_holder=[None], _loop_for_step=loop, _run_still_current=lambda: True,
        source=SessionSource(platform=Platform.TELEGRAM, chat_id="42", chat_type="dm", user_id="890796724"))
    runner._close_native_stream_boundary = lambda *a, **k: None
    monkeypatch.setattr(cm, "get_clarify_timeout", lambda: 5)
    return runner


def test_telegram_sends_the_context_before_the_buttons(loop, monkeypatch):
    from tools.clarify_tool import clarify_tool

    adapter = _TelegramLike()
    runner = _telegram_runner(adapter, loop, monkeypatch)
    result = json.loads(clarify_tool(QUESTIONS, REPORT, callback=runner._clarify_callback_sync))
    assert result["outcome"] == "submitted"
    assert [kind for kind, _ in adapter.log] == ["text", "card"]
    assert adapter.log[0][1] == REPORT  # the full report, through the adapter's normal formatted send
    assert adapter.metadata[0].get("_interim_send") is True  # not mistaken for the turn's final reply


def test_a_batch_sends_the_context_once_before_the_first_card(loop, monkeypatch):
    from tools.clarify_tool import clarify_tool

    adapter = _TelegramLike(answers=("Yes", "Later"))
    runner = _telegram_runner(adapter, loop, monkeypatch)
    two = QUESTIONS + [{"question": "When?", "choices": ["Now", "Later"]}]
    json.loads(clarify_tool(two, REPORT, callback=runner._clarify_callback_sync))
    assert [kind for kind, _ in adapter.log] == ["text", "card", "card"]


def test_the_first_card_entry_carries_the_context_for_pending_control_projections(loop, monkeypatch):
    """Desktop/web (api_server) read pending prompts from the registered entry."""
    from tools.clarify_tool import clarify_tool

    registered: list = []
    real_register = cm.register

    def spy(*args, **kwargs):
        entry = real_register(*args, **kwargs)
        registered.append(entry)
        return entry

    monkeypatch.setattr(cm, "register", spy)
    adapter = _TelegramLike(answers=("Yes", "Later"))
    runner = _telegram_runner(adapter, loop, monkeypatch)
    two = QUESTIONS + [{"question": "When?", "choices": ["Now", "Later"]}]
    json.loads(clarify_tool(two, REPORT, callback=runner._clarify_callback_sync))
    assert [entry.context for entry in registered] == [REPORT, ""]


# --- api_server / Desktop pending-control payload ----------------------------------------------------


def test_api_server_clarify_prompt_payload_carries_the_context():
    from gateway.session_pending_controls import PendingControls

    published: list = []
    events = SimpleNamespace(lock=threading.RLock(),
                             publish=lambda sid, prompt, event_type=None: published.append((event_type, prompt)))
    entry = cm.register("cid-ctx", "sk-api", "Apply the fix?", ["Yes", "No"], context=REPORT)
    try:
        PendingControls(events).register_clarify("sid", 3, entry)
    finally:
        cm.clear_session("sk-api")
    event_type, prompt = published[0]
    assert event_type == "clarify.request"
    assert prompt["context"] == REPORT and prompt["question"] == "Apply the fix?"


# --- local viewers: classic CLI / Ink TUI batch requests ---------------------------------------------


def test_gateway_batch_request_for_a_cli_viewer_carries_the_context(monkeypatch):
    import gateway.session_server_requests as ssr
    from gateway.session_clarify_batch import ask_clarify_batch
    from tools.clarify_tool import ClarifyQuestions

    sent: list = []
    monkeypatch.setattr(ssr, "ask_viewer_result", lambda stream, sid, method, params, **kw: sent.append(params) or {
        "answers": {"q0": "Yes"}, "outcome": "submitted"})
    authority = SimpleNamespace(sessions={"sid": SimpleNamespace(event_stream=object())})
    turn = SimpleNamespace(_approval_owner=(authority, "sid", 1), _ctx=SimpleNamespace(agent_holder=[None]))
    entries = [{"qid": "q0", "question": "Apply the fix?", "choices": ["Yes", "No"], "multi_select": False}]
    reply = ask_clarify_batch(turn, ClarifyQuestions(entries, context=REPORT))
    assert reply["outcome"] == "submitted"
    assert sent[0]["context"] == REPORT


def test_the_cli_viewer_hands_the_context_to_its_panel():
    from hermes_cli.gateway_agent import clarify_reply
    from tools.clarify_tool import clarify_call_context

    seen: list = []
    params = {"context": REPORT, "questions": [{"qid": "q0", "question": "Apply the fix?", "choices": ["Yes"]}]}
    clarify_reply(lambda qs: seen.append(qs) or {"answers": {"q0": "Yes"}, "outcome": "submitted"}, params)
    assert clarify_call_context(seen[0]) == REPORT


def test_tui_gateway_clarify_request_carries_the_context(monkeypatch):
    from tui_gateway import server, server_requests
    from tools.clarify_tool import ClarifyQuestions

    sent: list = []
    monkeypatch.setattr(server_requests, "send", lambda method, sid, params, **kw: sent.append(params) or {
        "answers": {}, "outcome": "submitted"})
    entries = [{"qid": "q0", "question": "Apply the fix?", "choices": ["Yes", "No"], "multi_select": False}]
    server._clarify_block("sid", ClarifyQuestions(entries, context=REPORT))
    assert sent[0]["context"] == REPORT


def test_the_classic_cli_panel_prints_the_context_above_the_questions(monkeypatch):
    import cli
    from hermes_cli.cli_modal_mixin import CLIModalMixin
    from tools.clarify_tool import ClarifyQuestions

    printed: list = []
    monkeypatch.setattr(cli, "_cprint", lambda text="", *a, **k: printed.append(str(text)))
    shell = types.SimpleNamespace(
        _clarify_batch_set_active=lambda state, index: None, _ring_bell=lambda **kw: None,
        _paint_now=lambda: None, _poll_modal_queue=lambda queue, attr: None)
    entries = [{"qid": "q0", "question": "Apply the fix?", "choices": ["Yes"], "multi_select": False}]
    reply = CLIModalMixin._clarify_callback(shell, ClarifyQuestions(entries, context=REPORT))
    assert reply["outcome"] == "cancelled"
    assert any("dry run passed" in line for line in printed)
