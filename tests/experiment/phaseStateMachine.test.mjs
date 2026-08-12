import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PhaseStateMachine } from '../../app/frontend/js/experiment/phaseStateMachine.js';

const SEQUENCE = [{ phaseId: 'A' }, { phaseId: 'B' }, { phaseId: 'C' }];

test('current() is null before start()', () => {
    const fsm = new PhaseStateMachine(SEQUENCE);
    assert.equal(fsm.hasStarted(), false);
    assert.equal(fsm.current(), null);
});

test('start() moves to the first phase', () => {
    const fsm = new PhaseStateMachine(SEQUENCE);
    const first = fsm.start();
    assert.equal(first.phaseId, 'A');
    assert.equal(fsm.current().phaseId, 'A');
});

test('next() walks the sequence in order and stops at the end', () => {
    const fsm = new PhaseStateMachine(SEQUENCE);
    fsm.start();
    assert.equal(fsm.next().phaseId, 'B');
    assert.equal(fsm.next().phaseId, 'C');
    assert.equal(fsm.next(), null, 'next() past the end returns null');
    assert.equal(fsm.current().phaseId, 'C', 'current() stays on the last phase');
});

test('isComplete() is true only once the last phase is current', () => {
    const fsm = new PhaseStateMachine(SEQUENCE);
    fsm.start();
    assert.equal(fsm.isComplete(), false);
    fsm.next();
    assert.equal(fsm.isComplete(), false);
    fsm.next();
    assert.equal(fsm.isComplete(), true);
});

test('reset() returns to the not-started state', () => {
    const fsm = new PhaseStateMachine(SEQUENCE);
    fsm.start();
    fsm.next();
    fsm.reset();
    assert.equal(fsm.hasStarted(), false);
    assert.equal(fsm.current(), null);
});

test('constructor rejects an empty sequence', () => {
    assert.throws(() => new PhaseStateMachine([]));
});
