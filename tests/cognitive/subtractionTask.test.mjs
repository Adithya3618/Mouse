import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SubtractionTask } from '../../app/frontend/js/cognitive/subtractionTask.js';

test('SubtractionTask stores its condition data', () => {
    const task = new SubtractionTask({ subtractionValue: 7, startingNumber: 892, duration: 120 });
    assert.equal(task.subtractionValue, 7);
    assert.equal(task.startingNumber, 892);
    assert.equal(task.duration, 120);
    assert.equal(task.isRunning(), false);
});

test('start()/stop() toggle running state and timestamps', () => {
    const task = new SubtractionTask({ subtractionValue: 3, startingNumber: 947, duration: 120 });
    task.start();
    assert.equal(task.isRunning(), true);
    assert.ok(task.startedAt instanceof Date);
    assert.equal(task.endedAt, null);

    task.stop();
    assert.equal(task.isRunning(), false);
    assert.ok(task.endedAt instanceof Date);
});

test('reset() clears timestamps and running state', () => {
    const task = new SubtractionTask({ subtractionValue: 17, startingNumber: 931, duration: 120 });
    task.start();
    task.stop();
    task.reset();
    assert.equal(task.startedAt, null);
    assert.equal(task.endedAt, null);
    assert.equal(task.isRunning(), false);
});
