import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateStartingNumber } from '../../app/frontend/js/cognitive/randomNumber.js';

const RANGE = { min: 799, max: 999 };

test('generateStartingNumber stays within [min, max] inclusive', () => {
    for (let i = 0; i < 500; i++) {
        const value = generateStartingNumber(RANGE);
        assert.ok(Number.isInteger(value));
        assert.ok(value >= RANGE.min && value <= RANGE.max, `${value} out of range`);
    }
});

test('generateStartingNumber never repeats the previous number', () => {
    let previous = null;
    for (let i = 0; i < 500; i++) {
        const value = generateStartingNumber(RANGE, previous);
        assert.notEqual(value, previous);
        previous = value;
    }
});

test('generateStartingNumber with min === max returns that value unless it is the previous one', () => {
    const value = generateStartingNumber({ min: 900, max: 900 }, null);
    assert.equal(value, 900);
});

test('generateStartingNumber throws if min === max === previousNumber (no valid value exists)', () => {
    assert.throws(() => generateStartingNumber({ min: 900, max: 900 }, 900), RangeError);
});

test('generateStartingNumber throws if max < min', () => {
    assert.throws(() => generateStartingNumber({ min: 999, max: 799 }), RangeError);
});
