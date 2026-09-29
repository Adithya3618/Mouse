// Click-level capture in mouse/mouseTask.js: every click and every target is
// recorded, hits are paired with the target that was clicked, and the
// recorded history always agrees with the task's own counters.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMouseSession } from '../../app/frontend/js/mouse/mouseTask.js';
import { summarizeMouseClickData } from '../../app/frontend/js/mouse/mousePerformanceSummary.js';

// Deterministic clock shared by the task's timers and its nowFn.
function createClock() {
    let now = 0;
    let nextId = 1;
    const timers = new Map();
    const schedule = (callback, ms, repeating) => {
        const id = nextId++;
        timers.set(id, { callback, interval: ms, nextFire: now + ms, repeating });
        return id;
    };
    return {
        now: () => now,
        setIntervalFn: (cb, ms) => schedule(cb, ms, true),
        setTimeoutFn: (cb, ms) => schedule(cb, ms, false),
        clearIntervalFn: (id) => timers.delete(id),
        advanceTo(target) {
            for (;;) {
                let next = null;
                for (const [id, t] of timers) {
                    if (t.nextFire <= target && (!next || t.nextFire < next.t.nextFire)) next = { id, t };
                }
                if (!next) break;
                now = next.t.nextFire;
                if (next.t.repeating) next.t.nextFire = now + next.t.interval;
                else timers.delete(next.id);
                next.t.callback();
            }
            now = target;
        }
    };
}

// Mirrors real DOM ordering: a click on a target runs the target's own
// listener (onHit) first, then bubbles to the document listener with the
// SAME event object.
function createHarness({ durationMs = 10000 } = {}) {
    const clock = createClock();
    const docListeners = new Set();
    const documentRef = {
        addEventListener: (type, fn) => { if (type === 'click') docListeners.add(fn); },
        removeEventListener: (type, fn) => { if (type === 'click') docListeners.delete(fn); },
        body: { style: {} }
    };
    const gameContainer = {
        style: {},
        clientWidth: 1200,
        clientHeight: 700,
        getBoundingClientRect: () => ({ left: 10, top: 50 })
    };
    const spawned = [];
    let result = null;

    runMouseSession({
        gameScreenContainer: { style: {} },
        gameContainer,
        timerElement: { style: {}, textContent: '' },
        endingElement: { style: {}, textContent: '' },
        startButtonElement: { style: {} },
        cursorType: 'default',
        bgColor: 'white',
        targetColor: 'black',
        targetSize: 75,
        durationMs,
        documentRef,
        spawnTargetFn: ({ onHit }) => {
            const element = { style: { left: `${100 + spawned.length * 10}px`, top: `${200 + spawned.length * 10}px` } };
            spawned.push({ onHit, element });
            return element;
        },
        setIntervalFn: clock.setIntervalFn,
        clearIntervalFn: clock.clearIntervalFn,
        setTimeoutFn: clock.setTimeoutFn,
        nowFn: clock.now,
        wallClockFn: () => Date.UTC(2026, 8, 29, 12, 0, 0),
        onComplete: (r) => { result = r; }
    });

    const fireDocument = (event) => { for (const fn of docListeners) fn(event); };
    return {
        clock,
        spawned,
        clickTarget(index, clientX, clientY) {
            const event = { clientX, clientY };
            spawned[index].onHit(event);
            fireDocument(event);
        },
        clickEmpty(clientX, clientY) {
            fireDocument({ clientX, clientY });
        },
        result: () => result
    };
}

