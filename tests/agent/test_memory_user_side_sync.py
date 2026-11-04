"""External memory receives the user's words, all of them, and nothing Hermes said in their place.

Words are captured when Hermes accepts them and sent by the next completed human turn of the same
conversation (``agent.memory_turn_sync``). Tests drive the real capture points (``AIAgent.run_conversation``'s
entry, both /steer delivery sites) and the real sync, on a bare agent with a real ``MemoryManager`` and a
recording provider, so each assertion reads what a provider's ``sync_turn`` actually received.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from agent.memory_manager import MemoryManager
from agent.memory_provider import (
    SYNTHETIC_TURN_DISPLAY_KINDS, MemoryProvider, is_synthetic_notification_turn,
)
from agent.memory_turn_sync import capture_turn_words


class _RecordingProvider(MemoryProvider):
    def __init__(self) -> None:
        self.synced: list[tuple[str, str, dict]] = []
        self.prefetched: list[str] = []
        self.events: list[tuple[str, str, str]] = []

    @property
    def name(self) -> str:
        return "recording"

    def initialize(self, session_id: str = "", **kwargs) -> None:
        pass

    def is_available(self) -> bool:
        return True

    def get_tool_schemas(self):
        return []

    def queue_prefetch(self, query, *, session_id: str = "") -> None:
        self.prefetched.append(query)

    def sync_turn(self, user_content, assistant_content, *, session_id="", messages=None, turn_author=None):
        self.synced.append((user_content, assistant_content, {"session_id": session_id, "turn_author": turn_author}))
        self.events.append(("sync", user_content, session_id))

    def on_session_switch(self, new_session_id, parent_session_id="", reset=False, **kwargs):
        self.events.append(("switch", new_session_id, parent_session_id))


@pytest.fixture
def agent_and_provider():
    from run_agent import AIAgent

    manager = MemoryManager()
    provider = _RecordingProvider()
    manager.add_provider(provider)
    agent = AIAgent.__new__(AIAgent)
    agent._memory_manager = manager
    agent.session_id = "s1"
    agent._turn_author = None
    yield agent, provider
    manager.shutdown_all()


def _deliver_steer(agent, text, *, before_api_call=False):
    """A /steer through its real delivery site: after a tool batch, or before the next API call."""
    messages = [{"role": "user", "content": "x"}, {"role": "tool", "tool_call_id": "c1", "content": "ok"}]
    if before_api_call:
        from agent.turn_iteration_prep import _inject_steer_after_newest_tool_result

        _inject_steer_after_newest_tool_result(agent, messages, text)
    else:
        from agent.agent_runtime_helpers import apply_pending_steer_to_tool_results

        agent._drain_pending_steer = lambda: text
        apply_pending_steer_to_tool_results(agent, messages, 1)
    assert messages[-1]["display_kind"] == "steer"


def _turn(agent, user, reply, *, interrupted=False, kind=None, author=None, steers=(), failed=False):
    """One turn: captured at entry (what ``AIAgent.run_conversation`` does first), its /steers delivered, then the
    finalizer's mirror (``build_turn_context`` stashes the parsed author on the agent)."""
    from agent.turn_author import parse_turn_author
    from agent.turn_finalizer import _mirror_turn_to_memory

    capture_turn_words(agent, user, display_kind=kind, turn_author=author)
    agent._turn_author = parse_turn_author(author)
    for text in steers:
        _deliver_steer(agent, text)
    agent.skip_background_review = True
    _mirror_turn_to_memory(agent, original_user_message=user, final_response=reply, interrupted=interrupted,
                           failed=failed, messages=None, review_memory=False, review_skills=False, vetoed=False)
    assert agent._memory_manager.flush_pending(timeout=10)


def _user_sides(provider):
    return [s[0] for s in provider.synced]


# -- the contract -------------------------------------------------------------------------------------------------

def test_a_plain_completed_turn_reaches_providers_as_typed(agent_and_provider):
    agent, provider = agent_and_provider
    _turn(agent, "  def f():\n      return 1\n", "Looks fine.")
    assert provider.synced == [("  def f():\n      return 1\n", "Looks fine.", {"session_id": "s1", "turn_author": None})]
    assert provider.prefetched == ["  def f():\n      return 1\n"]


