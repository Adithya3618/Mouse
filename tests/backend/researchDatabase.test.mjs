// Data-safety tests for the primary/secondary research database (see
// app/backend/database/researchDatabase.js). Every test here uses a fresh
// temp directory via fs.mkdtempSync - NEVER the real data/db/ - so nothing
// here can ever touch actual research data.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createDatabase } from '../../app/backend/database/db.js';
import { StartupSafetyError } from '../../app/backend/database/researchDatabase.js';

function freshDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'research-db-test-'));
}

function insertParticipant(db, code) {
    db.prepare('INSERT INTO participants (id, participant_code, created_at) VALUES (?, ?, ?)')
        .run(`id-${code}`, code, new Date().toISOString());
}

function participantCodes(db) {
    return db.prepare('SELECT participant_code FROM participants ORDER BY participant_code').all().map((r) => r.participant_code);
}

function corrupt(filePath) {
    fs.writeFileSync(filePath, 'NOT A SQLITE FILE');
    for (const ext of ['-wal', '-shm']) {
        const sidecar = `${filePath}${ext}`;
        if (fs.existsSync(sidecar)) fs.rmSync(sidecar);
    }
}

// TEST 1: create data, "restart" (reopen), verify it still exists.
test('TEST 1: participant/session/phase/recording data survives a server restart', async () => {
    const dir = freshDir();
    const db1 = createDatabase(dir);
    insertParticipant(db1, 'P_RESTART');
    await db1.waitForPendingSync();

    const db2 = createDatabase(dir);
    assert.deepEqual(participantCodes(db2), ['P_RESTART']);
});

// TEST 2: restart twice.
test('TEST 2: data survives two consecutive restarts', async () => {
    const dir = freshDir();
    const db1 = createDatabase(dir);
    insertParticipant(db1, 'P_TWICE');
    await db1.waitForPendingSync();

    const db2 = createDatabase(dir);
    assert.deepEqual(participantCodes(db2), ['P_TWICE']);

    const db3 = createDatabase(dir);
    assert.deepEqual(participantCodes(db3), ['P_TWICE']);
});

// TEST 3: a failed secondary write must never affect the primary.
test('TEST 3: a failed secondary sync leaves the primary fully intact', async () => {
    const dir = freshDir();
    const db = createDatabase(dir);
    insertParticipant(db, 'P_SECFAIL');
    await db.waitForPendingSync();

    // Make the secondary slot's directory read-only so the NEXT sync
    // (VACUUM INTO a temp file, then rename) fails partway through -
    // simulates a disk/permission failure during secondary replication.
    const status = db.getStatus();
    const secondarySlot = status.active === 'a' ? 'b' : 'a';
    const secondaryPath = path.join(dir, `research.${secondarySlot}.sqlite`);
    fs.chmodSync(dir, 0o500); // read+execute only - blocks creating new files in dir
    try {
        insertParticipant(db, 'P_SECFAIL_2');
        await db.waitForPendingSync();
    } finally {
        fs.chmodSync(dir, 0o700);
    }

    // The primary write must have succeeded regardless of secondary sync failing.
    assert.deepEqual(participantCodes(db), ['P_SECFAIL', 'P_SECFAIL_2']);
    // The secondary file itself must not have been left half-written/corrupt.
    fs.chmodSync(dir, 0o700);
    if (fs.existsSync(secondaryPath)) {
        const bytes = fs.readFileSync(secondaryPath);
        assert.ok(bytes.length === 0 || bytes.slice(0, 16).toString('utf8').startsWith('SQLite format 3'), 'secondary must be either untouched or a fully-valid SQLite file, never a torn/partial write');
    }
});

