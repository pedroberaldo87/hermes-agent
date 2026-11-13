"""Clarify tool: structured multiple-choice / open-ended questions to the user.
Schema, validation and a thin dispatcher; the UI lives in a platform-provided
callback (cli.py, gateway/run.py, tui_gateway)."""

import json
from typing import Callable, Dict, List, Optional

MAX_CHOICES = 4  # the UI always appends an "Other (type your answer)" row
MAX_QUESTIONS = 5  # independent questions per call
# Per-choice cap. Surfaces wrap long choice text (newlines kept), so anything longer is rejected here, at the
# source, instead of a surface silently dropping a choice that ``choices_offered`` still reports as shown.
MAX_CHOICE_CHARS = 8000
# Applied to the first choice here (not per-surface) so every adapter renders it identically.
RECOMMENDED_LABEL = "(Recommended)"
_UNAVAILABLE = "Clarify tool is not available in this execution context."
_SHAPE = "Pass questions=[{question, choices?, multi_select?}]; a single question is a one-entry array."
# Claude models that call clarify after other tools in the same turn write the explanation into a
# thinking block, which the user never sees (0/68 runs produced a text block); a required ``context``
# whose description says it is the only text shown got the full report 13/13 (2026-11-12 probe).
CONTEXT_DESCRIPTION = (
    "Required. The COMPLETE message the user reads above the buttons. It is the ONLY text the user sees for "
    "this question: your thinking and anything you wrote earlier in this turn are NOT shown. Put the full "
    "result, findings and every numbered item here (markdown ok), not a pointer like 'items above'.")
_CONTEXT_REQUIRED = (
    "clarify refused: `context` is missing or empty. The user sees ONLY `context` above the buttons; your "
    "thinking and earlier text in this turn are not shown. Call clarify again with the full explanation "
    "in `context` (findings, proposal, every numbered item; markdown ok), then the questions.")


class ClarifyQuestions(list):
    """The display copy of a clarify batch handed to a surface callback: a plain list of question
    entries (callbacks that ignore the explanation keep working) carrying ``context``, the text the
    surface shows above the questions. Read it with ``clarify_call_context``."""

    def __init__(self, entries=(), context: str = ""):
        super().__init__(entries)
        self.context = context


def clarify_call_context(questions) -> str:
    """The explanation a clarify batch carries (``""`` for a plain list)."""
    return str(getattr(questions, "context", "") or "")


def mark_recommended(choices: list[str]) -> list[str]:
    """Suffix the first choice (schema says best-first) with RECOMMENDED_LABEL; idempotent,
    and a lone choice is left untouched (nothing to prefer it over)."""
    first = str(choices[0]).strip() if choices else ""
    if len(choices) < 2 or first != strip_recommended(first):
        return choices
    return [f"{first} {RECOMMENDED_LABEL}"] + list(choices[1:])


def strip_recommended(text: str) -> str:
    """Remove the recommendation label so presentation never leaks into ``user_response``."""
    stripped = str(text).strip()
    if stripped.casefold().endswith(RECOMMENDED_LABEL.casefold()):
        return stripped[: -len(RECOMMENDED_LABEL)].strip()
    return stripped


def _clean_answer(raw, multi: bool):
    """Strip presentation (the label, multi-select JSON) from a locked answer: a multi-select
    answer is a list, a JSON array string, or one typed ("Other") answer."""
    if not multi:
        return strip_recommended(raw)
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = None
        raw = parsed if isinstance(parsed, list) else [raw]
    return [strip_recommended(item) for item in raw if str(item).strip()]


def _normalize_questions(questions) -> tuple:
    """Validate ``questions`` -> ``(normalized, error)``. Entries carry ``qid`` (stable wire id
    ``q<index>`` surfaces key answers by), ``question``, decorated ``choices``, bare
    ``choices_offered`` and ``multi_select``."""
    if not isinstance(questions, list) or not questions:
        return None, f"questions must be a non-empty array. {_SHAPE}"
    if len(questions) > MAX_QUESTIONS:
        return None, f"questions supports at most {MAX_QUESTIONS} items."
    normalized = []
    for index, item in enumerate(questions):
        if not isinstance(item, dict):
            return None, f"questions[{index}] must be an object. {_SHAPE}"
        text = str(item.get("question") or "").strip()
        if not text:
            return None, f"questions[{index}].question must be non-empty text."
        choices = item.get("choices")
        if choices is not None:
            if not isinstance(choices, list) or not all(isinstance(c, str) for c in choices):
                return None, f"questions[{index}].choices must be a list of strings."
            for pos, choice in enumerate(choices):
                if len(choice.strip()) > MAX_CHOICE_CHARS:
                    return None, (f"questions[{index}].choices[{pos}] is {len(choice.strip())} characters; the limit is "
                                  f"{MAX_CHOICE_CHARS}. Move detail into the question text and resend.")
            cleaned = [c.strip() for c in choices if c.strip()][:MAX_CHOICES]
            if choices and not cleaned:
                # A card with no options strands the turn: say so instead of silently asking open-ended.
                return None, (f"questions[{index}].choices has {len(choices)} entries but all are blank. "
                              "Send real labels, or omit choices to ask open-ended.")
            choices = cleaned or None
        normalized.append({
            "qid": f"q{index}", "question": text,
            "choices": mark_recommended(list(choices)) if choices else None,
            "choices_offered": list(choices) if choices else None,
            "multi_select": bool(item.get("multi_select")) and bool(choices)})
    return normalized, None


def _response_status(qid: str, answers: dict, multi: bool) -> tuple:
    raw = answers.get(qid)
    cleaned = _clean_answer(raw, multi) if raw not in (None, "") else None
    if cleaned:
        return "answered", cleaned
    return ("skipped" if qid in answers else "unanswered"), None


