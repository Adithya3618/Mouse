const { test } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const {
    buildSessionResultsWorkbook,
    buildSessionResultsFilename
} = require('../../app/backend/services/exportService');

function makeFormattedSession(overrides = {}) {
    return {
        participantId: null,
        participantCode: 'P014',
        sessionId: 'session-1755000000000-1',
        experimentId: 'motor-cognitive-dual-task',
        sessionDate: '2026-08-11',
        startTime: '2026-08-11T10:00:00.000Z',
        endTime: '2026-08-11T10:19:00.000Z',
        phases: [
            {
                phaseId: 'MOTOR_BASELINE',
                phaseType: 'motor',
                subtractionValue: null,
                startingNumber: null,
                duration: 120,
                startedAt: '2026-08-11T10:00:00.000Z',
                endedAt: '2026-08-11T10:02:00.000Z',
                mousePerformance: {
                    totalTargets: 40,
                    totalClicks: 50,
                    totalHits: 35,
                    totalMisses: 15,
                    totalAccuracy: 70,
                    targetEfficiency: 87.5
                }
            },
            {
                phaseId: 'RECOVERY_AFTER_MOTOR',
                phaseType: 'recovery',
                subtractionValue: null,
                startingNumber: null,
                duration: 90,
                startedAt: '2026-08-11T10:02:00.000Z',
                endedAt: '2026-08-11T10:03:30.000Z'
            },
            {
                phaseId: 'SUBTRACTION_3',
                phaseType: 'cognitive',
                subtractionValue: 3,
                startingNumber: 947,
                duration: 120,
                startedAt: '2026-08-11T10:03:30.000Z',
                endedAt: '2026-08-11T10:05:30.000Z'
            },
            {
                phaseId: 'DUAL_TASK_3',
                phaseType: 'dual-task',
                subtractionValue: 3,
                startingNumber: 947,
                duration: 120,
                startedAt: '2026-08-11T10:05:30.000Z',
                endedAt: '2026-08-11T10:07:30.000Z',
                mousePerformance: {
                    totalTargets: 20,
                    totalClicks: 30,
                    totalHits: 18,
                    totalMisses: 12,
                    totalAccuracy: 60,
                    targetEfficiency: 90
                },
                cognitivePerformance: {
                    subtractionRule: 3,
                    startingNumber: 947,
                    correctResponses: 14,
                    incorrectResponses: 4,
                    unresolvedResponses: 1,
                    numberOfResponses: 19,
                    cognitiveAccuracy: 14 / 18 * 100,
                    rawTranscript: '944 941 938 ...'
                }
            }
        ],
        ...overrides
    };
}

test('buildSessionResultsWorkbook produces a readable .xlsx with the correct header and one row per phase', async () => {
    const buffer = await buildSessionResultsWorkbook(makeFormattedSession());

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet('Session Results');

    assert.equal(worksheet.rowCount, 5); // header + 4 phases

    const headerValues = worksheet.getRow(1).values.slice(1);
    assert.deepEqual(headerValues, [
        'Participant ID',
        'Session ID',
        'Experiment ID',
        'Session Date',
        'Phase/Condition',
        'Subtraction Value',
        'Starting Number',
        'Duration (s)',
        'Total Targets',
        'Total Clicks',
        'Total Hits',
        'Total Misses',
        'Total Accuracy (%)',
        'Target Efficiency (%)',
        'Responses',
        'Correct Responses',
        'Incorrect Responses',
        'Unresolved Responses',
        'Cognitive Accuracy (%)',
        'Raw Transcript'
    ]);
});

test('buildSessionResultsWorkbook populates identifying columns and mouse data for a mouse-active phase', async () => {
    const buffer = await buildSessionResultsWorkbook(makeFormattedSession());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet('Session Results');

    const motorRow = worksheet.getRow(2).values.slice(1);
    assert.equal(motorRow[0], 'P014'); // Participant ID
    assert.equal(motorRow[1], 'session-1755000000000-1'); // Session ID
    assert.equal(motorRow[2], 'motor-cognitive-dual-task'); // Experiment ID
    assert.equal(motorRow[3], '2026-08-11'); // Session Date
    assert.equal(motorRow[4], 'MOTOR_BASELINE'); // Phase/Condition
    assert.equal(motorRow[7], 120); // Duration
    assert.equal(motorRow[8], 40); // Total Targets
    assert.equal(motorRow[9], 50); // Total Clicks
    assert.equal(motorRow[10], 35); // Total Hits
    assert.equal(motorRow[11], 15); // Total Misses
    assert.equal(motorRow[12], 70); // Total Accuracy
    assert.equal(motorRow[13], 87.5); // Target Efficiency
});