// TEST 4: a failed promotion must still leave a valid database available.
// Promotion = a manifest write; manifest.js writes atomically (temp file +
// fsync + rename), so an interruption can only ever leave the OLD manifest
// in place - this test corrupts a slot (forcing a recovery/promotion
// decision) and confirms the app still starts successfully with valid data,
// exactly as if the promotion path is safe to interrupt/retry.
test('TEST 4: a corrupted primary still results in a valid, usable database after recovery ("failed promotion" leaves a valid copy available)', async () => {
    const dir = freshDir();
    const db1 = createDatabase(dir);
    insertParticipant(db1, 'P_PROMO');
    await db1.waitForPendingSync();

    const status = db1.getStatus();
    corrupt(path.join(dir, `research.${status.active}.sqlite`));

    const db2 = createDatabase(dir);
    assert.deepEqual(participantCodes(db2), ['P_PROMO']);
    assert.notEqual(db2.getStatus().active, status.active, 'must have promoted the other slot');
});

// TEST 5: corrupt the primary, verify recovery from a valid secondary.
test('TEST 5: corrupting the primary recovers from the valid secondary, with no data loss', async () => {
    const dir = freshDir();
    const db1 = createDatabase(dir);
    insertParticipant(db1, 'P_RECOVER_FROM_SECONDARY');
    await db1.waitForPendingSync();
    const activeBefore = db1.getStatus().active;

    corrupt(path.join(dir, `research.${activeBefore}.sqlite`));

    const db2 = createDatabase(dir);
    assert.deepEqual(participantCodes(db2), ['P_RECOVER_FROM_SECONDARY']);
    const statusAfter = db2.getStatus();
    assert.notEqual(statusAfter.active, activeBefore, 'must have promoted the other (valid) slot to active');
    assert.match(statusAfter.lastRecoveryEvent, /recovered/, 'the recovery event must be durably recorded in the manifest');
    // The now-active slot rebuilds the demoted slot as a fresh, verified
    // secondary immediately (see openResearchDatabase) - that's correct:
    // the corrupt BYTES are preserved separately via quarantine (below),
    // not by leaving the manifest permanently pointing at a bad file.
    assert.equal(statusAfter.slots[activeBefore].status, 'VERIFIED');

    // The corrupt file must have been quarantined (renamed aside), never
    // deleted and never silently overwritten in place.
    const quarantined = fs.readdirSync(dir).filter((f) => f.includes('quarantined'));
    assert.equal(quarantined.length, 1);
    assert.equal(fs.readFileSync(path.join(dir, quarantined[0]), 'utf8'), 'NOT A SQLITE FILE');
});

// TEST 6: corrupt the secondary; the valid primary must remain fully available.
test('TEST 6: corrupting the secondary leaves the valid primary fully available', async () => {
    const dir = freshDir();
    const db1 = createDatabase(dir);
    insertParticipant(db1, 'P_PRIMARY_SURVIVES');
    await db1.waitForPendingSync();
    const activeBefore = db1.getStatus().active;
    const secondarySlot = activeBefore === 'a' ? 'b' : 'a';

    corrupt(path.join(dir, `research.${secondarySlot}.sqlite`));

    const db2 = createDatabase(dir);
    assert.deepEqual(participantCodes(db2), ['P_PRIMARY_SURVIVES']);
    assert.equal(db2.getStatus().active, activeBefore, 'must keep using the still-valid primary, not switch away from it');
});

// TEST 7: both copies valid -> correct generation/most-complete copy is selected.
test('TEST 7: with both copies valid, the manifest-designated (and more complete) slot is selected', async () => {
    const dir = freshDir();
    const db1 = createDatabase(dir);
    insertParticipant(db1, 'P_BOTH_VALID');
    await db1.waitForPendingSync();
    const activeBefore = db1.getStatus().active;

    // Both slots are valid at this point (primary + freshly-synced
    // secondary) - reopening must deterministically pick the
    // manifest-designated active slot, not an arbitrary one.
    const db2 = createDatabase(dir);
    assert.equal(db2.getStatus().active, activeBefore);
    assert.deepEqual(participantCodes(db2), ['P_BOTH_VALID']);
});

