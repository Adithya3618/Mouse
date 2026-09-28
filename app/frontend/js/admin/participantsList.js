import { adminFetch, fetchExportBlob } from './adminApi.js';

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
const fromDateInput = document.getElementById('fromDateInput');
const toDateInput = document.getElementById('toDateInput');
const needsReviewFilter = document.getElementById('needsReviewFilter');
const applyFiltersBtn = document.getElementById('applyFiltersBtn');
const clearFiltersBtn = document.getElementById('clearFiltersBtn');
const paginationSummary = document.getElementById('paginationSummary');
const paginationControls = document.getElementById('paginationControls');
const sortableHeaders = document.querySelectorAll('th.sortable');
const addParticipantBtn = document.getElementById('addParticipantBtn');
const exportBtn = document.getElementById('exportBtn');
const exportMenu = document.getElementById('exportMenu');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const exportJsonBtn = document.getElementById('exportJsonBtn');
const kpiTotalParticipants = document.getElementById('kpiTotalParticipants');
const kpiTotalSessions = document.getElementById('kpiTotalSessions');
const kpiAverageAccuracy = document.getElementById('kpiAverageAccuracy');
const kpiPendingReview = document.getElementById('kpiPendingReview');

const PAGE_SIZE = 10;

// Sort state lives here (not in a <select>, now that column headers
// themselves are clickable) - 'participant' ascending matches the
// backend's own default (see routes/admin.js#SORT_ALIASES).
const state = { sort: 'participant', sortDir: 'asc', page: 1 };

let debounceHandle = null;
let inFlight = false;

// Shared by load() and the Export button, so an export always reflects
// exactly the filters currently applied to the table - never a second,
// independently-typed copy of this logic (see routes/admin.js's own
// parseParticipantFilters, which the query string this builds maps onto).
function currentFilterParams() {
    const params = new URLSearchParams();
    if (searchInput.value.trim()) params.set('search', searchInput.value.trim());
    if (statusFilter.value) params.set('status', statusFilter.value);
    if (minAccuracyInput.value !== '') params.set('minAccuracy', minAccuracyInput.value);
    if (fromDateInput.value) params.set('fromDate', fromDateInput.value);
    if (toDateInput.value) params.set('toDate', toDateInput.value);
    if (needsReviewFilter.checked) params.set('needsReview', 'true');
    params.set('sort', state.sort);
    params.set('sortDir', state.sortDir);
    return params;
}

async function load() {
    if (inFlight) {
        return;
    }
    inFlight = true;
    setStatus('Loading…', false, true);
    setControlsDisabled(true);

    const params = currentFilterParams();
    params.set('page', String(state.page));
    params.set('pageSize', String(PAGE_SIZE));

    try {
        const result = await adminFetch(`/api/admin/participants?${params.toString()}`);
        state.page = result.page;
        render(result.participants);
        renderPagination(result);
        renderSortIndicators();
        renderStats(result.stats);
        setStatus(result.participants.length === 0 ? 'No participants found.' : '', false, false);
    } catch (error) {
        tbody.textContent = '';
        paginationSummary.textContent = '';
        paginationControls.textContent = '';
        setStatus(`Unable to load participants. ${error.message}`, true, false);
    } finally {
        inFlight = false;
        setControlsDisabled(false);
    }
}

function renderStats(stats) {
    if (!stats) return;
    kpiTotalParticipants.textContent = String(stats.totalParticipants);
    kpiTotalSessions.textContent = String(stats.totalSessions);
    kpiAverageAccuracy.textContent = `${stats.averageAccuracy.toFixed(1)}%`;
    kpiPendingReview.textContent = String(stats.pendingReview);
}

function render(participants) {
    tbody.textContent = '';
    for (const participant of participants) {
        const row = document.createElement('tr');
        row.addEventListener('click', () => openParticipant(participant));

        row.appendChild(cell(participant.participantCode));
        row.appendChild(cell(`${participant.sessionCount} session${participant.sessionCount === 1 ? '' : 's'}`));
        row.appendChild(accuracyCell(participant.overallAccuracy));
        row.appendChild(cell(String(participant.totalResponses)));
        row.appendChild(cell(String(participant.incorrectResponses)));
        row.appendChild(cell(formatSessionDate(participant.latestSessionAt)));
        row.appendChild(cell(formatSessionTime(participant.latestSessionAt)));

        const statusCell = document.createElement('td');
        const badge = document.createElement('span');
        const badgeClass = participant.needsReview ? 'review' : participant.completionStatus === 'No sessions' ? 'no-sessions' : (participant.completionStatus === 'Complete' ? 'complete' : 'incomplete');
        badge.className = `badge ${badgeClass}`;
        badge.textContent = participant.needsReview ? 'Review' : participant.completionStatus;
        statusCell.appendChild(badge);
        row.appendChild(statusCell);

        row.appendChild(actionsCell(participant));

        tbody.appendChild(row);
    }
}

