const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

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

async function buildSessionResultsWorkbook(formattedSession) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Session Results');

    worksheet.addRow(SESSION_RESULTS_HEADER_ROW);
    worksheet.getRow(1).font = { bold: true };

    for (const phase of formattedSession.phases) {
        const mouse = phase.mousePerformance;
        const cognitive = phase.cognitivePerformance;
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
            cognitive ? cognitive.correctResponses : '',
            cognitive ? cognitive.incorrectResponses : '',
            cognitive ? cognitive.unresolvedResponses : '',
            cognitive ? Number(cognitive.cognitiveAccuracy.toFixed(2)) : '',
            cognitive ? cognitive.rawTranscript : ''
        ]);
    }

    worksheet.columns.forEach((column) => {
        column.width = 20;
    });

    return workbook.xlsx.writeBuffer();
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