@pytest.mark.parametrize("before_api_call", [False, True])
def test_steers_delivered_in_the_turn_join_its_user_side(agent_and_provider, before_api_call):
    agent, provider = agent_and_provider
    capture_turn_words(agent, "fix the build", display_kind=None, turn_author=None)
    _deliver_steer(agent, "also bump the version", before_api_call=before_api_call)
    _deliver_steer(agent, "and tag it\nv2", before_api_call=before_api_call)
    agent._sync_external_memory_for_turn(original_user_message="fix the build", final_response="done",
                                         interrupted=False)
    assert agent._memory_manager.flush_pending(timeout=10)
    assert _user_sides(provider) == ["fix the build\n\nalso bump the version\n\nand tag it\nv2"]


def test_a_correction_applied_to_the_turn_joins_its_user_side(agent_and_provider):
    from agent.conversation_loop import _apply_active_turn_redirect

    agent, provider = agent_and_provider
    capture_turn_words(agent, "draft the email", display_kind=None, turn_author=None)
    agent._current_streamed_assistant_text = "Dear team,"
    _apply_active_turn_redirect(agent, [{"role": "user", "content": "draft the email"}], "make it formal")
    agent._sync_external_memory_for_turn(original_user_message="draft the email", final_response="Dear colleagues,",
                                         interrupted=False)
    assert agent._memory_manager.flush_pending(timeout=10)
    assert _user_sides(provider) == ["draft the email\n\nmake it formal"]


def test_an_interrupted_turn_sends_no_reply_and_its_words_ride_the_next_turn(agent_and_provider):
    agent, provider = agent_and_provider
    _turn(agent, "deploy to staging", "Deploying… (partial)", interrupted=True, steers=["only the api"])
    assert provider.synced == [] and provider.prefetched == []

    _turn(agent, "no, deploy to production", "Deployed to production.")
    assert provider.synced == [(
        "deploy to staging\n\nonly the api\n\nno, deploy to production", "Deployed to production.",
        {"session_id": "s1", "turn_author": None},
    )]
    assert provider.prefetched == ["no, deploy to production"]


@pytest.mark.parametrize("reply,failed", [(None, False), ("Context compression timed out; send it again.", True)])
def test_a_failed_turn_sends_nothing_and_its_words_ride_the_next_turn(agent_and_provider, reply, failed):
    agent, provider = agent_and_provider
    _turn(agent, "summarise the logs", reply, failed=failed)
    assert provider.synced == []

    _turn(agent, "again, last hour only", "Summary: …")
    assert _user_sides(provider) == ["summarise the logs\n\nagain, last hour only"]


def test_a_retried_message_is_kept_once(agent_and_provider):
    agent, provider = agent_and_provider
    _turn(agent, "check the disk", "Checking…", interrupted=True)
    _turn(agent, "check the disk", "Disk is 40% full.")
    assert _user_sides(provider) == ["check the disk"]


def test_captured_words_are_bounded(agent_and_provider):
    agent, provider = agent_and_provider
    for i in range(20):
        _turn(agent, f"attempt {i}", "…", interrupted=True)
    _turn(agent, "final", "Done.")

    parts = provider.synced[0][0].split("\n\n")
    assert parts[-1] == "final" and parts[0] == "attempt 5" and len(parts) == 16


@pytest.mark.parametrize("kind", sorted(SYNTHETIC_TURN_DISPLAY_KINDS))
def test_a_typed_hermes_turn_sends_nothing_and_leaves_the_words_alone(agent_and_provider, kind):
    agent, provider = agent_and_provider
    _turn(agent, "rename the file", "Renaming…", interrupted=True)
    _turn(agent, "any text a producer chose", "Handled.", kind=kind, steers=["skip the tests"])
    assert provider.synced == []

    _turn(agent, "thanks", "You're welcome.")
    assert _user_sides(provider) == ["rename the file\n\nskip the tests\n\nthanks"]


