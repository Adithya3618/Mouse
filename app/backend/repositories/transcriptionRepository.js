// transcriptions table - versioned per recording. insert() always adds a
// new row (version = previous max + 1); raw_text on an existing row is
// never updated or deleted, satisfying "if a transcription is reprocessed
// later, create a new processing version rather than destroying the
// previous raw result."

const crypto = require('node:crypto');

class TranscriptionRepository {
    constructor(db) {
        this._db = db;
    }

    insert({ recordingId, provider, model, rawText, status, errorMessage = null, metadata = null }) {
        const previous = this.getLatestForRecording(recordingId);
        const version = previous ? previous.version + 1 : 1;
        const id = crypto.randomUUID();
        this._db.prepare(
            `INSERT INTO transcriptions (id, recording_id, version, provider, model, raw_text, status, error_message, metadata_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
            id, recordingId, version, provider, model || null, rawText ?? null,
            status, errorMessage, metadata ? JSON.stringify(metadata) : null, new Date().toISOString()
        );
        return this.getById(id);
    }

    getById(id) {
        const row = this._db.prepare('SELECT * FROM transcriptions WHERE id = ?').get(id);
        return row ? deserialize(row) : null;
    }

    getLatestForRecording(recordingId) {
        const row = this._db.prepare(
            'SELECT * FROM transcriptions WHERE recording_id = ? ORDER BY version DESC LIMIT 1'
        ).get(recordingId);
        return row ? deserialize(row) : null;
    }

    listForRecording(recordingId) {
        return this._db.prepare(
            'SELECT * FROM transcriptions WHERE recording_id = ? ORDER BY version ASC'
        ).all(recordingId).map(deserialize);
    }
}

function deserialize(row) {
    return { ...row, metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null };
}

module.exports = { TranscriptionRepository };
