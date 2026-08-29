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
    const participant = context.participantRepository.upsertByCode(participantCode);
    const session = context.sessionRepository.upsertById({ sessionId, participantId: participant.id, experimentId: 'motor-cognitive-dual-task' });
    const phase = context.phaseRepository.upsert({
        sessionId: session.id, phaseId: 'SUBTRACTION_3', phaseType: 'SUBTRACTION',
        subtractionValue: 3, startingNumber: 800, duration: 120, startedAt: new Date().toISOString(),
        scoringMode: 'adaptive', expectedResponseDigits: 3
    });
    const recording = context.recordingRepository.insert({ phaseId: phase.id, storagePath: await context.audioStorage.save({ sessionId: session.id, phaseRecordId: phase.id, buffer: Buffer.from('audio'), extension: 'webm' }), mimeType: 'audio/webm' });

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
        const firstTranscription = context.transcriptionRepository.getLatestForRecording(recording.id);
        assert.equal(firstTranscription.version, 1);

        const response = await fetch(`${baseUrl}/api/admin/recordings/${recording.id}/reprocess`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` }
        });
        const json = await response.json();
        assert.equal(json.status, 'succeeded');
        assert.equal(json.transcriptionVersion, 2);

        const versions = context.transcriptionRepository.listForRecording(recording.id);
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