// A small, subtle horizontal indicator alongside the percentage - never a
// second, competing source of truth: the width is derived directly from
// the same overallAccuracy value the text shows, nothing recomputed.
function accuracyCell(overallAccuracy) {
    const td = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'accuracy-cell';

    const value = document.createElement('span');
    value.className = 'accuracy-value';
    value.textContent = `${overallAccuracy.toFixed(1)}%`;
    wrap.appendChild(value);

    const track = document.createElement('div');
    track.className = 'accuracy-bar-track';
    const fill = document.createElement('div');
    const tier = overallAccuracy >= 80 ? 'tier-high' : overallAccuracy >= 50 ? 'tier-mid' : 'tier-low';
    fill.className = `accuracy-bar-fill ${tier}`;
    fill.style.width = `${Math.max(0, Math.min(100, overallAccuracy))}%`;
    track.appendChild(fill);
    wrap.appendChild(track);

    td.appendChild(wrap);
    return td;
}

function actionsCell(participant) {
    const td = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'row-actions';

    const reviewBtn = document.createElement('button');
    reviewBtn.type = 'button';
    reviewBtn.className = 'admin-button';
    reviewBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg><span>Review</span>';
    reviewBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        openParticipant(participant);
    });
    wrap.appendChild(reviewBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'admin-button danger';
    deleteBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg><span>Delete</span>';
    deleteBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        handleDelete(participant, deleteBtn);
    });
    wrap.appendChild(deleteBtn);

    td.appendChild(wrap);
    return td;
}

function openParticipant(participant) {
    window.location.href = `participant.html?id=${encodeURIComponent(participant.participantId)}`;
}

function cell(text) {
    const td = document.createElement('td');
    td.textContent = text;
    return td;
}

