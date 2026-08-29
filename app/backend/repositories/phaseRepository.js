// phases table - one row per cognitive-speech phase (SUBTRACTION_<n> /
// DUAL_TASK_<n>) within a session. `phaseId` here is the semantic condition
// id (e.g. "SUBTRACTION_3"); this row's own `id` is what recordings hang off.

const crypto = require('node:crypto');

class PhaseRepository {
    constructor(db) {
        this._db = db;
    }

    // Looked up by (sessionId, phaseId, startedAt) so a participant who
    // somehow re-enters the same condition (should not normally happen)
    // still gets its own row rather than silently colliding.
    upsert({ sessionId, phaseId, phaseType, subtractionValue, startingNumber, duration, startedAt, scoringMode, expectedResponseDigits }) {
        const existing = this._db.prepare(
            'SELECT * FROM phases WHERE session_id = ? AND phase_id = ? AND started_at = ?'
        ).get(sessionId, phaseId, startedAt || null);
        if (existing) {
            return existing;
        }
        const id = crypto.randomUUID();
        this._db.prepare(
            `INSERT INTO phases (id, session_id, phase_id, phase_type, subtraction_value, starting_number, duration, started_at, ended_at, scoring_mode, expected_response_digits, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
        ).run(
            id, sessionId, phaseId, phaseType || null,
            subtractionValue ?? null, startingNumber ?? null, duration ?? null,
            startedAt || null, scoringMode || null, expectedResponseDigits ?? null,
            new Date().toISOString()
        );
        return this.getById(id);
    }

    getById(id) {
        return this._db.prepare('SELECT * FROM phases WHERE id = ?').get(id) || null;
    }

    listForSession(sessionId) {
        return this._db.prepare('SELECT * FROM phases WHERE session_id = ? ORDER BY created_at ASC').all(sessionId);
    }

    markEnded(id, endedAt) {
        this._db.prepare('UPDATE phases SET ended_at = ? WHERE id = ?').run(endedAt, id);
    }
}

module.exports = { PhaseRepository };
