import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { LocalFilesystemAudioStorage } from '../../app/backend/storage/audioStorage.js';

function makeTempStorage() {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-storage-test-'));
    return new LocalFilesystemAudioStorage({ baseDir });
}

test('save() writes the exact buffer bytes and read() returns them unchanged', async () => {
    const storage = makeTempStorage();
    const buffer = Buffer.from('fake webm audio bytes');

    const relativePath = await storage.save({ sessionId: 'session-1', phaseRecordId: 'phase-1', buffer, extension: 'webm' });
    const readBack = await storage.read(relativePath);

    assert.equal(Buffer.compare(buffer, readBack), 0);
});

test('save() never overwrites a different recording - distinct phase ids produce distinct files', async () => {
    const storage = makeTempStorage();
    const pathA = await storage.save({ sessionId: 'session-1', phaseRecordId: 'phase-A', buffer: Buffer.from('A'), extension: 'webm' });
    const pathB = await storage.save({ sessionId: 'session-1', phaseRecordId: 'phase-B', buffer: Buffer.from('B'), extension: 'webm' });

    assert.notEqual(pathA, pathB);
    assert.equal((await storage.read(pathA)).toString(), 'A');
    assert.equal((await storage.read(pathB)).toString(), 'B');
});

test('exists()/stat() reflect a saved file; a never-saved path does not exist', async () => {
    const storage = makeTempStorage();
    const relativePath = await storage.save({ sessionId: 's', phaseRecordId: 'p', buffer: Buffer.from('x'), extension: 'webm' });

    assert.equal(await storage.exists(relativePath), true);
    assert.equal((await storage.stat(relativePath)).size, 1);
    assert.equal(await storage.exists('session-does-not-exist/nope.webm'), false);
});

test('rejects path-traversal attempts in session/phase identifiers', async () => {
    const storage = makeTempStorage();
    await assert.rejects(() => storage.save({ sessionId: '../../etc', phaseRecordId: 'p', buffer: Buffer.from('x'), extension: 'webm' }));
    await assert.rejects(() => storage.save({ sessionId: 's', phaseRecordId: '../p', buffer: Buffer.from('x'), extension: 'webm' }));
});

test('save() also writes a verified secondary (mirror) copy alongside the primary', async () => {
    const storage = makeTempStorage();
    const buffer = Buffer.from('mirrored audio bytes');
    const relativePath = await storage.save({ sessionId: 'session-1', phaseRecordId: 'phase-1', buffer, extension: 'webm' });

    assert.deepEqual(await storage.verifyMirror(relativePath), { ok: true });
});

test('save() is not committed (does not resolve) if the primary write cannot be verified', async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-storage-test-'));
    const storage = new LocalFilesystemAudioStorage({ baseDir });
    const buffer = Buffer.from('x'.repeat(100));

    // Force the write to fail by making the base directory read-only right
    // before the write - save() must reject, not silently succeed with a
    // partial/missing file.
    fs.chmodSync(baseDir, 0o500);
    try {
        await assert.rejects(() => storage.save({ sessionId: 'session-1', phaseRecordId: 'phase-fail', buffer, extension: 'webm' }));
    } finally {
        fs.chmodSync(baseDir, 0o700);
    }
});

test('a mirror-write failure does not prevent save() from resolving - the primary copy (already verified) is what matters', async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-storage-test-'));
    const mirrorDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-storage-mirror-test-'));
    const storage = new LocalFilesystemAudioStorage({ baseDir, mirrorDir });
    const buffer = Buffer.from('primary survives even if mirror fails');

    fs.chmodSync(mirrorDir, 0o500);
    let relativePath;
    try {
        relativePath = await storage.save({ sessionId: 'session-1', phaseRecordId: 'phase-1', buffer, extension: 'webm' });
    } finally {
        fs.chmodSync(mirrorDir, 0o700);
    }

    assert.equal(await storage.exists(relativePath), true);
    assert.equal((await storage.read(relativePath)).toString(), buffer.toString());
});
