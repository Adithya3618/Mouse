import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreResponses, calculateCognitiveAccuracy, ScoringMode, DEFAULT_SCORING_MODE } from '../../app/frontend/js/cognitive/speechScoring.js';

function response(parsedNumber, resolved = true, rawTranscript = String(parsedNumber)) {
    return { timestamp: 0, rawTranscript, parsedNumber, resolved };
}

test('DEFAULT_SCORING_MODE is adaptive (researcher-selected default)', () => {
    assert.equal(DEFAULT_SCORING_MODE, ScoringMode.ADAPTIVE);
});

test('adaptive mode: a fully correct sequence is scored as all correct', () => {
    const responses = [response(944), response(941), response(938)];
    const scored = scoreResponses(responses, { startingNumber: 947, subtractionValue: 3, mode: 'adaptive' });

    assert.deepEqual(scored.map((r) => r.expectedNumber), [944, 941, 938]);
    assert.deepEqual(scored.map((r) => r.correctness), ['correct', 'correct', 'correct']);
});

test('adaptive mode: a single slip does not cascade into every later response being wrong', () => {
    // Participant says 944 (correct), then slips to 940 instead of 941,
    // then correctly subtracts 3 again from what THEY said (940 - 3 = 937).
    const responses = [response(944), response(940), response(937)];
    const scored = scoreResponses(responses, { startingNumber: 947, subtractionValue: 3, mode: 'adaptive' });

    assert.equal(scored[0].correctness, 'correct');
    assert.equal(scored[1].correctness, 'incorrect'); // expected 941, got 940
    assert.equal(scored[1].expectedNumber, 941);
    assert.equal(scored[2].correctness, 'correct', 'expected number continues from the participant\'s own previous answer (940), not the pure sequence');
    assert.equal(scored[2].expectedNumber, 937);
});

test('strict mode: expected sequence never adapts to what the participant actually said', () => {
    const responses = [response(944), response(940), response(937)];
    const scored = scoreResponses(responses, { startingNumber: 947, subtractionValue: 3, mode: 'strict' });

    assert.deepEqual(scored.map((r) => r.expectedNumber), [944, 941, 938]);
    assert.equal(scored[0].correctness, 'correct');
    assert.equal(scored[1].correctness, 'incorrect');
    // Even though 937 = 940 - 3 (correct relative to their own previous
    // answer), strict mode compares only to the pure sequence (938), so
    // this is scored incorrect - the cascade the adaptive mode avoids.
    assert.equal(scored[2].correctness, 'incorrect');
    assert.equal(scored[2].expectedNumber, 938);
});

test('unresolved responses are scored as "unresolved", not silently correct/incorrect', () => {
    const responses = [response(944), response(null, false, 'mumble'), response(938)];
    const scored = scoreResponses(responses, { startingNumber: 947, subtractionValue: 3, mode: 'adaptive' });

    assert.equal(scored[1].correctness, 'unresolved');
    // Adaptive chain does not advance on an unresolved response - the next
    // expected number still continues from the last known spoken number.
    assert.equal(scored[2].expectedNumber, 941);
});

test('scoreResponses throws on an unknown scoring mode instead of silently defaulting', () => {
    assert.throws(() => scoreResponses([], { startingNumber: 947, subtractionValue: 3, mode: 'made-up' }));
});

test('calculateCognitiveAccuracy excludes unresolved responses from the denominator', () => {
    assert.equal(calculateCognitiveAccuracy(17, 3), 85);
    assert.equal(calculateCognitiveAccuracy(0, 0), 0, 'no scored responses at all -> 0, not NaN');
    assert.equal(calculateCognitiveAccuracy(1, 0), 100);
});
