"""Desktop's Force on a canonical queued row (local patch: forçar mensagem da fila).

The owner keeps one FIFO with no reorder verb, so Desktop forces a row with verbs it already has:
``prompt.replace_queued`` re-admits each row ahead at the tail (same text), then ``session.interrupt``
at the running turn's generation stops it. This pins that the owner's drain then claims the forced
row next, the others keep their order behind it, and a Stop naming a turn that already ended is
refused instead of cutting the forced row."""
import asyncio

import pytest

from hermes_state_runtime import list_session_admissions
from tests.gateway.test_prompt_queued_controls import _call, _connection, interactive
from tests.gateway.test_session_authority_cancel_settlement import _authority, _submit


class Agent:
    def __init__(self, turn):
        self.turn = turn

    def steer(self, text):
        return True

    def clear_interrupt(self, *args, **kwargs):
        pass

    def interrupt(self, *args, **kwargs):
        self.turn.release.set()


class Turns:
    """Every claimed turn runs until released (a hard Stop releases it); each run is recorded."""

    def __init__(self, monkeypatch):
        from gateway import session_finite
        self.ran, self.claimed, self.release = [], asyncio.Event(), asyncio.Event()
        self.agent = Agent(self)

        async def execute(authority, ref, row):
            self.ran.append(row['payload']['text'])
            self.release.clear()
            authority.adopt_agent(ref.session_id, row['generation'], self.agent)
            self.claimed.set()
            await asyncio.wait_for(self.release.wait(), 30)
            return 'done'
        monkeypatch.setattr(session_finite, 'execute_finite_admission', execute)

    async def next_run(self, count):
        for _ in range(300):
            if len(self.ran) >= count:
                return
            await asyncio.sleep(0.01)
        raise AssertionError(f'expected {count} runs, saw {self.ran}')


def _queued(db):
    return [r['payload']['text'] for r in list_session_admissions(db, session_id='s') if r['status'] == 'queued']


@pytest.mark.asyncio
async def test_rotating_the_rows_ahead_then_stopping_runs_the_forced_row_next(tmp_path, monkeypatch):
    db, authority = _authority(tmp_path, monkeypatch)
    interactive(db)
    turns = Turns(monkeypatch)
    with db:
        running = await _submit(authority, 'running')
        await asyncio.wait_for(turns.claimed.wait(), 30)
        a, b = await _submit(authority, 'a'), await _submit(authority, 'b')
        await _submit(authority, 'forced')
        conn = _connection(authority)

        receipt = await _call(conn, 'prompt.receipt', admission_id=running.admission_id)
        generation = receipt['result']['execution_generation']
        assert receipt['result']['status'] == 'started' and isinstance(generation, int), receipt

        for row, text in ((a, 'a'), (b, 'b')):
            moved = await _call(conn, 'prompt.replace_queued', admission_id=row.admission_id,
                                submission_id=f'{text}-moved', text=text)
            assert 'error' not in moved, moved
        assert _queued(db) == ['forced', 'a', 'b'], 'the forced row must head the FIFO, the others in order'

        stopped = await _call(conn, 'session.interrupt', execution_generation=generation)
        assert 'error' not in stopped, stopped
        await turns.next_run(2)
        assert turns.ran == ['running', 'forced']

        # A second Stop naming the generation that already ended is refused: the forced row is not cut.
        late = await _call(conn, 'session.interrupt', execution_generation=generation)
        assert late['error']['data']['reason'] == 'stale_generation', late

        for count in (3, 4):
            turns.release.set()
            await turns.next_run(count)
        turns.release.set()
        await asyncio.wait_for(authority.sessions['s'].task, 30)
    assert turns.ran == ['running', 'forced', 'a', 'b']
