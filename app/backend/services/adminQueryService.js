// Read-side composition for the admin/research dashboard - joins across
// participants/sessions/phases/recordings/transcriptions/responses (always
// the LATEST transcription/processing_run per recording, i.e. the current
// version) into the shapes routes/admin.js serves directly. Deliberately
// plain JS composition over the single-table repositories rather than one
// large SQL join, at this application's expected scale (a research study,
// not a high-volume production system) - keeps each query auditable and
// keeps the repository layer swappable (see repositories/*.js) without this
// file's logic needing to change.
//
// Every method here is async, and every fan-out over a list of child
// records uses Promise.all(...map(async ...)) rather than a plain
// synchronous .map() - the repositories underneath are async now (see
// repositories/participantRepository.js's header comment for why: a real
// networked database can only ever be queried asynchronously), so composing
// them requires awaiting each one. Against SQLiteResearchDatabase this
// still runs in the same order, on the same data, with no synchronous
// section fewer since node:sqlite is single-threaded/blocking underneath
// regardless.

// A session is expected to produce a recording for each of these 6
// cognitive-active phases (see config/experimentConfig.js#subtractionValues
// and experiment/phases.js) - used only to decide session completion
// status for the dashboard, never to alter scoring.
const EXPECTED_PHASE_COUNT = 6;

// Dual-task counting-sequence continuity (see
// frontend/js/cognitive/dualTaskContinuity.js's own header for the full
// reasoning): each session's count-back-only and count-back-and-clicking
// phases were scored independently, against the series' own shared
// starting_number, at recording-processing time - unavoidably, since the
// two phases' recordings can finish transcribing in either order (a real
// race, not resolvable synchronously without delaying live phase
// advancement). This module is applied here, read-time, to re-derive the
// dual-task phase's display-only responses anchored to its sibling
// count-only phase's actual last valid spoken number instead - never
// written back to the database, so the stored rows this file's own
// repositories return are never touched or duplicated.
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const DUAL_TASK_CONTINUITY_URL = pathToFileURL(
    path.join(__dirname, '../../frontend/js/cognitive/dualTaskContinuity.js')
).href;

class AdminQueryService {
    constructor({ participantRepository, sessionRepository, phaseRepository, recordingRepository, transcriptionRepository, responseRepository }) {
        this._participants = participantRepository;
        this._sessions = sessionRepository;
        this._phases = phaseRepository;
        this._recordings = recordingRepository;
        this._transcriptions = transcriptionRepository;
        this._responses = responseRepository;
    }

