// Demonstrates, with real code (not just an explanation), the exact
// mechanism behind the "participant disappears when the admin dashboard is
// opened" production incident - and proves it is NOT caused by admin reads
// deleting anything.
//
// The mechanism: on a serverless platform, each function instance has its
// own private, ephemeral filesystem. Two requests handled by two different
// instances are talking to two entirely different, disconnected SQLite
// files - not the same database. A write on instance A is invisible on
// instance B not because it was deleted, but because it was never there.
// This is simulated below with two independent temp directories, standing
// in for two different Vercel instances' local /tmp.
//
// Every directory here is created via fs.mkdtempSync - never the real
// data/db/ or data/audio/.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createDatabase } from '../../app/backend/database/db.js';

function freshDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('DEMONSTRATION: two isolated ephemeral instances (different temp dirs) do NOT share writes - this is instance isolation, not deletion', async () => {
    // Instance A: "Request A" (participant upload) lands here.
    const instanceADir = freshDir('sim-vercel-instance-a-');
    const instanceA = createDatabase(instanceADir);
    instanceA.prepare('INSERT INTO participants (id, participant_code, created_at) VALUES (?, ?, ?)')
        .run('p-222', '222', new Date().toISOString());
    await instanceA.waitForPendingSync();

    // Confirm the write genuinely succeeded and is durable ON instance A -
    // this proves REQUEST A completed correctly, exactly as the symptom
    // report describes ("their research data appears to be saved").
    const onInstanceA = instanceA.prepare('SELECT * FROM participants WHERE participant_code = ?').get('222');
    assert.ok(onInstanceA, 'the write must succeed on the instance that received it');

    // Instance B: "Request B" (admin GET /api/admin/participants) lands on
    // a DIFFERENT instance - simulated here by a completely separate temp
    // directory, exactly as two different Vercel function instances each
    // have their own private /tmp with no shared filesystem between them.
    const instanceBDir = freshDir('sim-vercel-instance-b-');
    const instanceB = createDatabase(instanceBDir);

    const onInstanceB = instanceB.prepare('SELECT * FROM participants WHERE participant_code = ?').get('222');
    assert.equal(onInstanceB, undefined, 'instance B never received the write - it has its own separate, empty database, not a deleted copy of instance A\'s');

    // The critical distinction: instance A's data is completely intact and
    // untouched - nothing was deleted. It simply isn't the same storage as
    // instance B.
    const stillOnInstanceA = instanceA.prepare('SELECT * FROM participants WHERE participant_code = ?').get('222');
    assert.ok(stillOnInstanceA, 'instance A\'s data must remain completely intact throughout - proving instance B\'s empty read is isolation, not a deletion side effect');
});

test('CONTRAST: with a single shared/persistent storage location, "Request B" (a fresh app instance) DOES see "Request A"\'s write - proving durable storage fixes exactly this', async () => {
    // Simulates the fix: both "requests" point at the SAME durable
    // location (standing in for a real Postgres database, which - unlike
    // per-instance /tmp - genuinely is one shared location every instance
    // talks to). A fresh SQLiteResearchDatabase instance pointed at the
    // SAME directory is the closest thing to that which this sandbox can
    // exercise without a live Postgres server; the underlying interface
    // methods (prepare/exec) are identical to what PostgresResearchDatabase
    // exposes, so this proves the application-level behavior is correct
    // once storage is actually shared.
    const sharedDir = freshDir('sim-shared-durable-storage-');

    const requestA = createDatabase(sharedDir);
    requestA.prepare('INSERT INTO participants (id, participant_code, created_at) VALUES (?, ?, ?)')
        .run('p-222', '222', new Date().toISOString());
    await requestA.waitForPendingSync();

    // A brand-new app instance, as a fresh Vercel function invocation would
    // construct - but pointed at the same durable storage location.
    const requestB = createDatabase(sharedDir);
    const found = requestB.prepare('SELECT * FROM participants WHERE participant_code = ?').get('222');

    assert.ok(found, 'a fresh instance pointed at the SAME durable storage must see the earlier write - this is what real production persistence looks like');
});

