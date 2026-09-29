// Renders the Experiment Complete screen (just the thank-you heading, plus
// whether processing is still pending) and handles the Excel download.
// Per the researcher's request, this screen no longer previews any
// research results on-screen - it never did any of the real
// computation/persistence anyway; the actual mouse-performance/cognitive
// data still flows unchanged from data/sessionData.js's own recorders
// straight into the Excel export below.

import { getExperimentController } from '../experiment/experimentRuntime.js';
import { formatSessionForExport } from '../data/dataFormatter.js';
import { buildApiUrl } from '../config/apiBaseUrl.js';

export function initResultsScreen() {
    document.getElementById('downloadResultsBtn').addEventListener('click', downloadExcelResults);
}

// Called once, when the COMPLETE phase renders - session is the actual,
// just-finished ExperimentController session, not test/mock data. `controller`
// is needed to await any still-in-flight recording uploads/transcription/
// scoring (see experiment/experimentController.js#getPendingCognitiveProcessing),
// and any still-in-flight mouse-task completion (see that same file's
// getPendingMousePerformance() - normally already resolved by the time this
// runs, except for the final condition's dual-task phase, which has no
// recovery phase after it to provide that buffer). The Download button
// stays disabled behind a simple "Processing your recording(s)…" status
// until every phase's data has actually reached the research server, so
// the export it triggers is always complete - this screen shows no other
// research results/statistics per the researcher's request (see
// data/dataFormatter.js/exportService.js for where that data still goes,
// completely unchanged).
export async function renderResults(session, controller) {
    renderCompleteHeading(session);

    const downloadBtn = document.getElementById('downloadResultsBtn');
    const processingStatus = document.getElementById('cognitiveProcessingStatus');

    // Each mouse phase's promise settles only after its click data has been
    // sent to the research server (see experimentController.js#_persistMouseData),
    // so this also waits for the final DUAL_TASK_<n>'s upload.
    const pendingMouse = controller && controller.getPendingMousePerformance ? controller.getPendingMousePerformance() : [];
    if (pendingMouse.length > 0) {
        if (processingStatus) {
            processingStatus.hidden = false;
        }
        if (downloadBtn) {
            downloadBtn.disabled = true;
        }
        // allSettled, not all() - one phase's mouse task adapter failing
        // must never prevent the others' (already-succeeded) results from
        // rendering.
        await Promise.allSettled(pendingMouse);
    }

    const pending = controller && controller.getPendingCognitiveProcessing ? controller.getPendingCognitiveProcessing() : [];
    if (pending.length > 0) {
        if (processingStatus) {
            processingStatus.hidden = false;
        }
        if (downloadBtn) {
            downloadBtn.disabled = true;
        }
        // allSettled, not all() - one phase's recording failing to process
        // must never prevent the others' (already-succeeded) results from
        // being shown; see recordCognitiveProcessingFailed() in
        // data/sessionData.js for how a failure is represented per-phase.
        await Promise.allSettled(pending);
    }

    if (processingStatus) {
        processingStatus.hidden = true;
    }
    if (downloadBtn) {
        downloadBtn.disabled = false;
    }
}

// session.participantCode is the exact value the participant entered at
// intake (js/data/sessionData.js#createSession) - the same "Participant ID"
// terminology the admin dashboard uses, never a name (none is collected).
// Falls back to a participant-ID-free heading (per spec) if it's ever
// missing rather than showing a literal "null"/"undefined".
function renderCompleteHeading(session) {
    const heading = document.getElementById('completeHeading');
    const subtitle = document.getElementById('completeSubtitle');
    if (!heading || !subtitle) {
        return;
    }
    heading.textContent = session && session.participantCode
        ? `Thank You, Participant ${session.participantCode}`
        : 'Thank You for Participating';
    subtitle.textContent = 'Thank you for participating in the study. Your session is complete.';
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
        const response = await fetch(buildApiUrl('/exportSessionResults'), {
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
