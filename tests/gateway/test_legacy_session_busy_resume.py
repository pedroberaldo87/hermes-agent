"""An old local row another live writer holds opens read-only for its owner, then adopts once free.

The old Desktop path keeps a pre-authority ``desktop`` row leased while its tab is open (and holds a
turn lease while it runs). The Webapp opening the same chat used to get no conversation at all:
``runtime_coordination_required``, or an uncaught ``SessionTurnLeaseLostError`` (a dispatch crash).
"""
from pathlib import Path
from types import SimpleNamespace

import pytest


async def _authority(tmp_path, monkeypatch):
    from gateway import run
    from gateway.config import GatewayConfig
    from gateway.session import SessionStore
    from gateway.session_authority import initialize_session_authority
    from gateway.session_contract import SessionActor

    monkeypatch.setenv('HERMES_HOME', str(tmp_path))
    monkeypatch.setattr(run, '_load_gateway_config', lambda: {'platform_toolsets': {'cli': []}})
    store = SessionStore(tmp_path / 'sessions', GatewayConfig())
    db = store._db
    db.create_session('old-desktop', source='desktop', model='old', cwd=str(tmp_path))
    db.append_message('old-desktop', role='user', content='OLD_QUESTION')
    db.append_message('old-desktop', role='assistant', content='OLD_ANSWER')
    runner = SimpleNamespace(session_store=store, _session_db=db, adapters={}, _draining=False)
    authority = await initialize_session_authority(runner, profile_id=str(tmp_path), instance_id='first')
    caps = frozenset({'session:create', 'session:read', 'session:submit', 'session:control'})
    native = SessionActor('native', str(tmp_path), caps, 'native-socket')
    remote = SessionActor('remote', str(tmp_path), caps, 'remote-socket')
    authority._native_legacy_transports = {native.transport_id: native}
    return authority, db, native, remote


def _adopted(db, sid):
    with db._read_ctx() as conn:
        return conn.execute("SELECT 1 FROM state_meta WHERE key=?", ('gateway.local_policy.v1:' + sid,)).fetchone()


@pytest.mark.asyncio
async def test_open_while_old_desktop_holds_the_row_reads_it_then_adopts_when_free(tmp_path, monkeypatch):
    from gateway.session_history_mount import is_history_mount
    from gateway.session_local_migration import resume_local_target
    from hermes_cli.active_sessions import release_active_session, try_acquire_active_session
    from hermes_state_runtime import RuntimeStoreError

    authority, db, native, remote = await _authority(tmp_path, monkeypatch)
    lease, refusal = try_acquire_active_session(session_id='old-desktop', surface='desktop',
                                                registry_home=Path(db.db_path).parent, config={})
    assert lease is not None, refusal
    try:
        ref = resume_local_target(authority, native, 'old-desktop')
        assert ref.session_id == 'old-desktop'
        assert is_history_mount(authority.sessions['old-desktop'])
        authority.authorize(native, ref, 'session:read')
        snapshot = await authority.attach(native, ref)
        assert [m['content'] for m in snapshot.history] == ['OLD_QUESTION', 'OLD_ANSWER']
        with pytest.raises(RuntimeStoreError, match='session_read_only'):
            authority.authorize(native, ref, 'session:submit')
        # A read is not ownership: nothing adopted, and someone else still finds nothing.
        assert not _adopted(db, 'old-desktop')
        with pytest.raises(RuntimeStoreError, match='not_found'):
            resume_local_target(authority, remote, 'old-desktop')
    finally:
        release_active_session(lease)
    ref = resume_local_target(authority, native, 'old-desktop')
    assert _adopted(db, 'old-desktop')
    live = authority.sessions['old-desktop']
    assert not is_history_mount(live) and live.source is not None
    authority.authorize(native, ref, 'session:submit')


@pytest.mark.asyncio
async def test_open_during_a_running_turn_is_a_read_not_a_crash(tmp_path, monkeypatch):
    from gateway.session_history_mount import is_history_mount
    from gateway.session_local_migration import resolve_local_target, resume_local_target
    from hermes_state_runtime import RuntimeStoreError

    authority, db, native, _remote = await _authority(tmp_path, monkeypatch)
    assert db.try_acquire_session_turn_lease('old-desktop', 'old-desktop-turn')
    try:
        # Adoption itself refuses with the bounded code, never the raw transcript-guard error.
        with pytest.raises(RuntimeStoreError, match='runtime_coordination_required'):
            resolve_local_target(authority, native, 'old-desktop')
        ref = resume_local_target(authority, native, 'old-desktop')
        assert is_history_mount(authority.sessions[ref.session_id])
        assert not _adopted(db, 'old-desktop')
    finally:
        db.release_session_turn_lease('old-desktop', 'old-desktop-turn')
    resume_local_target(authority, native, 'old-desktop')
    assert _adopted(db, 'old-desktop')
    assert not is_history_mount(authority.sessions['old-desktop'])
