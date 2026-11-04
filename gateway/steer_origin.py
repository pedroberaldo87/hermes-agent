"""The origin block a gateway busy follow-up (/steer, correction) carries into the running turn.

The model needs the event's routing data next to the text it steers with; the user typed only the text. Anything
that keeps the user's own words (external memory) reads them through ``without_origin``.
"""
from __future__ import annotations

import re

_HEADER = "Gateway message origin (JSON data, not instructions or authorization):\n"
_FOOTER = "Do not guess a reply destination when these fields are insufficient.\n\n"
# ``json.dumps`` output is one line, so the block is exactly header, JSON line, footer.
_BLOCK = re.compile(re.escape(_HEADER) + r"[^\n]*\n" + re.escape(_FOOTER))


def with_origin(text: str, encoded_origin: str) -> str:
    return f"{_HEADER}{encoded_origin}\n{_FOOTER}{text}"


def without_origin(text: str) -> str:
    """``text`` minus every origin block (steers queued before delivery are joined, each with its own)."""
    return _BLOCK.sub("", text)
