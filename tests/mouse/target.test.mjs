import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getContainedPosition } from '../../app/frontend/js/mouse/target.js';

const TARGET_SIZE = 75; // matches config/mouseTaskConfig.js's targetSizePx

function assertContained(containerWidth, containerHeight, size, trials = 500) {
    const seenLefts = new Set();
    const seenTops = new Set();
    for (let i = 0; i < trials; i++) {
        const { left, top } = getContainedPosition(containerWidth, containerHeight, size);
        assert.ok(left >= 0, `left ${left} is negative`);
        assert.ok(top >= 0, `top ${top} is negative`);
        assert.ok(left + size <= containerWidth, `left ${left} + size ${size} exceeds width ${containerWidth}`);
        assert.ok(top + size <= containerHeight, `top ${top} + size ${size} exceeds height ${containerHeight}`);
        seenLefts.add(left);
        seenTops.add(top);
    }
    return { seenLefts, seenTops };
}

test('getContainedPosition keeps every position fully within the desktop target field (460x1200)', () => {
    assertContained(1200, 460, TARGET_SIZE);
});

test('getContainedPosition keeps every position fully within the mobile target field (320px height)', () => {
    assertContained(360, 320, TARGET_SIZE);
});

test('getContainedPosition positions are actually random, not a fixed point', () => {
    const { seenLefts, seenTops } = assertContained(1200, 460, TARGET_SIZE, 200);
    assert.ok(seenLefts.size > 10, 'expected many distinct left values across 200 trials');
    assert.ok(seenTops.size > 10, 'expected many distinct top values across 200 trials');
});

test('getContainedPosition never produces a negative range even when the container is smaller than the target', () => {
    const { left, top } = getContainedPosition(50, 50, TARGET_SIZE);
    assert.ok(left >= 0);
    assert.ok(top >= 0);
});
