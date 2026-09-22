import { adminFetch } from './adminApi.js';

// Pure formatting of the already-stored session timestamp
// (participant.latestSessionAt, an ISO 8601 string straight from
// sessions.start_time/created_at - see adminQueryService.js) - never
// generates a new Date() representing "now". A missing/unparseable value
// (a participant with no sessions yet) renders as an em dash rather than
// throwing or showing "Invalid Date".
function formatSessionDate(isoString) {
    const date = isoString ? new Date(isoString) : null;
    if (!date || Number.isNaN(date.getTime())) {
        return '—';
    }
    return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

// 12-hour clock with AM/PM, e.g. "2:05 PM" - same hour12 convention already
// used elsewhere in this app (js/ui/intakeScreen.js's own clock).
function formatSessionTime(isoString) {
    const date = isoString ? new Date(isoString) : null;
    if (!date || Number.isNaN(date.getTime())) {
        return '—';
    }
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).format(date);
}

const tbody = document.getElementById('participantsTableBody');
const statusLine = document.getElementById('statusLine');
const searchInput = document.getElementById('searchInput');
const statusFilter = document.getElementById('statusFilter');
const minAccuracyInput = document.getElementById('minAccuracyInput');
const needsReviewFilter = document.getElementById('needsReviewFilter');
const sortSelect = document.getElementById('sortSelect');

let debounceHandle = null;

async function load() {
    setStatus('Loading…', false);
    const params = new URLSearchParams();
    if (searchInput.value.trim()) params.set('search', searchInput.value.trim());
    if (statusFilter.value) params.set('status', statusFilter.value);
    if (minAccuracyInput.value !== '') params.set('minAccuracy', minAccuracyInput.value);
    if (needsReviewFilter.checked) params.set('needsReview', 'true');
    if (sortSelect.value) params.set('sort', sortSelect.value);

    try {
        const { participants } = await adminFetch(`/api/admin/participants?${params.toString()}`);
        render(participants);
        setStatus(participants.length === 0 ? 'No participants match these filters.' : '', false);
    } catch (error) {
        setStatus(error.message, true);
    }
}

function render(participants) {
    tbody.textContent = '';
    for (const participant of participants) {
        const row = document.createElement('tr');
        row.addEventListener('click', () => {
            window.location.href = `participant.html?id=${encodeURIComponent(participant.participantId)}`;
        });

        row.appendChild(cell(participant.participantCode));
        row.appendChild(cell(`${participant.sessionCount} session${participant.sessionCount === 1 ? '' : 's'}`));
        row.appendChild(cell(`${participant.overallAccuracy.toFixed(1)}%`));
        row.appendChild(cell(String(participant.totalResponses)));
        row.appendChild(cell(String(participant.incorrectResponses)));
        row.appendChild(cell(formatSessionDate(participant.latestSessionAt)));
        row.appendChild(cell(formatSessionTime(participant.latestSessionAt)));

        const statusCell = document.createElement('td');
        const badge = document.createElement('span');
        badge.className = `badge ${participant.needsReview ? 'review' : (participant.completionStatus === 'Complete' ? 'complete' : 'incomplete')}`;
        badge.textContent = participant.needsReview ? 'Review' : participant.completionStatus;
        statusCell.appendChild(badge);
        row.appendChild(statusCell);

        // Final column, as required - a standalone action, never the row's
        // own click-to-navigate (stopPropagation below), since the row
        // itself already navigates to participant.html on click.
        const actionCell = document.createElement('td');
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'admin-button danger';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            handleDelete(participant);
        });
        actionCell.appendChild(deleteBtn);
        row.appendChild(actionCell);

        tbody.appendChild(row);
    }
}

function cell(text) {
    const td = document.createElement('td');
    td.textContent = text;
    return td;
}

// Genuine, irreversible deletion - see routes/admin.js's own
// /participants/:id/hard-delete for exactly what this removes (every
// session/phase/recording/transcription/processing_run/response for this
// participant, their audio files, and the participant row itself). The
// confirm() dialog is the one explicit gate before that happens; the
// participant's own code (never just the id) is what the backend requires
// back as confirmation too, so this can't succeed against the wrong row
// even if the two ever got out of sync.
async function handleDelete(participant) {
    const confirmed = window.confirm(
        `Delete participant ${participant.participantCode} and all associated research data?`
    );
    if (!confirmed) {
        return;
    }

    setStatus('Deleting…', false);
    try {
        const result = await adminFetch(`/api/admin/participants/${encodeURIComponent(participant.participantId)}/hard-delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirm: participant.participantCode })
        });
        const warningNote = result.fileWarnings && result.fileWarnings.length > 0
            ? ` Warning: ${result.fileWarnings.length} audio file(s) could not be removed from disk - see server logs.`
            : '';
        setStatus(`Deleted participant ${participant.participantCode} and all associated research data.${warningNote}`, warningNote.length > 0);
        await load();
    } catch (error) {
        setStatus(`Delete failed: ${error.message}`, true);
    }
}

function setStatus(message, isError) {
    statusLine.textContent = message;
    statusLine.classList.toggle('is-error', isError);
}

function debouncedLoad() {
    clearTimeout(debounceHandle);
    debounceHandle = setTimeout(load, 200);
}

searchInput.addEventListener('input', debouncedLoad);
minAccuracyInput.addEventListener('input', debouncedLoad);
statusFilter.addEventListener('change', load);
needsReviewFilter.addEventListener('change', load);
sortSelect.addEventListener('change', load);

load();
