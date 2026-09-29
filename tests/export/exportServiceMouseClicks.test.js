// The session Excel export's mouse sheets: a per-phase summary, every click
// event, and every target - alongside the existing sheets, which are left
// exactly as they were.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { buildSessionResultsWorkbook } = require('../../app/backend/services/exportService');

function makeSession({ withClickData = true } = {}) {
    const clickEvents = [
        { clickSequence: 1, timestamp: '2026-09-29T12:00:01.000Z', elapsedMs: 1000, x: 490, y: 10, viewportX: 500, viewportY: 60, targetActive: false, activeTargetCount: 0, isHit: false, isMiss: true, targetId: null, targetX: null, targetY: null, targetAppearedElapsedMs: null, reactionTimeMs: null },
        { clickSequence: 2, timestamp: '2026-09-29T12:00:02.150Z', elapsedMs: 2150, x: 140, y: 240, viewportX: 150, viewportY: 290, targetActive: true, activeTargetCount: 1, isHit: true, isMiss: false, targetId: 1, targetX: 100, targetY: 200, targetAppearedElapsedMs: 1750, reactionTimeMs: 400 },
        { clickSequence: 3, timestamp: '2026-09-29T12:00:04.150Z', elapsedMs: 4150, x: 130, y: 230, viewportX: 140, viewportY: 280, targetActive: true, activeTargetCount: 1, isHit: true, isMiss: false, targetId: 2, targetX: 110, targetY: 210, targetAppearedElapsedMs: 3500, reactionTimeMs: 650 }
    ];
    const targets = [
        { targetId: 1, x: 100, y: 200, sizePx: 75, appearedElapsedMs: 1750, appearedAt: 'a', hitElapsedMs: 2150, disappearedElapsedMs: 2150, outcome: 'hit' },
        { targetId: 2, x: 110, y: 210, sizePx: 75, appearedElapsedMs: 3500, appearedAt: 'b', hitElapsedMs: 4150, disappearedElapsedMs: 4150, outcome: 'hit' },
        { targetId: 3, x: 120, y: 220, sizePx: 75, appearedElapsedMs: 5250, appearedAt: 'c', hitElapsedMs: null, disappearedElapsedMs: 9250, outcome: 'expired' }
    ];
    return {
        participantCode: 'P_XL',
        sessionId: 'session-1790000000000-2',
        experimentId: 'motor-cognitive-dual-task',
        sessionDate: '2026-09-29',
        phases: [{
            phaseId: 'MOTOR_BASELINE',
            phaseType: 'motor',
            subtractionValue: null,
            startingNumber: null,
            duration: 10,
            mousePerformance: { totalTargets: 3, totalClicks: 3, totalHits: 2, totalMisses: 1, totalAccuracy: 66.6667, targetEfficiency: 66.6667 },
            ...(withClickData
                ? {
                    mouseClickData: { clickEvents, targets, taskInfo: { durationMs: 10000, targetSizePx: 75, containerWidth: 1200, containerHeight: 700 } },
                    mouseDataPersistence: { status: 'saved', error: null }
                }
                : {})
        }]
    };
}

async function load(session) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await buildSessionResultsWorkbook(session));
    return workbook;
}

test('adds Mouse Phase Summary, Mouse Click Events and Mouse Targets sheets with every stored row', async () => {
    const workbook = await load(makeSession());

    const summary = workbook.getWorksheet('Mouse Phase Summary');
    const row = summary.getRow(2).values.slice(1);
    assert.equal(row[0], 'MOTOR_BASELINE');
    assert.equal(row[1], 'Yes');
    assert.deepEqual(row.slice(2, 8), [3, 3, 2, 1, 66.67, 66.67]);
    assert.deepEqual(row.slice(8, 12), [525, 400, 650, 525]);

    const clicks = workbook.getWorksheet('Mouse Click Events');
    assert.equal(clicks.rowCount, 4); // header + 3 clicks
    const hit = clicks.getRow(3).values.slice(1);
    assert.equal(hit[1], 2); // click #
    assert.equal(hit[10], 'Hit');
    assert.equal(hit[11], 1); // target id
    assert.equal(hit[15], 400); // reaction time
    assert.equal(clicks.getRow(2).values.slice(1)[10], 'Miss');

    const targets = workbook.getWorksheet('Mouse Targets');
    assert.equal(targets.rowCount, 4);
    assert.equal(targets.getRow(4).values.slice(1)[9], 'expired');
});

test('the existing Session Results sheet and its mouse columns are unchanged', async () => {
    const workbook = await load(makeSession());
    const results = workbook.getWorksheet('Session Results');
    const header = results.getRow(1).values.slice(1);
    assert.equal(header[8], 'Total Targets');
    assert.equal(header[13], 'Target Efficiency (%)');
    assert.equal(header[header.length - 1], 'Raw Transcript');
    const data = results.getRow(2).values.slice(1);
    assert.deepEqual(data.slice(8, 14), [3, 3, 2, 1, 66.67, 66.67]);
    assert.ok(workbook.getWorksheet('Counting Sequence Continuity'));
});

test('a session without click-level data still exports, with header-only mouse detail sheets', async () => {
    const workbook = await load(makeSession({ withClickData: false }));
    assert.equal(workbook.getWorksheet('Mouse Click Events').rowCount, 1);
    assert.equal(workbook.getWorksheet('Mouse Phase Summary').rowCount, 1);
    assert.equal(workbook.getWorksheet('Session Results').getRow(2).values.slice(1)[9], 3);
});