// TEST 8: both copies invalid -> FAIL CLOSED, no blank database created.
test('TEST 8: both copies invalid must FAIL CLOSED, never silently create a blank database', async () => {
    const dir = freshDir();
    const db1 = createDatabase(dir);
    insertParticipant(db1, 'P_MUST_NOT_BE_LOST');
    await db1.waitForPendingSync();

    corrupt(path.join(dir, 'research.a.sqlite'));
    corrupt(path.join(dir, 'research.b.sqlite'));

    assert.throws(() => createDatabase(dir), StartupSafetyError);

    // Confirm nothing was deleted or replaced - both corrupt files are
    // still exactly as we left them, no new empty database appeared.
    assert.equal(fs.readFileSync(path.join(dir, 'research.a.sqlite'), 'utf8'), 'NOT A SQLITE FILE');
    assert.equal(fs.readFileSync(path.join(dir, 'research.b.sqlite'), 'utf8'), 'NOT A SQLITE FILE');
});

// TEST 9: a transcription failure must not remove the recording or any
// existing research data (integration test through the real pipeline).
test('TEST 9: a transcription failure leaves the recording and existing data intact', async () => {
    const { createAppContext } = await import('../../app/backend/appContext.js');
    const dir = freshDir();
    const db = createDatabase(dir);
    const audioDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-test-'));
    const { LocalFilesystemAudioStorage } = await import('../../app/backend/storage/audioStorage.js');

    const failingProvider = { name: 'failing-stub', async transcribe() { throw new Error('simulated transcription outage'); } };
    const context = createAppContext({ db, audioStorage: new LocalFilesystemAudioStorage({ baseDir: audioDir }), transcriptionProvider: failingProvider });

    const participant = await context.participantRepository.upsertByCode('P_TX_FAIL');
    const session = await context.sessionRepository.upsertById({ sessionId: 's1', participantId: participant.id });
    const phase = await context.phaseRepository.upsert({ sessionId: session.id, phaseId: 'SUBTRACTION_3', subtractionValue: 3, startingNumber: 900 });
    const storagePath = await context.audioStorage.save({ sessionId: session.id, phaseRecordId: phase.id, buffer: Buffer.from('fake-audio'), extension: 'webm' });
    const recording = await context.recordingRepository.insert({ phaseId: phase.id, storagePath, mimeType: 'audio/webm', fileSizeBytes: 10 });

    const result = await context.speechProcessingService.process({ recordingId: recording.id, phase, scoringOptions: { scoringMode: 'adaptive', expectedResponseDigits: 3 } });
    assert.equal(result.status, 'failed');

    // The recording row and its audio file must both still exist.
    assert.ok(await context.recordingRepository.getById(recording.id));
    assert.ok(await context.audioStorage.exists(storagePath));
    assert.deepEqual(participantCodes(db), ['P_TX_FAIL']);
});

// TEST 10: reprocessing must preserve prior transcription/processing/response history.
test('TEST 10: reprocessing a recording preserves the original transcription/processing/response history', async () => {
    const { createAppContext } = await import('../../app/backend/appContext.js');
    const { LocalFilesystemAudioStorage } = await import('../../app/backend/storage/audioStorage.js');
    const { StubTranscriptionProvider } = await import('../../app/backend/transcription/stubProvider.js');

    const dir = freshDir();
    const db = createDatabase(dir);
    const audioDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-test-'));
    const context = createAppContext({ db, audioStorage: new LocalFilesystemAudioStorage({ baseDir: audioDir }), transcriptionProvider: new StubTranscriptionProvider() });

    const participant = await context.participantRepository.upsertByCode('P_REPROCESS');
    const session = await context.sessionRepository.upsertById({ sessionId: 's1', participantId: participant.id });
    const phase = await context.phaseRepository.upsert({ sessionId: session.id, phaseId: 'SUBTRACTION_3', subtractionValue: 3, startingNumber: 900 });
    const storagePath = await context.audioStorage.save({ sessionId: session.id, phaseRecordId: phase.id, buffer: Buffer.from('fake-audio'), extension: 'webm' });
    const recording = await context.recordingRepository.insert({ phaseId: phase.id, storagePath, mimeType: 'audio/webm', fileSizeBytes: 10 });

    const first = await context.speechProcessingService.process({ recordingId: recording.id, phase, scoringOptions: { scoringMode: 'adaptive', expectedResponseDigits: 3 } });
    const second = await context.speechProcessingService.process({ recordingId: recording.id, phase, scoringOptions: { scoringMode: 'adaptive', expectedResponseDigits: 3 } });

    assert.notEqual(first.transcription.id, second.transcription.id);
    assert.equal(second.transcription.version, first.transcription.version + 1);

    const allVersions = await context.transcriptionRepository.listForRecording(recording.id);
    assert.equal(allVersions.length, 2, 'both the original and the reprocessed transcription must still exist');
    assert.ok(allVersions.some((t) => t.id === first.transcription.id));
    assert.ok(allVersions.some((t) => t.id === second.transcription.id));
});

