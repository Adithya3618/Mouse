// Formal contract every AudioStorage implementation must satisfy. Same
// duck-typed-contract-plus-runtime-assertion approach as
// database/researchDatabaseContract.js - see that file's header for why.
//
//   save({sessionId, phaseRecordId, buffer, extension}) -> Promise<key>
//     Writes durably and verifies the write before resolving; throws (never
//     resolves) on any failure - callers must never create a database row
//     for a recording whose save() call didn't resolve successfully.
//   read(key) -> Promise<Buffer>
//   exists(key) -> Promise<boolean>
//   stat(key) -> Promise<{size: number, ...}>
//
// `key` is an opaque, implementation-chosen string (a relative filesystem
// path for LocalAudioStorage, an object key for ObjectStorageAudioStorage) -
// callers only ever pass it back to the SAME implementation that produced
// it; nothing outside an AudioStorage implementation parses or constructs
// one directly.
//
// Two methods are optional, used only by routes/admin.js's audio-streaming
// route as an optimization when present:
//   resolveAbsolutePath(key) -> string   (local filesystem implementations only)
//   readStream(key, {start, end}?) -> Promise<Readable>   (all implementations)
// An implementation must provide at least one of the two.

const REQUIRED_METHODS = ['save', 'read', 'exists', 'stat'];

function assertImplementsAudioStorage(candidate) {
    if (!candidate || typeof candidate !== 'object') {
        throw new Error('AudioStorage candidate must be an object.');
    }
    for (const method of REQUIRED_METHODS) {
        if (typeof candidate[method] !== 'function') {
            throw new Error(`AudioStorage candidate is missing required method: ${method}()`);
        }
    }
    if (typeof candidate.resolveAbsolutePath !== 'function' && typeof candidate.readStream !== 'function') {
        throw new Error('AudioStorage candidate must provide at least one of resolveAbsolutePath() or readStream().');
    }
    return true;
}

module.exports = { assertImplementsAudioStorage, REQUIRED_METHODS };
