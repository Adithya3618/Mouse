import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    resolveContinuationAnchor,
    continueDualTaskScoring,
    countOnlyPhaseIdFor,
    isDualTaskPhaseId,
    fromResponseRow
} from '../../app/frontend/js/cognitive/dualTaskContinuity.js';

// Canonical pre-scoring response shape this module standardizes on - see
// dualTaskContinuity.js's own header. `resolved` defaults to true, matching
// this suite's own speechScoring.test.mjs helper.
function response(parsedNumber, resolved = true, rawTranscript = String(parsedNumber)) {
    return { rawTranscript, parsedNumber, resolved };
}

// --- phaseId pairing -------------------------------------------------

test('countOnlyPhaseIdFor maps each DUAL_TASK_<n> to its paired SUBTRACTION_<n>', () => {
    assert.equal(countOnlyPhaseIdFor('DUAL_TASK_3'), 'SUBTRACTION_3');
    assert.equal(countOnlyPhaseIdFor('DUAL_TASK_7'), 'SUBTRACTION_7');
    assert.equal(countOnlyPhaseIdFor('DUAL_TASK_17'), 'SUBTRACTION_17');
});

test('countOnlyPhaseIdFor returns null for anything that is not a dual-task phase', () => {
    assert.equal(countOnlyPhaseIdFor('SUBTRACTION_3'), null);
    assert.equal(countOnlyPhaseIdFor('MOTOR_BASELINE'), null);
    assert.equal(countOnlyPhaseIdFor('RECOVERY_AFTER_MOTOR'), null);
    assert.equal(countOnlyPhaseIdFor(null), null);
    assert.equal(countOnlyPhaseIdFor(undefined), null);
});

test('isDualTaskPhaseId is true only for DUAL_TASK_<n> phases', () => {
    assert.equal(isDualTaskPhaseId('DUAL_TASK_3'), true);
    assert.equal(isDualTaskPhaseId('DUAL_TASK_17'), true);
    assert.equal(isDualTaskPhaseId('SUBTRACTION_3'), false);
    assert.equal(isDualTaskPhaseId('MOTOR_BASELINE'), false);
});

// --- resolveContinuationAnchor -----------------------------------------

test('resolveContinuationAnchor returns the last resolved spoken number, not the last response overall', () => {
    const countOnly = [response(822), response(819), response(null, false, 'mumble')];
    assert.equal(resolveContinuationAnchor(countOnly, 825), 819);
});

test('resolveContinuationAnchor falls back to the shared starting number when the count-only phase produced nothing valid', () => {
    assert.equal(resolveContinuationAnchor([], 825), 825);
    assert.equal(resolveContinuationAnchor(null, 825), 825);
    assert.equal(resolveContinuationAnchor([response(null, false, 'mumble')], 825), 825);
});

test('fromResponseRow adapts a stored DB row (snake_case) into the canonical pre-scoring shape losslessly', () => {
    const row = { raw_transcript_segment: '759', actual_number: 759, correctness: 'correct' };
    assert.deepEqual(fromResponseRow(row), { rawTranscript: '759', parsedNumber: 759, resolved: true });

    const unresolvedRow = { raw_transcript_segment: 'mumble', actual_number: null, correctness: 'unresolved' };
    assert.deepEqual(fromResponseRow(unresolvedRow), { rawTranscript: 'mumble', parsedNumber: null, resolved: false });
});

// --- The three worked examples given by the researcher (verbatim) -----

test('SUBTRACT BY 3: starting 825, count-only ends at 759, dual-task continues 756, 753, 750, 747', async () => {
    const countOnlyResponses = [822, 819, 816, 813, 810, 807, 804, 801, 798, 795, 792, 789,
        786, 783, 780, 777, 774, 771, 768, 765, 762, 759].map((n) => response(n));
    const dualTaskResponses = [756, 753, 750, 747].map((n) => response(n));

    const { continuationAnchor, mapped, scored } = await continueDualTaskScoring({
        dualTaskResponses,
        countOnlyResponses,
        startingNumber: 825,
        subtractionValue: 3,
        mode: 'adaptive'
    });

    assert.equal(continuationAnchor, 759, 'must anchor to the actual last valid count-only response, not restart at 825');
    assert.deepEqual(scored.map((r) => r.expectedNumber), [756, 753, 750, 747]);
    assert.deepEqual(scored.map((r) => r.correctness), ['correct', 'correct', 'correct', 'correct']);
    assert.equal(mapped[0].expectedNumber, 756, 'first dual-task expected number continues the sequence (759 - 3), never restarts at 825 - 3');
});

