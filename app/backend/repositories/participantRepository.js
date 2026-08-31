// participants table - keyed by the free-text participant code the
// intake screen already collects (app/frontend/js/ui/intakeScreen.js).
// Participant IDs (this table's own generated `id`) are used everywhere
// else in the schema in place of any real name, per the "use participant
// IDs rather than real names" requirement.
//
// Every method is async. This is required for genuine portability: a real
// networked database (PostgresResearchDatabase) can only ever be queried
// asynchronously, so the repository layer - the one place the app is
// allowed to talk to the database at all - has to expose an async
// contract to work with either backend. Against SQLiteResearchDatabase
// (still fully synchronous under the hood, unchanged) `await`ing a plain
// return value is a no-op other than one microtask tick; behavior and
// data are identical to before this change.

const crypto = require('node:crypto');

class ParticipantRepository {
    constructor(db) {
        this._db = db;
    }

    // Creates the participant row the first time a given code is seen,
    // otherwise returns the existing one - multiple sessions for the same
    // participant code are linked to one participant record.
    async upsertByCode(participantCode) {
        const existing = await this.getByCode(participantCode);
        if (existing) {
            return existing;
        }
        const id = crypto.randomUUID();
        await this._db.prepare(
            'INSERT INTO participants (id, participant_code, created_at) VALUES (?, ?, ?)'
        ).run(id, participantCode, new Date().toISOString());
        return this.getByCode(participantCode);
    }

    async getByCode(participantCode) {
        return (await this._db.prepare('SELECT * FROM participants WHERE participant_code = ?').get(participantCode)) || null;
    }

    async getById(id) {
        return (await this._db.prepare('SELECT * FROM participants WHERE id = ?').get(id)) || null;
    }

    // Excludes soft-deleted participants (deleted_at set) - see
    // softDelete()/routes/admin.js. getById() deliberately does NOT filter,
    // so a direct lookup by id (e.g. an admin audit view) can still find a
    // deleted participant's row if ever needed.
    async list() {
        return this._db.prepare('SELECT * FROM participants WHERE deleted_at IS NULL ORDER BY participant_code ASC').all();
    }

    // Soft delete only - never a physical DELETE. Reversible via restore().
    // Only ever called from the authenticated admin route
    // (routes/admin.js), never from startup/schema/migration code.
    async softDelete(id) {
        await this._db.prepare('UPDATE participants SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), id);
        return this.getById(id);
    }

    async restore(id) {
        await this._db.prepare('UPDATE participants SET deleted_at = NULL WHERE id = ?').run(id);
        return this.getById(id);
    }
}

module.exports = { ParticipantRepository };
