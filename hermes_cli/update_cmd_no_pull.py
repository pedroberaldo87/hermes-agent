"""``hermes update --no-pull``: install the commit already checked out, without fetching.

A deploy tool that has already put the exact commit it validated in the checkout (``git checkout
<sha>``) needs the rest of the update -- dependency sync, launchers, plugin repair, config
migrations, Desktop rebuild, gateway restart, receipt -- for THAT commit. The normal update
fetches and then moves the checkout (``merge --ff-only``, a branch switch, or with
``updates.parked_branch_strategy: update_in_place`` a merge of the newest ``origin/<branch>``
into the checked-out branch), so the Mac ends up running upstream code nobody validated.

``--no-pull`` makes HEAD the update target through the route an install already takes when its
channel's release is HEAD itself (``target_is_head``): nothing is fetched, the parked-branch
strategy and branch switch are never consulted (a pinned commit never merges into or rewrites the
branch), HEAD does not move, and the run finishes through the same completion tail as every
update. No channel or release is resolved. The receipt records ``pulled: false``.
"""

from __future__ import annotations

import sys
from typing import NoReturn

from hermes_cli.update_cmd_common import _record_stop

#: Flags that choose a different target than HEAD; contradictory with --no-pull.
_TARGET_FLAGS = (("branch", "--branch"), ("channel", "--channel"), ("switch_branch", "--switch-branch"))


def _uc():
    from hermes_cli import update_cmd

    return update_cmd


def refuse_conflicting_flags(args) -> None:
    """Exit 2 before anything runs when ``--no-pull`` is combined with a target-choosing flag."""
    if not getattr(args, "no_pull", False):
        return
    clashing = [flag for attr, flag in _TARGET_FLAGS if getattr(args, attr, None)]
    if clashing:
        print(f"✗ --no-pull installs the checked-out commit; it cannot be combined with {', '.join(clashing)}.")
        print("  Check out the commit you want first, then run `hermes update --no-pull`.")
        sys.exit(2)


def _refuse(message: str, stop, stop_class: str) -> NoReturn:
    print(f"✗ {message} No update was applied.")
    stop()
    _record_stop(stop_class)
    sys.exit(1)


def select_apply_target(args, branch: str, request: dict, *, git_cmd, stop) -> tuple:
    """``update_cmd_check.select_apply_target``, except that ``--no-pull`` targets HEAD itself.

    Returns ``(target_ref, release_sha, target_is_head, repository)``; for ``--no-pull`` that is
    ``(HEAD, HEAD, True, None)``: the caller skips the fetch and lands on its up-to-date tail.
    """
    uc = _uc()
    if not getattr(args, "no_pull", False):
        return uc._check.select_apply_target(args, branch, request, git_cmd=git_cmd, stop=stop)
    if git_cmd is None:  # ZIP install: there is no checked-out commit to install
        _refuse("--no-pull needs a git checkout; this install has none.", stop, "not_git_checkout")
    head = uc._capture_head_sha(git_cmd, uc._m().PROJECT_ROOT)
    if not head:
        _refuse("--no-pull could not read the checked-out commit (git rev-parse HEAD failed).",
                stop, "checkout_move_failed")
    where = uc._current_branch_name(git_cmd) or "HEAD"
    where = "detached HEAD" if where == "HEAD" else f"'{where}'"
    print(f"→ --no-pull: installing the checked-out commit {head[:10]} on {where} (nothing fetched or merged)")
    uc._completion_receipt.record_fact("pulled", False)
    uc._completion_receipt.record_skip("pull", "--no-pull: the checked-out commit is the target")
    request["expected_sha"] = head
    return head, head, True, None