test('SUBTRACT BY 7: starting 917, count-only ends at 700, dual-task continues 693, 686, 679', async () => {
    const countOnlyResponses = [910, 903, 700].map((n) => response(n)); // last valid = 700
    const dualTaskResponses = [693, 686, 679].map((n) => response(n));

    const { continuationAnchor, scored } = await continueDualTaskScoring({
        dualTaskResponses,
        countOnlyResponses,
        startingNumber: 917,
        subtractionValue: 7,
        mode: 'adaptive'
    });

    assert.equal(continuationAnchor, 700);
    assert.deepEqual(scored.map((r) => r.expectedNumber), [693, 686, 679]);
    assert.deepEqual(scored.map((r) => r.correctness), ['correct', 'correct', 'correct']);
});

test('SUBTRACT BY 17: starting 903, count-only ends at 682, dual-task continues 665, 648, 631', async () => {
    const countOnlyResponses = [886, 682].map((n) => response(n)); // last valid = 682
    const dualTaskResponses = [665, 648, 631].map((n) => response(n));

    const { continuationAnchor, scored } = await continueDualTaskScoring({
        dualTaskResponses,
        countOnlyResponses,
        startingNumber: 903,
        subtractionValue: 17,
        mode: 'adaptive'
    });

    assert.equal(continuationAnchor, 682);
    assert.deepEqual(scored.map((r) => r.expectedNumber), [665, 648, 631]);
    assert.deepEqual(scored.map((r) => r.correctness), ['correct', 'correct', 'correct']);
});

// --- No new random number; original starting number is never consulted
//     for anything other than the "no valid count-only response" fallback

test('continueDualTaskScoring never introduces randomness - identical inputs always produce identical output', async () => {
    const countOnlyResponses = [822, 819, 759].map((n) => response(n));
    const dualTaskResponses = [756, 753].map((n) => response(n));
    const args = { dualTaskResponses, countOnlyResponses, startingNumber: 825, subtractionValue: 3, mode: 'adaptive' };

    const first = await continueDualTaskScoring(args);
    const second = await continueDualTaskScoring(args);

    assert.deepEqual(first.mapped, second.mapped);
    assert.equal(first.continuationAnchor, second.continuationAnchor);
});

test('the series starting number itself is never mutated or consulted when the count-only phase has valid responses', async () => {
    const countOnlyResponses = [759].map((n) => response(n));
    const dualTaskResponses = [756].map((n) => response(n));
    const startingNumber = 825;

    const { continuationAnchor } = await continueDualTaskScoring({
        dualTaskResponses, countOnlyResponses, startingNumber, subtractionValue: 3, mode: 'adaptive'
    });

    assert.notEqual(continuationAnchor, startingNumber, 'the dual-task sequence must not restart at the shared starting number');
    assert.equal(startingNumber, 825, 'the caller\'s own starting number value is never altered by this module');
});

// --- Existing mistake-handling/scoring rules are preserved under continuity

test('a mistake during the dual-task phase becomes the new reference point, exactly like the pre-existing adaptive rule', async () => {
    // Count-only ends at 759 (anchor). Dual-task: participant says 756
    // (correct), then slips to 752 instead of 753, then correctly
    // continues from their own actual 752 (752 - 3 = 749).
    const countOnlyResponses = [759].map((n) => response(n));
    const dualTaskResponses = [756, 752, 749].map((n) => response(n));

    const { scored } = await continueDualTaskScoring({
        dualTaskResponses, countOnlyResponses, startingNumber: 825, subtractionValue: 3, mode: 'adaptive'
    });

    assert.equal(scored[0].correctness, 'correct');
    assert.equal(scored[1].expectedNumber, 753);
    assert.equal(scored[1].correctness, 'incorrect');
    assert.equal(scored[2].expectedNumber, 749, 'continues from the actual 752, not the expected 753');
    assert.equal(scored[2].correctness, 'correct');
});

test('an unresolved dual-task response does not advance the adaptive chain, same as the pre-existing rule', async () => {
    const countOnlyResponses = [759].map((n) => response(n));
    const dualTaskResponses = [756, response(null, false, 'mumble'), 750].map((n) => (typeof n === 'number' ? response(n) : n));

    const { scored } = await continueDualTaskScoring({
        dualTaskResponses, countOnlyResponses, startingNumber: 825, subtractionValue: 3, mode: 'adaptive'
    });

    assert.equal(scored[1].correctness, 'unresolved');
    assert.equal(scored[2].expectedNumber, 753, 'chain still continues from the last actual spoken number (756), unresolved responses do not advance it');
});

test('when the count-only phase has no valid response yet, the dual-task phase falls back to the shared starting number (pre-existing behavior)', async () => {
    const { continuationAnchor, scored } = await continueDualTaskScoring({
        dualTaskResponses: [822].map((n) => response(n)),
        countOnlyResponses: [],
        startingNumber: 825,
        subtractionValue: 3,
        mode: 'adaptive'
    });

    assert.equal(continuationAnchor, 825);
    assert.equal(scored[0].expectedNumber, 822);
    assert.equal(scored[0].correctness, 'correct');
});
