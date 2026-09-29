// Mouse click-history persistence: POST /api/mouse-performance ->
// SQLite -> Admin Session Review. Every test uses an in-memory or temp-dir
// database - never the real data/db/.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from '../../app/backend/database/db.js';
import { createAppContext } from '../../app/backend/appContext.js';
import { createMousePerformanceRouter } from '../../app/backend/routes/mousePerformance.js';
import { createAdminRouter } from '../../app/backend/routes/admin.js';
import { LocalFilesystemAudioStorage } from '../../app/backend/storage/audioStorage.js';
import { StubTranscriptionProvider } from '../../app/backend/transcription/stubProvider.js';

async function startServer({ db = createDatabase(':memory:') } = {}) {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mouse-perf-test-'));
    const context = createAppContext({
        db,
        audioStorage: new LocalFilesystemAudioStorage({ baseDir }),
        transcriptionProvider: new StubTranscriptionProvider(),
        logger: () => {}
    });
    const app = express();
    // Same order as server.js: the mouse router parses its own (larger)
    // bodies ahead of the app-wide 100kb express.json().
    app.use(createMousePerformanceRouter(context));
    app.use(express.json());
    app.use('/api/admin', createAdminRouter(context));

    const server = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s));
    });
    return { server, context, db, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

// A realistic phase: targets every 1750ms, some hit, plus misses between.
// `hits` targets are clicked `reactionMs[i]` after appearing; `misses`
// clicks land on empty space.
function buildPayload({
    participantCode = 'MOUSE_P1',
    sessionId = 'session-1790000000000-1',
    phaseId = 'MOTOR_BASELINE',
    phaseType,
    targetCount = 4,
    reactionMs = [400, 650],
    misses = 1,
    durationMs = 10000
} = {}) {
    const resolvedType = phaseType || (phaseId === 'MOTOR_BASELINE' ? 'motor' : 'dual-task');
    const targets = [];
    for (let i = 0; i < targetCount; i += 1) {
        const appeared = 1750 * (i + 1);
        const hit = i < reactionMs.length;
        targets.push({
            targetId: i + 1,
            x: 100 + i * 50,
            y: 200 + i * 20,
            sizePx: 75,
            appearedElapsedMs: appeared,
            appearedAt: new Date(Date.UTC(2026, 8, 29, 12, 0, 0) + appeared).toISOString(),
            hitElapsedMs: hit ? appeared + reactionMs[i] : null,
            disappearedElapsedMs: hit ? appeared + reactionMs[i] : appeared + 4000,
            outcome: hit ? 'hit' : (appeared + 4000 <= durationMs ? 'expired' : 'active_at_end')
        });
    }

    const raw = [];
    reactionMs.forEach((rt, i) => {
        const t = targets[i];
        raw.push({ elapsedMs: t.appearedElapsedMs + rt, isHit: true, target: t });
    });
    for (let i = 0; i < misses; i += 1) {
        raw.push({ elapsedMs: 1000 + i * 3000 + 17, isHit: false, target: null });
    }
    raw.sort((a, b) => a.elapsedMs - b.elapsedMs);

    const clickEvents = raw.map((r, index) => ({
        clickSequence: index + 1,
        timestamp: new Date(Date.UTC(2026, 8, 29, 12, 0, 0) + r.elapsedMs).toISOString(),
        elapsedMs: r.elapsedMs,
        x: r.target ? r.target.x + 30 : 640,
        y: r.target ? r.target.y + 30 : 12,
        viewportX: r.target ? r.target.x + 30 : 640,
        viewportY: r.target ? r.target.y + 30 : 12,
        targetActive: Boolean(r.target),
        activeTargetCount: r.target ? 1 : 0,
        isHit: r.isHit,
        isMiss: !r.isHit,
        targetId: r.target ? r.target.targetId : null,
        targetX: r.target ? r.target.x : null,
        targetY: r.target ? r.target.y : null,
        targetAppearedElapsedMs: r.target ? r.target.appearedElapsedMs : null,
        targetAppearedAt: r.target ? r.target.appearedAt : null,
        reactionTimeMs: r.target ? r.elapsedMs - r.target.appearedElapsedMs : null
    }));

    return {
        participantCode,
        sessionId,
        experimentId: 'motor-cognitive-dual-task',
        sessionDate: '2026-09-29',
        sessionStartTime: '2026-09-29T11:59:00.000Z',
        phaseId,
        phaseType: resolvedType,
        phaseStartedAt: '2026-09-29T12:00:00.000Z',
        taskInfo: {
            startedAt: '2026-09-29T12:00:00.000Z',
            endedAt: '2026-09-29T12:00:10.000Z',
            durationMs,
            actualDurationMs: durationMs + 3,
            targetSizePx: 75,
            targetSpawnIntervalMs: 1750,
            targetLifetimeMs: 4000,
            containerWidth: 1280,
            containerHeight: 720
        },
        reportedTotals: {
            totalTargets: targets.length,
            totalClicks: clickEvents.length,
            totalHits: reactionMs.length
        },
        targets,
        clickEvents
    };
}

async function post(baseUrl, payload) {
    const response = await fetch(`${baseUrl}/api/mouse-performance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    return { status: response.status, body: await response.json() };
}

function countRows(db, table, sessionId) {
    return db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE session_id = ?`).get(sessionId).c;
}

for (const phaseId of ['MOTOR_BASELINE', 'DUAL_TASK_3', 'DUAL_TASK_7', 'DUAL_TASK_17']) {
    test(`${phaseId}: every click event, every target and the phase summary are persisted`, async () => {
        const { server, db, context, baseUrl } = await startServer();
        try {
            const payload = buildPayload({ phaseId, reactionMs: [420, 510, 380], targetCount: 5, misses: 2 });
            const { status, body } = await post(baseUrl, payload);
            assert.equal(status, 200, JSON.stringify(body));
            assert.equal(body.status, 'stored');

            assert.equal(countRows(db, 'mouse_click_events', payload.sessionId), 5);
            assert.equal(countRows(db, 'mouse_targets', payload.sessionId), 5);
            assert.equal(countRows(db, 'mouse_phase_performance', payload.sessionId), 1);

            const detail = await context.mousePerformanceService.getPhaseDetail(payload.sessionId, phaseId);
            assert.equal(detail.phaseId, phaseId);
            assert.equal(detail.totalClicks, 5);
            assert.equal(detail.totalHits, 3);
            assert.equal(detail.totalMisses, 2);
            assert.equal(detail.totalTargets, 5);
            assert.equal(detail.totalAccuracy, 60); // scoring.js: 3 / 5 * 100
            assert.equal(detail.targetEfficiency, 60); // 3 hits / 5 targets
            assert.deepEqual(detail.clickEvents.map((c) => c.clickSequence), [1, 2, 3, 4, 5]);
        } finally {
            server.close();
        }
    });
}

test('hits, misses, coordinates, target links and reaction times are stored click by click', async () => {
    const { server, context, baseUrl } = await startServer();
    try {
        const payload = buildPayload({ reactionMs: [400, 650], misses: 1, targetCount: 3 });
        assert.equal((await post(baseUrl, payload)).status, 200);

        const detail = await context.mousePerformanceService.getPhaseDetail(payload.sessionId, 'MOTOR_BASELINE');
        const [miss, hit1, hit2] = detail.clickEvents; // miss at 1017ms, hits at 2150 / 4150ms

        assert.equal(miss.isHit, false);
        assert.equal(miss.isMiss, true);
        assert.equal(miss.targetId, null);
        assert.equal(miss.reactionTimeMs, null);
        assert.equal(miss.x, 640);
        assert.equal(miss.targetActive, false);

        assert.equal(hit1.isHit, true);
        assert.equal(hit1.isMiss, false);
        assert.equal(hit1.targetId, 1);
        assert.equal(hit1.targetX, 100);
        assert.equal(hit1.targetY, 200);
        assert.equal(hit1.targetAppearedElapsedMs, 1750);
        assert.equal(hit1.reactionTimeMs, 400);
        assert.equal(hit2.reactionTimeMs, 650);

        assert.equal(detail.avgReactionTimeMs, 525);
        assert.equal(detail.minReactionTimeMs, 400);
        assert.equal(detail.maxReactionTimeMs, 650);
        assert.equal(detail.medianReactionTimeMs, 525);

        assert.deepEqual(detail.targets.map((t) => t.outcome), ['hit', 'hit', 'expired']);
    } finally {
        server.close();
    }
});

test('reaction time is recomputed on the server from the stored target, not trusted from the browser', async () => {
    const { server, context, baseUrl } = await startServer();
    try {
        const payload = buildPayload({ reactionMs: [400], misses: 0, targetCount: 1 });
        payload.clickEvents[0].reactionTimeMs = 9999; // tampered
        payload.clickEvents[0].targetX = -5; // tampered
        assert.equal((await post(baseUrl, payload)).status, 200);

        const detail = await context.mousePerformanceService.getPhaseDetail(payload.sessionId, 'MOTOR_BASELINE');
        assert.equal(detail.clickEvents[0].reactionTimeMs, 400);
        assert.equal(detail.clickEvents[0].targetX, 100);
    } finally {
        server.close();
    }
});

test('a large phase (1500 clicks, well over the 100kb app-wide JSON limit) is stored in full', async () => {
    const { server, db, baseUrl } = await startServer();
    try {
        const payload = buildPayload({ reactionMs: [300], targetCount: 1, misses: 1499, durationMs: 120000 });
        payload.clickEvents = payload.clickEvents.map((c, i) => ({ ...c, clickSequence: i + 1 }));
        // Keep elapsed times non-decreasing and inside the task.
        payload.clickEvents.forEach((c, i) => { if (!c.isHit) c.elapsedMs = Math.min(1000 + i * 70, 119000); });
        payload.clickEvents.sort((a, b) => a.elapsedMs - b.elapsedMs).forEach((c, i) => { c.clickSequence = i + 1; });
        assert.ok(JSON.stringify(payload).length > 100 * 1024);

        const { status, body } = await post(baseUrl, payload);
        assert.equal(status, 200, JSON.stringify(body));
        assert.equal(countRows(db, 'mouse_click_events', payload.sessionId), 1500);
    } finally {
        server.close();
    }
});

test('idempotent: a retried/duplicated upload stores nothing twice', async () => {
    const { server, db, baseUrl } = await startServer();
    try {
        const payload = buildPayload({ phaseId: 'DUAL_TASK_17' });
        const first = await post(baseUrl, payload);
        const [second, third] = await Promise.all([post(baseUrl, payload), post(baseUrl, payload)]);

        assert.equal(first.body.status, 'stored');
        assert.equal(second.status, 200);
        assert.equal(second.body.status, 'already_stored');
        assert.equal(third.body.status, 'already_stored');
        assert.equal(second.body.mousePhasePerformanceId, first.body.mousePhasePerformanceId);
        assert.equal(countRows(db, 'mouse_phase_performance', payload.sessionId), 1);
        assert.equal(countRows(db, 'mouse_click_events', payload.sessionId), payload.clickEvents.length);
        assert.equal(countRows(db, 'mouse_targets', payload.sessionId), payload.targets.length);
    } finally {
        server.close();
    }
});

test('a different upload for an already-stored phase is refused (409), leaving the original intact', async () => {
    const { server, db, baseUrl } = await startServer();
    try {
        await post(baseUrl, buildPayload({ reactionMs: [400], misses: 0 }));
        const conflicting = await post(baseUrl, buildPayload({ reactionMs: [400, 500], misses: 3 }));
        assert.equal(conflicting.status, 409);
        assert.equal(countRows(db, 'mouse_click_events', 'session-1790000000000-1'), 1);
    } finally {
        server.close();
    }
});

test('validation: rejects non-mouse phases, mismatched phase types, and malformed click data', async () => {
    const { server, db, baseUrl } = await startServer();
    try {
        const cases = [
            ['non-mouse phase', { ...buildPayload(), phaseId: 'SUBTRACTION_3', phaseType: 'cognitive' }],
            ['unknown phase', { ...buildPayload(), phaseId: 'NOT_A_PHASE' }],
            ['phase type mismatch', { ...buildPayload(), phaseType: 'dual-task' }],
            ['missing participant', { ...buildPayload(), participantCode: '' }],
            ['malformed session id', { ...buildPayload(), sessionId: 'bad id with spaces' }],
            ['missing duration', { ...buildPayload(), taskInfo: {} }]
        ];

        const skipped = buildPayload();
        skipped.clickEvents[1].clickSequence = 5;
        cases.push(['non-consecutive click sequence', skipped]);

        const unknownTarget = buildPayload();
        unknownTarget.clickEvents.find((c) => c.isHit).targetId = 99;
        cases.push(['hit on a target that does not exist', unknownTarget]);

        const outOfOrder = buildPayload();
        outOfOrder.clickEvents[2].elapsedMs = 1;
        cases.push(['click times going backwards', outOfOrder]);

        const notBoolean = buildPayload();
        notBoolean.clickEvents[0].isHit = 'yes';
        cases.push(['isHit not a boolean', notBoolean]);

        cases.push(['clickEvents not an array', { ...buildPayload(), clickEvents: 'x' }]);

        for (const [label, payload] of cases) {
            const { status } = await post(baseUrl, payload);
            assert.equal(status, 400, `${label} should be rejected`);
        }
        assert.equal(db.prepare('SELECT COUNT(*) AS c FROM mouse_phase_performance').get().c, 0);
    } finally {
        server.close();
    }
});

test('a session can only receive mouse data for its own participant', async () => {
    const { server, db, baseUrl } = await startServer();
    try {
        assert.equal((await post(baseUrl, buildPayload({ participantCode: 'OWNER' }))).status, 200);
        const hijack = await post(baseUrl, buildPayload({ participantCode: 'SOMEONE_ELSE', phaseId: 'DUAL_TASK_3' }));
        assert.equal(hijack.status, 409);
        assert.equal(countRows(db, 'mouse_phase_performance', 'session-1790000000000-1'), 1);
    } finally {
        server.close();
    }
});

test('Admin Session Review returns stored mouse totals, per-phase summaries, and every click event', async () => {
    const { server, context, baseUrl } = await startServer();
    try {
        const sessionId = 'session-1790000000000-7';
        await post(baseUrl, buildPayload({ sessionId, phaseId: 'MOTOR_BASELINE', reactionMs: [400, 600], misses: 1 }));
        await post(baseUrl, buildPayload({ sessionId, phaseId: 'DUAL_TASK_3', reactionMs: [500], misses: 2 }));

        // A recorded speech phase for DUAL_TASK_3, as POST /api/recordings creates.
        const session = await context.sessionRepository.getById(sessionId);
        await context.phaseRepository.upsert({ sessionId, phaseId: 'DUAL_TASK_3', phaseType: 'dual-task', subtractionValue: 3, startingNumber: 900, duration: 10, startedAt: '2026-09-29T12:05:00.000Z' });
        assert.ok(session);

        const detail = await (await fetch(`${baseUrl}/api/admin/sessions/${sessionId}`)).json();
        assert.deepEqual(detail.mousePhases.map((m) => m.phaseId).sort(), ['DUAL_TASK_3', 'MOTOR_BASELINE']);
        assert.equal(detail.mouseTotals.totalClicks, 6);
        assert.equal(detail.mouseTotals.totalHits, 3);
        assert.equal(detail.mouseTotals.totalMisses, 3);
        assert.equal(detail.mouseTotals.totalAccuracy, 50);

        const dualTask = detail.phases.find((p) => p.phaseId === 'DUAL_TASK_3');
        assert.equal(dualTask.mousePerformance.totalClicks, 3);
        assert.equal(dualTask.mousePerformance.totalHits, 1);

        const clicks = await (await fetch(`${baseUrl}/api/admin/sessions/${sessionId}/mouse/MOTOR_BASELINE`)).json();
        assert.equal(clicks.clickEvents.length, 3);
        assert.equal(clicks.targets.length, 4);
        assert.deepEqual(clicks.clickEvents.filter((c) => c.isHit).map((c) => c.reactionTimeMs), [400, 600]);
    } finally {
        server.close();
    }
});

test('a session with no stored mouse data (e.g. recorded before this feature) reports none - nothing is fabricated', async () => {
    const { server, context, baseUrl } = await startServer();
    try {
        const participant = await context.participantRepository.upsertByCode('OLD_P');
        await context.sessionRepository.upsertById({ sessionId: 'session-old-1', participantId: participant.id });
        await context.phaseRepository.upsert({ sessionId: 'session-old-1', phaseId: 'DUAL_TASK_3', phaseType: 'dual-task', subtractionValue: 3, startingNumber: 900, duration: 120, startedAt: '2026-08-01T10:00:00.000Z' });

        const detail = await (await fetch(`${baseUrl}/api/admin/sessions/session-old-1`)).json();
        assert.deepEqual(detail.mousePhases, []);
        assert.equal(detail.mouseTotals, null);
        assert.equal(detail.phases[0].mousePerformance, null);

        const missing = await fetch(`${baseUrl}/api/admin/sessions/session-old-1/mouse/DUAL_TASK_3`);
        assert.equal(missing.status, 404);
    } finally {
        server.close();
    }
});

test('admin hard-delete removes the participant\'s mouse rows too', async () => {
    const { server, db, context, baseUrl } = await startServer();
    try {
        await post(baseUrl, buildPayload({ participantCode: 'DELETE_ME' }));
        const participant = await context.participantRepository.getByCode('DELETE_ME');
        const result = await context.participantDeletionRepository.hardDeleteParticipant(participant.id);

        assert.equal(result.counts.mousePhasePerformance, 1);
        assert.equal(result.counts.mouseClickEvents, 3);
        assert.equal(result.counts.mouseTargets, 4);
        for (const table of ['mouse_phase_performance', 'mouse_click_events', 'mouse_targets']) {
            assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c, 0, table);
        }
    } finally {
        server.close();
    }
});

test('an existing database created before the mouse tables existed opens unchanged and gains them (additive)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mouse-migration-test-'));
    const first = createDatabase(dir);
    first.prepare('INSERT INTO participants (id, participant_code, created_at) VALUES (?, ?, ?)').run('p-old', 'LEGACY', new Date().toISOString());
    await first.waitForPendingSync();
    first.close();

    // Recreate the "before" state: drop the new tables from both slots.
    for (const file of ['research.a.sqlite', 'research.b.sqlite']) {
        const raw = new DatabaseSync(path.join(dir, file));
        raw.exec('DROP TABLE IF EXISTS mouse_click_events; DROP TABLE IF EXISTS mouse_targets; DROP TABLE IF EXISTS mouse_phase_performance;');
        raw.close();
    }

    const reopened = createDatabase(dir);
    assert.equal(reopened.prepare('SELECT participant_code FROM participants').get().participant_code, 'LEGACY');
    for (const table of ['mouse_phase_performance', 'mouse_click_events', 'mouse_targets']) {
        assert.equal(reopened.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c, 0, `${table} exists and is empty`);
    }
    reopened.close();
});