def test_a_cli_timeline_notification_is_typed_by_itself(agent_and_provider):
    from tools.process_registry_notifications import TimelineNotification

    agent, provider = agent_and_provider
    notice = TimelineNotification("Build output follows", "make finished", "process_complete")
    _turn(agent, notice, "Build finished.")
    assert provider.synced == []


def test_a_bot_authored_turn_is_synced_as_itself_and_takes_no_human_words(agent_and_provider):
    agent, provider = agent_and_provider
    alpha = {"id": "bot:alpha", "name": "Alpha", "is_bot": True}
    _turn(agent, "pause the job", "Pausing…", interrupted=True)
    _turn(agent, "Message from Alpha: status?", "All green.", author=alpha, steers=["owner steer"])
    _turn(agent, "ok", "Noted.")

    assert [(s[0], s[2]["turn_author"]) for s in provider.synced] == [
        ("Message from Alpha: status?", alpha),
        ("pause the job\n\nowner steer\n\nok", None),
    ]


def test_a_gateway_human_turn_carries_its_words_like_any_human_turn(agent_and_provider):
    """The gateway names every sender (gateway/run_turn_runner.py): a human author is the user, not a bot."""
    agent, provider = agent_and_provider
    pedro = {"id": "tg:42", "name": "Pedro", "is_bot": False}
    _turn(agent, "first request", "Working… (partial)", interrupted=True, author=pedro, steers=["only the api"])
    _turn(agent, "second request", "Done.", author=pedro)

    assert provider.synced == [(
        "first request\n\nonly the api\n\nsecond request", "Done.", {"session_id": "s1", "turn_author": pedro},
    )]


def test_in_a_group_one_persons_words_never_ride_anothers_turn(agent_and_provider):
    agent, provider = agent_and_provider
    ana = {"id": "tg:1", "name": "Ana", "is_bot": False}
    bia = {"id": "tg:2", "name": "Bia", "is_bot": False}
    _turn(agent, "Ana's interrupted ask", "…", interrupted=True, author=ana)
    _turn(agent, "Bia's ask", "Answer for Bia.", author=bia)
    _turn(agent, "Ana again", "Answer for Ana.", author=ana)

    assert [(s[0], s[2]["turn_author"]["id"]) for s in provider.synced] == [
        ("Bia's ask", "tg:2"),
        ("Ana's interrupted ask\n\nAna again", "tg:1"),
    ]


def test_a_vetoed_prompt_is_discarded(agent_and_provider):
    from agent.turn_finalizer import _mirror_turn_to_memory

    agent, provider = agent_and_provider
    capture_turn_words(agent, "my password is hunter2", display_kind=None, turn_author=None)
    _mirror_turn_to_memory(agent, original_user_message="my password is hunter2", final_response="",
                           interrupted=False, failed=False, messages=None, review_memory=False,
                           review_skills=False, vetoed=True)
    _turn(agent, "hello", "Hi.")
    assert _user_sides(provider) == ["hello"]


def test_a_capture_failure_never_fails_the_turn(agent_and_provider, monkeypatch):
    from agent import memory_turn_sync

    agent, provider = agent_and_provider

    def _boom(*_a, **_k):
        raise ValueError("bad row")

    monkeypatch.setattr(memory_turn_sync, "is_synthetic_notification_turn", _boom)
    _turn(agent, "hello", "Hi.")  # must not raise
    assert provider.synced == []


# -- the turn's real entry: whatever happens after it, the words wait -------------------------------------------

def _admission(monkeypatch, *, early=None, raises=None):
    from agent import background_review, turn_facade_lease

    def _admit(*_a, **_k):
        if raises is not None:
            raise raises
        return SimpleNamespace(early_result=early, lease=None, conversation_history=[])

    monkeypatch.setattr(background_review, "cancel_background_review_for_live_turn", lambda _agent: None)
    monkeypatch.setattr(turn_facade_lease, "admit_durable_turn_lease", _admit)


