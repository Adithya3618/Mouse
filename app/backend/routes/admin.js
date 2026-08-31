// /api/admin/* - the research/admin dashboard's API. Every route here is
// gated by adminAuth.js (mounted by server.js) - this file assumes that has
// already run. Participants are identified by participant code/id only,
// never a real name (none is collected).
//
// Every handler is async and awaits its repository/service calls - see
// repositories/participantRepository.js's header comment for why the whole
// data-access layer is async. Routes never execute SQL directly (see
// tests/backend/noRawSqlOutsideRepositories.test.mjs) - the audit log for
// the delete/restore routes goes through auditLogRepository, same as every
// other table.

const express = require('express');
const fs = require('node:fs');

// Aliases so ?sort=accuracy/sessions/errors reads naturally from the admin
// UI without adminQueryService.js needing to know about API-facing names.
const SORT_ALIASES = {
    accuracy: 'overallAccuracy',
    sessions: 'sessionCount',
    errors: 'incorrectResponses',
    responses: 'totalResponses',
    participant: 'participantCode'
};

function createAdminRouter({ adminQueryService, recordingRepository, phaseRepository, audioStorage, speechProcessingService, participantRepository, auditLogRepository }) {
    const router = express.Router();

    router.get('/participants', async (req, res) => {
        try {
            const { search, status, needsReview, minAccuracy, sort, sortDir } = req.query;
            const participants = await adminQueryService.listParticipants({
                search,
                status,
                needsReview: needsReview === 'true',
                minAccuracy: minAccuracy !== undefined ? Number(minAccuracy) : undefined,
                sort: SORT_ALIASES[sort] || sort || 'participantCode',
                sortDir
            });
            res.json({ participants });
        } catch (error) {
            res.status(500).json({ error: `Failed to list participants: ${error.message}` });
        }
    });

    router.get('/participants/:id', async (req, res) => {
        try {
            const profile = await adminQueryService.getParticipantProfile(req.params.id);
            if (!profile) {
                res.status(404).json({ error: 'Participant not found.' });
                return;
            }
            res.json(profile);
        } catch (error) {
            res.status(500).json({ error: `Failed to load participant: ${error.message}` });
        }
    });

    // Deletes research data ONLY through this explicit, authenticated
    // (adminAuth, mounted above this router) route - never as a side effect
    // of startup, restart, deployment, or any other code path. This is a
    // SOFT delete (participants.deleted_at is set) - the row and every
    // linked session/phase/recording/transcription/response stays on disk
    // untouched and is fully recoverable via the /restore route below; see
    // repositories/participantRepository.js#softDelete. Requires the
    // caller to echo back the participant's own code as explicit
    // confirmation of exactly what is being deleted (never just an id),
    // and every deletion is written to admin_audit_log before responding.
    //
    // Not wrapped in an explicit database transaction: true multi-statement
    // transactions need a single checked-out connection, which doesn't fit
    // a connection-pooled Postgres deployment behind the same simple
    // prepare()/exec() shape used everywhere else. The two writes below are
    // sequential instead - the worst case of an interruption between them
    // is a soft-delete with a missing audit-log line (never lost research
    // data, since nothing is ever hard-deleted).
    router.post('/participants/:id/delete', async (req, res) => {
        try {
            const participant = await participantRepository.getById(req.params.id);
            if (!participant) {
                res.status(404).json({ error: 'Participant not found.' });
                return;
            }
            const confirm = (req.body || {}).confirm;
            if (confirm !== participant.participant_code) {
                res.status(400).json({
                    error: 'Confirmation did not match. To delete this participant, resend with { "confirm": "<exact participant code>" }.',
                    participantCode: participant.participant_code
                });
                return;
            }

            const updated = await participantRepository.softDelete(participant.id);
            await auditLogRepository.insert({
                action: 'participant_soft_delete',
                targetType: 'participant',
                targetId: participant.id,
                details: { participantCode: participant.participant_code }
            });
            res.json({ participantId: updated.id, participantCode: updated.participant_code, deletedAt: updated.deleted_at });
        } catch (error) {
            res.status(500).json({ error: `Deletion failed: ${error.message}` });
        }
    });

    // Reverses an accidental/mistaken soft delete - deliberately provided
    // since soft-delete without a restore path would make a mis-click as
    // unrecoverable as a hard delete. Also authenticated + audit-logged.
    router.post('/participants/:id/restore', async (req, res) => {
        try {
            const participant = await participantRepository.getById(req.params.id);
            if (!participant) {
                res.status(404).json({ error: 'Participant not found.' });
                return;
            }
            const restored = await participantRepository.restore(participant.id);
            await auditLogRepository.insert({
                action: 'participant_restore',
                targetType: 'participant',
                targetId: participant.id,
                details: { participantCode: participant.participant_code }
            });
            res.json({ participantId: restored.id, participantCode: restored.participant_code, deletedAt: restored.deleted_at });
        } catch (error) {
            res.status(500).json({ error: `Restore failed: ${error.message}` });
        }
    });

    router.get('/sessions/:id', async (req, res) => {
        try {
            const detail = await adminQueryService.getSessionDetail(req.params.id);
            if (!detail) {
                res.status(404).json({ error: 'Session not found.' });
                return;
            }
            res.json(detail);
        } catch (error) {
            res.status(500).json({ error: `Failed to load session: ${error.message}` });
        }
    });

    // Streams the original audio file, with HTTP Range support so the
    // <audio> player (session detail page) can seek. Never served as a
    // plain static file - this route is the only way audio bytes leave the
    // server, and it's gated by adminAuth like everything else here.
    router.get('/recordings/:id/audio', async (req, res) => {
        try {
            const recording = await recordingRepository.getById(req.params.id);
            if (!recording || !(await audioStorage.exists(recording.storage_path))) {
                res.status(404).json({ error: 'Recording not found.' });
                return;
            }

            const range = req.headers.range;
            res.setHeader('Content-Type', recording.mime_type || 'audio/webm');
            res.setHeader('Accept-Ranges', 'bytes');

            // LocalAudioStorage exposes a real filesystem path it can be
            // streamed from directly; a future object-storage-backed
            // AudioStorage won't (there is no local file), so it exposes a
            // readStream(key, {start,end}) method instead - whichever the
            // active implementation provides is used, so this route works
            // unchanged against either.
            if (typeof audioStorage.resolveAbsolutePath === 'function') {
                const absolutePath = audioStorage.resolveAbsolutePath(recording.storage_path);
                const stat = await audioStorage.stat(recording.storage_path);
                if (!range) {
                    res.setHeader('Content-Length', stat.size);
                    fs.createReadStream(absolutePath).pipe(res);
                    return;
                }
                const match = /bytes=(\d*)-(\d*)/.exec(range);
                const start = match && match[1] ? Number(match[1]) : 0;
                const end = match && match[2] ? Number(match[2]) : stat.size - 1;
                res.status(206);
                res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
                res.setHeader('Content-Length', end - start + 1);
                fs.createReadStream(absolutePath, { start, end }).pipe(res);
                return;
            }

            const stat = await audioStorage.stat(recording.storage_path);
            if (!range) {
                res.setHeader('Content-Length', stat.size);
                (await audioStorage.readStream(recording.storage_path)).pipe(res);
                return;
            }
            const match = /bytes=(\d*)-(\d*)/.exec(range);
            const start = match && match[1] ? Number(match[1]) : 0;
            const end = match && match[2] ? Number(match[2]) : stat.size - 1;
            res.status(206);
            res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
            res.setHeader('Content-Length', end - start + 1);
            (await audioStorage.readStream(recording.storage_path, { start, end })).pipe(res);
        } catch (error) {
            res.status(500).json({ error: `Failed to stream audio: ${error.message}` });
        }
    });

    // Explicit reprocess: re-transcribes the SAME, untouched original audio
    // file and re-parses/re-scores it, creating a new transcription version
    // + processing run + response rows. Never modifies the audio file or
    // any prior version's rows - see speechProcessingService.js.
    router.post('/recordings/:id/reprocess', async (req, res) => {
        try {
            const recording = await recordingRepository.getById(req.params.id);
            if (!recording) {
                res.status(404).json({ error: 'Recording not found.' });
                return;
            }
            const phase = await phaseRepository.getById(recording.phase_id);
            if (!phase) {
                res.status(404).json({ error: 'Phase not found for this recording.' });
                return;
            }

            const result = await speechProcessingService.process({
                recordingId: recording.id,
                phase,
                scoringOptions: {
                    scoringMode: phase.scoring_mode || 'adaptive',
                    expectedResponseDigits: phase.expected_response_digits || 3
                }
            });

            res.json({
                recordingId: recording.id,
                status: result.status,
                error: result.error || null,
                transcriptionVersion: result.transcription ? result.transcription.version : null,
                results: result.results
            });
        } catch (error) {
            res.status(500).json({ error: `Reprocessing failed: ${error.message}` });
        }
    });

    return router;
}

module.exports = { createAdminRouter, SORT_ALIASES };
