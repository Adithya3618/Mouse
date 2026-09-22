import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { createDatabase } from '../../app/backend/database/db.js';
import { createAppContext } from '../../app/backend/appContext.js';
import { createAdminRouter } from '../../app/backend/routes/admin.js';
import { adminAuth } from '../../app/backend/routes/adminAuth.js';
import { LocalFilesystemAudioStorage } from '../../app/backend/storage/audioStorage.js';
import { StubTranscriptionProvider } from '../../app/backend/transcription/stubProvider.js';

async function startAdminServer({ token = 'test-admin-token' } = {}) {
    const previousToken = process.env.ADMIN_API_TOKEN;
    process.env.ADMIN_API_TOKEN = token;

    const db = createDatabase(':memory:');
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-route-test-'));
    const audioStorage = new LocalFilesystemAudioStorage({ baseDir });
    const context = createAppContext({ db, audioStorage, transcriptionProvider: new StubTranscriptionProvider() });

    const app = express();
    // Matches app/backend/server.js's own middleware order - without this,
    // req.body is always undefined for any POST route, which nothing in
    // this file exercised until the hard-delete tests below (the first
    // ones here to actually send a JSON body).
    app.use(express.json());
    app.use('/api/admin', adminAuth, createAdminRouter(context));

    const server = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s));
    });
    const { port } = server.address();

    return {
        server,
        context,
        baseUrl: `http://127.0.0.1:${port}`,
        token,
        async close() {
            server.close();
            if (previousToken === undefined) {
                delete process.env.ADMIN_API_TOKEN;
            } else {
                process.env.ADMIN_API_TOKEN = previousToken;
            }
        }
    };
}

// Seeds one participant with one session containing two phases, one
// correct/incorrect mix and one unresolved response, via direct repository
// calls + a real processing pass (stub provider) - mirrors what
// routes/recordings.js would have produced.
async function seedSession(context, { participantCode, sessionId, transcriptText }) {
    const participant = await context.participantRepository.upsertByCode(participantCode);
    const session = await context.sessionRepository.upsertById({ sessionId, participantId: participant.id, experimentId: 'motor-cognitive-dual-task' });
    const phase = await context.phaseRepository.upsert({
        sessionId: session.id, phaseId: 'SUBTRACTION_3', phaseType: 'SUBTRACTION',
        subtractionValue: 3, startingNumber: 800, duration: 120, startedAt: new Date().toISOString(),
        scoringMode: 'adaptive', expectedResponseDigits: 3
    });
    const storagePath = await context.audioStorage.save({ sessionId: session.id, phaseRecordId: phase.id, buffer: Buffer.from('audio'), extension: 'webm' });
    const recording = await context.recordingRepository.insert({ phaseId: phase.id, storagePath, mimeType: 'audio/webm' });

    const provider = new StubTranscriptionProvider({ text: transcriptText });
    const previousProvider = context.speechProcessingService._transcriptionProvider;
    context.speechProcessingService._transcriptionProvider = provider;
    await context.speechProcessingService.process({ recordingId: recording.id, phase, scoringOptions: { scoringMode: 'adaptive', expectedResponseDigits: 3 } });
    context.speechProcessingService._transcriptionProvider = previousProvider;

    return { participant, session, phase, recording };
}

test('admin routes require a valid bearer token', async () => {
    const { close, baseUrl } = await startAdminServer();
    try {
        const noAuth = await fetch(`${baseUrl}/api/admin/participants`);
        assert.equal(noAuth.status, 401);

        const wrongToken = await fetch(`${baseUrl}/api/admin/participants`, { headers: { Authorization: 'Bearer wrong' } });
        assert.equal(wrongToken.status, 401);
    } finally {
        await close();
    }
});

test('admin API refuses all requests when ADMIN_API_TOKEN is not configured on the server', async () => {
    const { close, baseUrl, token } = await startAdminServer();
    delete process.env.ADMIN_API_TOKEN;
    try {
        const response = await fetch(`${baseUrl}/api/admin/participants`, { headers: { Authorization: `Bearer ${token}` } });
        assert.equal(response.status, 503);
    } finally {
        await close();
    }
});