@pytest.mark.parametrize("hard", [False, True])
def test_an_input_past_an_interrupted_lease_wait_is_kept(agent_and_provider, monkeypatch, hard):
    """A soft interrupt carries the input into the follow-up's history; /stop cancels the turn. Either way the
    user typed it."""
    agent, provider = agent_and_provider
    early = {"messages": [], "api_calls": 0, "completed": False, "interrupted": True, "_hard_interrupted": hard}
    _admission(monkeypatch, early=early)
    assert agent.run_conversation("book the flight") is early

    _turn(agent, "aisle seat", "Booked.")
    assert _user_sides(provider) == ["book the flight\n\naisle seat"]


def test_a_turn_that_raises_anywhere_keeps_its_words(agent_and_provider, monkeypatch):
    agent, provider = agent_and_provider
    _admission(monkeypatch, raises=OSError("session store unavailable"))
    with pytest.raises(OSError):
        agent.run_conversation("archive the logs")

    _turn(agent, "done?", "Archived.")
    assert _user_sides(provider) == ["archive the logs\n\ndone?"]


def test_an_injected_input_past_the_lease_wait_is_not_kept(agent_and_provider, monkeypatch):
    agent, provider = agent_and_provider
    early = {"messages": [], "api_calls": 0, "completed": False, "interrupted": True}
    _admission(monkeypatch, early=early)
    agent.run_conversation("[IMPORTANT: Background process proc_ab12 completed]",
                           persist_user_display_kind="process_complete")

    _turn(agent, "aisle seat", "Booked.")
    assert _user_sides(provider) == ["aisle seat"]


# -- conversations ------------------------------------------------------------------------------------------------

def test_words_follow_a_compression_rotation_and_a_left_conversation_sends_its_own(agent_and_provider):
    agent, provider = agent_and_provider
    manager = agent._memory_manager

    _turn(agent, "first", "…", interrupted=True)
    manager.on_session_switch("s2", parent_session_id="s1", reset=False, reason="compression")
    agent.session_id = "s2"
    _turn(agent, "second", "Done.")

    _turn(agent, "third", "…", interrupted=True)
    manager.on_session_switch("s3", parent_session_id="s2", reset=True)
    agent.session_id = "s3"
    _turn(agent, "fourth", "Done.")

    # /resume and /branch name the old session as parent too (hermes_cli/cli_session_switch.py)
    for reason in ("resume", "branch"):
        _turn(agent, f"before {reason}", "…", interrupted=True)
        manager.on_session_switch(f"{reason}-id", parent_session_id=agent.session_id, reset=False, reason=reason)
        agent.session_id = f"{reason}-id"
        _turn(agent, f"after {reason}", "Done.")

    assert [(s[0], s[1], s[2]["session_id"]) for s in provider.synced] == [
        ("first\n\nsecond", "Done.", "s2"),
        ("third", "", "s2"),  # the conversation it was typed in, with no reply: none came
        ("fourth", "Done.", "s3"),
        ("before resume", "", "s3"),
        ("after resume", "Done.", "resume-id"),
        ("before branch", "", "resume-id"),
        ("after branch", "Done.", "branch-id"),
    ]


def test_a_left_conversations_words_reach_providers_before_they_switch(agent_and_provider):
    """Providers key writes off the conversation they are bound to, so the old conversation's words go first."""
    agent, provider = agent_and_provider
    pedro = {"id": "tg:42", "name": "Pedro", "is_bot": False}
    _turn(agent, "Executa o vault processing", "…", interrupted=True, author=pedro)
    agent._memory_manager.on_session_switch("s2", parent_session_id="s1", reset=True, reason="new_session")

    assert provider.events == [("sync", "Executa o vault processing", "s1"), ("switch", "s2", "s1")]
    assert provider.synced[0][2]["turn_author"] == pedro


class _SessionRows:
    """The state.db rows a gateway session store writes: /new and an idle reset end the old session and name it
    as the new one's parent (gateway/session.py)."""

    def __init__(self, rows: dict) -> None:
        self.rows = rows

    def get_session(self, session_id):
        return self.rows.get(session_id)