def _result(normalized: list[dict], reply: dict, shown: list[dict] | None = None) -> str:
    """Result JSON from a callback reply ``{"answers": {qid: raw | None}, "outcome", "notice"?}``:
    every response carries ``status`` and ``user_response`` (null unless answered); ``outcome``
    says how the wait ended and ``notice`` (surface-supplied) says why. A picked display-copy
    choice (from ``shown``) maps back to the raw choice by position."""
    answers = reply.get("answers") or {}
    responses = []
    for entry, seen in zip(normalized, shown or normalized):
        status, value = _response_status(entry["qid"], answers, entry["multi_select"])
        back = dict(zip(seen["choices_offered"] or [], entry["choices_offered"] or []))
        if back and value:
            value = [back.get(v, v) for v in value] if isinstance(value, list) else back.get(value, value)
        responses.append({"question": entry["question"], "choices_offered": entry["choices_offered"],
                          "status": status, "user_response": value})
    result: dict[str, object] = {"responses": responses, "outcome": reply["outcome"]}
    if reply.get("notice"):
        result["notice"] = str(reply["notice"])
    return json.dumps(result, ensure_ascii=False)


def clarify_tool(questions, context=None, callback: Optional[Callable] = None) -> str:
    """Ask 1-5 questions in one call. ``callback(questions) -> {"answers", "outcome", "notice"?}``
    is platform injected (cli.py / gateway / tui_gateway) and receives the normalized list as a
    ``ClarifyQuestions`` carrying ``context`` (stripped, never truncated: messaging surfaces send it
    through their normal reply path, which splits long text)."""
    normalized, error = _normalize_questions(questions)
    if error:
        return tool_error(error)
    context = context.strip() if isinstance(context, str) else ""
    if not context:
        return tool_error(_CONTEXT_REQUIRED)
    if callback is None:
        return tool_error(_UNAVAILABLE)
    from agent.redact import redact_approval_display
    from tools.human_input_hooks import human_input_request

    def prose(texts):
        if not texts:
            return texts
        out: list[str] = []
        for text in (redact_approval_display(t, prose=True) for t in texts):
            label, n = text, 1
            while label in out:  # choices that redact alike (two `***` secrets) stay distinct, so a pick maps back to its own raw
                n += 1
                label = f"{text} ({n})"
            out.append(label)
        return out
    # Every surface renders the prose display copy of the question and choices; the result echoes the raw text.
    shown = []
    for q in normalized:
        offered = prose(q["choices_offered"])
        shown.append({**q, "question": prose([q["question"]])[0], "choices_offered": offered,
                      "choices": mark_recommended(list(offered)) if offered else None})
    shown = ClarifyQuestions(shown, context=redact_approval_display(context, prose=True))
    # Observers see the questions only; the answers stay in the tool result.
    with human_input_request("clarify", prompt="\n".join(q["question"] for q in shown)) as human:
        try:
            reply = callback(shown)
            human.outcome = str(reply.get("outcome") or "")
            return _result(normalized, reply, shown)
        except Exception as exc:
            human.outcome = "error"
            return tool_error(f"Failed to get user input: {exc}")


def check_clarify_requirements() -> bool:
    """Clarify tool has no external requirements -- always available."""
    return True


CLARIFY_SCHEMA = {
    "name": "clarify",
    "description": (
        "Ask the user one or more questions when you need a decision or feedback. "
        "Pass every question "
        f"in `questions` (1-{MAX_QUESTIONS} entries) — a single question is a "
        "one-entry array, and several INDEPENDENT questions belong in ONE "
        "call (one form beats a chain of clarify calls; if one answer would "
        "change another question, ask separately). Per question: "
        f"single-select (up to {MAX_CHOICES} choices — put your recommended "
        "option FIRST, the UI marks it '(Recommended)' and auto-appends an "
        "'Other' free-text row), multi-select (multi_select=true), or "
        "open-ended (omit choices). Options go ONLY in `choices`, never "
        "enumerated inside the question text (choices render as pickable "
        "rows; options written into the question are dead prose the user "
        "can't click). Result: {responses: [...], outcome} in question order. "
        "Each response has status answered, skipped or unanswered "
        "(user_response is null unless answered); outcome is submitted, "
        "cancelled, timed_out or undelivered, with a notice saying why "
        "when the wait ended without a submit. Prefer deciding "
        "low-stakes questions yourself; don't use this for dangerous-command "
        "confirmation (the terminal tool handles that)."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "context": {"type": "string", "description": CONTEXT_DESCRIPTION},
            "questions": {
                "type": "array",
                "minItems": 1,
                "maxItems": MAX_QUESTIONS,
                "description": (
                    "The question(s). Each: question text (options excluded), "
                    "optional choices (recommended first; omit for free-text), "
                    "optional multi_select. Responses come back in question "
                    "order with the question text echoed."
                ),
                "items": {
                    "type": "object",
                    "properties": {
                        "question": {"type": "string"},
                        "choices": {
                            "type": "array",
                            "items": {"type": "string"},  # no maxLength: llama.cpp's grammar converter rejects >=2000 (#131278); the limit is enforced above
                            "maxItems": MAX_CHOICES,
                        },
                        "multi_select": {"type": "boolean"},
                    },
                    "required": ["question"],
                },
            },
        },
        "required": ["context", "questions"],
    },
}

# --- Registry ---
from tools.registry import registry, tool_error

registry.register(
    name="clarify",
    toolset="clarify",
    schema=CLARIFY_SCHEMA,
    handler=lambda args, **kw: clarify_tool(args.get("questions"), args.get("context"), callback=kw.get("callback")),
    check_fn=check_clarify_requirements,
    emoji="❓",
    self_checked_args=("questions", "context"),  # the handler's refusal says what belongs in context
)
