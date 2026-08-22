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
