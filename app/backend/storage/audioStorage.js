// Local-filesystem implementation of the AudioStorage interface (see
// audioStorageContract.js for the formal contract every implementation -
// this one, and the future ObjectStorageAudioStorage - must satisfy).
// Exported as both LocalFilesystemAudioStorage (original name, still used
// by existing tests) and LocalAudioStorage (the interface-conformant name).
//
// Every method is async, including the ones that don't strictly need to be
// for local disk I/O (exists/stat/verifyMirror) - a real object-storage
// implementation's equivalent calls (HEAD requests) are inherently
// network/async, so the interface is async everywhere for both
// implementations to satisfy it identically. Callers already await these
// (see routes/admin.js).
//
// No hosting-provider awareness lives here at all (see
// config/storageConfig.js, the only place that decides which directory to
// point this at, including the Vercel /tmp fallback that used to live here).

const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { sanitizeSegment } = require('./sanitizeSegment');

class LocalFilesystemAudioStorage {
    constructor({ baseDir, mirrorDir, logger = console.log } = {}) {
        if (!baseDir) {
            throw new Error('LocalFilesystemAudioStorage requires an explicit baseDir - provider/environment path selection belongs in config/storageConfig.js, not here.');
        }
        this._baseDir = baseDir;
        // A second, independent copy of every recording - same
        // primary/secondary philosophy as database/researchDatabase.js.
        // Sibling directory (not nested inside _baseDir), so deleting or
        // losing the primary directory entirely does not take the mirror
        // with it. Never read from in the normal request path - it exists
        // purely as a recovery copy (see verifyMirror() below), same as the
        // database's secondary slot.
        this._mirrorDir = mirrorDir || `${this._baseDir}-secondary`;
        this._logger = logger;
        logger(`[storage] Using persistent audio directory: ${this._baseDir} (secondary copy: ${this._mirrorDir})`);
    }

    // Returns the storage-layer key to persist on the recordings row
    // (recordingRepository.insert's storagePath) - relative to this
    // storage's own base directory, never an absolute host path, so the
    // base directory itself can move without invalidating stored rows.
    //
    // Order matters here for data safety: the caller (routes/recordings.js)
    // only creates the `recordings` database row AFTER this resolves - so a
    // recording is only ever "committed" (visible/queryable) once its audio
    // is durably on disk and verified. A write or verification failure here
    // throws, no DB row gets created, and no phantom recording ever points
    // at audio that doesn't actually exist.
    async save({ sessionId, phaseRecordId, buffer, extension }) {
        const relativePath = path.join(sanitizeSegment(sessionId), `${sanitizeSegment(phaseRecordId)}.${extension}`);
        const absolutePath = path.join(this._baseDir, relativePath);

        await fsPromises.mkdir(path.dirname(absolutePath), { recursive: true });
        await fsPromises.writeFile(absolutePath, buffer);

        const written = await fsPromises.stat(absolutePath).catch(() => null);
        if (!written || written.size !== buffer.length) {
            throw new Error(`Audio write verification failed for ${relativePath}: expected ${buffer.length} bytes, found ${written ? written.size : 'no file'}.`);
        }

        // Mirror copy is best-effort: a failure here is logged loudly but
        // does not lose the recording that was JUST successfully written
        // and verified above - the primary copy is what's actually
        // operationally in use, and a missing mirror can be rebuilt later
        // without losing anything. Making the mirror mandatory-or-abort
        // would risk discarding a perfectly good, already-captured
        // recording over a transient secondary-disk issue.
        try {
            const mirrorAbsolutePath = path.join(this._mirrorDir, relativePath);
            await fsPromises.mkdir(path.dirname(mirrorAbsolutePath), { recursive: true });
            await fsPromises.writeFile(mirrorAbsolutePath, buffer);
            const mirrorWritten = await fsPromises.stat(mirrorAbsolutePath).catch(() => null);
            if (!mirrorWritten || mirrorWritten.size !== buffer.length) {
                throw new Error(`mirror size mismatch (expected ${buffer.length}, found ${mirrorWritten ? mirrorWritten.size : 'no file'})`);
            }
        } catch (error) {
            this._logger(`[storage] Secondary audio copy failed for ${relativePath} (primary copy is safe and already verified): ${error.message}`);
        }

        return relativePath;
    }

    // Not part of the formal AudioStorage contract (object storage has no
    // equivalent concept - see audioStorageContract.js) - an optimization
    // routes/admin.js uses when present (streams straight from disk instead
    // of going through readStream()), and skips otherwise.
    resolveAbsolutePath(relativePath) {
        return path.join(this._baseDir, relativePath);
    }

    async read(relativePath) {
        return fsPromises.readFile(this.resolveAbsolutePath(relativePath));
    }

    async readStream(relativePath, { start, end } = {}) {
        const absolutePath = this.resolveAbsolutePath(relativePath);
        return start != null ? fs.createReadStream(absolutePath, { start, end }) : fs.createReadStream(absolutePath);
    }

    async exists(relativePath) {
        try {
            await fsPromises.access(this.resolveAbsolutePath(relativePath));
            return true;
        } catch {
            return false;
        }
    }

    async stat(relativePath) {
        return fsPromises.stat(this.resolveAbsolutePath(relativePath));
    }

    // Whether the mirror copy exists and matches the primary's size - used
    // only for diagnostics/tests, never on the normal read path.
    async verifyMirror(relativePath) {
        const primaryAbs = this.resolveAbsolutePath(relativePath);
        const mirrorAbs = path.join(this._mirrorDir, relativePath);
        const [primaryStat, mirrorStat] = await Promise.all([
            fsPromises.stat(primaryAbs).catch(() => null),
            fsPromises.stat(mirrorAbs).catch(() => null)
        ]);
        if (!primaryStat || !mirrorStat) {
            return { ok: false, reason: 'missing' };
        }
        return primaryStat.size === mirrorStat.size ? { ok: true } : { ok: false, reason: 'size mismatch' };
    }
}

module.exports = { LocalFilesystemAudioStorage, LocalAudioStorage: LocalFilesystemAudioStorage };
