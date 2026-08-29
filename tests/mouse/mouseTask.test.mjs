import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMouseSession, TARGET_SPAWN_INTERVAL_MS } from '../../app/frontend/js/mouse/mouseTask.js';

// A minimal fake clock - runMouseSession is given setIntervalFn/
// clearIntervalFn/setTimeoutFn overrides (see mouseTask.js), so every
// "timer" in these tests is driven by this deterministic queue instead of
// real elapsed wall-clock time. advance(ms) fires every due callback in
// time order, including new timers scheduled while processing (mirrors how
// setInterval reschedules itself for its next tick).
function createFakeClock() {
    let now = 0;
    let nextId = 1;
    const timers = new Map();

    function schedule(callback, ms, { repeating }) {
        const id = nextId++;
        timers.set(id, { callback, interval: ms, nextFire: now + ms, repeating });
        return id;
    }
    function clear(id) {
        timers.delete(id);
    }
    function advance(ms) {
        const deadline = now + ms;
        for (;;) {
            let next = null;
            for (const [id, t] of timers) {
                if (t.nextFire <= deadline && (next === null || t.nextFire < next.t.nextFire)) {
                    next = { id, t };
                }
            }
            if (!next) {
                break;
            }
            now = next.t.nextFire;
            if (next.t.repeating) {
                next.t.nextFire = now + next.t.interval;
            } else {
                timers.delete(next.id);
            }
            next.t.callback();
        }
        now = deadline;
    }

    return {
        setIntervalFn: (cb, ms) => schedule(cb, ms, { repeating: true }),
        clearIntervalFn: clear,
        setTimeoutFn: (cb, ms) => schedule(cb, ms, { repeating: false }),
        advance
    };
}

function makeFakeElement() {
    return { style: {}, textContent: '' };
}

function makeFakeDocument() {
    const listeners = new Set();
    return {
        addEventListener: (type, fn) => { if (type === 'click') listeners.add(fn); },
        removeEventListener: (type, fn) => { if (type === 'click') listeners.delete(fn); },
        body: { style: {} },
        _fireClick: () => { for (const fn of listeners) fn(); }
    };
}

function baseElements() {
    return {
        gameScreenContainer: makeFakeElement(),
        gameContainer: makeFakeElement(),
        timerElement: makeFakeElement(),
        endingElement: makeFakeElement(),
        startButtonElement: makeFakeElement()
    };
}

test('spawns targets at exactly the configured interval - one per tick, none extra', () => {
    const clock = createFakeClock();
    const documentRef = makeFakeDocument();
    let spawnCount = 0;

    runMouseSession({
        ...baseElements(),
        cursorType: 'default',
        bgColor: 'white',
        targetColor: 'black',
        targetSize: 75,
        durationMs: 6000,
        documentRef,
        spawnTargetFn: () => { spawnCount++; },
        setIntervalFn: clock.setIntervalFn,
        clearIntervalFn: clock.clearIntervalFn,
        setTimeoutFn: clock.setTimeoutFn,
        onComplete: () => {}
    });

    // 6000ms duration at the default 1750ms interval -> targets at 1750,
    // 3500, 5250 (three spawns; the fourth would land at 7000ms, past the
    // session's own end).
    clock.advance(6000);
    assert.equal(spawnCount, Math.floor(6000 / TARGET_SPAWN_INTERVAL_MS));
    assert.equal(spawnCount, 3);
});

test('the spawn interval is configurable via targetSpawnIntervalMs, without touching the shared constant', () => {
    const clock = createFakeClock();
    const documentRef = makeFakeDocument();
    let spawnCount = 0;

    runMouseSession({
        ...baseElements(),
        cursorType: 'default',
        bgColor: 'white',
        targetColor: 'black',
        targetSize: 75,
        durationMs: 1000,
        targetSpawnIntervalMs: 200,
        documentRef,
        spawnTargetFn: () => { spawnCount++; },
        setIntervalFn: clock.setIntervalFn,
        clearIntervalFn: clock.clearIntervalFn,
        setTimeoutFn: clock.setTimeoutFn,
        onComplete: () => {}
    });

    clock.advance(1000);
    assert.equal(spawnCount, 5); // 200, 400, 600, 800, 1000
});

