// /api/admin/* - the research/admin dashboard's API. Every route here is
// gated by adminAuth.js (mounted by server.js) - this file assumes that has
// already run. Participants are identified by participant code/id only,
// never a real name (none is collected).

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

function createAdminRouter({ adminQueryService, recordingRepository, phaseRepository, audioStorage, speechProcessingService }) {
    const router = express.Router();

    router.get('/participants', (req, res) => {
        const { search, status, needsReview, minAccuracy, sort, sortDir } = req.query;
        const participants = adminQueryService.listParticipants({
            search,
            status,
            needsReview: needsReview === 'true',
            minAccuracy: minAccuracy !== undefined ? Number(minAccuracy) : undefined,
            sort: SORT_ALIASES[sort] || sort || 'participantCode',
            sortDir
        });
        res.json({ participants });
    });

    router.get('/participants/:id', (req, res) => {
        const profile = adminQueryService.getParticipantProfile(req.params.id);
        if (!profile) {
            res.status(404).json({ error: 'Participant not found.' });
            return;
        }
        res.json(profile);
    });

    router.get('/sessions/:id', (req, res) => {
        const detail = adminQueryService.getSessionDetail(req.params.id);
        if (!detail) {
            res.status(404).json({ error: 'Session not found.' });
            return;
        }
        res.json(detail);
    });

    // Streams the original audio file, with HTTP Range support so the
    // <audio> player (session detail page) can seek. Never served as a
    // plain static file - this route is the only way audio bytes leave the
    // server, and it's gated by adminAuth like everything else here.
    router.get('/recordings/:id/audio', (req, res) => {
        const recording = recordingRepository.getById(req.params.id);
        if (!recording || !audioStorage.exists(recording.storage_path)) {
            res.status(404).json({ error: 'Recording not found.' });
            return;
        }

        const absolutePath = audioStorage.resolveAbsolutePath(recording.storage_path);
        const stat = audioStorage.stat(recording.storage_path);
        const range = req.headers.range;

        res.setHeader('Content-Type', recording.mime_type || 'audio/webm');
        res.setHeader('Accept-Ranges', 'bytes');

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
    });

    // Explicit reprocess: re-transcribes the SAME, untouched original audio
    // file and re-parses/re-scores it, creating a new transcription version
    // + processing run + response rows. Never modifies the audio file or
    // any prior version's rows - see speechProcessingService.js.
    router.post('/recordings/:id/reprocess', async (req, res) => {
        const recording = recordingRepository.getById(req.params.id);
        if (!recording) {
            res.status(404).json({ error: 'Recording not found.' });
            return;
        }
        const phase = phaseRepository.getById(recording.phase_id);
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
    });

    return router;
}

module.exports = { createAdminRouter, SORT_ALIASES };
