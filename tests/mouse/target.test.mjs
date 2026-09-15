import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getContainedPosition, RESERVED_CORNER_ZONE, RESERVED_CORNER_ZONE_LEFT } from '../../app/frontend/js/mouse/target.js';

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

// --- Reserved corner (the floating Time Remaining / recording-indicator
// group - see css/experiment-screen.css's body.fullscreen-task rules and
// this file's own RESERVED_CORNER_ZONE comment). On by default - every
// spawn happens on a fullscreen task screen, so no caller needs to opt in. ---

test('getContainedPosition never overlaps the reserved corner zone by default', () => {
    const containerWidth = 1200;
    const containerHeight = 800;
    for (let i = 0; i < 500; i++) {
        const { left, top } = getContainedPosition(containerWidth, containerHeight, TARGET_SIZE);
        const overlapsCorner = left + TARGET_SIZE > containerWidth - RESERVED_CORNER_ZONE.width
            && top < RESERVED_CORNER_ZONE.height;
        assert.ok(!overlapsCorner, `target at (${left}, ${top}) overlaps the reserved corner`);
        // Still fully contained - the corner exclusion must never be
        // satisfied by pushing a target out of bounds instead.
        assert.ok(left >= 0 && left + TARGET_SIZE <= containerWidth);
        assert.ok(top >= 0 && top + TARGET_SIZE <= containerHeight);
    }
});

test('getContainedPosition still reaches positions outside the reserved corner (not just avoiding it into a single spot)', () => {
    const containerWidth = 1200;
    const containerHeight = 800;
    const seenLefts = new Set();
    for (let i = 0; i < 200; i++) {
        seenLefts.add(getContainedPosition(containerWidth, containerHeight, TARGET_SIZE).left);
    }
    assert.ok(seenLefts.size > 10, 'expected many distinct left values even with the corner reserved');
});

test('getContainedPosition can have the right reserved corner disabled explicitly (reservedCorner: null)', () => {
    // With the right corner disabled, positions landing inside where it
    // would have been are allowed again - can't assert a specific draw
    // lands there (it's random), but the call must not throw or misbehave.
    // (The left corner stays on at its default here.)
    const { left, top } = getContainedPosition(1200, 800, TARGET_SIZE, null);
    assert.ok(left >= 0 && left + TARGET_SIZE <= 1200);
    assert.ok(top >= 0 && top + TARGET_SIZE <= 800);
});

test('getContainedPosition falls back to a contained (if corner-overlapping) position rather than hanging when the reserved corners leave no room', () => {
    // A container far smaller than either reserved zone - every valid
    // position necessarily overlaps a "reserved" corner. Must still
    // return promptly, still respecting basic containment.
    const { left, top } = getContainedPosition(50, 50, TARGET_SIZE);
    assert.ok(left >= 0);
    assert.ok(top >= 0);
});

// --- Reserved corner, left (the counting-number card - DUAL_TASK_<n>
// only - see css/experiment-screen.css's body.fullscreen-task
// .starting-number rule and this file's own RESERVED_CORNER_ZONE_LEFT
// comment). Also on by default, same reasoning as the right corner above. ---

test('getContainedPosition never overlaps the reserved left corner zone by default', () => {
    const containerWidth = 1200;
    const containerHeight = 800;
    for (let i = 0; i < 500; i++) {
        const { left, top } = getContainedPosition(containerWidth, containerHeight, TARGET_SIZE);
        const overlapsLeftCorner = left < RESERVED_CORNER_ZONE_LEFT.width && top < RESERVED_CORNER_ZONE_LEFT.height;
        assert.ok(!overlapsLeftCorner, `target at (${left}, ${top}) overlaps the reserved left corner`);
        assert.ok(left >= 0 && left + TARGET_SIZE <= containerWidth);
        assert.ok(top >= 0 && top + TARGET_SIZE <= containerHeight);
    }
});

test('getContainedPosition never overlaps EITHER reserved corner simultaneously (both on at once, their normal default state)', () => {
    const containerWidth = 1200;
    const containerHeight = 800;
    for (let i = 0; i < 500; i++) {
        const { left, top } = getContainedPosition(containerWidth, containerHeight, TARGET_SIZE);
        const overlapsRight = left + TARGET_SIZE > containerWidth - RESERVED_CORNER_ZONE.width && top < RESERVED_CORNER_ZONE.height;
        const overlapsLeft = left < RESERVED_CORNER_ZONE_LEFT.width && top < RESERVED_CORNER_ZONE_LEFT.height;
        assert.ok(!overlapsRight, `target at (${left}, ${top}) overlaps the reserved right corner`);
        assert.ok(!overlapsLeft, `target at (${left}, ${top}) overlaps the reserved left corner`);
    }
});

test('getContainedPosition can have the left reserved corner disabled explicitly (reservedCornerLeft: null)', () => {
    const { left, top } = getContainedPosition(1200, 800, TARGET_SIZE, RESERVED_CORNER_ZONE, null);
    assert.ok(left >= 0 && left + TARGET_SIZE <= 1200);
    assert.ok(top >= 0 && top + TARGET_SIZE <= 800);
});

test('getContainedPosition can have both reserved corners disabled explicitly', () => {
    const seenLefts = new Set();
    for (let i = 0; i < 200; i++) {
        seenLefts.add(getContainedPosition(1200, 800, TARGET_SIZE, null, null).left);
    }
    // With nothing reserved, positions should be reachable across the
    // full width, including near left:0 (impossible with the left corner
    // enabled, since TARGET_SIZE < RESERVED_CORNER_ZONE_LEFT.width).
    assert.ok([...seenLefts].some((left) => left < RESERVED_CORNER_ZONE_LEFT.width));
});
