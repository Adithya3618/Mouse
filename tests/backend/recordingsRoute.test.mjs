import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { createDatabase } from '../../app/backend/database/db.js';
import { createAppContext } from '../../app/backend/appContext.js';
import { createRecordingsRouter } from '../../app/backend/routes/recordings.js';
import { LocalFilesystemAudioStorage } from '../../app/backend/storage/audioStorage.js';
import { StubTranscriptionProvider } from '../../app/backend/transcription/stubProvider.js';

async function startTestServer({ transcriptText } = {}) {
    const db = createDatabase(':memory:');
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recordings-route-test-'));
    const context = createAppContext({
        db,
        audioStorage: new LocalFilesystemAudioStorage({ baseDir }),
        transcriptionProvider: new StubTranscriptionProvider({ text: transcriptText })
    });

    const app = express();
    app.use(createRecordingsRouter(context));

    return new Promise((resolve) => {
        const server = app.listen(0, () => {
            const { port } = server.address();
            resolve({ server, context, baseUrl: `http://127.0.0.1:${port}` });
        });
    });
}

function buildMultipartBody(fields, audioBuffer) {
    const boundary = '----test-boundary-1234567890';
    const parts = [];
    for (const [key, value] of Object.entries(fields)) {
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`);
    }
    const preamble = Buffer.from(parts.join(''), 'utf8');
    const filePart = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="recording.webm"\r\nContent-Type: audio/webm\r\n\r\n`,
        'utf8'
    );
    const closing = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    return { body: Buffer.concat([preamble, filePart, audioBuffer, closing]), boundary };
}

test('POST /api/recordings stores the audio unchanged, transcribes it, and returns scored responses', async () => {
    const { server, context, baseUrl } = await startTestServer({ transcriptText: '797 794 792 789 786' });
    try {
        const audioBuffer = Buffer.from('fake webm audio bytes for this phase');
        const { body, boundary } = buildMultipartBody({
            participantCode: 'P001',
            sessionId: 'session-abc',
            phaseId: 'SUBTRACTION_3',
            phaseType: 'SUBTRACTION',
            subtractionValue: '3',
            startingNumber: '800',
            duration: '120',
            startedAt: new Date().toISOString(),
            endedAt: new Date().toISOString(),
            expectedResponseDigits: '3',
            scoringMode: 'adaptive'
        }, audioBuffer);

        const response = await fetch(`${baseUrl}/api/recordings`, {
            method: 'POST',
            headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
            body
        });
        const json = await response.json();

        assert.equal(response.status, 200);
        assert.equal(json.status, 'succeeded');
        assert.deepEqual(json.results.responses.map((r) => r.parsedNumber), [797, 794, 792, 789, 786]);
        assert.equal(json.results.rawTranscript, '797 794 792 789 786');

        // The exact original bytes were persisted, unmodified.
        const recording = context.recordingRepository.getById(json.recordingId);
        const stored = await context.audioStorage.read(recording.storage_path);
        assert.equal(Buffer.compare(stored, audioBuffer), 0);
    } finally {
        server.close();
    }
});

test('POST /api/recordings rejects a request missing required fields', async () => {
    const { server, baseUrl } = await startTestServer();
    try {
        const { body, boundary } = buildMultipartBody({ participantCode: 'P001' }, Buffer.from('x'));
        const response = await fetch(`${baseUrl}/api/recordings`, {
            method: 'POST',
            headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
            body
        });
        assert.equal(response.status, 400);
    } finally {
        server.close();
    }
});

test('two recordings for the same session/participant are linked under one participant and session row', async () => {
    const { server, context, baseUrl } = await startTestServer({ transcriptText: '944 941 938' });
    try {
        for (const phaseId of ['SUBTRACTION_3', 'DUAL_TASK_3']) {
            const { body, boundary } = buildMultipartBody({
                participantCode: 'P002',
                sessionId: 'session-xyz',
                phaseId,
                subtractionValue: '3',
                startingNumber: '947',
                expectedResponseDigits: '3',
                scoringMode: 'adaptive'
            }, Buffer.from(`audio for ${phaseId}`));
            const response = await fetch(`${baseUrl}/api/recordings`, {
                method: 'POST',
                headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
                body
            });
            assert.equal(response.status, 200);
        }

        const participant = context.participantRepository.getByCode('P002');
        const sessions = context.sessionRepository.listForParticipant(participant.id);
        assert.equal(sessions.length, 1);
        const phases = context.phaseRepository.listForSession(sessions[0].id);
        assert.equal(phases.length, 2);
    } finally {
        server.close();
    }
});
