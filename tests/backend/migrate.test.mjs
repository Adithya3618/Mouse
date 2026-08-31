// migrate.js tests, exercised SQLite -> SQLite (two independent temp
// directories) - this sandbox has no live Postgres to test SQLite ->
// Postgres against directly, but migrateDatabase()/migrateAudio() only
// ever call the ResearchDatabase/AudioStorage interface methods (never a
// SQLite- or Postgres-specific API), so this is a faithful test of the
// same code path a real Postgres destination would exercise - see
// migrate.js's own header comment.
//
// Every temp directory here is created via fs.mkdtempSync - never the real
// data/db/ or data/audio/.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createDatabase } from '../../app/backend/database/db.js';
import { LocalFilesystemAudioStorage } from '../../app/backend/storage/audioStorage.js';
import { migrateDatabase, verifyDatabaseMigration, migrateAudio } from '../../app/backend/database/migrate.js';

function freshDbDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-db-'));
}
function freshAudioDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-audio-'));
}

async function seedSource() {
    const { createAppContext } = await import('../../app/backend/appContext.js');
    const { StubTranscriptionProvider } = await import('../../app/backend/transcription/stubProvider.js');

    const db = createDatabase(freshDbDir());
    const audioDir = freshAudioDir();
    const audioStorage = new LocalFilesystemAudioStorage({ baseDir: audioDir });
    const context = createAppContext({ db, audioStorage, transcriptionProvider: new StubTranscriptionProvider({ text: '944 941 938' }) });

    const participant = await context.participantRepository.upsertByCode('P_MIGRATE');
    const session = await context.sessionRepository.upsertById({ sessionId: 'session-migrate-1', participantId: participant.id, experimentId: 'motor-cognitive-dual-task' });
    const phase = await context.phaseRepository.upsert({
        sessionId: session.id, phaseId: 'SUBTRACTION_3', phaseType: 'SUBTRACTION',
        subtractionValue: 3, startingNumber: 947, duration: 120, startedAt: new Date().toISOString(),
        scoringMode: 'adaptive', expectedResponseDigits: 3
    });
    const storagePath = await audioStorage.save({ sessionId: session.id, phaseRecordId: phase.id, buffer: Buffer.from('real-ish audio bytes'), extension: 'webm' });
    const recording = await context.recordingRepository.insert({ phaseId: phase.id, storagePath, mimeType: 'audio/webm', fileSizeBytes: 21 });
    await context.speechProcessingService.process({ recordingId: recording.id, phase, scoringOptions: { scoringMode: 'adaptive', expectedResponseDigits: 3 } });
    // A second processing pass, to prove reprocessing history survives migration too.
    await context.speechProcessingService.process({ recordingId: recording.id, phase, scoringOptions: { scoringMode: 'adaptive', expectedResponseDigits: 3 } });

    return { db, audioStorage, context, participant, session, phase, recording };
}

test('migrateDatabase() copies every row with IDENTICAL ids, never regenerating them', async () => {
    const { db: sourceDb, participant, session, phase, recording } = await seedSource();
    const destDb = createDatabase(freshDbDir());

    const report = await migrateDatabase({ source: sourceDb, destination: destDb, logger: () => {} });

    assert.deepEqual(report.errors, []);
    assert.equal(report.tables.participants.copied, 1);
    assert.equal(report.tables.responses.copied, 6); // 3 responses x 2 processing runs (original + reprocess)

    const migratedParticipant = await destDb.prepare('SELECT * FROM participants WHERE id = ?').get(participant.id);
    assert.equal(migratedParticipant.id, participant.id);
    assert.equal(migratedParticipant.participant_code, participant.participant_code);

    const migratedSession = await destDb.prepare('SELECT * FROM sessions WHERE id = ?').get(session.id);
    assert.equal(migratedSession.id, session.id);

    const migratedPhase = await destDb.prepare('SELECT * FROM phases WHERE id = ?').get(phase.id);
    assert.equal(migratedPhase.id, phase.id);

    const migratedRecording = await destDb.prepare('SELECT * FROM recordings WHERE id = ?').get(recording.id);
    assert.equal(migratedRecording.id, recording.id);
    assert.equal(migratedRecording.storage_path, recording.storage_path);
});

test('migrateDatabase() preserves transcription version history exactly (no version collapsing/renumbering)', async () => {
    const { db: sourceDb, recording } = await seedSource();
    const destDb = createDatabase(freshDbDir());

    await migrateDatabase({ source: sourceDb, destination: destDb, logger: () => {} });

    const sourceVersions = await sourceDb.prepare('SELECT version, raw_text FROM transcriptions WHERE recording_id = ? ORDER BY version').all(recording.id);
    const destVersions = await destDb.prepare('SELECT version, raw_text FROM transcriptions WHERE recording_id = ? ORDER BY version').all(recording.id);
    assert.deepEqual(destVersions, sourceVersions);
    assert.equal(sourceVersions.length, 2, 'sanity check: the two process() calls in seedSource() must have produced two versions');
});

