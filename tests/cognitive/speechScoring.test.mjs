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

// --- ADAPTIVE CONTINUATION RULE - verification against specific worked
// examples (researcher request, 2026). These tests were added to CONFIRM
// existing behavior, not to change it: scoreResponses()'s adaptive mode
// already implements "expected next number = previous ACTUAL parsed
// response - subtraction rule" (see the "single slip does not cascade"
// test above, added earlier and unchanged). No modification to this file
// was necessary for any of these tests to pass.
//
// Per the existing, unmodified architecture (see cognitiveSpeechSession.js
// and the tests below/above), the starting number itself is never treated
// as a graded response - it is the given reference point the participant
// counts down FROM, not something they are expected to speak aloud. The
// participant's first genuinely spoken number is graded normally against
// startingNumber - subtractionValue, exactly like every subsequent
// response. This is "the existing intended handling of the starting
// number" the researcher asked to be preserved, not invented.

test('Subtract-by-3: 94, 91, 87, 84, 81 (starting number 97) - one incorrect response, does not cascade', () => {
    const responses = [94, 91, 87, 84, 81].map((n) => response(n));
    const scored = scoreResponses(responses, { startingNumber: 97, subtractionValue: 3, mode: 'adaptive' });

    assert.deepEqual(
        scored.map((r) => ({ parsedNumber: r.parsedNumber, expectedNumber: r.expectedNumber, correctness: r.correctness })),
        [
            { parsedNumber: 94, expectedNumber: 94, correctness: 'correct' },
            { parsedNumber: 91, expectedNumber: 91, correctness: 'correct' },
            { parsedNumber: 87, expectedNumber: 88, correctness: 'incorrect' }, // 91 - 3 = 88, participant said 87
            { parsedNumber: 84, expectedNumber: 84, correctness: 'correct' }, // continues from the ACTUAL 87, not the expected 88: 87 - 3 = 84
            { parsedNumber: 81, expectedNumber: 81, correctness: 'correct' }
        ]
    );

    const correctResponses = scored.filter((r) => r.correctness === 'correct').length;
    const incorrectResponses = scored.filter((r) => r.correctness === 'incorrect').length;
    assert.equal(correctResponses, 4);
    assert.equal(incorrectResponses, 1);
    assert.equal(scored.length, 5, 'total scored/graded responses - the given starting number 97 is not itself a graded response');
    assert.equal(calculateCognitiveAccuracy(correctResponses, incorrectResponses), 80);
});

test('Subtract-by-3: 97, 95, 92, 89 (starting number 100) - one incorrect response', () => {
    const responses = [97, 95, 92, 89].map((n) => response(n));
    const scored = scoreResponses(responses, { startingNumber: 100, subtractionValue: 3, mode: 'adaptive' });

    assert.deepEqual(
        scored.map((r) => ({ parsedNumber: r.parsedNumber, expectedNumber: r.expectedNumber, correctness: r.correctness })),
        [
            { parsedNumber: 97, expectedNumber: 97, correctness: 'correct' },
            { parsedNumber: 95, expectedNumber: 94, correctness: 'incorrect' }, // 97 - 3 = 94, participant said 95
            { parsedNumber: 92, expectedNumber: 92, correctness: 'correct' }, // continues from the ACTUAL 95: 95 - 3 = 92
            { parsedNumber: 89, expectedNumber: 89, correctness: 'correct' }
        ]
    );

    const correctResponses = scored.filter((r) => r.correctness === 'correct').length;
    const incorrectResponses = scored.filter((r) => r.correctness === 'incorrect').length;
    assert.equal(correctResponses, 3);
    assert.equal(incorrectResponses, 1);
    assert.equal(calculateCognitiveAccuracy(correctResponses, incorrectResponses), 75);
});

