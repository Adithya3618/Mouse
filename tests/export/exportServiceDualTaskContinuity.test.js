// Verifies the Excel export actually reflects the dual-task counting-
// sequence continuity rule (see app/frontend/js/cognitive/dualTaskContinuity.js) -
// both the existing "Session Results" sheet's cognitive summary columns for
// a dual-task phase, and the new "Counting Sequence Continuity" sheet's
// per-response detail rows, using the researcher's own worked example
// (starting 825, count-only ends at 759, dual-task continues 756, 753,
// 750, 747).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { buildSessionResultsWorkbook } = require('../../app/backend/services/exportService');

// Matches the canonical pre-scoring response shape scoreResponses()
// produces (and cognitivePerformance.responses already carries) -
// { rawTranscript, parsedNumber, resolved }.
function response(parsedNumber, resolved = true, rawTranscript = String(parsedNumber)) {
    return { timestamp: 0, rawTranscript, parsedNumber, resolved };
}

function makeSessionWithContinuity() {
    const countOnlyResponses = [822, 819, 816, 813, 810, 807, 804, 801, 798, 795, 792, 789,
        786, 783, 780, 777, 774, 771, 768, 765, 762, 759].map((n) => response(n));
    const dualTaskResponses = [756, 753, 750, 747].map((n) => response(n));

    return {
        participantCode: 'P825',
        sessionId: 'session-825',
        experimentId: 'motor-cognitive-dual-task',
        sessionDate: '2026-09-01',
        startTime: '2026-09-01T10:00:00.000Z',
        endTime: '2026-09-01T10:20:00.000Z',
        phases: [
            {
                phaseId: 'SUBTRACTION_3',
                phaseType: 'cognitive',
                subtractionValue: 3,
                startingNumber: 825,
                duration: 90,
                cognitivePerformance: {
                    subtractionRule: 3,
                    startingNumber: 825,
                    responses: countOnlyResponses,
                    correctResponses: 22,
                    incorrectResponses: 0,
                    unresolvedResponses: 0,
                    numberOfResponses: 22,
                    cognitiveAccuracy: 100,
                    rawTranscript: '822 819 ... 759',
                    scoringMode: 'adaptive'
                }
            },
            {
                phaseId: 'DUAL_TASK_3',
                phaseType: 'dual-task',
                subtractionValue: 3,
                startingNumber: 825, // the SAME shared series starting number, per protocol
                duration: 120,
                cognitivePerformance: {
                    subtractionRule: 3,
                    // Anchored to the ORIGINAL starting number at processing
                    // time (the pre-existing, unmodified per-phase scoring) -
                    // this is deliberately "wrong" relative to the protocol
                    // rule, to prove the export re-anchors it rather than
                    // just echoing whatever was originally scored.
                    startingNumber: 825,
                    responses: dualTaskResponses,
                    correctResponses: 0,
                    incorrectResponses: 4,
                    unresolvedResponses: 0,
                    numberOfResponses: 4,
                    cognitiveAccuracy: 0,
                    rawTranscript: '756 753 750 747',
                    scoringMode: 'adaptive'
                }
            }
        ]
    };
}

test('Session Results sheet: dual-task cognitive summary columns reflect continuity-corrected scoring, not the raw restart-at-825 scoring', async () => {
    const buffer = await buildSessionResultsWorkbook(makeSessionWithContinuity());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet('Session Results');

    const dualTaskRow = worksheet.getRow(3).values.slice(1);
    assert.equal(dualTaskRow[4], 'DUAL_TASK_3');
    assert.equal(dualTaskRow[6], 825); // Starting Number column is still the shared series number, unchanged
    // Correct Responses: all 4 (756/753/750/747) are correct once anchored
    // to 759 - the fixture's original (unanchored) scoring said 0/4.
    assert.equal(dualTaskRow[15], 4, 'Correct Responses must reflect the continuity-corrected scoring');
    assert.equal(dualTaskRow[16], 0, 'Incorrect Responses must reflect the continuity-corrected scoring');
    assert.equal(dualTaskRow[18], 100, 'Cognitive Accuracy must reflect the continuity-corrected scoring');
    // Raw transcript is verbatim and anchor-independent - never rewritten.
    assert.equal(dualTaskRow[19], '756 753 750 747');
});

test('Session Results sheet: the count-only phase\'s own row is completely untouched by the continuity feature', async () => {
    const buffer = await buildSessionResultsWorkbook(makeSessionWithContinuity());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet('Session Results');

    const countOnlyRow = worksheet.getRow(2).values.slice(1);
    assert.equal(countOnlyRow[4], 'SUBTRACTION_3');
    assert.equal(countOnlyRow[15], 22);
    assert.equal(countOnlyRow[16], 0);
    assert.equal(countOnlyRow[18], 100);
});

test('Counting Sequence Continuity sheet exists with the exact required columns', async () => {
    const buffer = await buildSessionResultsWorkbook(makeSessionWithContinuity());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet('Counting Sequence Continuity');

    assert.ok(worksheet, 'a dedicated Counting Sequence Continuity sheet must exist');
    assert.deepEqual(worksheet.getRow(1).values.slice(1), [
        'Series',
        'Starting Number',
        'Count-only phase',
        'Last valid count-only number',
        'Dual-task phase',
        'Dual-task continuation starting number',
        'Expected sequence',
        'User Said',
        'Correct/Incorrect',
        'Next Expected'
    ]);
});

test('Counting Sequence Continuity sheet: one row per dual-task response, matching the researcher\'s exact worked example (825 -> 759 -> 756, 753, 750, 747)', async () => {
    const buffer = await buildSessionResultsWorkbook(makeSessionWithContinuity());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet('Counting Sequence Continuity');

    assert.equal(worksheet.rowCount, 5); // header + 4 dual-task responses

    const rows = [];
    for (let i = 2; i <= worksheet.rowCount; i += 1) {
        rows.push(worksheet.getRow(i).values.slice(1));
    }

    for (const row of rows) {
        assert.equal(row[0], 3); // Series
        assert.equal(row[1], 825); // Starting Number
        assert.equal(row[2], 'SUBTRACTION_3'); // Count-only phase
        assert.equal(row[3], 759); // Last valid count-only number
        assert.equal(row[4], 'DUAL_TASK_3'); // Dual-task phase
        assert.equal(row[5], 756); // Dual-task continuation starting number
    }

    assert.deepEqual(rows.map((r) => r[6]), [756, 753, 750, 747]); // Expected sequence
    assert.deepEqual(rows.map((r) => r[7]), [756, 753, 750, 747]); // User Said
    assert.deepEqual(rows.map((r) => r[8]), ['correct', 'correct', 'correct', 'correct']); // Correct/Incorrect
    assert.deepEqual(rows.map((r) => r[9]), [753, 750, 747, 744]); // Next Expected
});

test('Counting Sequence Continuity sheet has no rows for a session with no dual-task response data', async () => {
    const session = makeSessionWithContinuity();
    delete session.phases[1].cognitivePerformance.responses;

    const buffer = await buildSessionResultsWorkbook(session);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet('Counting Sequence Continuity');

    assert.equal(worksheet.rowCount, 1); // header only
});