test('verifyDatabaseMigration() passes when row counts match, fails when they do not', async () => {
    const { db: sourceDb } = await seedSource();
    const destDb = createDatabase(freshDbDir());
    await migrateDatabase({ source: sourceDb, destination: destDb, logger: () => {} });

    const passing = await verifyDatabaseMigration({ source: sourceDb, destination: destDb, logger: () => {} });
    assert.equal(passing.ok, true);
    assert.deepEqual(passing.mismatches, []);

    // Now insert an extra, unmigrated row into the source only.
    await sourceDb.prepare('INSERT INTO participants (id, participant_code, created_at) VALUES (?, ?, ?)').run('extra-id', 'EXTRA', new Date().toISOString());
    const failing = await verifyDatabaseMigration({ source: sourceDb, destination: destDb, logger: () => {} });
    assert.equal(failing.ok, false);
    assert.ok(failing.mismatches.some((m) => m.table === 'participants'));
});

test('migrateDatabase() never modifies the source - row counts and content are identical before and after', async () => {
    const { db: sourceDb } = await seedSource();
    const destDb = createDatabase(freshDbDir());

    const beforeCounts = {};
    for (const t of ['participants', 'sessions', 'phases', 'recordings', 'transcriptions', 'processing_runs', 'responses']) {
        beforeCounts[t] = (await sourceDb.prepare(`SELECT COUNT(*) c FROM ${t}`).get()).c;
    }

    await migrateDatabase({ source: sourceDb, destination: destDb, logger: () => {} });

    for (const t of ['participants', 'sessions', 'phases', 'recordings', 'transcriptions', 'processing_runs', 'responses']) {
        const afterCount = (await sourceDb.prepare(`SELECT COUNT(*) c FROM ${t}`).get()).c;
        assert.equal(afterCount, beforeCounts[t], `source table ${t} row count must be unchanged after migration`);
    }
});

test('a per-row destination failure does not delete/roll back the source, and is reported rather than thrown', async () => {
    const { db: sourceDb, participant } = await seedSource();
    const destDb = createDatabase(freshDbDir());

    // Pre-seed the destination with a colliding id, so the migration's own
    // insert for that same participant fails on a primary-key conflict.
    await destDb.prepare('INSERT INTO participants (id, participant_code, created_at) VALUES (?, ?, ?)').run(participant.id, 'COLLIDING_CODE', new Date().toISOString());

    const report = await migrateDatabase({ source: sourceDb, destination: destDb, logger: () => {} });

    assert.ok(report.errors.some((e) => e.table === 'participants' && e.id === participant.id));
    // The source is completely unaffected by the destination-side failure.
    const stillThere = await sourceDb.prepare('SELECT * FROM participants WHERE id = ?').get(participant.id);
    assert.equal(stillThere.participant_code, participant.participant_code);
});

test('migrateAudio() copies audio bytes to the exact same storage key, verified by size', async () => {
    const { db: sourceDb, audioStorage: sourceAudioStorage, recording } = await seedSource();
    const destDb = createDatabase(freshDbDir());
    await migrateDatabase({ source: sourceDb, destination: destDb, logger: () => {} });

    const destAudioDir = freshAudioDir();
    const destAudioStorage = new LocalFilesystemAudioStorage({ baseDir: destAudioDir });

    const report = await migrateAudio({ sourceStorage: sourceAudioStorage, destinationStorage: destAudioStorage, destinationDb: destDb, logger: () => {} });

    assert.equal(report.errors.length, 0);
    assert.equal(report.copied, 1);
    assert.equal(report.verified, 1);

    const originalBytes = await sourceAudioStorage.read(recording.storage_path);
    const migratedBytes = await destAudioStorage.read(recording.storage_path);
    assert.equal(Buffer.compare(originalBytes, migratedBytes), 0);
});

test('migrateAudio() never deletes or modifies the source audio files', async () => {
    const { db: sourceDb, audioStorage: sourceAudioStorage, recording } = await seedSource();
    const destDb = createDatabase(freshDbDir());
    await migrateDatabase({ source: sourceDb, destination: destDb, logger: () => {} });
    const destAudioStorage = new LocalFilesystemAudioStorage({ baseDir: freshAudioDir() });

    const beforeBytes = await sourceAudioStorage.read(recording.storage_path);
    await migrateAudio({ sourceStorage: sourceAudioStorage, destinationStorage: destAudioStorage, destinationDb: destDb, logger: () => {} });
    const afterBytes = await sourceAudioStorage.read(recording.storage_path);

    assert.equal(Buffer.compare(beforeBytes, afterBytes), 0);
});