// TEST 11: SIGINT-style abrupt stop, then restart - data must survive.
// (We can't literally send SIGINT to ourselves mid-test without killing the
// test runner, so this simulates the equivalent: the process never calls
// db.close()/does any graceful shutdown at all before "restarting" - which
// is exactly what happens on a real Ctrl+C, since SQLite's WAL durability
// is what actually protects the data, not any explicit close() call.)
test('TEST 11: an abrupt stop with no graceful shutdown (simulating Ctrl+C/SIGINT) does not lose data on restart', async () => {
    const dir = freshDir();
    const db1 = createDatabase(dir);
    insertParticipant(db1, 'P_SIGINT');
    await db1.waitForPendingSync();
    // No db1.close() call - simulates the process being killed abruptly.

    const db2 = createDatabase(dir);
    assert.deepEqual(participantCodes(db2), ['P_SIGINT']);
});

// TEST 12: simulated deployment/restart must not reset the database.
test('TEST 12: re-running startup (simulating a deployment/redeploy) never resets an existing non-empty database', async () => {
    const dir = freshDir();
    const db1 = createDatabase(dir);
    insertParticipant(db1, 'P_DEPLOY_1');
    await db1.waitForPendingSync();

    // Simulate several consecutive deployments/restarts in a row.
    for (let i = 0; i < 3; i += 1) {
        const db = createDatabase(dir);
        assert.deepEqual(participantCodes(db), ['P_DEPLOY_1'], `data must still be present after simulated redeploy #${i + 1}`);
    }
});

