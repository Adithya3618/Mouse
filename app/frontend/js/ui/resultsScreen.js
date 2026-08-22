// Renders the final results (mouse-performance table + starting numbers)
// on the Experiment Complete screen, and handles the Excel download.
//
// The mouse-performance numbers come straight from
// data/sessionData.js#recordMousePerformance (which itself reuses
// mouse/scoring.js's existing, unchanged accuracy/efficiency formulas) -
// nothing here recomputes anything.

import { getExperimentController } from '../experiment/experimentRuntime.js';
import { formatPercentage, formatSessionForExport } from '../data/dataFormatter.js';

const MOUSE_CONDITION_ORDER = ['MOTOR_BASELINE', 'DUAL_TASK_3', 'DUAL_TASK_7', 'DUAL_TASK_17'];

const MOUSE_CONDITION_LABELS = {
    MOTOR_BASELINE: 'Motor Baseline',
    DUAL_TASK_3: 'Dual Task — Subtract by 3',
    DUAL_TASK_7: 'Dual Task — Subtract by 7',
    DUAL_TASK_17: 'Dual Task — Subtract by 17'
};

const STARTING_NUMBER_SUBTRACTION_VALUES = [3, 7, 17];

// Cognitive results are kept in their own table, separate from the mouse
// performance table above - cognitive and mouse accuracy are never
// combined into one score (see data/sessionData.js#recordCognitivePerformance).
const COGNITIVE_CONDITION_ORDER = [
    'SUBTRACTION_3', 'DUAL_TASK_3',
    'SUBTRACTION_7', 'DUAL_TASK_7',
    'SUBTRACTION_17', 'DUAL_TASK_17'
];

const COGNITIVE_CONDITION_LABELS = {
    SUBTRACTION_3: 'Subtract by 3',
    DUAL_TASK_3: 'Dual Task — Subtract by 3',
    SUBTRACTION_7: 'Subtract by 7',
    DUAL_TASK_7: 'Dual Task — Subtract by 7',
    SUBTRACTION_17: 'Subtract by 17',
    DUAL_TASK_17: 'Dual Task — Subtract by 17'
};

export function initResultsScreen() {
    document.getElementById('downloadResultsBtn').addEventListener('click', downloadExcelResults);
}

// Called once, when the COMPLETE phase renders - session is the actual,
// just-finished ExperimentController session, not test/mock data.
export function renderResults(session) {
    renderMousePerformanceTable(session);
    renderCognitivePerformanceTable(session);
    renderStartingNumbers(session);
    setExportStatus('', false);
}

function renderCognitivePerformanceTable(session) {
    const tbody = document.getElementById('cognitivePerformanceTableBody');
    tbody.textContent = '';

    for (const phaseId of COGNITIVE_CONDITION_ORDER) {
        const phase = session.phases.find((p) => p.phaseId === phaseId);
        const cognitive = phase ? phase.cognitivePerformance : null;

        const row = document.createElement('tr');
        row.appendChild(createCell(COGNITIVE_CONDITION_LABELS[phaseId]));
        row.appendChild(createCell(phase && phase.startingNumber != null ? String(phase.startingNumber) : '—'));
        row.appendChild(createCell(cognitive ? String(cognitive.numberOfResponses) : '—'));
        row.appendChild(createCell(cognitive ? String(cognitive.correctResponses) : '—'));
        row.appendChild(createCell(cognitive ? String(cognitive.incorrectResponses) : '—'));
        row.appendChild(createCell(cognitive ? String(cognitive.unresolvedResponses) : '—'));
        row.appendChild(createCell(cognitive ? formatPercentage(cognitive.cognitiveAccuracy) : '—'));
        tbody.appendChild(row);
    }
}

function renderMousePerformanceTable(session) {
    const tbody = document.getElementById('mousePerformanceTableBody');
    tbody.textContent = '';

    for (const phaseId of MOUSE_CONDITION_ORDER) {
        const phase = session.phases.find((p) => p.phaseId === phaseId);
        const mouse = phase ? phase.mousePerformance : null;

        const row = document.createElement('tr');
        row.appendChild(createCell(MOUSE_CONDITION_LABELS[phaseId]));
        row.appendChild(createCell(mouse ? String(mouse.totalTargets) : '—'));
        row.appendChild(createCell(mouse ? String(mouse.totalClicks) : '—'));
        row.appendChild(createCell(mouse ? String(mouse.totalHits) : '—'));
        row.appendChild(createCell(mouse ? String(mouse.totalMisses) : '—'));
        row.appendChild(createCell(mouse ? formatPercentage(mouse.totalAccuracy) : '—'));
        row.appendChild(createCell(mouse ? formatPercentage(mouse.targetEfficiency) : '—'));
        tbody.appendChild(row);
    }
}

function renderStartingNumbers(session) {
    const list = document.getElementById('startingNumbersList');
    list.textContent = '';

    for (const value of STARTING_NUMBER_SUBTRACTION_VALUES) {
        const phase = session.phases.find((p) => p.phaseId === `SUBTRACTION_${value}`);

        const dt = document.createElement('dt');
        dt.textContent = `Subtract by ${value}`;

        const dd = document.createElement('dd');
        dd.textContent = phase && phase.startingNumber != null ? String(phase.startingNumber) : '—';

        list.appendChild(dt);
        list.appendChild(dd);
    }
}

function createCell(text) {
    const td = document.createElement('td');
    td.textContent = text;
    return td;
}

async function downloadExcelResults() {
    const downloadBtn = document.getElementById('downloadResultsBtn');
    const session = getExperimentController().getSession();

    if (!session || session.phases.length === 0) {
        setExportStatus('No session data available to export.', true);
        return;
    }

    downloadBtn.disabled = true;
    setExportStatus('Preparing your download…', false);

    try {
        const response = await fetch('/exportSessionResults', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formatSessionForExport(session))
        });

        if (!response.ok) {
            throw new Error(`Server responded with ${response.status}`);
        }

        const blob = await response.blob();
        const filename = getFilenameFromResponse(response, session);
        triggerBrowserDownload(blob, filename);
        setExportStatus('Download complete.', false);
    } catch (error) {
        setExportStatus(`Could not download results: ${error.message}`, true);
    } finally {
        downloadBtn.disabled = false;
    }
}

function getFilenameFromResponse(response, session) {
    const disposition = response.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/);
    if (match) {
        return match[1];
    }
    // Fallback in case the header is ever stripped by an intermediary -
    // mirrors the backend's own fallback naming exactly.
    const participant = session.participantCode || 'UnknownParticipant';
    const sessionId = session.sessionId || `Session${Date.now()}`;
    return `MouseAccuracy_${participant}_${sessionId}.xlsx`;
}

function triggerBrowserDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function setExportStatus(message, isError) {
    const statusEl = document.getElementById('exportStatus');
    statusEl.hidden = !message;
    statusEl.textContent = message;
    statusEl.classList.toggle('is-error', isError);
}
