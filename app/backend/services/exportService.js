const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('node:url');

// Dual-task counting-sequence continuity (see
// frontend/js/cognitive/dualTaskContinuity.js's own header, and
// services/adminQueryService.js's identical use of this same module for
// Admin Session Review - this is the one other read-time consumer). The
// participant-facing session JSON posted to /exportSessionResults already
// carries each phase's own responses in exactly the canonical pre-scoring
// shape this module expects ({ rawTranscript, parsedNumber, resolved,
// ... }) - see data/sessionData.js#recordCognitivePerformance /
// speechProcessingService.js's `results.responses` - so no row-shape
// adapter is needed here, unlike adminQueryService.js's DB rows.
const DUAL_TASK_CONTINUITY_URL = pathToFileURL(
    path.join(__dirname, '../../frontend/js/cognitive/dualTaskContinuity.js')
).href;
const SPEECH_SCORING_URL = pathToFileURL(
    path.join(__dirname, '../../frontend/js/cognitive/speechScoring.js')
).href;
// The same click-history -> summary derivation services/mousePerformanceService.js
// uses before storing, so the Excel file and Admin Session Review agree.
const MOUSE_SUMMARY_URL = pathToFileURL(
    path.join(__dirname, '../../frontend/js/mouse/mousePerformanceSummary.js')
).href;

// Moved verbatim from the original server.js /saveScore handler.
const excelFilePath = path.join(__dirname, '../../../data/exports/excel/scores.xlsx');

async function saveScore(data) {
    const {
        name,
        code,
        accuracy_s1,
        accuracy_s2,
        accuracy_s3,
        accuracy_F,
        targetEfficiency_s1,
        targetEfficiency_s2,
        targetEfficiency_s3,
        targetEfficiency_F
    } = data;

    const workbook = new ExcelJS.Workbook();

    if (fs.existsSync(excelFilePath)) {
        await workbook.xlsx.readFile(excelFilePath);
    } else {
        const worksheet = workbook.addWorksheet('Scores');
        worksheet.addRow([
            'Name', 'Code', 'Date',
            'Session 1 Accuracy', 'Session 1 TargetEfficiency',
            'Session 2 Accuracy', 'Session 2 TargetEfficiency',
            'Session 3 Accuracy', 'Session 3 TargetEfficiency',
            'Total Game Accuracy', 'Total Game TargetEfficiency'
        ]);
    }

    const worksheet = workbook.getWorksheet('Scores');
    worksheet.addRow([
        name, code, new Date(),
        accuracy_s1, targetEfficiency_s1,
        accuracy_s2, targetEfficiency_s2,
        accuracy_s3, targetEfficiency_s3,
        accuracy_F, targetEfficiency_F
    ]);

    await workbook.xlsx.writeFile(excelFilePath);
}

// --- Dual-task session results export (additive; saveScore() above and
// data/exports/excel/scores.xlsx are completely untouched by this) -------
//
// Builds a fresh, in-memory .xlsx workbook (as a Buffer) for ONE completed
// experiment session - one row per recorded phase, with mouse-performance
// columns populated only for phases that actually ran the mouse task
// (never combined into a single score). This never reads or writes any
// file on disk, so it cannot collide with or overwrite the existing
// legacy scores.xlsx research data.

const SESSION_RESULTS_HEADER_ROW = [
    'Participant ID',
    'Session ID',
    'Experiment ID',
    'Session Date',
    'Phase/Condition',
    'Subtraction Value',
    'Starting Number',
    'Duration (s)',
    'Total Targets',
    'Total Clicks',
    'Total Hits',
    'Total Misses',
    'Total Accuracy (%)',
    'Target Efficiency (%)',
    // Cognitive (speech) columns - additive, appended after the existing
    // mouse columns above, which are left completely unchanged. Populated
    // only for cognitive-active phases (SUBTRACTION_<n>/DUAL_TASK_<n>); see
    // data/sessionData.js#recordCognitivePerformance.
    'Responses',
    'Correct Responses',
    'Incorrect Responses',
    'Unresolved Responses',
    'Cognitive Accuracy (%)',
    'Raw Transcript'
];

