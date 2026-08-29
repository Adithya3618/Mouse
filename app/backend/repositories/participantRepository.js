// participants table - keyed by the free-text participant code the
// intake screen already collects (app/frontend/js/ui/intakeScreen.js).
// Participant IDs (this table's own generated `id`) are used everywhere
// else in the schema in place of any real name, per the "use participant
// IDs rather than real names" requirement.

const crypto = require('node:crypto');

class ParticipantRepository {
    constructor(db) {
        this._db = db;
    }

    // Creates the participant row the first time a given code is seen,
    // otherwise returns the existing one - multiple sessions for the same
    // participant code are linked to one participant record.
    upsertByCode(participantCode) {
        const existing = this.getByCode(participantCode);
        if (existing) {
            return existing;
        }
        const id = crypto.randomUUID();
        this._db.prepare(
            'INSERT INTO participants (id, participant_code, created_at) VALUES (?, ?, ?)'
        ).run(id, participantCode, new Date().toISOString());
        return this.getByCode(participantCode);
    }

    getByCode(participantCode) {
        return this._db.prepare('SELECT * FROM participants WHERE participant_code = ?').get(participantCode) || null;
    }

    getById(id) {
        return this._db.prepare('SELECT * FROM participants WHERE id = ?').get(id) || null;
    }

    list() {
        return this._db.prepare('SELECT * FROM participants ORDER BY participant_code ASC').all();
    }
}

module.exports = { ParticipantRepository };
