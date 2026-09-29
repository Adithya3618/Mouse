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
    participant: 'participantCode',
    date: 'latestSessionAt',
    time: 'latestSessionAt',
    status: 'completionStatus'
};

// Server-side pagination for /participants - listParticipants() already
// does the real work (filter/sort over every participant); this just
// slices the result before it goes over the wire, so "do not load
// thousands of records into the browser" holds even though the query
// itself still has to look at every participant to filter/sort correctly
// (the same tradeoff adminQueryService.js's own header comment already
// makes, at this application's research-study scale). Defaults to a page
// size large enough that no existing caller needs to pass page/pageSize at
// all to see every participant in a normal-sized study.
const DEFAULT_PAGE_SIZE = 20;

// Shared between GET /participants and GET /participants/export so both
// read the exact same filters out of the query string - the export can
// never drift from what the currently-filtered table is showing.
function parseParticipantFilters(query) {
    const { search, status, needsReview, minAccuracy, fromDate, toDate, sort, sortDir } = query;
    return {
        search,
        status,
        needsReview: needsReview === 'true',
        minAccuracy: minAccuracy !== undefined ? Number(minAccuracy) : undefined,
        fromDate,
        toDate,
        sort: SORT_ALIASES[sort] || sort || 'participantCode',
        sortDir
    };
}

// KPI cards on the Participants page - plain aggregates over exactly the
// (already-filtered) summaries the table itself renders, nothing recomputed
// from a separate source. "Average accuracy" only counts participants who
// have at least one session, same as a single participant's own
// overallAccuracy already excludes phases with no scored responses.
function computeStats(summaries) {
    const withSessions = summaries.filter((p) => p.sessionCount > 0);
    const averageAccuracy = withSessions.length > 0
        ? Number((withSessions.reduce((sum, p) => sum + p.overallAccuracy, 0) / withSessions.length).toFixed(1))
        : 0;
    return {
        totalParticipants: summaries.length,
        totalSessions: summaries.reduce((sum, p) => sum + p.sessionCount, 0),
        averageAccuracy,
        pendingReview: summaries.filter((p) => p.needsReview).length
    };
}