// Re-anchors each dual-task (DUAL_TASK_<n>) phase's responses to its
// sibling count-only (SUBTRACTION_<n>) phase's actual last valid spoken
// number - see dualTaskContinuity.js's own header for the full reasoning
// (identical rule, identical pure computation, to Admin Session Review's
// use of it in adminQueryService.js). Returns a Map keyed by the dual-task
// phase's own phaseId -> { continuationAnchor, dualTaskContinuationNumber,
// scored, countOnlyPhaseId, correctResponses, incorrectResponses,
// unresolvedResponses, cognitiveAccuracy }. Phases with no cognitivePerformance
// yet (recording still processing, or phase never reached) are simply
// absent from the returned map - callers fall back to that phase's own
// original (non-continuity) values, exactly as before this feature existed.
async function computeDualTaskContinuity(formattedSession) {
    const { continueDualTaskScoring, isDualTaskPhaseId, countOnlyPhaseIdFor } = await import(DUAL_TASK_CONTINUITY_URL);
    const { calculateCognitiveAccuracy } = await import(SPEECH_SCORING_URL);

    const phasesById = new Map(formattedSession.phases.map((phase) => [phase.phaseId, phase]));
    const continuityByPhaseId = new Map();

    for (const phase of formattedSession.phases) {
        // Requires actual per-response detail to re-anchor - a phase whose
        // cognitivePerformance only carries summary counts (no responses
        // array; not how a real session is ever recorded - see
        // data/sessionData.js#recordCognitivePerformance - but a legitimate
        // shape for a caller to pass) is left exactly as originally scored,
        // the same graceful fallback as an unavailable sibling phase below.
        if (!isDualTaskPhaseId(phase.phaseId) || !phase.cognitivePerformance
            || !Array.isArray(phase.cognitivePerformance.responses) || phase.cognitivePerformance.responses.length === 0) {
            continue;
        }
        const countOnlyPhaseId = countOnlyPhaseIdFor(phase.phaseId);
        const sibling = phasesById.get(countOnlyPhaseId);

        const { continuationAnchor, scored, mapped } = await continueDualTaskScoring({
            dualTaskResponses: phase.cognitivePerformance.responses,
            countOnlyResponses: sibling && sibling.cognitivePerformance ? sibling.cognitivePerformance.responses : [],
            startingNumber: phase.startingNumber,
            subtractionValue: phase.subtractionValue,
            mode: phase.cognitivePerformance.scoringMode
        });

        const correctResponses = scored.filter((r) => r.correctness === 'correct').length;
        const incorrectResponses = scored.filter((r) => r.correctness === 'incorrect').length;
        const unresolvedResponses = scored.filter((r) => r.correctness === 'unresolved').length;

        continuityByPhaseId.set(phase.phaseId, {
            continuationAnchor,
            dualTaskContinuationNumber: continuationAnchor - phase.subtractionValue,
            mapped,
            countOnlyPhaseId,
            correctResponses,
            incorrectResponses,
            unresolvedResponses,
            cognitiveAccuracy: calculateCognitiveAccuracy(correctResponses, incorrectResponses)
        });
    }

    return continuityByPhaseId;
}

async function buildSessionResultsWorkbook(formattedSession) {
    const continuityByPhaseId = await computeDualTaskContinuity(formattedSession);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Session Results');

    worksheet.addRow(SESSION_RESULTS_HEADER_ROW);
    worksheet.getRow(1).font = { bold: true };

    for (const phase of formattedSession.phases) {
        const mouse = phase.mousePerformance;
        const cognitive = phase.cognitivePerformance;
        // For dual-task phases, the scoring shown here follows the same
        // continuation rule as everywhere else - see the module header.
        // numberOfResponses/rawTranscript are anchor-independent (the
        // transcript is verbatim, the response count doesn't change) and
        // are never overridden.
        const continuity = continuityByPhaseId.get(phase.phaseId);
        worksheet.addRow([
            formattedSession.participantCode ?? '',
            formattedSession.sessionId ?? '',
            formattedSession.experimentId ?? '',
            formattedSession.sessionDate ?? '',
            phase.phaseId,
            phase.subtractionValue ?? '',
            phase.startingNumber ?? '',
            phase.duration ?? '',
            mouse ? mouse.totalTargets : '',
            mouse ? mouse.totalClicks : '',
            mouse ? mouse.totalHits : '',
            mouse ? mouse.totalMisses : '',
            mouse ? Number(mouse.totalAccuracy.toFixed(2)) : '',
            mouse ? Number(mouse.targetEfficiency.toFixed(2)) : '',
            cognitive ? cognitive.numberOfResponses : '',
            cognitive ? (continuity ? continuity.correctResponses : cognitive.correctResponses) : '',
            cognitive ? (continuity ? continuity.incorrectResponses : cognitive.incorrectResponses) : '',
            cognitive ? (continuity ? continuity.unresolvedResponses : cognitive.unresolvedResponses) : '',
            cognitive ? Number((continuity ? continuity.cognitiveAccuracy : cognitive.cognitiveAccuracy).toFixed(2)) : '',
            cognitive ? cognitive.rawTranscript : ''
        ]);
    }

    worksheet.columns.forEach((column) => {
        column.width = 20;
    });

    addCountingSequenceContinuitySheet(workbook, formattedSession, continuityByPhaseId);
    await addMouseSheets(workbook, formattedSession);

    return workbook.xlsx.writeBuffer();
}