def _gateway_successor(session_id, rows):
    """The agent a gateway builds for the first turn after /new: fresh, no on_session_switch, only state.db."""
    successor, provider = _fresh_agent(session_id)
    successor._session_db = _SessionRows(rows)
    return successor, provider


def test_a_new_conversation_sends_what_the_one_it_replaced_left(agent_and_provider, tmp_path):
    """Telegram, 04/11 22:41: a message, /stop, /new, a message. The gateway ends the old session without telling
    any memory manager, so the first turn of the new one sends the old one's words, in the old one's name."""
    from hermes_state import SessionDB

    agent, first_provider = agent_and_provider
    pedro = {"id": "tg:42", "name": "Pedro", "is_bot": False}
    _turn(agent, "Executa o vault processing", "…", interrupted=True, author=pedro)

    db = SessionDB(db_path=tmp_path / "state.db")  # the rows gateway/session.py writes on /new
    db.create_session("s1", "telegram")
    db.end_session("s1", "session_reset")
    db.create_session("s2", "telegram", parent_session_id="s1")
    successor, provider = _fresh_agent("s2")
    successor._session_db = db
    _turn(successor, "Execut ao cron das 21h", "Rodando.", author=pedro)
    successor._memory_manager.shutdown_all()

    assert first_provider.synced == []
    assert provider.synced == [
        ("Executa o vault processing", "", {"session_id": "s1", "turn_author": pedro}),
        ("Execut ao cron das 21h", "Rodando.", {"session_id": "s2", "turn_author": pedro}),
    ]


def test_the_words_are_found_past_a_conversation_that_said_nothing(agent_and_provider):
    agent, _ = agent_and_provider
    _turn(agent, "first ask", "…", interrupted=True)

    successor, provider = _gateway_successor("s3", {
        "s1": {"id": "s1", "ended_at": 1.0, "parent_session_id": None},
        "s2": {"id": "s2", "ended_at": 2.0, "parent_session_id": "s1"},  # /new, then /new again
        "s3": {"id": "s3", "ended_at": None, "parent_session_id": "s2"},
    })
    _turn(successor, "second ask", "Done.")
    successor._memory_manager.shutdown_all()

    assert [(s[0], s[2]["session_id"]) for s in provider.synced] == [("first ask", "s1"), ("second ask", "s3")]


def test_a_parent_still_open_keeps_its_words_for_its_own_next_turn(agent_and_provider):
    """A /branch leaves its parent open: the parent's next completed turn sends them, with its reply."""
    agent, provider = agent_and_provider
    _turn(agent, "draft the plan", "…", interrupted=True)

    branch, branch_provider = _gateway_successor("s2", {
        "s1": {"id": "s1", "ended_at": None, "parent_session_id": None},
        "s2": {"id": "s2", "ended_at": None, "parent_session_id": "s1"},
    })
    _turn(branch, "try another angle", "Here.")
    branch._memory_manager.shutdown_all()
    _turn(agent, "go on", "Plan: …")

    assert _user_sides(branch_provider) == ["try another angle"]
    assert _user_sides(provider) == ["draft the plan\n\ngo on"]


def test_a_session_store_failure_never_fails_the_turn(agent_and_provider):
    agent, _ = agent_and_provider
    _turn(agent, "first ask", "…", interrupted=True)

    class _Broken:
        def get_session(self, _sid):
            raise OSError("database is locked")

    successor, provider = _fresh_agent("s2")
    successor._session_db = _Broken()
    _turn(successor, "second ask", "Done.")
    successor._memory_manager.shutdown_all()

    assert _user_sides(provider) == ["second ask"]


def _fresh_agent(session_id="s1"):
    """The agent a gateway builds for the conversation's next turn after evicting the last one (/stop, /model)."""
    from run_agent import AIAgent

    manager = MemoryManager()
    provider = _RecordingProvider()
    manager.add_provider(provider)
    agent = AIAgent.__new__(AIAgent)
    agent._memory_manager, agent.session_id, agent._turn_author = manager, session_id, None
    return agent, provider