test('admin reads never modify data: participant survives GET /api/admin/participants, GET .../:id, and GET /api/admin/sessions/:id, end to end', async () => {
    const { createAppContext } = await import('../../app/backend/appContext.js');
    const { createAdminRouter } = await import('../../app/backend/routes/admin.js');
    const { adminAuth } = await import('../../app/backend/routes/adminAuth.js');
    const { LocalFilesystemAudioStorage } = await import('../../app/backend/storage/audioStorage.js');
    const { StubTranscriptionProvider } = await import('../../app/backend/transcription/stubProvider.js');
    const express = (await import('express')).default;

    const previousToken = process.env.ADMIN_API_TOKEN;
    process.env.ADMIN_API_TOKEN = 'test-token-read-only';

    const db = createDatabase(freshDir('admin-readonly-test-db-'));
    const audioStorage = new LocalFilesystemAudioStorage({ baseDir: freshDir('admin-readonly-test-audio-') });
    const context = createAppContext({ db, audioStorage, transcriptionProvider: new StubTranscriptionProvider({ text: '944 941 938' }) });

    // 1. Participant exists (seed exactly as routes/recordings.js would).
    const participant = await context.participantRepository.upsertByCode('P_READONLY');
    const session = await context.sessionRepository.upsertById({ sessionId: 'session-readonly', participantId: participant.id, experimentId: 'motor-cognitive-dual-task' });
    const phase = await context.phaseRepository.upsert({
        sessionId: session.id, phaseId: 'SUBTRACTION_3', phaseType: 'SUBTRACTION',
        subtractionValue: 3, startingNumber: 947, duration: 120, startedAt: new Date().toISOString(),
        scoringMode: 'adaptive', expectedResponseDigits: 3
    });
    const storagePath = await audioStorage.save({ sessionId: session.id, phaseRecordId: phase.id, buffer: Buffer.from('audio bytes'), extension: 'webm' });
    const recording = await context.recordingRepository.insert({ phaseId: phase.id, storagePath, mimeType: 'audio/webm' });
    await context.speechProcessingService.process({ recordingId: recording.id, phase, scoringOptions: { scoringMode: 'adaptive', expectedResponseDigits: 3 } });

    const app = express();
    app.use('/api/admin', adminAuth, createAdminRouter(context));
    const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    const { port } = server.address();
    const headers = { Authorization: 'Bearer test-token-read-only' };

    try {
        // 2/3. GET /api/admin/participants - participant still exists after.
        const listResponse = await fetch(`http://localhost:${port}/api/admin/participants`, { headers });
        assert.equal(listResponse.status, 200);
        const listed = (await listResponse.json()).participants;
        assert.ok(listed.some((p) => p.participantId === participant.id));
        assert.ok(await context.participantRepository.getById(participant.id), 'participant must still exist in the database after the list GET');

        // 4/5. GET /api/admin/participants/:id - participant still exists after.
        const profileResponse = await fetch(`http://localhost:${port}/api/admin/participants/${participant.id}`, { headers });
        assert.equal(profileResponse.status, 200);
        assert.ok(await context.participantRepository.getById(participant.id), 'participant must still exist after the profile GET');

        // 6/7. GET /api/admin/sessions/:id - participant/session/recordings/responses all still exist after.
        const sessionResponse = await fetch(`http://localhost:${port}/api/admin/sessions/${session.id}`, { headers });
        assert.equal(sessionResponse.status, 200);
        const sessionDetail = await sessionResponse.json();
        assert.equal(sessionDetail.phases[0].responses.length, 3);

        assert.ok(await context.participantRepository.getById(participant.id), 'participant survives all three GETs');
        assert.ok(await context.sessionRepository.getById(session.id), 'session survives all three GETs');
        assert.ok(await context.recordingRepository.getById(recording.id), 'recording survives all three GETs');
        const transcriptions = await context.transcriptionRepository.listForRecording(recording.id);
        assert.equal(transcriptions.length, 1, 'transcription survives all three GETs');

        // Repeat every GET a second time, to rule out "the first read is
        // fine, a later one deletes it" - a genuine concern the bug report
        // explicitly raised.
        await fetch(`http://localhost:${port}/api/admin/participants`, { headers });
        await fetch(`http://localhost:${port}/api/admin/participants/${participant.id}`, { headers });
        await fetch(`http://localhost:${port}/api/admin/sessions/${session.id}`, { headers });
        assert.ok(await context.participantRepository.getById(participant.id), 'participant survives a SECOND round of the same GETs');
    } finally {
        server.close();
        if (previousToken === undefined) delete process.env.ADMIN_API_TOKEN; else process.env.ADMIN_API_TOKEN = previousToken;
    }
});