// Genuine, irreversible deletion - see routes/admin.js's own
// /participants/:id/hard-delete for exactly what this removes (every
// session/phase/recording/transcription/processing_run/response for this
// participant, their audio files, and the participant row itself).
// Requires the admin to actually TYPE the participant's own code (never
// just click "OK") - the backend independently re-checks this exact same
// value, so the UI requirement and the server-side guarantee match; typing
// the wrong code (or leaving it blank/cancelling) does nothing.
async function handleDelete(participant, deleteBtn) {
    const typed = window.prompt(
        `This permanently deletes participant ${participant.participantCode} and every session, recording, transcript, and response associated with them. This cannot be undone.\n\n` +
        `Type the participant ID (${participant.participantCode}) to confirm:`
    );
    if (typed !== participant.participantCode) {
        if (typed !== null) {
            setStatus('Delete cancelled - the participant ID you entered did not match.', true, false);
        }
        return;
    }

    deleteBtn.disabled = true;
    setStatus('Deleting…', false, true);
    try {
        const result = await adminFetch(`/api/admin/participants/${encodeURIComponent(participant.participantId)}/hard-delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirm: participant.participantCode })
        });
        const warningNote = result.fileWarnings && result.fileWarnings.length > 0
            ? ` Warning: ${result.fileWarnings.length} audio file(s) could not be removed from disk - see server logs.`
            : '';
        setStatus(`Deleted participant ${participant.participantCode} and all associated research data.${warningNote}`, warningNote.length > 0, false);
        await load();
    } catch (error) {
        setStatus(`Delete failed. ${error.message}`, true, false);
        deleteBtn.disabled = false;
    }
}

function renderPagination(result) {
    const { total, page, pageSize, totalPages } = result;
    if (total === 0) {
        paginationSummary.textContent = '';
        paginationControls.textContent = '';
        return;
    }
    const start = (page - 1) * pageSize + 1;
    const end = Math.min(total, page * pageSize);
    paginationSummary.textContent = `Showing ${start}–${end} of ${total} participant${total === 1 ? '' : 's'}`;

    paginationControls.textContent = '';
    paginationControls.appendChild(pageButton('←', page - 1, page <= 1));
    for (let p = 1; p <= totalPages; p += 1) {
        const btn = pageButton(String(p), p, false);
        if (p === page) btn.classList.add('active');
        paginationControls.appendChild(btn);
    }
    paginationControls.appendChild(pageButton('→', page + 1, page >= totalPages));
}

function pageButton(label, targetPage, disabled) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.disabled = disabled;
    btn.addEventListener('click', () => {
        state.page = targetPage;
        load();
    });
    return btn;
}

function renderSortIndicators() {
    sortableHeaders.forEach((th) => {
        let arrow = th.querySelector('.sort-arrow');
        if (!arrow) {
            arrow = document.createElement('span');
            arrow.className = 'sort-arrow';
            th.appendChild(arrow);
        }
        const isActive = th.dataset.sort === state.sort;
        th.classList.toggle('sort-active', isActive);
        arrow.textContent = isActive ? (state.sortDir === 'asc' ? '↑' : '↓') : '↕';
    });
}

function setStatus(message, isError, isLoading) {
    statusLine.textContent = message;
    statusLine.classList.toggle('is-error', isError);
    statusLine.classList.toggle('is-loading', isLoading);
}

function setControlsDisabled(disabled) {
    applyFiltersBtn.disabled = disabled;
    clearFiltersBtn.disabled = disabled;
}

function debouncedLoad() {
    clearTimeout(debounceHandle);
    debounceHandle = setTimeout(() => { state.page = 1; load(); }, 250);
}

sortableHeaders.forEach((th) => {
    th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (state.sort === key) {
            state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
            state.sort = key;
            state.sortDir = 'asc';
        }
        state.page = 1;
        load();
    });
});

searchInput.addEventListener('input', debouncedLoad);
minAccuracyInput.addEventListener('input', debouncedLoad);
statusFilter.addEventListener('change', () => { state.page = 1; load(); });
fromDateInput.addEventListener('change', () => { state.page = 1; load(); });
toDateInput.addEventListener('change', () => { state.page = 1; load(); });
needsReviewFilter.addEventListener('change', () => { state.page = 1; load(); });
applyFiltersBtn.addEventListener('click', () => { state.page = 1; load(); });
clearFiltersBtn.addEventListener('click', () => {
    searchInput.value = '';
    statusFilter.value = '';
    minAccuracyInput.value = '';
    fromDateInput.value = '';
    toDateInput.value = '';
    needsReviewFilter.checked = false;
    state.page = 1;
    load();
});

// Adds a participant the same way a first session for a brand-new code
// would (see routes/admin.js POST /participants - it goes through the
// exact same participantRepository.upsertByCode as the intake flow, just
// triggered by an admin instead of an actual session start). A plain
// window.prompt() matches the confirmation pattern already used for
// deletion above rather than introducing a new modal component for a
// single text field.
addParticipantBtn.addEventListener('click', async () => {
    const code = window.prompt('Enter the new participant\'s ID:');
    if (!code || !code.trim()) {
        return;
    }
    addParticipantBtn.disabled = true;
    setStatus('Adding participant…', false, true);
    try {
        const result = await adminFetch('/api/admin/participants', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ participantCode: code.trim() })
        });
        setStatus(`Added participant ${result.participantCode}.`, false, false);
        state.page = 1;
        await load();
    } catch (error) {
        setStatus(`Unable to add participant. ${error.message}`, true, false);
    } finally {
        addParticipantBtn.disabled = false;
    }
});

// Exports exactly the current filtered/sorted set (unpaginated - see
// routes/admin.js GET /participants/export) as a downloaded file. Fetched
// as a Blob (see adminApi.js#fetchExportBlob) rather than a plain <a href>
// so the admin bearer token can still be sent as a header, never a URL
// query param.
exportBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    exportMenu.hidden = !exportMenu.hidden;
});
document.addEventListener('click', () => { exportMenu.hidden = true; });

async function downloadExport(format) {
    exportMenu.hidden = true;
    setStatus(`Preparing ${format.toUpperCase()} export…`, false, true);
    try {
        const params = currentFilterParams();
        if (format === 'json') {
            const result = await adminFetch(`/api/admin/participants?${params.toString()}&pageSize=100000`);
            triggerDownload(new Blob([JSON.stringify(result.participants, null, 2)], { type: 'application/json' }), 'participants-export.json');
        } else {
            const blob = await fetchExportBlob(`/api/admin/participants/export?${params.toString()}`);
            triggerDownload(blob, 'participants-export.csv');
        }
        setStatus('', false, false);
    } catch (error) {
        setStatus(`Export failed. ${error.message}`, true, false);
    }
}

function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

exportCsvBtn.addEventListener('click', () => downloadExport('csv'));
exportJsonBtn.addEventListener('click', () => downloadExport('json'));

load();