// TEST 13: admin deletion only occurs through an authenticated, explicit request.
test('TEST 13: participant deletion is only reachable through the authenticated admin route, and is a soft-delete', async () => {
    const { createAppContext } = await import('../../app/backend/appContext.js');
    const { createAdminRouter } = await import('../../app/backend/routes/admin.js');
    const { adminAuth } = await import('../../app/backend/routes/adminAuth.js');
    const { LocalFilesystemAudioStorage } = await import('../../app/backend/storage/audioStorage.js');
    const { StubTranscriptionProvider } = await import('../../app/backend/transcription/stubProvider.js');
    const express = (await import('express')).default;

    const previousToken = process.env.ADMIN_API_TOKEN;
    process.env.ADMIN_API_TOKEN = 'test-token-for-delete';

    const dir = freshDir();
    const db = createDatabase(dir);
    const audioDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-test-'));
    const context = createAppContext({ db, audioStorage: new LocalFilesystemAudioStorage({ baseDir: audioDir }), transcriptionProvider: new StubTranscriptionProvider() });
    const participant = await context.participantRepository.upsertByCode('P_DELETE_ME');

    const app = express();
    app.use(express.json());
    app.use('/api/admin', adminAuth, createAdminRouter(context));
    const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    const { port } = server.address();

    try {
        // No token -> refused.
        const noAuth = await fetch(`http://localhost:${port}/api/admin/participants/${participant.id}/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'P_DELETE_ME' }) });
        assert.equal(noAuth.status, 401);

        // Missing/incorrect confirmation -> refused, nothing changed.
        const badConfirm = await fetch(`http://localhost:${port}/api/admin/participants/${participant.id}/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token-for-delete' }, body: JSON.stringify({ confirm: 'WRONG_CODE' }) });
        assert.equal(badConfirm.status, 400);
        assert.equal((await context.participantRepository.getById(participant.id)).deleted_at, null);

        // Correct auth + correct confirmation -> succeeds, soft-delete only.
        const ok = await fetch(`http://localhost:${port}/api/admin/participants/${participant.id}/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token-for-delete' }, body: JSON.stringify({ confirm: 'P_DELETE_ME' }) });
        assert.equal(ok.status, 200);

        const afterDelete = await context.participantRepository.getById(participant.id);
        assert.ok(afterDelete.deleted_at, 'must be soft-deleted (deleted_at set)');
        assert.ok(fs.existsSync(path.join(dir, `research.${db.getStatus().active}.sqlite`)), 'the row/database itself must still physically exist - this is a soft delete, not a physical one');

        const auditRows = db.prepare("SELECT * FROM admin_audit_log WHERE action = 'participant_soft_delete'").all();
        assert.equal(auditRows.length, 1, 'the deletion must be logged in the audit table');
        assert.equal(auditRows[0].target_id, participant.id);
    } finally {
        server.close();
        if (previousToken === undefined) delete process.env.ADMIN_API_TOKEN; else process.env.ADMIN_API_TOKEN = previousToken;
    }
});

// TEST 14: no startup path in the application code may delete research data.
//
// DROP TABLE / DELETE FROM / TRUNCATE are banned everywhere, no exceptions -
// the schema is CREATE TABLE IF NOT EXISTS only, and admin deletion is a
// soft-delete UPDATE (see routes/admin.js), never a DELETE FROM.
//
// fs.unlinkSync/fs.rmSync/fs.rmdirSync are allowed ONLY inside
// researchDatabase.js, and ONLY because that file's own file-removal calls
// have all been individually reviewed as part of this test's design: they
// either (a) delete a FAILED temp snapshot file that never became a real
// slot (snapshotTo()'s cleanup path), which touches no committed research
// data, or (b) don't exist at all - corrupt slots are renamed aside
// (quarantined) via fs.renameSync, never deleted, by deliberate design (see
// the "quarantine" comment in openResearchDatabase()). Any such call
// appearing in a NEW location is exactly what this test exists to catch.
test('TEST 14: no application source file contains a destructive database/filesystem operation on startup paths', () => {
    const projectRoot = path.join(import.meta.dirname, '../..');
    const scanDirs = ['app/backend', 'api'];
    const alwaysBanned = [/DROP\s+TABLE/i, /DELETE\s+FROM/i, /TRUNCATE/i];
    const fileRemovalPatterns = [/\bfs\.unlinkSync\s*\(/, /\bfs\.rmSync\s*\(/, /\bfs\.rmdirSync\s*\(/, /\brequire\(['"]child_process['"]\).*rm\s+-rf/];
    const fileRemovalAllowedIn = new Set(['app/backend/database/researchDatabase.js']);

    function walk(dir) {
        const results = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                results.push(...walk(full));
            } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.sql'))) {
                results.push(full);
            }
        }
        return results;
    }

    const offenders = [];
    for (const scanDir of scanDirs) {
        const fullDir = path.join(projectRoot, scanDir);
        if (!fs.existsSync(fullDir)) continue;
        for (const file of walk(fullDir)) {
            const relative = path.relative(projectRoot, file).split(path.sep).join('/');
            const content = fs.readFileSync(file, 'utf8');
            for (const pattern of alwaysBanned) {
                if (pattern.test(content)) {
                    offenders.push(`${relative}: matches ${pattern}`);
                }
            }
            if (!fileRemovalAllowedIn.has(relative)) {
                for (const pattern of fileRemovalPatterns) {
                    if (pattern.test(content)) {
                        offenders.push(`${relative}: matches ${pattern} (file removal is only reviewed/allowed in researchDatabase.js)`);
                    }
                }
            }
        }
    }

    assert.deepEqual(offenders, [], `Found destructive operations in application code:\n${offenders.join('\n')}`);
});

// TEST 15: a MISSING slot file (deleted, not corrupted) while the manifest
// still references it must recover from the other slot, never create a new
// empty database.
test('TEST 15: a missing (deleted) primary slot file recovers from the valid secondary, never creates a new empty database', async () => {
    const dir = freshDir();
    const db1 = createDatabase(dir);
    insertParticipant(db1, 'P_MISSING_FILE');
    await db1.waitForPendingSync();
    const activeBefore = db1.getStatus().active;

    // Delete (not corrupt) the primary slot's file entirely.
    fs.rmSync(path.join(dir, `research.${activeBefore}.sqlite`));
    for (const ext of ['-wal', '-shm']) {
        const sidecar = path.join(dir, `research.${activeBefore}.sqlite${ext}`);
        if (fs.existsSync(sidecar)) fs.rmSync(sidecar);
    }

    const db2 = createDatabase(dir);
    assert.deepEqual(participantCodes(db2), ['P_MISSING_FILE'], 'must recover from the still-valid secondary, not silently start empty');
    assert.notEqual(db2.getStatus().active, activeBefore);
});

// TEST 16: a corrupt (unparseable) manifest.json, with BOTH slot files
// still valid and non-empty, must never result in a fresh empty database -
// per the "empty database must never be preferred, never guess" rule, this
// is ambiguous-but-recoverable (both slots ARE valid data), not a reason to
// discard everything and start over.
test('TEST 16: a corrupt/unparseable manifest.json with two valid non-empty slots recovers data, never creates an empty database', async () => {
    const dir = freshDir();
    const db1 = createDatabase(dir);
    insertParticipant(db1, 'P_BAD_MANIFEST');
    await db1.waitForPendingSync();

    // Corrupt only the manifest - both slot .sqlite files remain untouched
    // and fully valid.
    fs.writeFileSync(path.join(dir, 'manifest.json'), '{ this is not valid json');

    const db2 = createDatabase(dir);
    assert.deepEqual(participantCodes(db2), ['P_BAD_MANIFEST'], 'data must survive a corrupt manifest when the underlying slot files are still valid');

    // The manifest itself must have been rebuilt into something valid and
    // parseable (not left corrupt, and not silently ignored).
    const rebuiltManifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    assert.ok(rebuiltManifest.active === 'a' || rebuiltManifest.active === 'b');
});

// TEST 17: an invalid secondary snapshot (simulated by making the snapshot
// destination briefly unwritable, forcing the VACUUM INTO/rename step to
// fail) must never replace the existing valid secondary - the old, valid
// secondary content must survive completely unchanged.
test('TEST 17: a failed secondary snapshot never replaces the existing valid secondary with a bad one', async () => {
    const dir = freshDir();
    const db = createDatabase(dir);
    insertParticipant(db, 'P_SNAPSHOT_1');
    await db.waitForPendingSync();

    const secondarySlot = db.getStatus().active === 'a' ? 'b' : 'a';
    const secondaryPath = path.join(dir, `research.${secondarySlot}.sqlite`);
    const validSecondaryBytesBefore = fs.readFileSync(secondaryPath);

    // Force the NEXT sync's snapshot-to-temp-file step to fail by making
    // the directory briefly read-only (VACUUM INTO can't create its temp
    // file), then confirm the existing, valid secondary is byte-for-byte
    // unchanged - never partially overwritten.
    fs.chmodSync(dir, 0o500);
    try {
        insertParticipant(db, 'P_SNAPSHOT_2');
        await db.waitForPendingSync();
    } finally {
        fs.chmodSync(dir, 0o700);
    }

    const secondaryBytesAfter = fs.readFileSync(secondaryPath);
    assert.equal(Buffer.compare(validSecondaryBytesBefore, secondaryBytesAfter), 0, 'the old valid secondary must be byte-for-byte unchanged after a failed sync attempt');

    // And the primary write itself still succeeded regardless.
    assert.deepEqual(participantCodes(db), ['P_SNAPSHOT_1', 'P_SNAPSHOT_2']);
});

// TEST 18: comprehensive identity/relationship preservation across a
// restart - not just "a participant exists", but every id at every level
// of the chain, plus transcription/processing-run version history.
test('TEST 18: participant/session/phase/recording/transcription/processing-run/response IDs and relationships are byte-identical across a restart', async () => {
    const { createAppContext } = await import('../../app/backend/appContext.js');
    const { LocalFilesystemAudioStorage } = await import('../../app/backend/storage/audioStorage.js');
    const { StubTranscriptionProvider } = await import('../../app/backend/transcription/stubProvider.js');

    const dir = freshDir();
    const audioDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-restart-test-'));
    const db1 = createDatabase(dir);
    const context1 = createAppContext({ db: db1, audioStorage: new LocalFilesystemAudioStorage({ baseDir: audioDir }), transcriptionProvider: new StubTranscriptionProvider({ text: '944 941 938' }) });

    const participant = await context1.participantRepository.upsertByCode('P_IDENTITY');
    const session = await context1.sessionRepository.upsertById({ sessionId: 'session-identity', participantId: participant.id });
    const phase = await context1.phaseRepository.upsert({ sessionId: session.id, phaseId: 'SUBTRACTION_3', subtractionValue: 3, startingNumber: 947 });
    const storagePath = await context1.audioStorage.save({ sessionId: session.id, phaseRecordId: phase.id, buffer: Buffer.from('identity audio'), extension: 'webm' });
    const recording = await context1.recordingRepository.insert({ phaseId: phase.id, storagePath, mimeType: 'audio/webm' });
    const first = await context1.speechProcessingService.process({ recordingId: recording.id, phase, scoringOptions: { scoringMode: 'adaptive', expectedResponseDigits: 3 } });
    const second = await context1.speechProcessingService.process({ recordingId: recording.id, phase, scoringOptions: { scoringMode: 'adaptive', expectedResponseDigits: 3 } }); // reprocess -> version 2
    await db1.waitForPendingSync();

    // "Restart": fresh app context, fresh db connection, SAME directory.
    const db2 = createDatabase(dir);
    const context2 = createAppContext({ db: db2, audioStorage: new LocalFilesystemAudioStorage({ baseDir: audioDir }), transcriptionProvider: new StubTranscriptionProvider() });

    assert.equal((await context2.participantRepository.getById(participant.id)).id, participant.id);
    assert.equal((await context2.sessionRepository.getById(session.id)).id, session.id);
    assert.equal((await context2.phaseRepository.getById(phase.id)).id, phase.id);
    assert.equal((await context2.recordingRepository.getById(recording.id)).id, recording.id);

    const versions = await context2.transcriptionRepository.listForRecording(recording.id);
    assert.equal(versions.length, 2, 'both transcription versions must survive the restart');
    assert.equal(versions[0].id, first.transcription.id);
    assert.equal(versions[0].version, 1);
    assert.equal(versions[1].id, second.transcription.id);
    assert.equal(versions[1].version, 2);

    const runsV2 = await context2.responseRepository.listProcessingRunsForTranscription(versions[1].id);
    assert.equal(runsV2.length, 1);
    const responsesV2 = await context2.responseRepository.listResponsesForRun(runsV2[0].id);
    assert.equal(responsesV2.length, 3);

    // Audio: the file survives the restart at the exact same key, byte-identical.
    assert.equal(await context2.audioStorage.exists(storagePath), true, 'audio file must remain available after restart');
    const audioAfter = await context2.audioStorage.read(storagePath);
    assert.equal(audioAfter.toString(), 'identity audio', 'audio bytes must remain byte-identical after restart');
    assert.equal((await context2.recordingRepository.getById(recording.id)).storage_path, storagePath, 'the database recording row must still point at the same, still-existing audio file');
});