test('records every click with time, position, hit/miss, target link and reaction time', () => {
    const h = createHarness();
    h.clock.advanceTo(1000);
    h.clickEmpty(500, 60); // miss, no target on screen yet
    h.clock.advanceTo(1750); // target #1 appears
    h.clock.advanceTo(2150);
    h.clickTarget(0, 150, 290); // hit #1 after 400ms
    h.clock.advanceTo(3500); // target #2 appears
    h.clock.advanceTo(3600);
    h.clickEmpty(900, 600); // miss while target #2 is on screen
    h.clock.advanceTo(4150);
    h.clickTarget(1, 140, 280); // hit #2 after 650ms
    h.clock.advanceTo(10000);

    const r = h.result();
    assert.ok(r, 'onComplete fired');
    assert.equal(r.clickEvents.length, 4);
    assert.equal(r.clickCount, 4);
    assert.equal(r.hitCount, 2);

    const [miss1, hit1, miss2, hit2] = r.clickEvents;
    assert.deepEqual(r.clickEvents.map((c) => c.clickSequence), [1, 2, 3, 4]);

    assert.equal(miss1.isHit, false);
    assert.equal(miss1.isMiss, true);
    assert.equal(miss1.elapsedMs, 1000);
    assert.equal(miss1.targetActive, false);
    assert.equal(miss1.reactionTimeMs, null);
    assert.equal(miss1.x, 490); // clientX 500 - container left 10
    assert.equal(miss1.y, 10); // clientY 60 - container top 50
    assert.equal(miss1.viewportX, 500);
    assert.equal(miss1.timestamp, '2026-09-29T12:00:01.000Z');

    assert.equal(hit1.isHit, true);
    assert.equal(hit1.targetId, 1);
    assert.equal(hit1.targetX, 100);
    assert.equal(hit1.targetY, 200);
    assert.equal(hit1.targetAppearedElapsedMs, 1750);
    assert.equal(hit1.reactionTimeMs, 400);

    assert.equal(miss2.targetActive, true);
    assert.equal(miss2.activeTargetCount, 1);

    assert.equal(hit2.targetId, 2);
    assert.equal(hit2.reactionTimeMs, 650);
});

test('records every target with its position, appearance time and outcome, plus the task settings', () => {
    const h = createHarness();
    h.clock.advanceTo(2000);
    h.clickTarget(0, 150, 290);
    h.clock.advanceTo(10000);

    const r = h.result();
    // Targets at 1750, 3500, 5250, 7000, 8750.
    assert.equal(r.targets.length, 5);
    assert.equal(r.numberOfTargets, 5);
    assert.deepEqual(r.targets.map((t) => t.outcome), ['hit', 'expired', 'expired', 'active_at_end', 'active_at_end']);
    assert.equal(r.targets[0].hitElapsedMs, 2000);
    assert.equal(r.targets[1].disappearedElapsedMs, 7500);
    assert.equal(r.targets[2].x, 120);

    assert.equal(r.taskInfo.durationMs, 10000);
    assert.equal(r.taskInfo.targetSpawnIntervalMs, 1750);
    assert.equal(r.taskInfo.targetLifetimeMs, 4000);
    assert.equal(r.taskInfo.containerWidth, 1200);
    assert.equal(r.taskInfo.containerHeight, 700);
});

test('the recorded click history reproduces the task\'s own counters exactly', () => {
    const h = createHarness({ durationMs: 12000 });
    for (let i = 0; i < 6; i += 1) {
        h.clock.advanceTo(1750 * (i + 1) + 300);
        if (i % 2 === 0) h.clickTarget(i, 100, 300);
        h.clickEmpty(10, 60);
    }
    h.clock.advanceTo(12000);

    const r = h.result();
    const summary = summarizeMouseClickData({ clickEvents: r.clickEvents, targets: r.targets });
    assert.equal(summary.totalClicks, r.clickCount);
    assert.equal(summary.totalHits, r.hitCount);
    assert.equal(summary.totalTargets, r.numberOfTargets);
    assert.equal(summary.totalMisses, r.clickCount - r.hitCount);
    assert.equal(summary.minReactionTimeMs, 300);
    assert.equal(summary.medianReactionTimeMs, 300);
});

test('clicks after the task ends are not recorded', () => {
    const h = createHarness({ durationMs: 3000 });
    h.clock.advanceTo(3000);
    h.clickEmpty(1, 1);
    assert.equal(h.result().clickEvents.length, 0);
});
