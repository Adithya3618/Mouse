// Genuine, irreversible hard deletion of a participant and every row that
// hangs off them (sessions -> phases -> recordings -> transcriptions ->
// processing_runs -> responses), plus the participant row itself. This is
// the ONE deliberate exception to every other repository's "nothing is ever
// hard-deleted" rule (see schema.sql's own header comment, and
// participantRepository.js's softDelete()/restore(), which remain the
// normal, reversible admin action) - only ever called from the explicit,
// authenticated, confirmation-gated admin route (routes/admin.js), never
// from any other code path.
//
// Deletion order matters: children are removed before their parents so a
// crash/interruption mid-way never leaves a row pointing at something that
// no longer exists. Audio FILES are deliberately not touched here - this
// repository only ever talks to the database (see
// tests/backend/noRawSqlOutsideRepositories.test.mjs); the caller
// (routes/admin.js) deletes the actual files via audioStorage AFTER this
// resolves, using the storagePaths this method returns, so a file-deletion
// failure can never roll back research-data rows that have already been
// correctly removed.
//
// Wrapped in one BEGIN/COMMIT/ROLLBACK transaction, same as
// database/researchDatabase.js#applySchema - this gives true all-or-nothing
// atomicity against the SQLite implementation this app actually runs on.
// The same caveat already documented on the existing soft-delete route
// applies if this database is ever swapped for a connection-pooled Postgres
// deployment: a multi-statement transaction needs one held connection,
// which this simple prepare()/exec() contract doesn't guarantee across
// calls in that case. "Transactional/atomic where possible" is honored as
// specified; nothing here silently pretends otherwise.
//
// Async throughout - see participantRepository.js's header comment for why.

class ParticipantDeletionRepository {
    constructor(db) {
        this._db = db;
    }

    // Returns { participantId, participantCode, storagePaths, counts } on
    // success - storagePaths is every recording's storage_path that
    // existed for this participant (for the caller to delete from
    // audioStorage), counts is a per-table row count for the audit log.
    // Throws (after rolling back) if the participant doesn't exist or any
    // step fails - no partial deletion is ever left committed.
    async hardDeleteParticipant(participantId) {
        const participant = await this._db.prepare('SELECT * FROM participants WHERE id = ?').get(participantId);
        if (!participant) {
            throw new Error(`Participant ${participantId} not found.`);
        }

        const sessions = await this._db.prepare('SELECT * FROM sessions WHERE participant_id = ?').all(participantId);
        const storagePaths = [];
        const counts = { sessions: 0, phases: 0, recordings: 0, transcriptions: 0, processingRuns: 0, responses: 0 };

        await this._db.exec('BEGIN;');
        try {
            for (const session of sessions) {
                const phases = await this._db.prepare('SELECT * FROM phases WHERE session_id = ?').all(session.id);
                for (const phase of phases) {
                    const recordings = await this._db.prepare('SELECT * FROM recordings WHERE phase_id = ?').all(phase.id);
                    for (const recording of recordings) {
                        storagePaths.push(recording.storage_path);

                        const transcriptions = await this._db.prepare('SELECT * FROM transcriptions WHERE recording_id = ?').all(recording.id);
                        for (const transcription of transcriptions) {
                            const runs = await this._db.prepare('SELECT * FROM processing_runs WHERE transcription_id = ?').all(transcription.id);
                            for (const run of runs) {
                                const responseCount = await this._db.prepare('SELECT COUNT(*) AS c FROM responses WHERE processing_run_id = ?').get(run.id);
                                counts.responses += responseCount.c;
                                await this._db.prepare('DELETE FROM responses WHERE processing_run_id = ?').run(run.id);
                            }
                            counts.processingRuns += runs.length;
                            await this._db.prepare('DELETE FROM processing_runs WHERE transcription_id = ?').run(transcription.id);
                        }
                        counts.transcriptions += transcriptions.length;
                        await this._db.prepare('DELETE FROM transcriptions WHERE recording_id = ?').run(recording.id);
                    }
                    counts.recordings += recordings.length;
                    await this._db.prepare('DELETE FROM recordings WHERE phase_id = ?').run(phase.id);
                }
                counts.phases += phases.length;
                await this._db.prepare('DELETE FROM phases WHERE session_id = ?').run(session.id);
            }
            counts.sessions = sessions.length;
            await this._db.prepare('DELETE FROM sessions WHERE participant_id = ?').run(participantId);
            await this._db.prepare('DELETE FROM participants WHERE id = ?').run(participantId);

            await this._db.exec('COMMIT;');
        } catch (error) {
            await this._db.exec('ROLLBACK;');
            throw error;
        }

        return {
            participantId: participant.id,
            participantCode: participant.participant_code,
            storagePaths,
            counts
        };
    }
}

module.exports = { ParticipantDeletionRepository };