function csvField(value) {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toParticipantsCsv(participants) {
    const header = ['Participant ID', 'Sessions', 'Accuracy (%)', 'Total Responses', 'Incorrect', 'Latest Session (UTC)', 'Status', 'Needs Review'];
    const rows = participants.map((p) => [
        p.participantCode,
        p.sessionCount,
        p.overallAccuracy,
        p.totalResponses,
        p.incorrectResponses,
        p.latestSessionAt || '',
        p.completionStatus,
        p.needsReview ? 'Yes' : 'No'
    ]);
    return [header, ...rows].map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n';
}

function createAdminRouter({ adminQueryService, recordingRepository, phaseRepository, audioStorage, speechProcessingService, participantRepository, auditLogRepository, participantDeletionRepository }) {
    const router = express.Router();

    router.get('/participants', async (req, res) => {
        try {
            const allParticipants = await adminQueryService.listParticipants(parseParticipantFilters(req.query));

            const total = allParticipants.length;
            const resolvedPageSize = Math.max(1, Number(req.query.pageSize) || DEFAULT_PAGE_SIZE);
            const totalPages = Math.max(1, Math.ceil(total / resolvedPageSize));
            const resolvedPage = Math.min(Math.max(1, Number(req.query.page) || 1), totalPages);
            const start = (resolvedPage - 1) * resolvedPageSize;
            const participants = allParticipants.slice(start, start + resolvedPageSize);

            res.json({ participants, total, page: resolvedPage, pageSize: resolvedPageSize, totalPages, stats: computeStats(allParticipants) });
        } catch (error) {
            res.status(500).json({ error: `Failed to list participants: ${error.message}` });
        }
    });

    // Adds a participant record the same way the intake screen's first
    // session for a code does (see repositories/participantRepository.js#
    // upsertByCode) - the only field a participant row ever has beyond its
    // id/timestamps is the participant code itself (no name, no other
    // intake fields are collected or stored), so that's the only thing this
    // route accepts. Rejects a code that already exists rather than
    // silently reusing it, since "Add Participant" from an admin is a
    // deliberate create, not the intake flow's idempotent upsert-on-session.
    router.post('/participants', async (req, res) => {
        try {
            const participantCode = String((req.body || {}).participantCode || '').trim();
            if (!participantCode) {
                res.status(400).json({ error: 'participantCode is required.' });
                return;
            }
            const existing = await participantRepository.getByCode(participantCode);
            if (existing && !existing.deleted_at) {
                res.status(409).json({ error: `Participant ${participantCode} already exists.` });
                return;
            }
            // A soft-deleted participant with this exact code already has a
            // row (see participantRepository.js#getByCode, which doesn't
            // filter deleted_at) - restore it rather than upsert, which
            // would otherwise hand back that same still-deleted row.
            const participant = existing
                ? await participantRepository.restore(existing.id)
                : await participantRepository.upsertByCode(participantCode);
            await auditLogRepository.insert({
                action: 'participant_create',
                targetType: 'participant',
                targetId: participant.id,
                details: { participantCode: participant.participant_code, restoredFromSoftDelete: Boolean(existing) }
            });
            res.status(201).json({ participantId: participant.id, participantCode: participant.participant_code });
        } catch (error) {
            res.status(500).json({ error: `Failed to create participant: ${error.message}` });
        }
    });

    // CSV export of exactly the rows the Participants table can show -
    // same adminQueryService.listParticipants() call as the list route
    // above, same filters, just unpaginated and serialized as CSV instead
    // of JSON. No external export/reporting service involved: the file is
    // built in memory from already-queried research data and streamed
    // straight back in the response.
    router.get('/participants/export', async (req, res) => {
        try {
            const participants = await adminQueryService.listParticipants(parseParticipantFilters(req.query));
            const csv = toParticipantsCsv(participants);
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename="participants-export.csv"');
            res.send(csv);
        } catch (error) {
            res.status(500).json({ error: `Failed to export participants: ${error.message}` });
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

    // GENUINE, IRREVERSIBLE hard deletion of a participant and every row
    // that hangs off them (sessions/phases/recordings/transcriptions/
    // processing_runs/responses), plus their audio files - a deliberate
    // exception to the soft-delete-only /:id/delete route above (see
    // repositories/participantDeletionRepository.js's own header for why
    // this is a separate, distinctly-named route rather than a mode on the
    // existing one: they have fundamentally different safety properties and
    // must never be confused with each other). Same confirmation
    // convention as the soft-delete route (the caller must echo back the
    // participant's own code), and every attempt is audit-logged.
    //
    // Order of operations matters for safety: the database rows are
    // deleted first, inside one transaction (see
    // participantDeletionRepository.js) - if that fails, it rolls back and
    // NOTHING is touched, including audio files, so this route never
    // deletes a file while leaving the database row that pointed at it, or
    // vice versa in a way that would matter (the reverse - DB rows gone,
    // a file still on disk - is an orphaned file with no work to reference
    // it, not a broken/dangling reference). Audio file deletion happens
    // only after that transaction has already committed, and is
    // best-effort per file: a file that fails to delete is reported back
    // as a warning, never re-throws to make the response look like the
    // (already-successful, already-committed) database deletion failed.
    router.post('/participants/:id/hard-delete', async (req, res) => {
        try {
            const participant = await participantRepository.getById(req.params.id);
            if (!participant) {
                res.status(404).json({ error: 'Participant not found.' });
                return;
            }
            const confirm = (req.body || {}).confirm;
            if (confirm !== participant.participant_code) {
                res.status(400).json({
                    error: 'Confirmation did not match. To permanently delete this participant and all associated research data, resend with { "confirm": "<exact participant code>" }.',
                    participantCode: participant.participant_code
                });
                return;
            }

            const result = await participantDeletionRepository.hardDeleteParticipant(participant.id);

            const fileWarnings = [];
            for (const storagePath of result.storagePaths) {
                try {
                    const outcome = await audioStorage.delete(storagePath);
                    if (outcome && Array.isArray(outcome.errors) && outcome.errors.length > 0) {
                        fileWarnings.push(`${storagePath}: ${outcome.errors.join('; ')}`);
                    }
                } catch (error) {
                    fileWarnings.push(`${storagePath}: ${error.message}`);
                }
            }

            await auditLogRepository.insert({
                action: 'participant_hard_delete',
                targetType: 'participant',
                targetId: result.participantId,
                details: { participantCode: result.participantCode, counts: result.counts, fileWarnings }
            });

            res.json({
                participantId: result.participantId,
                participantCode: result.participantCode,
                counts: result.counts,
                filesDeleted: result.storagePaths.length - fileWarnings.length,
                fileWarnings
            });
        } catch (error) {
            res.status(500).json({ error: `Deletion failed: ${error.message}` });
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

    // One mouse-active phase's complete stored history: summary, every
    // click event, every target. 404 when that phase was never persisted
    // (e.g. sessions recorded before click-level capture existed).
    router.get('/sessions/:id/mouse/:phaseId', async (req, res) => {
        try {
            const detail = await adminQueryService.getMousePhaseDetail(req.params.id, req.params.phaseId);
            if (!detail) {
                res.status(404).json({ error: 'No mouse click data is stored for this phase.' });
                return;
            }
            res.json(detail);
        } catch (error) {
            res.status(500).json({ error: `Failed to load mouse data: ${error.message}` });
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
