// POST /api/recordings - the one upload endpoint the participant-facing app
// calls once per finished cognitive-speech phase (see
// app/frontend/js/data/recordingUploadService.js). Creates/looks-up the
// participant/session/phase rows, stores the audio unchanged, and runs the
// full transcribe -> parse -> score pipeline synchronously within this
// request (there is no background-worker infrastructure to hand it off to -
// see app/backend/server.js), returning the finished results. The caller
// (cognitiveAudioSession.js) does NOT await this before the experiment
// advances to the next phase - see experiment/experimentController.js.

const express = require('express');
const multer = require('multer');

// A 2-minute audio/webm;codecs=opus recording is typically well under 2MB;
// 50MB is a generous ceiling against abuse/misconfiguration, not a tuned limit.
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_AUDIO_BYTES } });

function createRecordingsRouter({ participantRepository, sessionRepository, phaseRepository, recordingRepository, audioStorage, speechProcessingService, logger = console.error }) {
    const router = express.Router();

    router.post('/api/recordings', upload.single('audio'), async (req, res) => {
        try {
            const body = req.body || {};
            const { participantCode, sessionId, phaseId } = body;

            if (!req.file || !participantCode || !sessionId || !phaseId) {
                res.status(400).json({ error: 'Missing required fields: audio file, participantCode, sessionId, phaseId.' });
                return;
            }

            const subtractionValue = numberOrNull(body.subtractionValue);
            const startingNumber = numberOrNull(body.startingNumber);
            const duration = numberOrNull(body.duration);
            const expectedResponseDigits = numberOrNull(body.expectedResponseDigits);
            const scoringMode = body.scoringMode || null;

            const participant = participantRepository.upsertByCode(participantCode);
            const session = sessionRepository.upsertById({
                sessionId,
                participantId: participant.id,
                experimentId: body.experimentId || null,
                sessionDate: body.sessionDate || null,
                startTime: body.sessionStartTime || null
            });
            const phase = phaseRepository.upsert({
                sessionId: session.id,
                phaseId,
                phaseType: body.phaseType || null,
                subtractionValue,
                startingNumber,
                duration,
                startedAt: body.startedAt || null,
                scoringMode,
                expectedResponseDigits
            });
            if (body.endedAt) {
                phaseRepository.markEnded(phase.id, body.endedAt);
            }

            const extension = extensionForMime(req.file.mimetype);
            const storagePath = await audioStorage.save({
                sessionId: session.id,
                phaseRecordId: phase.id,
                buffer: req.file.buffer,
                extension
            });
            const recording = recordingRepository.insert({
                phaseId: phase.id,
                storagePath,
                mimeType: req.file.mimetype || 'audio/webm',
                durationSeconds: duration,
                fileSizeBytes: req.file.size
            });

            const result = await speechProcessingService.process({
                recordingId: recording.id,
                phase,
                scoringOptions: {
                    scoringMode: scoringMode || 'adaptive',
                    expectedResponseDigits: expectedResponseDigits || 3
                }
            });

            res.json({
                recordingId: recording.id,
                phaseRecordId: phase.id,
                status: result.status,
                error: result.error || null,
                results: result.results
            });
        } catch (error) {
            logger(`[recordings] upload/processing failed: ${error.message}`);
            res.status(500).json({ error: 'Failed to store/process the recording.' });
        }
    });

    return router;
}

function numberOrNull(value) {
    if (value == null || value === '') {
        return null;
    }
    const num = Number(value);
    return Number.isNaN(num) ? null : num;
}

function extensionForMime(mimeType) {
    if (!mimeType) {
        return 'webm';
    }
    if (mimeType.includes('mp4')) {
        return 'mp4';
    }
    if (mimeType.includes('ogg')) {
        return 'ogg';
    }
    return 'webm';
}

module.exports = { createRecordingsRouter };