test('GET /api/admin/participants lists participants with search/filter/sort, incorrect responses never hidden', async () => {
    const { context, close, baseUrl, token } = await startAdminServer();
    try {
        await seedSession(context, { participantCode: 'P001', sessionId: 'session-1', transcriptText: '797 794 792 789 786' });
        await seedSession(context, { participantCode: 'P002', sessionId: 'session-2', transcriptText: '944 941 938' });

        const all = await fetch(`${baseUrl}/api/admin/participants`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
        assert.equal(all.participants.length, 2);
        const p001 = all.participants.find((p) => p.participantCode === 'P001');
        assert.equal(p001.incorrectResponses, 1);
        assert.equal(p001.totalResponses, 5);

        const search = await fetch(`${baseUrl}/api/admin/participants?search=p001`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
        assert.equal(search.participants.length, 1);
        assert.equal(search.participants[0].participantCode, 'P001');

        const sorted = await fetch(`${baseUrl}/api/admin/participants?sort=accuracy&sortDir=asc`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
        assert.ok(sorted.participants[0].overallAccuracy <= sorted.participants[1].overallAccuracy);
    } finally {
        await close();
    }
});

test('GET /api/admin/participants/:id returns a full profile with sessions', async () => {
    const { context, close, baseUrl, token } = await startAdminServer();
    try {
        const { participant } = await seedSession(context, { participantCode: 'P003', sessionId: 'session-3', transcriptText: '797 794 792 789 786' });

        const profile = await fetch(`${baseUrl}/api/admin/participants/${participant.id}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
        assert.equal(profile.participantCode, 'P003');
        assert.equal(profile.sessions.length, 1);

        const notFound = await fetch(`${baseUrl}/api/admin/participants/does-not-exist`, { headers: { Authorization: `Bearer ${token}` } });
        assert.equal(notFound.status, 404);
    } finally {
        await close();
    }
});

test('GET /api/admin/sessions/:id returns session detail with the response table, expected vs actual never hidden', async () => {
    const { context, close, baseUrl, token } = await startAdminServer();
    try {
        const { session } = await seedSession(context, { participantCode: 'P004', sessionId: 'session-4', transcriptText: '797 794 792 789 786' });

        const detail = await fetch(`${baseUrl}/api/admin/sessions/${session.id}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
        assert.equal(detail.participantCode, 'P004');
        assert.equal(detail.phases.length, 1);
        const responses = detail.phases[0].responses;
        assert.equal(responses.length, 5);
        // Response 3 (index 2): expected 791, actual 792, incorrect - must be present, not filtered out.
        const wrong = responses.find((r) => r.response_index === 2);
        assert.equal(wrong.expected_number, 791);
        assert.equal(wrong.actual_number, 792);
        assert.equal(wrong.correctness, 'incorrect');
        assert.equal(wrong.next_expected_number, 789);
        assert.equal(detail.phases[0].rawTranscript, '797 794 792 789 786');
    } finally {
        await close();
    }
});

test('GET /api/admin/recordings/:id/audio streams the exact original audio bytes with range support', async () => {
    const { context, close, baseUrl, token } = await startAdminServer();
    try {
        const { recording } = await seedSession(context, { participantCode: 'P005', sessionId: 'session-5', transcriptText: '944 941 938' });
        const original = await context.audioStorage.read(recording.storage_path);

        const full = await fetch(`${baseUrl}/api/admin/recordings/${recording.id}/audio`, { headers: { Authorization: `Bearer ${token}` } });
        assert.equal(full.status, 200);
        const fullBytes = Buffer.from(await full.arrayBuffer());
        assert.equal(Buffer.compare(fullBytes, original), 0);

        const ranged = await fetch(`${baseUrl}/api/admin/recordings/${recording.id}/audio`, { headers: { Authorization: `Bearer ${token}`, Range: 'bytes=0-2' } });
        assert.equal(ranged.status, 206);
        const rangedBytes = Buffer.from(await ranged.arrayBuffer());
        assert.equal(rangedBytes.length, 3);
    } finally {
        await close();
    }
});

test('POST /api/admin/recordings/:id/reprocess creates a new version without touching the original audio or prior version', async () => {
    const { context, close, baseUrl, token } = await startAdminServer();
    try {
        const { recording } = await seedSession(context, { participantCode: 'P006', sessionId: 'session-6', transcriptText: '944 941 938' });
        const originalAudio = await context.audioStorage.read(recording.storage_path);
        const firstTranscription = await context.transcriptionRepository.getLatestForRecording(recording.id);
        assert.equal(firstTranscription.version, 1);

        const response = await fetch(`${baseUrl}/api/admin/recordings/${recording.id}/reprocess`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` }
        });
        const json = await response.json();
        assert.equal(json.status, 'succeeded');
        assert.equal(json.transcriptionVersion, 2);

        const versions = await context.transcriptionRepository.listForRecording(recording.id);
        assert.equal(versions.length, 2);
        assert.equal(versions[0].version, 1);
        assert.equal(versions[0].raw_text, '944 941 938');
        assert.equal(versions[1].version, 2);
        // seedSession() restores the context's default-text stub provider
        // after seeding - the reprocess call above genuinely used a
        // DIFFERENT transcription result, proving version 1's raw text is
        // untouched by it rather than merely re-inserted verbatim.
        assert.notEqual(versions[1].raw_text, versions[0].raw_text);

        const audioAfterReprocess = await context.audioStorage.read(recording.storage_path);
        assert.equal(Buffer.compare(originalAudio, audioAfterReprocess), 0, 'the original audio file is never modified by reprocessing');
    } finally {
        await close();
    }
});

test('GET /api/admin/participants exposes latestSessionAt as the raw stored timestamp, not frontend-generated', async () => {
    const { context, close, baseUrl, token } = await startAdminServer();
    try {
        const { session } = await seedSession(context, { participantCode: 'P007', sessionId: 'session-7', transcriptText: '944 941 938' });

        const all = await fetch(`${baseUrl}/api/admin/participants`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
        const p007 = all.participants.find((p) => p.participantCode === 'P007');
        // seedSession() never passes startTime, so this must be the
        // session's own created_at (server-set at row-creation time) -
        // exactly one of the two real stored columns adminQueryService.js
        // reads, never a value invented at request time.
        const storedSession = await context.sessionRepository.getById(session.id);
        assert.equal(p007.latestSessionAt, storedSession.created_at);
        assert.ok(p007.latestSessionAt, 'latestSessionAt must be present for a participant with a session');
    } finally {
        await close();
    }
});

// Hard-delete tests use their own disposable participant codes (never
// touching the real data/db or data/audio directories - startAdminServer()
// above gives every test its own :memory: database and a freshly
// mkdtempSync()'d temp directory for audio, discarded when the test ends).
test('POST /api/admin/participants/:id/hard-delete requires exact participant-code confirmation and deletes nothing without it', async () => {
    const { context, close, baseUrl, token } = await startAdminServer();
    try {
        const { participant, recording } = await seedSession(context, { participantCode: 'DELETE-TEST-1', sessionId: 'del-session-1', transcriptText: '944 941 938' });

        const wrongConfirm = await fetch(`${baseUrl}/api/admin/participants/${participant.id}/hard-delete`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirm: 'NOT-THE-CODE' })
        });
        assert.equal(wrongConfirm.status, 400);

        // Nothing was touched - the participant, its session, and its
        // recording (including the audio bytes on disk) all still exist.
        assert.ok(await context.participantRepository.getById(participant.id));
        assert.ok(await context.recordingRepository.getById(recording.id));
        assert.ok(await context.audioStorage.exists(recording.storage_path));
    } finally {
        await close();
    }
});

test('POST /api/admin/participants/:id/hard-delete on an unknown id returns 404', async () => {
    const { close, baseUrl, token } = await startAdminServer();
    try {
        const response = await fetch(`${baseUrl}/api/admin/participants/does-not-exist/hard-delete`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirm: 'whatever' })
        });
        assert.equal(response.status, 404);
    } finally {
        await close();
    }
});

test('POST /api/admin/participants/:id/hard-delete genuinely removes the participant and every associated row and audio file', async () => {
    const { context, close, baseUrl, token } = await startAdminServer();
    try {
        const { participant, session, phase, recording } = await seedSession(context, { participantCode: 'DELETE-TEST-2', sessionId: 'del-session-2', transcriptText: '944 941 938' });
        const transcription = await context.transcriptionRepository.getLatestForRecording(recording.id);
        const processingRuns = await context.responseRepository.listProcessingRunsForTranscription(transcription.id);
        assert.ok(processingRuns.length > 0, 'test setup sanity check: seedSession() must have produced a processing run');
        const responsesBefore = await context.responseRepository.listResponsesForRun(processingRuns[0].id);
        assert.ok(responsesBefore.length > 0, 'test setup sanity check: seedSession() must have produced responses');

        // Audio actually exists on disk (primary + mirror) before deletion.
        assert.ok(await context.audioStorage.exists(recording.storage_path));
        const primaryPath = context.audioStorage.resolveAbsolutePath(recording.storage_path);
        assert.ok(fs.existsSync(primaryPath), 'primary audio file must exist before deletion');

        const response = await fetch(`${baseUrl}/api/admin/participants/${participant.id}/hard-delete`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirm: participant.participant_code })
        });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.participantCode, 'DELETE-TEST-2');
        assert.equal(body.counts.sessions, 1);
        assert.equal(body.counts.phases, 1);
        assert.equal(body.counts.recordings, 1);
        assert.equal(body.counts.transcriptions, 1);
        assert.equal(body.counts.processingRuns, processingRuns.length);
        assert.equal(body.counts.responses, responsesBefore.length);
        assert.equal(body.filesDeleted, 1);
        assert.deepEqual(body.fileWarnings, []);

        // Every row, at every level, is genuinely gone - not soft-deleted,
        // not merely hidden from a list query.
        assert.equal(await context.participantRepository.getById(participant.id), null);
        assert.equal(await context.sessionRepository.getById(session.id), null);
        assert.equal(await context.phaseRepository.getById(phase.id), null);
        assert.equal(await context.recordingRepository.getById(recording.id), null);
        assert.equal(await context.transcriptionRepository.getById(transcription.id), null);
        for (const run of processingRuns) {
            assert.equal(await context.responseRepository.getProcessingRunById(run.id), null);
        }
        assert.deepEqual(await context.responseRepository.listResponsesForRun(processingRuns[0].id), []);

        // The audio file is genuinely removed from disk (both the primary
        // copy and its mirror), not just dereferenced in the database.
        assert.equal(await context.audioStorage.exists(recording.storage_path), false);
        assert.equal(fs.existsSync(primaryPath), false);

        // The participant no longer appears in the dashboard list.
        const all = await fetch(`${baseUrl}/api/admin/participants`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
        assert.equal(all.participants.some((p) => p.participantCode === 'DELETE-TEST-2'), false);

        // An audit trail survives even though the participant row itself
        // does not - admin_audit_log has no FK to participants, by design
        // (see repositories/auditLogRepository.js).
        const auditEntries = await context.auditLogRepository.listForTarget('participant', participant.id);
        assert.ok(auditEntries.some((e) => e.action === 'participant_hard_delete'));
    } finally {
        await close();
    }
});

test('POST /api/admin/participants/:id/hard-delete on a participant with no sessions deletes just the participant row, with no error', async () => {
    const { context, close, baseUrl, token } = await startAdminServer();
    try {
        const participant = await context.participantRepository.upsertByCode('DELETE-TEST-NO-SESSIONS');

        const response = await fetch(`${baseUrl}/api/admin/participants/${participant.id}/hard-delete`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirm: participant.participant_code })
        });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.counts.sessions, 0);
        assert.equal(body.filesDeleted, 0);
        assert.equal(await context.participantRepository.getById(participant.id), null);
    } finally {
        await close();
    }
});