test('buildSessionResultsWorkbook leaves mouse columns blank for non-mouse phases, and keeps conditions separately identifiable', async () => {
    const buffer = await buildSessionResultsWorkbook(makeFormattedSession());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet('Session Results');

    const recoveryRow = worksheet.getRow(3).values.slice(1);
    assert.equal(recoveryRow[4], 'RECOVERY_AFTER_MOTOR');
    assert.equal(recoveryRow[8], ''); // no Total Targets for recovery

    const subtractionRow = worksheet.getRow(4).values.slice(1);
    assert.equal(subtractionRow[4], 'SUBTRACTION_3');
    assert.equal(subtractionRow[5], 3); // Subtraction Value
    assert.equal(subtractionRow[6], 947); // Starting Number
    assert.equal(subtractionRow[8], ''); // no mouse data during subtraction-only

    const dualTaskRow = worksheet.getRow(5).values.slice(1);
    assert.equal(dualTaskRow[4], 'DUAL_TASK_3');
    assert.equal(dualTaskRow[6], 947); // same starting number as SUBTRACTION_3
    assert.equal(dualTaskRow[8], 20); // its own, separate mouse data

    // MOTOR_BASELINE and DUAL_TASK_3 must never be combined into one score.
    assert.notEqual(motorAccuracy(worksheet), dualTaskAccuracy(worksheet));

    // Non-cognitive phases leave the cognitive columns blank too.
    assert.equal(recoveryRow[14], ''); // Responses
    assert.equal(subtractionRow[14], ''); // no speech data recorded for the fixture's SUBTRACTION_3 row

    function motorAccuracy(ws) {
        return ws.getRow(2).values[13];
    }
    function dualTaskAccuracy(ws) {
        return ws.getRow(5).values[13];
    }
});

test('buildSessionResultsWorkbook populates cognitive (speech) columns for a cognitive-active phase, independent of that phase\'s mouse columns', async () => {
    const buffer = await buildSessionResultsWorkbook(makeFormattedSession());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet('Session Results');

    const dualTaskRow = worksheet.getRow(5).values.slice(1);
    assert.equal(dualTaskRow[4], 'DUAL_TASK_3');
    assert.equal(dualTaskRow[14], 19); // Responses
    assert.equal(dualTaskRow[15], 14); // Correct Responses
    assert.equal(dualTaskRow[16], 4); // Incorrect Responses
    assert.equal(dualTaskRow[17], 1); // Unresolved Responses
    assert.equal(dualTaskRow[18], Number((14 / 18 * 100).toFixed(2))); // Cognitive Accuracy
    assert.equal(dualTaskRow[19], '944 941 938 ...'); // Raw Transcript

    // Cognitive and mouse data for the same phase are independent columns,
    // never combined into one score.
    assert.equal(dualTaskRow[8], 20); // Total Targets (mouse)
    assert.equal(dualTaskRow[12], 60); // Total Accuracy (mouse)
});

test('buildSessionResultsFilename produces a meaningful filename from participant/session', () => {
    const name = buildSessionResultsFilename(makeFormattedSession());
    assert.equal(name, 'MouseAccuracy_P014_session-1755000000000-1.xlsx');
});

test('buildSessionResultsFilename falls back safely when participant/session are unavailable', () => {
    const name = buildSessionResultsFilename(makeFormattedSession({ participantCode: null, sessionId: null }));
    assert.match(name, /^MouseAccuracy_UnknownParticipant_Session\d+\.xlsx$/);
});

test('buildSessionResultsFilename sanitizes characters that are unsafe in filenames', () => {
    const name = buildSessionResultsFilename(makeFormattedSession({ participantCode: '../../evil P/014' }));
    assert.ok(!name.includes('/'));
    assert.ok(!name.includes('..'));
    assert.ok(name.startsWith('MouseAccuracy_'));
    assert.ok(name.endsWith('.xlsx'));
});