test('Subtract-by-7: an incorrect response is followed by an adaptively-correct one (93, 86, 80, 73 from starting number 100)', () => {
    const responses = [93, 86, 80, 73].map((n) => response(n));
    const scored = scoreResponses(responses, { startingNumber: 100, subtractionValue: 7, mode: 'adaptive' });

    assert.equal(scored[0].correctness, 'correct'); // 93 = 100 - 7
    assert.equal(scored[1].correctness, 'correct'); // 86 = 93 - 7
    assert.equal(scored[2].expectedNumber, 79); // 86 - 7 = 79
    assert.equal(scored[2].parsedNumber, 80, 'the raw/actual response (80) is preserved, never overwritten with the expected 79');
    assert.equal(scored[2].correctness, 'incorrect');
    assert.equal(scored[3].expectedNumber, 73, 'continues from the actual 80, not the expected 79: 80 - 7 = 73');
    assert.equal(scored[3].correctness, 'correct');
});

test('Subtract-by-17: an incorrect response is followed by an adaptively-correct one (133, 116, 100, 83 from starting number 150)', () => {
    const responses = [133, 116, 100, 83].map((n) => response(n));
    const scored = scoreResponses(responses, { startingNumber: 150, subtractionValue: 17, mode: 'adaptive' });

    assert.equal(scored[0].correctness, 'correct'); // 133 = 150 - 17
    assert.equal(scored[1].correctness, 'correct'); // 116 = 133 - 17
    assert.equal(scored[2].expectedNumber, 99); // 116 - 17 = 99
    assert.equal(scored[2].parsedNumber, 100, 'the raw/actual response (100) is preserved, never overwritten with the expected 99');
    assert.equal(scored[2].correctness, 'incorrect');
    assert.equal(scored[3].expectedNumber, 83, 'continues from the actual 100, not the expected 99: 100 - 17 = 83');
    assert.equal(scored[3].correctness, 'correct');
});

test('multiple consecutive mistakes: every response is evaluated against the previous ACTUAL response, never the original mathematical sequence', () => {
    // 100 (starting number, given) -> participant says 97, 95, 91, 88, rule 3.
    const responses = [97, 95, 91, 88].map((n) => response(n));
    const scored = scoreResponses(responses, { startingNumber: 100, subtractionValue: 3, mode: 'adaptive' });

    assert.equal(scored[0].expectedNumber, 97); // 100 - 3
    assert.equal(scored[0].correctness, 'correct');

    assert.equal(scored[1].expectedNumber, 94); // 97 - 3
    assert.equal(scored[1].parsedNumber, 95);
    assert.equal(scored[1].correctness, 'incorrect');

    // Critical case: the original mathematical sequence would expect 91
    // here (94 - 3), which would make this response "correct" if scoring
    // ignored the participant's actual previous answer. The adaptive rule
    // instead continues from what was ACTUALLY said (95), so the expected
    // number is 95 - 3 = 92, and 91 is scored incorrect.
    assert.equal(scored[2].expectedNumber, 92);
    assert.equal(scored[2].parsedNumber, 91);
    assert.equal(scored[2].correctness, 'incorrect', 'must be judged against 95 - 3, not the original 88/91 mathematical sequence');

    assert.equal(scored[3].expectedNumber, 88); // 91 - 3, continuing from the actual (also incorrect) previous answer
    assert.equal(scored[3].correctness, 'correct');

    const correctResponses = scored.filter((r) => r.correctness === 'correct').length;
    const incorrectResponses = scored.filter((r) => r.correctness === 'incorrect').length;
    assert.equal(correctResponses, 2);
    assert.equal(incorrectResponses, 2);
});

test('an incorrect response is never replaced with the expected number, and correctly becomes the reference point for the next expected number', () => {
    const responses = [91, 87, 84].map((n) => response(n));
    const scored = scoreResponses(responses, { startingNumber: 94, subtractionValue: 3, mode: 'adaptive' });

    const [first, second, third] = scored;
    assert.equal(first.parsedNumber, 91);
    assert.equal(first.correctness, 'correct');

    assert.deepEqual(
        { parsedNumber: second.parsedNumber, expectedNumber: second.expectedNumber, correctness: second.correctness },
        { parsedNumber: 87, expectedNumber: 88, correctness: 'incorrect' }
    );

    // The participant's raw response (87) - not the mathematically
    // expected 88 - is what the next expected number is derived from.
    assert.equal(third.expectedNumber, 84, '87 - 3, not 88 - 3');
    assert.equal(third.parsedNumber, 84);
    assert.equal(third.correctness, 'correct');
});