    async listParticipants({ search, status, needsReview, minAccuracy, fromDate, toDate, sort = 'participantCode', sortDir = 'asc' } = {}) {
        const participants = await this._participants.list();
        let summaries = await Promise.all(participants.map((p) => this._buildParticipantSummary(p)));

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
        // Compares against the same stored latestSessionAt the Date/Time
        // columns render (see _buildParticipantSummary below) - a
        // participant with no sessions (latestSessionAt === null) never
        // matches either bound, same as it already renders as "-" rather
        // than a fabricated date.
        if (fromDate) {
            summaries = summaries.filter((p) => p.latestSessionAt && p.latestSessionAt.slice(0, 10) >= fromDate);
        }
        if (toDate) {
            summaries = summaries.filter((p) => p.latestSessionAt && p.latestSessionAt.slice(0, 10) <= toDate);
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

    async getParticipantProfile(participantId) {
        const participant = await this._participants.getById(participantId);
        if (!participant || participant.deleted_at) {
            return null;
        }
        return this._buildParticipantSummary(participant);
    }

    async getSessionDetail(sessionId) {
        const session = await this._sessions.getById(sessionId);
        if (!session) {
            return null;
        }
        const participant = await this._participants.getById(session.participant_id);
        const phases = await this._phases.listForSession(sessionId);
        const phaseDetails = await this._applyDualTaskContinuity(
            await Promise.all(phases.map((phase) => this._buildPhaseDetail(phase)))
        );

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

    async _buildParticipantSummary(participant) {
        const sessionRows = await this._sessions.listForParticipant(participant.id);
        const sessions = await Promise.all(sessionRows.map((session) => this._buildSessionSummary(session)));
        const totals = summarizeResponses(sessions.flatMap((s) => s.responses));
        const completionStatus = sessions.length === 0
            ? 'No sessions'
            : (sessions.every((s) => s.completionStatus === 'Complete') ? 'Complete' : 'Incomplete');

        // The single stored timestamp the dashboard's Date/Time columns
        // format (js/admin/participantsList.js) - never regenerated on the
        // frontend. start_time (set once, client-side, at the moment the
        // participant actually began the session - see
        // js/data/sessionData.js#createSession) is preferred; created_at
        // (always present, server-set when the session row was first
        // written) is the fallback for the rare case a session exists with
        // no start_time yet. Comparing ISO 8601 strings lexicographically
        // is valid chronological ordering as long as every value uses the
        // same format, which both of these always do.
        const latestSessionAt = sessionRows.length > 0
            ? sessionRows.reduce((latest, row) => {
                const candidate = row.start_time || row.created_at;
                return !latest || candidate > latest ? candidate : latest;
            }, null)
            : null;

        return {
            participantId: participant.id,
            participantCode: participant.participant_code,
            sessionCount: sessions.length,
            latestSessionAt,
            completionStatus,
            needsReview: sessions.some((s) => s.needsReview),
            sessions: sessions.map(({ responses, ...rest }) => rest), // response rows omitted from the list view - fetched via session detail
            ...totals
        };
    }

    async _buildSessionSummary(session) {
        const phases = await this._phases.listForSession(session.id);
        const phaseDetails = await this._applyDualTaskContinuity(
            await Promise.all(phases.map((phase) => this._buildPhaseDetail(phase)))
        );
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

    async _buildPhaseDetail(phase) {
        const recording = await this._recordings.getLatestForPhase(phase.id);
        const transcriptions = recording ? await this._transcriptions.listForRecording(recording.id) : [];
        const latestTranscription = transcriptions.length > 0 ? transcriptions[transcriptions.length - 1] : null;
        const processingRuns = latestTranscription
            ? await this._responses.listProcessingRunsForTranscription(latestTranscription.id)
            : [];
        const latestRun = processingRuns.length > 0 ? processingRuns[processingRuns.length - 1] : null;
        const responses = latestRun ? await this._responses.listResponsesForRun(latestRun.id) : [];
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
            scoringMode: latestRun ? latestRun.scoring_mode : null,
            responses,
            ...totals
        };
    }

    // Overlays continuation-aware responses/totals onto each dual-task
    // (count-back-and-clicking) phase in `phaseDetails`, in place, using its
    // sibling count-only phase (already present in the same array - both
    // belong to the same session/series) - see
    // frontend/js/cognitive/dualTaskContinuity.js. Count-only phases, REST,
    // and the motor baseline are returned completely unchanged. Never
    // mutates or persists anything - `phaseDetails` here is this read
    // request's own freshly-built, disposable composition object.
    async _applyDualTaskContinuity(phaseDetails) {
        const { fromResponseRow, continueDualTaskScoring, isDualTaskPhaseId, countOnlyPhaseIdFor } =
            await import(DUAL_TASK_CONTINUITY_URL);

        const byPhaseId = new Map(phaseDetails.map((detail) => [detail.phaseId, detail]));

        return Promise.all(phaseDetails.map(async (detail) => {
            if (!isDualTaskPhaseId(detail.phaseId)) {
                return detail;
            }
            const sibling = byPhaseId.get(countOnlyPhaseIdFor(detail.phaseId));

            const { continuationAnchor, mapped } = await continueDualTaskScoring({
                dualTaskResponses: detail.responses.map(fromResponseRow),
                countOnlyResponses: sibling ? sibling.responses.map(fromResponseRow) : [],
                startingNumber: detail.startingNumber,
                subtractionValue: detail.subtractionValue,
                // undefined (never null) so scoreResponses()'s own default
                // parameter (DEFAULT_SCORING_MODE) applies when this phase
                // has no processing run yet (zero responses so far) -
                // explicit null would bypass that default and throw.
                mode: detail.scoringMode || undefined
            });

            const responses = mapped.map((response) => ({
                response_index: response.responseIndex,
                expected_number: response.expectedNumber,
                actual_number: response.actualNumber,
                correctness: response.correctness,
                reference_number_after_response: response.referenceNumberAfterResponse,
                next_expected_number: response.nextExpectedNumber,
                raw_transcript_segment: response.rawTranscriptSegment,
                timestamp_ms: response.timestamp
            }));

            return {
                ...detail,
                // Per the protocol's Admin Session Review requirement:
                // Starting Number (unchanged, above), Count-only Final
                // Number, Dual-task Continuation Number - e.g.
                // startingNumber 825, countOnlyFinalNumber 759,
                // dualTaskContinuationNumber 756.
                countOnlyFinalNumber: continuationAnchor,
                dualTaskContinuationNumber: continuationAnchor - detail.subtractionValue,
                responses,
                ...summarizeResponses(responses)
            };
        }));
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
