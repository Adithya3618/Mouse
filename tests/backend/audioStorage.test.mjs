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

    assert.equal(storage.exists(relativePath), true);
    assert.equal(storage.stat(relativePath).size, 1);
    assert.equal(storage.exists('session-does-not-exist/nope.webm'), false);
});

test('rejects path-traversal attempts in session/phase identifiers', async () => {
    const storage = makeTempStorage();
    await assert.rejects(() => storage.save({ sessionId: '../../etc', phaseRecordId: 'p', buffer: Buffer.from('x'), extension: 'webm' }));
    await assert.rejects(() => storage.save({ sessionId: 's', phaseRecordId: '../p', buffer: Buffer.from('x'), extension: 'webm' }));
});
