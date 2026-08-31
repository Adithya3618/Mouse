// admin_audit_log table - append-only record of every administrative
// action (soft delete/restore, etc. - see routes/admin.js). This is the
// ONLY place that writes to that table; routes/services must never call
// db.prepare()/db.exec() directly (see
// tests/backend/noRawSqlOutsideRepositories.test.mjs).
//
// Async throughout - see participantRepository.js's header comment for why.

const crypto = require('node:crypto');

class AuditLogRepository {
    constructor(db) {
        this._db = db;
    }

    async insert({ action, targetType, targetId, details }) {
        const id = crypto.randomUUID();
        await this._db.prepare(
            `INSERT INTO admin_audit_log (id, action, target_type, target_id, details_json, performed_at)
             VALUES (?, ?, ?, ?, ?, ?)`
        ).run(id, action, targetType, targetId, details ? JSON.stringify(details) : null, new Date().toISOString());
        return this.getById(id);
    }

    async getById(id) {
        return (await this._db.prepare('SELECT * FROM admin_audit_log WHERE id = ?').get(id)) || null;
    }

    async listForTarget(targetType, targetId) {
        return this._db.prepare(
            'SELECT * FROM admin_audit_log WHERE target_type = ? AND target_id = ? ORDER BY performed_at ASC'
        ).all(targetType, targetId);
    }
}

module.exports = { AuditLogRepository };
