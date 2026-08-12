import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Timer } from '../../app/frontend/js/timer/timer.js';

// msPerSecond is set tiny throughout so these tests exercise the real
// countdown logic without waiting anywhere near real seconds.

test('Timer counts down and fires onComplete', async () => {
    const ticks = [];
    let completed = false;

    await new Promise((resolve) => {
        const timer = new Timer({
            msPerSecond: 2,
            onTick: (remaining) => ticks.push(remaining),
            onComplete: () => {
                completed = true;
                resolve();
            }
        });
        timer.start(3);
    });

    assert.equal(completed, true);
    assert.deepEqual(ticks, [2, 1, 0]);
});

test('Timer.getRemainingSeconds() reflects countdown progress', async () => {
    const timer = new Timer({ msPerSecond: 5 });
    timer.start(5);
    assert.equal(timer.getRemainingSeconds(), 5);

    await new Promise((resolve) => setTimeout(resolve, 12));
    assert.ok(timer.getRemainingSeconds() < 5);
    timer.stop();
});

test('Timer.pause() stops ticking and resume() continues', async () => {
    const ticks = [];
    const timer = new Timer({
        msPerSecond: 3,
        onTick: (remaining) => ticks.push(remaining)
    });

    timer.start(4);
    await new Promise((resolve) => setTimeout(resolve, 8)); // ~2 ticks
    timer.pause();
    assert.equal(timer.isRunning(), false);
    const remainingWhilePaused = timer.getRemainingSeconds();

    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(timer.getRemainingSeconds(), remainingWhilePaused, 'should not tick while paused');

    timer.resume();
    assert.equal(timer.isRunning(), true);
    timer.stop();
});

test('Timer.stop() clears remaining time and prevents further ticks', async () => {
    let tickCountAfterStop = 0;
    const timer = new Timer({
        msPerSecond: 2,
        onTick: () => tickCountAfterStop++
    });
    timer.start(10);
    timer.stop();
    assert.equal(timer.getRemainingSeconds(), 0);
    assert.equal(timer.isRunning(), false);

    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(tickCountAfterStop, 0, 'no ticks should fire after stop()');
});

test('Timer.reset() sets a fresh remaining duration without starting', () => {
    const timer = new Timer({ msPerSecond: 5 });
    timer.start(10);
    timer.reset(20);
    assert.equal(timer.getRemainingSeconds(), 20);
    assert.equal(timer.isRunning(), false);
});