const MOUSE_SUMMARY_HEADER_ROW = [
    'Phase/Condition',
    'Stored on Research Server',
    'Total Targets',
    'Total Clicks',
    'Successful Clicks (Hits)',
    'Missed Clicks',
    'Click Accuracy (%)',
    'Target Efficiency (%)',
    'Avg Reaction Time (ms)',
    'Min Reaction Time (ms)',
    'Max Reaction Time (ms)',
    'Median Reaction Time (ms)',
    'Task Duration (ms)',
    'Target Size (px)',
    'Target Field Width (px)',
    'Target Field Height (px)'
];

const MOUSE_CLICK_EVENTS_HEADER_ROW = [
    'Phase/Condition',
    'Click #',
    'Timestamp',
    'Elapsed (ms)',
    'X (px)',
    'Y (px)',
    'Viewport X (px)',
    'Viewport Y (px)',
    'Target Active',
    'Active Targets',
    'Hit/Miss',
    'Target ID',
    'Target X (px)',
    'Target Y (px)',
    'Target Appeared (ms)',
    'Reaction Time (ms)'
];

const MOUSE_TARGETS_HEADER_ROW = [
    'Phase/Condition',
    'Target ID',
    'X (px)',
    'Y (px)',
    'Size (px)',
    'Appeared (ms)',
    'Appeared At',
    'Hit At (ms)',
    'Disappeared (ms)',
    'Outcome'
];

const PERSISTENCE_LABELS = {
    saved: 'Yes',
    saving: 'Not confirmed yet',
    failed: 'No - upload failed',
    rejected: 'No - rejected by server'
};

function blankIfNull(value) {
    return value === null || value === undefined ? '' : value;
}

function roundOrBlank(value) {
    return typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(2)) : '';
}