def test_words_outlive_the_agent_that_captured_them(agent_and_provider):
    agent, first_provider = agent_and_provider
    _turn(agent, "deploy to staging", "Deploying…", interrupted=True)

    successor, provider = _fresh_agent()
    _turn(successor, "status?", "Staging is up.")
    successor._memory_manager.shutdown_all()

    assert first_provider.synced == []
    assert _user_sides(provider) == ["deploy to staging\n\nstatus?"]


def test_another_profiles_conversation_never_receives_the_words(agent_and_provider, tmp_path, monkeypatch):
    agent, _ = agent_and_provider
    _turn(agent, "deploy to staging", "Deploying…", interrupted=True)

    other_home = tmp_path / "other-home"
    other_home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(other_home))
    other, provider = _fresh_agent()
    _turn(other, "status?", "All quiet.")
    other._memory_manager.shutdown_all()

    assert _user_sides(provider) == ["status?"]


def test_a_conversation_switch_leaves_other_conversations_words_alone(agent_and_provider):
    agent, _ = agent_and_provider
    elsewhere, provider = _fresh_agent("s9")
    _turn(elsewhere, "rotate the keys", "Rotating…", interrupted=True)

    agent._memory_manager.on_session_switch("s2", parent_session_id="s1", reset=True, reason="new_session")
    _turn(elsewhere, "done?", "Rotated.")
    elsewhere._memory_manager.shutdown_all()

    assert _user_sides(provider) == ["rotate the keys\n\ndone?"]


def test_a_gateway_steer_reaches_memory_without_its_routing_block(agent_and_provider):
    from gateway.steer_origin import with_origin

    agent, provider = agent_and_provider
    origin = '{"platform": "telegram", "chat_id": "42", "user_id": "42", "message_id": "7"}'
    capture_turn_words(agent, "fix the build", display_kind=None, turn_author=None)
    # Two steers queued before delivery arrive joined, each with its own block.
    _deliver_steer(agent, with_origin("also bump the version", origin) + "\n" + with_origin("and tag it", origin))
    agent._sync_external_memory_for_turn(original_user_message="fix the build", final_response="done",
                                         interrupted=False)
    assert agent._memory_manager.flush_pending(timeout=10)
    assert _user_sides(provider) == ["fix the build\n\nalso bump the version\nand tag it"]


def test_a_steer_requeued_as_the_next_turn_reaches_memory_without_its_routing_block(agent_and_provider):
    from gateway.steer_origin import with_origin

    agent, provider = agent_and_provider
    _turn(agent, with_origin("only the api", '{"platform": "telegram"}'), "On it.")
    assert _user_sides(provider) == ["only the api"]


def test_a_queued_session_boundary_keeps_what_the_new_conversation_captured(agent_and_provider):
    manager = agent_and_provider[0]._memory_manager
    manager.capture_user_words("old conversation words", session_id="s1")
    manager.capture_user_words("new conversation words", session_id="s2")  # before the queued boundary ran
    manager.on_session_switch("s2", parent_session_id="s1", reset=True, reason="new_session")

    assert manager.take_user_words("s2") == ["new conversation words"]


def test_undo_drops_the_words_it_rewound(agent_and_provider):
    manager = agent_and_provider[0]._memory_manager
    manager.capture_user_words("undone words", session_id="s1")
    manager.on_session_switch("s1", rewound=True)

    assert manager.take_user_words("s1") == []


# -- which texts are Hermes' own --------------------------------------------------------------------------------

def test_turn_kinds_cover_the_gateway_machinery_kinds():
    from gateway.response_filters import MACHINERY_DISPLAY_KINDS
    from tools.process_registry_notifications import HEARTBEAT_DISPLAY_KIND

    assert MACHINERY_DISPLAY_KINDS <= SYNTHETIC_TURN_DISPLAY_KINDS
    assert HEARTBEAT_DISPLAY_KIND in SYNTHETIC_TURN_DISPLAY_KINDS  # muted diagnostics are retyped to it too


