import { adminFetch } from './adminApi.js';

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

        const statusCell = document.createElement('td');
        const badge = document.createElement('span');
        badge.className = `badge ${participant.needsReview ? 'review' : (participant.completionStatus === 'Complete' ? 'complete' : 'incomplete')}`;
        badge.textContent = participant.needsReview ? 'Review' : participant.completionStatus;
        statusCell.appendChild(badge);
        row.appendChild(statusCell);

        tbody.appendChild(row);
    }
}

function cell(text) {
    const td = document.createElement('td');
    td.textContent = text;
    return td;
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