test('clicking a target (onHit) never triggers an extra spawn or resets the spawn timer', () => {
    const clock = createFakeClock();
    const documentRef = makeFakeDocument();
    let spawnCount = 0;
    const onHits = [];

    runMouseSession({
        ...baseElements(),
        cursorType: 'default',
        bgColor: 'white',
        targetColor: 'black',
        targetSize: 75,
        durationMs: 6000,
        documentRef,
        spawnTargetFn: ({ onHit }) => { spawnCount++; onHits.push(onHit); },
        setIntervalFn: clock.setIntervalFn,
        clearIntervalFn: clock.clearIntervalFn,
        setTimeoutFn: clock.setTimeoutFn,
        onComplete: () => {}
    });

    clock.advance(1750); // one target spawned
    assert.equal(spawnCount, 1);

    // Click the same target many times in a row - none of this should
    // schedule a replacement or change the cadence of future spawns.
    for (let i = 0; i < 10; i++) {
        onHits[0]();
    }
    assert.equal(spawnCount, 1, 'clicking never spawns a replacement target directly');

    clock.advance(4250); // through 3500 and 5250 - two more, still on schedule
    assert.equal(spawnCount, 3);
});

test('spawning stops at the session duration, and click/hit tracking still reports correctly via onComplete', () => {
    const clock = createFakeClock();
    const documentRef = makeFakeDocument();
    let completeResult = null;

    runMouseSession({
        ...baseElements(),
        cursorType: 'default',
        bgColor: 'white',
        targetColor: 'black',
        targetSize: 75,
        durationMs: 3500,
        documentRef,
        spawnTargetFn: ({ onHit }) => { onHit(); }, // every spawned target is immediately "hit" for this test
        setIntervalFn: clock.setIntervalFn,
        clearIntervalFn: clock.clearIntervalFn,
        setTimeoutFn: clock.setTimeoutFn,
        onComplete: (result) => { completeResult = result; }
    });

    documentRef._fireClick();
    documentRef._fireClick();

    clock.advance(3500);
    assert.ok(completeResult, 'onComplete must fire once the duration elapses');
    assert.equal(completeResult.numberOfTargets, 2); // spawns at 1750, 3500
    assert.equal(completeResult.hitCount, 2); // each spawned target was "hit" in this test
    assert.equal(completeResult.clickCount, 2); // the two raw document clicks

    // Advancing further must not spawn anything else or call onComplete again.
    const resultAtEnd = completeResult;
    clock.advance(10000);
    assert.equal(completeResult, resultAtEnd);
});

test('only a single spawn timer is ever active - the raw setInterval call count matches, never duplicated', () => {
    const clock = createFakeClock();
    const documentRef = makeFakeDocument();
    let intervalCallCount = 0;
    const wrappedSetInterval = (cb, ms) => { intervalCallCount++; return clock.setIntervalFn(cb, ms); };

    runMouseSession({
        ...baseElements(),
        cursorType: 'default',
        bgColor: 'white',
        targetColor: 'black',
        targetSize: 75,
        durationMs: 4000,
        documentRef,
        spawnTargetFn: () => {},
        setIntervalFn: wrappedSetInterval,
        clearIntervalFn: clock.clearIntervalFn,
        setTimeoutFn: clock.setTimeoutFn,
        onComplete: () => {}
    });

    clock.advance(4000);
    // Exactly 2 intervals are created for the whole session: the countdown
    // display (ticks every 1000ms) and the spawn timer - never more than
    // one of each, regardless of how long the session runs.
    assert.equal(intervalCallCount, 2);
});