def _producer_prompts() -> list[str]:
    """What the producers that queue plain text (no display kind) actually render."""
    from hermes_cli import goals, loops
    from tools.process_registry_notifications import ProcessNotificationBatch

    class _Registry:
        @staticmethod
        def is_completion_consumed(_session_id):
            return False

    from types import SimpleNamespace

    from hermes_cli.heartbeat import HEARTBEAT_PROMPT_TEMPLATE
    from tools.process_registry_notifications import format_process_notification
    from tui_gateway.session_notifications import _KANBAN_EVENT_FORMATTERS, _format_kanban_event_text

    batch = ProcessNotificationBatch(notifications=(({"session_id": "a"}, "one"), ({"session_id": "b"}, "two")))
    fields = dict(goal="ship it", contract_block="- done", subgoals_block="- also", attempt=1, max_retries=3,
                  command="make", output="boom", tick=3, cadence=", every 5m", prompt="check", until="done",
                  interval="5m")
    templates = [getattr(goals, name) for name in dir(goals) if name.startswith("CONTINUATION_PROMPT")]
    templates += [getattr(loops, name) for name in dir(loops) if name.startswith("WAKEUP_PROMPT")]
    templates.append(HEARTBEAT_PROMPT_TEMPLATE)
    assert len(templates) >= 5
    process_events = [
        {"type": kind, "session_id": "proc_ab12", "command": "make", "output": "ok", "exit_code": 0,
         "message": message}
        for kind, message in (
            ("completion", ""), ("watch_match", ""), ("heartbeat", ""),
            ("watch_disabled", "Watch patterns disabled for process proc_ab12 — too many matches. "),
            ("watch_overflow_tripped", "Watch-pattern overflow: >20 notifications in 60s across all processes."),
            ("watch_overflow_released", "Watch-pattern notifications resumed. 3 match event(s) were suppressed."),
        )
    ]
    kanban = [
        _format_kanban_event_text({"task_id": "t_1a2b"}, SimpleNamespace(title="Ship", assignee=who, result=None),
                                  SimpleNamespace(kind=kind, payload={}), board)
        for kind in _KANBAN_EVENT_FORMATTERS for who, board in (("", ""), ("infra", "ops"))
    ]
    from gateway.session_automation import _FOLD_HEADER
    from tools.process_registry_notifications import _format_task_failure_notice

    failure = _format_task_failure_notice({"goals": ["a", "b"], "n_tasks": 2, "results": [
        {"task_index": 1, "error": "boom"}]}, "deleg_1")
    return ([template.format_map(_Defaults(fields)) for template in templates] + [batch.render(_Registry())]
            + [format_process_notification(evt) for evt in process_events] + kanban
            + [_FOLD_HEADER.format(count=3) + "\n\n[IMPORTANT: Background process proc_a completed]", failure])


class _Defaults(dict):
    def __missing__(self, key):
        return "x"


def test_plain_text_producers_are_recognised():
    for prompt in _producer_prompts():
        assert is_synthetic_notification_turn(prompt), prompt[:80]


@pytest.mark.parametrize("text", [
    "continue toward the goal we discussed",
    "the /loop wakeup failed yesterday, why?",
    "[Replying to: \"Cronjob Response: Lembrete\"] ok, feito",
])
def test_user_words_about_the_same_things_are_not_synthetic(text):
    assert not is_synthetic_notification_turn(text)


def test_a_fork_keeps_no_words_and_sends_none_from_a_left_conversation():
    """A fork (``agent_context="subagent"``) holds a provider only for the checkpoint gate: its harness prompt is
    never captured, and leaving its conversation sends nothing (#16c6bbf keeps fork writes off on the host)."""
    provider = _RecordingProvider()
    mgr = MemoryManager()
    mgr.add_provider(provider)
    mgr.initialize_all("fork-1", agent_context="subagent")
    mgr.capture_user_words("fork harness prompt", session_id="fork-1")
    assert "fork-1" not in mgr.pending_user_word_sessions()
    assert mgr.send_left_conversation_words("fork-1", inline=True) == 0
    mgr.flush_pending(timeout=5)
    assert _user_sides(provider) == []
