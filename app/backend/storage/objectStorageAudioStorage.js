// Generic AudioStorage implementation for ANY durable object-storage
// provider (Vercel Blob, S3, Cloudflare R2, a future UF-approved store,
// ...). Holds every bit of shared logic (write-then-verify before
// resolving, key construction, path-traversal guarding) exactly once; a
// concrete provider is plugged in as a small `client` adapter satisfying:
//
//   put(key, buffer) -> Promise<void>
//   get(key) -> Promise<Buffer>
//   head(key) -> Promise<{size: number} | null>   (null/rejects if missing)
//   delete(key) -> Promise<void>                   (not currently called by
//                                                    this class - no code
//                                                    path ever deletes
//                                                    audio; kept in the
//                                                    contract for a future
//                                                    explicit admin action)
//   getStream(key) -> Promise<Readable>            (optional)
//
// No client adapter is implemented yet (see docs/storage-architecture.md) -
// this class has been written and tested (see
// tests/backend/objectStorageAudioStorage.test.mjs) against a fake in-memory
// client, so the moment a real object-storage account is provisioned, only
// a thin new client file needs to be added (config/storageConfig.js is the
// one place that would wire it in) - this class, and everything above it
// (routes, services, repositories, the experiment), needs no changes.
//
// Deliberately does NOT reproduce the local primary/secondary mirroring
// (see storage/audioStorage.js) - a real object-storage provider already
// replicates objects across multiple physical devices/zones internally;
// hand-rolling a second application-level copy here would be redundant
// complexity pretending to add safety a durable provider already provides.
// This class's job is narrower and still essential: verify a write
// actually landed (via head()) before this method resolves, so a database
// row is never created for a recording that isn't actually durably stored.

const { sanitizeSegment } = require('./sanitizeSegment');

class ObjectStorageAudioStorage {
    constructor({ client, logger = console.log } = {}) {
        if (!client) {
            throw new Error('ObjectStorageAudioStorage requires a client ({put, get, head, delete}) - see this file\'s header comment.');
        }
        for (const method of ['put', 'get', 'head']) {
            if (typeof client[method] !== 'function') {
                throw new Error(`ObjectStorageAudioStorage's client is missing required method: ${method}()`);
            }
        }
        this._client = client;
        this._logger = logger;
    }

    // Mirrors LocalFilesystemAudioStorage.save()'s data-safety guarantee:
    // only resolves once the write is verified durable. A recording row is
    // only ever created by the caller (routes/recordings.js) after this
    // resolves, so a failure here (write OR verification) means no phantom
    // database row ever points at an object that doesn't actually exist.
    async save({ sessionId, phaseRecordId, buffer, extension }) {
        const key = `${sanitizeSegment(sessionId)}/${sanitizeSegment(phaseRecordId)}.${extension}`;

        await this._client.put(key, buffer);

        const head = await this._client.head(key).catch(() => null);
        if (!head || head.size !== buffer.length) {
            throw new Error(`Object storage write verification failed for ${key}: expected ${buffer.length} bytes, found ${head ? head.size : 'not found'}.`);
        }

        return key;
    }

    async read(key) {
        return this._client.get(key);
    }

    async exists(key) {
        const head = await this._client.head(key).catch(() => null);
        return head != null;
    }

    async stat(key) {
        const head = await this._client.head(key);
        if (!head) {
            throw new Error(`Object not found: ${key}`);
        }
        return head;
    }

    // routes/admin.js uses this (rather than resolveAbsolutePath, which
    // this class deliberately does not implement - there is no local file)
    // to stream audio for the authenticated admin route. Range support is
    // best-effort: a client without native range support just streams the
    // full object and lets the caller slice it, which routes/admin.js
    // already falls back to correctly.
    async readStream(key, { start, end } = {}) {
        if (typeof this._client.getStream === 'function') {
            return this._client.getStream(key, start != null ? { start, end } : undefined);
        }
        const { Readable } = require('node:stream');
        const buffer = await this.read(key);
        return Readable.from(start != null ? buffer.subarray(start, end + 1) : buffer);
    }
}

module.exports = { ObjectStorageAudioStorage };
