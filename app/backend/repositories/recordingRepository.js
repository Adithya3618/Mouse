// recordings table - one immutable row per phase's complete audio file.
// storage_path is written once at insert time and never updated - see
// app/backend/storage/audioStorage.js for where that path actually points.

const crypto = require('node:crypto');

class RecordingRepository {
    constructor(db) {
        this._db = db;
    }

    insert({ phaseId, storagePath, mimeType, durationSeconds, fileSizeBytes }) {
        const id = crypto.randomUUID();
        this._db.prepare(
            `INSERT INTO recordings (id, phase_id, storage_path, mime_type, duration_seconds, file_size_bytes, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(id, phaseId, storagePath, mimeType, durationSeconds ?? null, fileSizeBytes ?? null, new Date().toISOString());
        return this.getById(id);
    }

    getById(id) {
        return this._db.prepare('SELECT * FROM recordings WHERE id = ?').get(id) || null;
    }

    // A phase is designed to have exactly one recording, but this returns
    // the most recently created one defensively rather than assuming.
    getLatestForPhase(phaseId) {
        return this._db.prepare(
            'SELECT * FROM recordings WHERE phase_id = ? ORDER BY created_at DESC LIMIT 1'
        ).get(phaseId) || null;
    }

    listForPhase(phaseId) {
        return this._db.prepare('SELECT * FROM recordings WHERE phase_id = ? ORDER BY created_at ASC').all(phaseId);
    }
}

module.exports = { RecordingRepository };
