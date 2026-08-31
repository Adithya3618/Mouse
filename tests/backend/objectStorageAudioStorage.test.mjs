// ObjectStorageAudioStorage tests, against a fake in-memory client (no real
// object-storage provider is provisioned/implemented yet - see
// docs/storage-architecture.md). Verifies the class's own shared logic
// (write-then-verify, key construction, path-traversal guarding) works
// correctly regardless of which real provider eventually plugs into it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObjectStorageAudioStorage } from '../../app/backend/storage/objectStorageAudioStorage.js';
import { assertImplementsAudioStorage } from '../../app/backend/storage/audioStorageContract.js';

function makeFakeClient({ failOn } = {}) {
    const objects = new Map();
    return {
        objects,
        async put(key, buffer) {
            if (failOn === key) {
                throw new Error('simulated put failure');
            }
            objects.set(key, buffer);
        },
        async head(key) {
            if (!objects.has(key)) {
                return null;
            }
            return { size: objects.get(key).length };
        },
        async get(key) {
            if (!objects.has(key)) {
                throw new Error('not found');
            }
            return objects.get(key);
        },
        async delete(key) {
            objects.delete(key);
        }
    };
}

test('requires a client with put/get/head - throws a clear error without one', () => {
    assert.throws(() => new ObjectStorageAudioStorage({}), /client/);
    assert.throws(() => new ObjectStorageAudioStorage({ client: { put() {}, get() {} } }), /head/);
});

test('satisfies the formal AudioStorage contract shape', () => {
    const storage = new ObjectStorageAudioStorage({ client: makeFakeClient(), logger: () => {} });
    assert.doesNotThrow(() => assertImplementsAudioStorage(storage));
});

test('save() writes via the client and read() returns the exact bytes back', async () => {
    const storage = new ObjectStorageAudioStorage({ client: makeFakeClient(), logger: () => {} });
    const buffer = Buffer.from('fake audio bytes');

    const key = await storage.save({ sessionId: 'session-1', phaseRecordId: 'phase-1', buffer, extension: 'webm' });
    const readBack = await storage.read(key);

    assert.equal(Buffer.compare(buffer, readBack), 0);
});

test('exists()/stat() reflect what was actually saved', async () => {
    const storage = new ObjectStorageAudioStorage({ client: makeFakeClient(), logger: () => {} });
    const key = await storage.save({ sessionId: 's', phaseRecordId: 'p', buffer: Buffer.from('xyz'), extension: 'webm' });

    assert.equal(await storage.exists(key), true);
    assert.equal((await storage.stat(key)).size, 3);
    assert.equal(await storage.exists('never/saved.webm'), false);
});

test('save() throws (never resolves) if the client write-verification (head) does not match the written size', async () => {
    // A client whose head() lies about the size after a successful put -
    // simulates a provider that accepted the write but didn't actually
    // durably store all the bytes.
    const client = {
        async put() {},
        async head() { return { size: 999 }; },
        async get() { return Buffer.from(''); }
    };
    const storage = new ObjectStorageAudioStorage({ client, logger: () => {} });

    await assert.rejects(() => storage.save({ sessionId: 's', phaseRecordId: 'p', buffer: Buffer.from('short'), extension: 'webm' }));
});

test('save() throws if the client rejects the write outright - no key is ever returned for a failed save', async () => {
    const client = makeFakeClient({ failOn: 's/p.webm' });
    const storage = new ObjectStorageAudioStorage({ client, logger: () => {} });

    await assert.rejects(() => storage.save({ sessionId: 's', phaseRecordId: 'p', buffer: Buffer.from('x'), extension: 'webm' }));
});

test('rejects path-traversal attempts in session/phase identifiers, same as LocalAudioStorage', async () => {
    const storage = new ObjectStorageAudioStorage({ client: makeFakeClient(), logger: () => {} });
    await assert.rejects(() => storage.save({ sessionId: '../../etc', phaseRecordId: 'p', buffer: Buffer.from('x'), extension: 'webm' }));
    await assert.rejects(() => storage.save({ sessionId: 's', phaseRecordId: '../p', buffer: Buffer.from('x'), extension: 'webm' }));
});

test('readStream() yields the same bytes as read(), for the admin audio-streaming route', async () => {
    const storage = new ObjectStorageAudioStorage({ client: makeFakeClient(), logger: () => {} });
    const buffer = Buffer.from('streamable bytes');
    const key = await storage.save({ sessionId: 's', phaseRecordId: 'p', buffer, extension: 'webm' });

    const stream = await storage.readStream(key);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    assert.equal(Buffer.compare(Buffer.concat(chunks), buffer), 0);
});
