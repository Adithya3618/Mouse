// Read-side composition for the admin/research dashboard - joins across
// participants/sessions/phases/recordings/transcriptions/responses (always
// the LATEST transcription/processing_run per recording, i.e. the current
// version) into the shapes routes/admin.js serves directly. Deliberately
// plain JS composition over the single-table repositories rather than one
// large SQL join, at this application's expected scale (a research study,
// not a high-volume production system) - keeps each query auditable and
// keeps the repository layer swappable (see repositories/*.js) without this
// file's logic needing to change.

// A session is expected to produce a recording for each of these 6
// cognitive-active phases (see config/experimentConfig.js#subtractionValues
// and experiment/phases.js) - used only to decide session completion
// status for the dashboard, never to alter scoring.
const EXPECTED_PHASE_COUNT = 6;

class AdminQueryService {
    constructor({ participantRepository, sessionRepository, phaseRepository, recordingRepository, transcriptionRepository, responseRepository }) {
        this._participants = participantRepository;
        this._sessions = sessionRepository;
        this._phases = phaseRepository;
        this._recordings = recordingRepository;
        this._transcriptions = transcriptionRepository;
        this._responses = responseRepository;
    }

    listParticipants({ search, status, needsReview, minAccuracy, sort = 'participantCode', sortDir = 'asc' } = {}) {
        let summaries = this._participants.list().map((p) => this._buildParticipantSummary(p));

        if (search) {
            const query = search.trim().toLowerCase();
            summaries = summaries.filter((p) => p.participantCode.toLowerCase().includes(query));
        }
        if (status) {
            summaries = summaries.filter((p) => p.completionStatus === status);
        }
        if (needsReview === true || needsReview === 'true') {
            summaries = summaries.filter((p) => p.needsReview);
        }
        if (minAccuracy != null && minAccuracy !== '') {
            const threshold = Number(minAccuracy);
            summaries = summaries.filter((p) => p.overallAccuracy >= threshold);
        }

        const dir = sortDir === 'desc' ? -1 : 1;
        summaries.sort((a, b) => {
            const av = a[sort];
            const bv = b[sort];
            if (typeof av === 'string') {
                return av.localeCompare(bv) * dir;
            }
            return ((av ?? 0) - (bv ?? 0)) * dir;
        });

        return summaries;
    }

    getParticipantProfile(participantId) {
        const participant = this._participants.getById(participantId);
        if (!participant) {
            return null;
        }
        return this._buildParticipantSummary(participant);
    }

    getSessionDetail(sessionId) {
        const session = this._sessions.getById(sessionId);
        if (!session) {
            return null;
        }
        const participant = this._participants.getById(session.participant_id);
        const phaseDetails = this._phases.listForSession(sessionId).map((phase) => this._buildPhaseDetail(phase));

        const totals = summarizeResponses(phaseDetails.flatMap((p) => p.responses));
        return {
            sessionId: session.id,
            participantId: participant ? participant.id : null,
            participantCode: participant ? participant.participant_code : null,
            experimentId: session.experiment_id,
            sessionDate: session.session_date,
            startTime: session.start_time,
            endTime: session.end_time,
            completionStatus: phaseDetails.length >= EXPECTED_PHASE_COUNT && phaseDetails.every((p) => p.transcriptionStatus === 'succeeded')
                ? 'Complete'
                : 'Incomplete',
            phases: phaseDetails,
            ...totals
        };
    }

    _buildParticipantSummary(participant) {
        const sessions = this._sessions.listForParticipant(participant.id).map((session) => this._buildSessionSummary(session));
        const totals = summarizeResponses(sessions.flatMap((s) => s.responses));
        const completionStatus = sessions.length === 0
            ? 'No sessions'
            : (sessions.every((s) => s.completionStatus === 'Complete') ? 'Complete' : 'Incomplete');

        return {
            participantId: participant.id,
            participantCode: participant.participant_code,
            sessionCount: sessions.length,
            completionStatus,
            needsReview: sessions.some((s) => s.needsReview),
            sessions: sessions.map(({ responses, ...rest }) => rest), // response rows omitted from the list view - fetched via session detail
            ...totals
        };
    }

    _buildSessionSummary(session) {
        const phaseDetails = this._phases.listForSession(session.id).map((phase) => this._buildPhaseDetail(phase));
        const totals = summarizeResponses(phaseDetails.flatMap((p) => p.responses));
        const complete = phaseDetails.length >= EXPECTED_PHASE_COUNT && phaseDetails.every((p) => p.transcriptionStatus === 'succeeded');

        return {
            sessionId: session.id,
            experimentId: session.experiment_id,
            sessionDate: session.session_date,
            startTime: session.start_time,
            endTime: session.end_time,
            subtractionRules: [...new Set(phaseDetails.map((p) => p.subtractionValue).filter((v) => v != null))],
            completionStatus: complete ? 'Complete' : 'Incomplete',
            needsReview: phaseDetails.some((p) => p.transcriptionStatus === 'failed' || p.unresolvedResponses > 0),
            responses: phaseDetails.flatMap((p) => p.responses),
            ...totals
        };
    }

    _buildPhaseDetail(phase) {
        const recording = this._recordings.getLatestForPhase(phase.id);
        const transcriptions = recording ? this._transcriptions.listForRecording(recording.id) : [];
        const latestTranscription = transcriptions.length > 0 ? transcriptions[transcriptions.length - 1] : null;
        const processingRuns = latestTranscription
            ? this._responses.listProcessingRunsForTranscription(latestTranscription.id)
            : [];
        const latestRun = processingRuns.length > 0 ? processingRuns[processingRuns.length - 1] : null;
        const responses = latestRun ? this._responses.listResponsesForRun(latestRun.id) : [];
        const totals = summarizeResponses(responses);

        return {
            phaseRecordId: phase.id,
            phaseId: phase.phase_id,
            phaseType: phase.phase_type,
            subtractionValue: phase.subtraction_value,
            startingNumber: phase.starting_number,
            duration: phase.duration,
            startedAt: phase.started_at,
            endedAt: phase.ended_at,
            recording: recording ? { recordingId: recording.id, mimeType: recording.mime_type, durationSeconds: recording.duration_seconds } : null,
            transcriptionStatus: latestTranscription ? latestTranscription.status : 'pending',
            transcriptionVersion: latestTranscription ? latestTranscription.version : null,
            transcriptionVersionCount: transcriptions.length,
            rawTranscript: latestTranscription ? latestTranscription.raw_text : null,
            transcriptionError: latestTranscription ? latestTranscription.error_message : null,
            processingRunId: latestRun ? latestRun.id : null,
            responses,
            ...totals
        };
    }
}

function summarizeResponses(responses) {
    const correct = responses.filter((r) => r.correctness === 'correct').length;
    const incorrect = responses.filter((r) => r.correctness === 'incorrect').length;
    const unresolvedResponses = responses.filter((r) => r.correctness === 'unresolved').length;
    const scored = correct + incorrect;
    return {
        totalResponses: responses.length,
        correctResponses: correct,
        incorrectResponses: incorrect,
        unresolvedResponses,
        // "accuracy = (correct responses / valid responses) * 100" - valid
        // (scored) responses exclude unresolved ones from the denominator,
        // per spec section 16. Sequence deviations = incorrect responses
        // (never the reference-number change itself - see section 15).
        overallAccuracy: scored > 0 ? Number(((correct / scored) * 100).toFixed(2)) : 0,
        sequenceDeviations: incorrect
    };
}

module.exports = { AdminQueryService, EXPECTED_PHASE_COUNT };