// Per-phase mouse summary, every click, and every target - only for phases
// that carry a click history (sessions recorded before click-level capture
// existed simply get header-only sheets).
async function addMouseSheets(workbook, formattedSession) {
    const { summarizeMouseClickData } = await import(MOUSE_SUMMARY_URL);
    const mousePhases = formattedSession.phases.filter((phase) => phase.mouseClickData);

    const summarySheet = workbook.addWorksheet('Mouse Phase Summary');
    summarySheet.addRow(MOUSE_SUMMARY_HEADER_ROW);
    summarySheet.getRow(1).font = { bold: true };

    const clicksSheet = workbook.addWorksheet('Mouse Click Events');
    clicksSheet.addRow(MOUSE_CLICK_EVENTS_HEADER_ROW);
    clicksSheet.getRow(1).font = { bold: true };

    const targetsSheet = workbook.addWorksheet('Mouse Targets');
    targetsSheet.addRow(MOUSE_TARGETS_HEADER_ROW);
    targetsSheet.getRow(1).font = { bold: true };

    for (const phase of mousePhases) {
        const { clickEvents = [], targets = [], taskInfo } = phase.mouseClickData;
        const summary = summarizeMouseClickData({ clickEvents, targets });
        const persistence = phase.mouseDataPersistence ? phase.mouseDataPersistence.status : null;

        summarySheet.addRow([
            phase.phaseId,
            PERSISTENCE_LABELS[persistence] || 'Unknown',
            summary.totalTargets,
            summary.totalClicks,
            summary.totalHits,
            summary.totalMisses,
            roundOrBlank(summary.totalAccuracy),
            roundOrBlank(summary.targetEfficiency),
            roundOrBlank(summary.avgReactionTimeMs),
            roundOrBlank(summary.minReactionTimeMs),
            roundOrBlank(summary.maxReactionTimeMs),
            roundOrBlank(summary.medianReactionTimeMs),
            blankIfNull(taskInfo && taskInfo.durationMs),
            blankIfNull(taskInfo && taskInfo.targetSizePx),
            blankIfNull(taskInfo && taskInfo.containerWidth),
            blankIfNull(taskInfo && taskInfo.containerHeight)
        ]);

        for (const c of clickEvents) {
            clicksSheet.addRow([
                phase.phaseId,
                c.clickSequence,
                blankIfNull(c.timestamp),
                blankIfNull(c.elapsedMs),
                blankIfNull(c.x),
                blankIfNull(c.y),
                blankIfNull(c.viewportX),
                blankIfNull(c.viewportY),
                c.targetActive ? 'Yes' : 'No',
                blankIfNull(c.activeTargetCount),
                c.isHit ? 'Hit' : 'Miss',
                blankIfNull(c.targetId),
                blankIfNull(c.targetX),
                blankIfNull(c.targetY),
                blankIfNull(c.targetAppearedElapsedMs),
                blankIfNull(c.reactionTimeMs)
            ]);
        }

        for (const t of targets) {
            targetsSheet.addRow([
                phase.phaseId,
                t.targetId,
                blankIfNull(t.x),
                blankIfNull(t.y),
                blankIfNull(t.sizePx),
                blankIfNull(t.appearedElapsedMs),
                blankIfNull(t.appearedAt),
                blankIfNull(t.hitElapsedMs),
                blankIfNull(t.disappearedElapsedMs),
                blankIfNull(t.outcome)
            ]);
        }
    }

    for (const sheet of [summarySheet, clicksSheet, targetsSheet]) {
        sheet.columns.forEach((column) => {
            column.width = 20;
        });
    }
}

const COUNTING_SEQUENCE_HEADER_ROW = [
    'Series',
    'Starting Number',
    'Count-only phase',
    'Last valid count-only number',
    'Dual-task phase',
    'Dual-task continuation starting number',
    'Expected sequence',
    'User Said',
    'Correct/Incorrect',
    'Next Expected'
];

// One row per dual-task response (not per phase) - the detailed,
// per-response view of the counting-sequence continuity rule requested
// alongside the summary sheet above. Worked example (researcher-provided):
// SUBTRACTION_3, starting 825, count-only ends at 759, DUAL_TASK_3
// continues 756, 753, 750, 747... - each of those is its own row here,
// with the series-level context columns repeated on every row.
function addCountingSequenceContinuitySheet(workbook, formattedSession, continuityByPhaseId) {
    const worksheet = workbook.addWorksheet('Counting Sequence Continuity');
    worksheet.addRow(COUNTING_SEQUENCE_HEADER_ROW);
    worksheet.getRow(1).font = { bold: true };

    for (const phase of formattedSession.phases) {
        const continuity = continuityByPhaseId.get(phase.phaseId);
        if (!continuity) {
            continue;
        }
        const series = phase.subtractionValue;
        for (const response of continuity.mapped) {
            worksheet.addRow([
                series ?? '',
                phase.startingNumber ?? '',
                continuity.countOnlyPhaseId ?? '',
                continuity.continuationAnchor ?? '',
                phase.phaseId,
                continuity.dualTaskContinuationNumber ?? '',
                response.expectedNumber ?? '',
                response.actualNumber ?? '',
                response.correctness ?? '',
                response.nextExpectedNumber ?? ''
            ]);
        }
    }

    worksheet.columns.forEach((column) => {
        column.width = 24;
    });
}

function sanitizeForFilename(value) {
    return String(value).replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60);
}

function buildSessionResultsFilename(formattedSession) {
    const participantPart = formattedSession.participantCode
        ? sanitizeForFilename(formattedSession.participantCode)
        : 'UnknownParticipant';
    const sessionPart = formattedSession.sessionId
        ? sanitizeForFilename(formattedSession.sessionId)
        : `Session${Date.now()}`;
    return `MouseAccuracy_${participantPart}_${sessionPart}.xlsx`;
}

module.exports = { saveScore, buildSessionResultsWorkbook, buildSessionResultsFilename };
