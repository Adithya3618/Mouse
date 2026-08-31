// sessions table - one row per experiment session. Created lazily on the
// first recording upload for that session (see routes/recordings.js): this
// database exists to hold cognitive-speech research data, so a session is
// only worth a row once it has actually produced some.
//
// Async throughout - see participantRepository.js's header comment for why.

class SessionRepository {
    constructor(db) {
        this._db = db;
    }

    async upsertById({ sessionId, participantId, experimentId, sessionDate, startTime }) {
        const existing = await this.getById(sessionId);
        if (existing) {
            return existing;
        }
        await this._db.prepare(
            `INSERT INTO sessions (id, participant_id, experiment_id, session_date, start_time, end_time, created_at)
             VALUES (?, ?, ?, ?, ?, NULL, ?)`
        ).run(sessionId, participantId, experimentId || null, sessionDate || null, startTime || null, new Date().toISOString());
        return this.getById(sessionId);
    }

    async getById(id) {
        return (await this._db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)) || null;
    }

    async listForParticipant(participantId) {
        return this._db.prepare('SELECT * FROM sessions WHERE participant_id = ? ORDER BY created_at ASC').all(participantId);
    }

    async markEnded(id, endTime) {
        await this._db.prepare('UPDATE sessions SET end_time = ? WHERE id = ?').run(endTime, id);
    }
}

module.exports = { SessionRepository };
