// Audio storage abstraction (see docs/data-flow.md). Swapping to a
// UF-approved object store (S3-compatible, etc.) later means providing a
// class with the same save()/read() shape - nothing else in the app
// constructs file paths or touches the filesystem directly for audio.
//
// Audio is stored OUTSIDE app/frontend (never web-servable as a static
// file) and is only ever readable through the authenticated
// GET /api/admin/recordings/:id/audio route (see routes/admin.js). Never
// written to git, never sent to the frontend except as that streamed
// response, never placed in localStorage (there is no participant-facing
// audio playback at all - see the participant experience redesign).

const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_AUDIO_DIR = path.join(__dirname, '../../../data/audio');

// See database/db.js's identical VERCEL_FALLBACK_DB_PATH comment: Vercel's
// filesystem is read-only outside /tmp, so DEFAULT_AUDIO_DIR would throw
// there. Only takes effect when AUDIO_STORAGE_DIR isn't set and VERCEL is -
// local dev/tests are unaffected.
const VERCEL_FALLBACK_AUDIO_DIR = '/tmp/audio';

class LocalFilesystemAudioStorage {
    constructor({ baseDir, logger = console.log } = {}) {
        this._baseDir = baseDir
            || process.env.AUDIO_STORAGE_DIR
            || (process.env.VERCEL ? VERCEL_FALLBACK_AUDIO_DIR : DEFAULT_AUDIO_DIR);
        // Only logged when no explicit baseDir was passed in (i.e. real
        // server startup, not a test fixture pointed at a throwaway temp
        // directory) - same rationale as db.js's startup log: a plain
        // filesystem path, never audio content/credentials, so it's obvious
        // at a glance this is a persistent on-disk location.
        if (!baseDir) {
            logger(`[storage] Using persistent audio directory: ${this._baseDir}`);
        }
    }

    // Returns the storage-layer path to persist on the recordings row
    // (recordingRepository.insert's storagePath) - relative to this
    // storage's own base directory, never an absolute host path, so the
    // base directory itself can move without invalidating stored rows.
    async save({ sessionId, phaseRecordId, buffer, extension }) {
        const relativePath = path.join(sanitizeSegment(sessionId), `${sanitizeSegment(phaseRecordId)}.${extension}`);
        const absolutePath = path.join(this._baseDir, relativePath);
        await fsPromises.mkdir(path.dirname(absolutePath), { recursive: true });
        await fsPromises.writeFile(absolutePath, buffer);
        return relativePath;
    }

    resolveAbsolutePath(relativePath) {
        return path.join(this._baseDir, relativePath);
    }

    async read(relativePath) {
        return fsPromises.readFile(this.resolveAbsolutePath(relativePath));
    }

    exists(relativePath) {
        return fs.existsSync(this.resolveAbsolutePath(relativePath));
    }

    stat(relativePath) {
        return fs.statSync(this.resolveAbsolutePath(relativePath));
    }
}

// Defends against a malicious/malformed id ever escaping the audio
// directory via path traversal (e.g. "../../etc") - ids in practice are
// always our own generated uuids/session ids, but this makes the guarantee
// structural rather than incidental.
function sanitizeSegment(segment) {
    const value = String(segment ?? '');
    if (!value || value.includes('..') || value.includes('/') || value.includes('\\')) {
        throw new Error(`Invalid path segment for audio storage: ${JSON.stringify(segment)}`);
    }
    return value;
}

module.exports = { LocalFilesystemAudioStorage };
