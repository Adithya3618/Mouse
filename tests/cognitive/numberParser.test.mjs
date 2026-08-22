import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpokenNumber, parseNumbersFromTranscript } from '../../app/frontend/js/cognitive/numberParser.js';

test('parseSpokenNumber parses a clean digit string', () => {
    const result = parseSpokenNumber('947');
    assert.equal(result.value, 947);
    assert.equal(result.resolved, true);
    assert.equal(result.raw, '947');
});

test('parseSpokenNumber parses spoken number words', () => {
    assert.deepEqual(parseSpokenNumber('nine hundred forty four'), { raw: 'nine hundred forty four', value: 944, resolved: true });
    assert.deepEqual(parseSpokenNumber('eight hundred seventeen'), { raw: 'eight hundred seventeen', value: 817, resolved: true });
    assert.equal(parseSpokenNumber('eight hundred and seventeen').value, 817, '"and" is treated as filler');
});

test('parseSpokenNumber marks unrelated/unresolved speech as unresolved without guessing', () => {
    const result = parseSpokenNumber('um I think maybe');
    assert.equal(result.value, null);
    assert.equal(result.resolved, false);
    assert.equal(result.raw, 'um I think maybe', 'raw text is preserved even when unresolved');
});

test('parseSpokenNumber marks empty/whitespace input as unresolved', () => {
    assert.deepEqual(parseSpokenNumber(''), { raw: '', value: null, resolved: false });
    assert.deepEqual(parseSpokenNumber('   '), { raw: '', value: null, resolved: false });
});

test('parseSpokenNumber does not guess at a bare ones-word fragment with no "hundred" anchor', () => {
    const result = parseSpokenNumber('four');
    assert.equal(result.resolved, false);
    assert.equal(result.value, null);
});

test('parseNumbersFromTranscript splits a comma-separated run of digit numbers', () => {
    const results = parseNumbersFromTranscript('944, 941, 938, 935');
    assert.deepEqual(results.map((r) => r.value), [944, 941, 938, 935]);
    assert.ok(results.every((r) => r.resolved));
});

test('parseNumbersFromTranscript splits consecutive word-form numbers', () => {
    const results = parseNumbersFromTranscript('nine hundred forty four nine hundred forty one');
    assert.deepEqual(results.map((r) => r.value), [944, 941]);
});

test('parseNumbersFromTranscript preserves the raw transcript as unresolved when nothing number-like is found', () => {
    const results = parseNumbersFromTranscript('I lost count sorry');
    assert.equal(results.length, 1);
    assert.equal(results[0].resolved, false);
    assert.equal(results[0].value, null);
    assert.equal(results[0].raw, 'I lost count sorry');
});

test('parseNumbersFromTranscript returns an empty array for empty transcripts', () => {
    assert.deepEqual(parseNumbersFromTranscript(''), []);
    assert.deepEqual(parseNumbersFromTranscript(null), []);
});

// --- Robustness pass (researcher request, 2026): reliably segmenting a
// spoken sequence of numbers, including continuous word-form speech with
// no pause-driven punctuation. See the module-level comment on
// NUMBER_SEGMENT_PATTERN above for the specific bug this fixes. ---

test('"960" parses to 960', () => {
    assert.deepEqual(parseNumbersFromTranscript('960').map((r) => r.value), [960]);
});

test('"nine hundred sixty" parses to 960', () => {
    assert.deepEqual(parseNumbersFromTranscript('nine hundred sixty').map((r) => r.value), [960]);
});

test('"nine hundred and sixty" parses to 960', () => {
    assert.deepEqual(parseNumbersFromTranscript('nine hundred and sixty').map((r) => r.value), [960]);
});

test('"960 957 954" (space-separated digits) parses to [960, 957, 954]', () => {
    assert.deepEqual(parseNumbersFromTranscript('960 957 954').map((r) => r.value), [960, 957, 954]);
});

test('"960, 957, 954" (comma-separated digits) parses to [960, 957, 954]', () => {
    assert.deepEqual(parseNumbersFromTranscript('960, 957, 954').map((r) => r.value), [960, 957, 954]);
});

test('BUG FIX: three consecutive word-form numbers with no separating punctuation are segmented correctly, not merged/lost', () => {
    // Before the fix, the greedy tens+ones lookahead swallowed the
    // leading "nine" of the second number into the first ("sixty nine" =
    // 69), producing [969, 954] and silently dropping 957 entirely.
    const results = parseNumbersFromTranscript('nine hundred sixty nine hundred fifty seven nine hundred fifty four');
    assert.deepEqual(results.map((r) => r.value), [960, 957, 954]);
    assert.equal(results.every((r) => r.resolved), true);
});

test('a mix of digit-form and word-form numbers in the same transcript segments correctly', () => {
    const results = parseNumbersFromTranscript('960 nine hundred fifty seven 954');
    assert.deepEqual(results.map((r) => r.value), [960, 957, 954]);
});

test('regression: a legitimate compound tens+ones number is still parsed as ONE number, not split at the word boundary', () => {
    // "sixty four" here has nothing ambiguous following "four" - the fix
    // must not affect this case.
    assert.deepEqual(parseNumbersFromTranscript('nine hundred sixty four').map((r) => r.value), [964]);
});

test('regression: a standalone number ending in a tens+ones compound is still parsed whole when nothing follows it', () => {
    assert.deepEqual(parseNumbersFromTranscript('nine hundred sixty nine').map((r) => r.value), [969]);
});

test('normalization: trailing "." or "," on an otherwise-clean digit string still resolves to the same numeric value, without altering the raw text', () => {
    assert.deepEqual(parseSpokenNumber('960.'), { raw: '960.', value: 960, resolved: true });
    assert.deepEqual(parseSpokenNumber('960,'), { raw: '960,', value: 960, resolved: true });
});
