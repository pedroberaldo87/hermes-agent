"""Give a cloned profile its memory provider's config AND its own identity, on every create path.

Only ``hermes profile create --clone`` called Honcho's ``clone_honcho_for_profile``, so a profile
cloned by the dashboard (``POST /api/profiles``) or Desktop Bot Mode (``profiles.create``) got no
Honcho host block: it resolved no pinned user peer and wrote the user's words under an OS-uid peer
(``uid-501``), splitting their memory from every other surface. The CLI wrote the block into the
launch home's ``honcho.json``, which the new profile does not read once
``clone_memory_provider_config`` (#120115) has given it a copy of its own. ``create_profile`` now runs
both steps for every clone, before the profile is published, so the multiplexer never serves it
without its identity.
"""

import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


def clone_memory_provider_state(source_dir: Optional[Path], profile_dir: Path, profile_name: str, *,
                                copy_config: bool) -> None:
    """Copy the source's active-provider config into *profile_dir* (skipped for ``--clone-all``,
    which copied the whole home), then derive the new profile's provider identity."""
    if source_dir is None:
        return
    from hermes_cli.profile_memory_config import _load_config_dict, active_memory_provider, clone_memory_provider_config
    provider = active_memory_provider(_load_config_dict(source_dir))
    if copy_config:
        clone_memory_provider_config(source_dir, profile_dir, provider)
    clone_memory_provider_identity(profile_name, profile_dir, provider)


def _honcho_config_home(profile_dir: Path) -> Path:
    """The home whose ``honcho.json`` the new profile will read: its own copy when it has one,
    else the default profile's (the plugin's fallback, where host blocks accumulate)."""
    if (profile_dir / "honcho.json").exists():
        return profile_dir
    from hermes_cli.profiles import _get_default_hermes_home
    return _get_default_hermes_home()


def clone_memory_provider_identity(profile_name: str, profile_dir: Path, provider: Optional[str]) -> bool:
    """Run *provider*'s per-profile clone hook against the config *profile_dir* will read; True when it
    wrote something. Best-effort: a provider hiccup is logged, never raised into profile creation."""
    if provider != "honcho":
        return False
    try:
        from plugins.memory import import_provider_module
        honcho_cli = import_provider_module("honcho", "cli")
    except ImportError:
        return False  # Honcho selected in config.yaml but its plugin is not installed
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override
    token = set_hermes_home_override(_honcho_config_home(profile_dir))
    try:
        cloned = bool(honcho_cli.clone_honcho_for_profile(profile_name))
    except Exception:  # health: allow BLE001 -- a third-party hook must not fail profile creation
        logger.warning("profile %s: Honcho host block not cloned", profile_name, exc_info=True)
        return False
    finally:
        reset_hermes_home_override(token)
    if cloned:
        logger.info("profile %s: Honcho host block cloned (peer: %s)", profile_name, profile_name)
    return cloned


def backfill_memory_provider_identities() -> list[str]:
    """``hermes update``: give every named profile whose own config selects a provider the identity it
    lacks, in the file it reads. Replaces Honcho's ``sync_honcho_profiles_quiet``, which writes every
    profile's block into the launch home's ``honcho.json`` and so never reaches a profile that carries
    its own copy. Returns the names that got one."""
    from hermes_cli.profile_memory_config import _load_config_dict, active_memory_provider
    from hermes_cli.profiles import list_profiles
    return [p.name for p in list_profiles() if not p.is_default and clone_memory_provider_identity(
        p.name, p.path, active_memory_provider(_load_config_dict(p.path)))]
