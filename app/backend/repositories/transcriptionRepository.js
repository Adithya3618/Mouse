// transcriptions table - versioned per recording. insert() always adds a
// new row (version = previous max + 1); raw_text on an existing row is
// never updated or deleted, satisfying "if a transcription is reprocessed
// later, create a new processing version rather than destroying the
// previous raw result."
//
// Async throughout - see participantRepository.js's header comment for why.

const crypto = require('node:crypto');

class TranscriptionRepository {
    constructor(db) {
        this._db = db;
    }

    // The version number is computed with a scalar subquery INSIDE the
    // INSERT itself (one atomic statement), not via a separate read-then-
    // write - under concurrent requests for the same recording (multiple
    // Vercel function instances reprocessing at once, say), a
    // read-then-write would let two requests both compute the same "next
    // version" and race. A single atomic statement can't race with itself;
    // combined with the unique (recording_id, version) index in schema.sql,
    // a genuine simultaneous collision fails loudly (constraint violation)
    // rather than silently producing two rows claiming the same version.
    async insert({ recordingId, provider, model, rawText, status, errorMessage = null, metadata = null }) {
        const id = crypto.randomUUID();
        await this._db.prepare(
            `INSERT INTO transcriptions (id, recording_id, version, provider, model, raw_text, status, error_message, metadata_json, created_at)
             VALUES (?, ?, (SELECT COALESCE(MAX(version), 0) + 1 FROM transcriptions WHERE recording_id = ?), ?, ?, ?, ?, ?, ?, ?)`
        ).run(
            id, recordingId, recordingId, provider, model || null, rawText ?? null,
            status, errorMessage, metadata ? JSON.stringify(metadata) : null, new Date().toISOString()
        );
        return this.getById(id);
    }

    async getById(id) {
        const row = await this._db.prepare('SELECT * FROM transcriptions WHERE id = ?').get(id);
        return row ? deserialize(row) : null;
    }

    async getLatestForRecording(recordingId) {
        const row = await this._db.prepare(
            'SELECT * FROM transcriptions WHERE recording_id = ? ORDER BY version DESC LIMIT 1'
        ).get(recordingId);
        return row ? deserialize(row) : null;
    }

    async listForRecording(recordingId) {
        const rows = await this._db.prepare(
            'SELECT * FROM transcriptions WHERE recording_id = ? ORDER BY version ASC'
        ).all(recordingId);
        return rows.map(deserialize);
    }
}

function deserialize(row) {
    return { ...row, metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null };
}

module.exports = { TranscriptionRepository };
