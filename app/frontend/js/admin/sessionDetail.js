import { adminFetch, fetchAudioObjectUrl } from './adminApi.js';

// Admin Session Review. Renders ONLY what the admin API returns - nothing
// here computes a new research metric:
//   GET /api/admin/sessions/:id              (adminQueryService.js#getSessionDetail)
//   GET /api/admin/sessions/:id/mouse/:phase (every stored click + target)
//
// Mouse data comes from the research database (POST /api/mouse-performance,
// stored per phase by services/mousePerformanceService.js). Sessions
// recorded before click-level capture existed have none, and say so.

const params = new URLSearchParams(window.location.search);
const sessionId = params.get('id');

const backLink = document.getElementById('backLink');
const participantHeading = document.getElementById('participantHeading');
const sessionHeading = document.getElementById('sessionHeading');
const sessionMeta = document.getElementById('sessionMeta');
const statusBadge = document.getElementById('statusBadge');
const summaryRow = document.getElementById('summaryRow');
const phasesSection = document.getElementById('phasesSection');
const phaseTableBody = document.getElementById('phaseTableBody');
const phaseDetail = document.getElementById('phaseDetail');
const statusLine = document.getElementById('statusLine');

const MOUSE_UNAVAILABLE = 'Mouse click data unavailable for this session';

// Phase types whose protocol runs the mouse task (see experiment/conditions.js).
const MOUSE_PHASE_TYPES = new Set(['motor', 'dual-task']);

// Static inline icons (no user data ever goes through innerHTML).
const ICONS = {
    mic: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v4"/></svg>',
    target: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>',
    list: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
    cursor: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l7 17 2.5-7.5L21 11z"/></svg>',
    clock: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    checkCircle: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16 10"/></svg>',
    xMark: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    percent: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 5L5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>',
    check: '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    cross: '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></svg>'
};

let currentDetail = null;
let rows = [];
let selectedIndex = 0;
const audioUrlCache = new Map();
const mouseDetailCache = new Map();

async function load() {
    if (!sessionId) {
        setStatus('No session id in the URL.', true);
        return;
    }
    setStatus('Loading…', false);
    try {
        const detail = await adminFetch(`/api/admin/sessions/${encodeURIComponent(sessionId)}`);
        currentDetail = detail;
        rows = buildRows(detail);
        const requestedIndex = rows.findIndex((row) => row.phaseId === params.get('phase'));
        selectedIndex = requestedIndex >= 0 ? requestedIndex : 0;
        render();
        setStatus('', false);
    } catch (error) {
        setStatus(`Unable to load session. ${error.message}`, true);
    }
}

// One row per phase: every recorded speech phase (with its stored mouse
// summary attached for dual-task phases), plus mouse-only phases (the
// clicking-only baseline) that have stored mouse data but no recording.
// Ordered by when each phase started.
function buildRows(detail) {
    const speechRows = detail.phases.map((phase) => ({
        phaseId: phase.phaseId,
        phaseType: phase.phaseType,
        startingNumber: phase.startingNumber,
        durationSeconds: phase.duration,
        startedAt: phase.startedAt,
        speech: phase,
        mouse: phase.mousePerformance || null
    }));
    const speechIds = new Set(speechRows.map((row) => row.phaseId));
    const mouseOnlyRows = (detail.mousePhases || [])
        .filter((m) => !speechIds.has(m.phaseId))
        .map((m) => ({
            phaseId: m.phaseId,
            phaseType: m.phaseType,
            startingNumber: null,
            durationSeconds: m.durationMs != null ? m.durationMs / 1000 : null,
            startedAt: m.phaseStartedAt || m.taskStartedAt,
            speech: null,
            mouse: m
        }));
    return [...mouseOnlyRows, ...speechRows]
        .map((row, order) => ({ row, order }))
        .sort((a, b) => {
            const at = Date.parse(a.row.startedAt);
            const bt = Date.parse(b.row.startedAt);
            if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) {
                return at - bt;
            }
            return a.order - b.order;
        })
        .map(({ row }) => row);
}

function render() {
    const detail = currentDetail;
    renderHeader(detail);
    renderSummary(detail);
    renderPhaseTable();
    renderPhaseDetail();
}

// --- Header ---------------------------------------------------------------

function renderHeader(detail) {
    if (detail.participantId) {
        backLink.href = `participant.html?id=${encodeURIComponent(detail.participantId)}`;
        backLink.textContent = `← Back to Participant ${detail.participantCode}`;
    }
    participantHeading.textContent = detail.participantCode
        ? `Participant ${detail.participantCode}`
        : 'Participant —';
    sessionHeading.textContent = `Session ${detail.sessionId}`;

    const timing = sessionTiming(detail);
    sessionMeta.textContent = [
        formatSessionDate(detail.sessionDate),
        timing.start ? formatTime(timing.start) : null,
        `Duration: ${timing.durationMs != null ? formatDuration(timing.durationMs) : '—'}`,
        `Status: ${detail.completionStatus}`
    ].filter(Boolean).join('  •  ');

    statusBadge.textContent = detail.completionStatus;
    statusBadge.className = `badge sr-status-badge ${detail.completionStatus === 'Complete' ? 'complete' : 'incomplete'}`;
    statusBadge.hidden = false;
}

// Session start/end come from the session row when the client sent them;
// otherwise from the earliest stored phase start to the latest stored phase
// end (speech phases and mouse phases) - flagged via `derived`.
function sessionTiming(detail) {
    if (detail.startTime && detail.endTime) {
        return { start: detail.startTime, durationMs: Date.parse(detail.endTime) - Date.parse(detail.startTime), derived: false };
    }
    const mousePhases = detail.mousePhases || [];
    const starts = [...detail.phases.map((p) => p.startedAt), ...mousePhases.map((m) => m.phaseStartedAt || m.taskStartedAt)]
        .filter(Boolean).map(Date.parse).filter(Number.isFinite);
    const ends = [...detail.phases.map((p) => p.endedAt), ...mousePhases.map((m) => m.taskEndedAt)]
        .filter(Boolean).map(Date.parse).filter(Number.isFinite);
    const start = detail.startTime || (starts.length ? new Date(Math.min(...starts)).toISOString() : null);
    const durationMs = start && ends.length ? Math.max(...ends) - Date.parse(start) : null;
    return { start, durationMs: durationMs != null && durationMs >= 0 ? durationMs : null, derived: true };
}

// --- Summary cards -------------------------------------------------------

function renderSummary(detail) {
    summaryRow.textContent = '';
    const timing = sessionTiming(detail);
    const mouse = detail.mouseTotals;

    summaryRow.appendChild(summaryCard({
        icon: 'mic', tone: 'blue', label: 'Cognitive Accuracy',
        value: formatAccuracy(detail),
        sub: [`Correct: ${detail.correctResponses}`, `Incorrect: ${detail.incorrectResponses}`]
    }));
    summaryRow.appendChild(summaryCard(mouse
        ? {
            icon: 'target', tone: 'green', label: 'Mouse Accuracy',
            value: formatPercent(mouse.totalAccuracy),
            sub: [`Hits: ${mouse.totalHits}`, `Misses: ${mouse.totalMisses}`]
        }
        : { icon: 'target', tone: 'green', label: 'Mouse Accuracy', value: 'Unavailable', muted: true, sub: [MOUSE_UNAVAILABLE] }));
    summaryRow.appendChild(summaryCard({
        icon: 'list', tone: 'purple', label: 'Total Responses (Cognitive)',
        value: String(detail.totalResponses),
        sub: detail.unresolvedResponses > 0 ? [`Unresolved: ${detail.unresolvedResponses}`] : []
    }));
    summaryRow.appendChild(summaryCard(mouse
        ? {
            icon: 'cursor', tone: 'amber', label: 'Total Clicks (Mouse)',
            value: String(mouse.totalClicks),
            sub: [`Across ${mouse.phaseCount} mouse phase${mouse.phaseCount === 1 ? '' : 's'}`]
        }
        : { icon: 'cursor', tone: 'amber', label: 'Total Clicks (Mouse)', value: 'Unavailable', muted: true, sub: [MOUSE_UNAVAILABLE] }));
    summaryRow.appendChild(summaryCard({
        icon: 'clock', tone: 'red', label: 'Session Duration',
        value: timing.durationMs != null ? formatDuration(timing.durationMs) : '—',
        sub: timing.derived && timing.durationMs != null ? ['First to last recorded phase'] : []
    }));
}

function summaryCard({ icon, tone, label, value, sub = [], muted = false }) {
    const card = el('div', 'sr-summary-card');
    const iconWrap = el('span', `sr-icon ${tone}`);
    iconWrap.innerHTML = ICONS[icon];
    card.appendChild(iconWrap);

    const body = el('div', 'sr-summary-body');
    body.appendChild(el('div', 'sr-summary-label', label));
    body.appendChild(el('div', `sr-summary-value${muted ? ' is-muted' : ''}`, value));
    if (sub.length) {
        const subEl = el('div', 'sr-summary-sub');
        sub.forEach((text, i) => {
            if (i > 0) {
                subEl.appendChild(el('span', 'sr-sep', '|'));
            }
            subEl.appendChild(el('span', null, text));
        });
        body.appendChild(subEl);
    }
    card.appendChild(body);
    return card;
}

// --- Experiment phases table ---------------------------------------------

function renderPhaseTable() {
    phaseTableBody.textContent = '';
    phasesSection.hidden = rows.length === 0;

    rows.forEach((row, index) => {
        const tr = document.createElement('tr');
        tr.classList.toggle('is-selected', index === selectedIndex);
        tr.addEventListener('click', () => selectPhase(index));

        tr.appendChild(td(String(index + 1)));
        tr.appendChild(td(row.phaseId, 'sr-phase-name'));
        tr.appendChild(td(conditionLabel(row)));
        tr.appendChild(td(row.startingNumber != null ? String(row.startingNumber) : '—'));
        tr.appendChild(td(row.durationSeconds != null ? `${row.durationSeconds}s` : '—'));
        tr.appendChild(row.speech ? td(formatAccuracy(row.speech)) : td('N/A', 'sr-muted'));
        tr.appendChild(mouseAccuracyCell(row));
        if (row.speech) {
            tr.appendChild(availabilityCell(row.speech.recording ? 'yes' : 'no', row.speech.recording ? 'Audio available' : 'No recording'));
            tr.appendChild(transcriptCell(row.speech));
        } else {
            tr.appendChild(td('N/A', 'sr-center sr-muted'));
            tr.appendChild(td('N/A', 'sr-center sr-muted'));
        }

        const viewCell = td('');
        const viewBtn = el('button', `sr-view-btn${index === selectedIndex ? ' is-active' : ''}`, 'View');
        viewBtn.type = 'button';
        viewBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            selectPhase(index);
        });
        viewCell.appendChild(viewBtn);
        tr.appendChild(viewCell);

        phaseTableBody.appendChild(tr);
    });
}

function mouseAccuracyCell(row) {
    if (row.mouse) {
        return td(formatPercent(row.mouse.totalAccuracy));
    }
    const cell = td(isMousePhase(row) ? 'Unavailable' : 'N/A', 'sr-muted');
    if (isMousePhase(row)) {
        cell.title = MOUSE_UNAVAILABLE;
    }
    return cell;
}

function transcriptCell(phase) {
    if (phase.transcriptionStatus === 'failed') {
        return availabilityCell('no', 'Transcription failed');
    }
    if (phase.rawTranscript != null) {
        return availabilityCell('yes', `Transcript available (v${phase.transcriptionVersion})`);
    }
    return availabilityCell('pending', 'Transcript pending');
}

function availabilityCell(state, title) {
    const cell = td('', 'sr-center');
    const mark = el('span', `sr-mark ${state}`);
    mark.title = title;
    mark.setAttribute('aria-label', title);
    if (state === 'yes') {
        mark.innerHTML = ICONS.check;
    } else if (state === 'no') {
        mark.innerHTML = ICONS.cross;
    } else {
        mark.textContent = '—';
    }
    cell.appendChild(mark);
    return cell;
}

function selectPhase(index) {
    if (index === selectedIndex) {
        return;
    }
    selectedIndex = index;
    const url = new URL(window.location.href);
    url.searchParams.set('phase', rows[index].phaseId);
    window.history.replaceState(null, '', url);
    renderPhaseTable();
    renderPhaseDetail();
}

// --- Selected phase detail -----------------------------------------------

function renderPhaseDetail() {
    // A detached <audio> keeps playing, so stop it before replacing it.
    phaseDetail.querySelectorAll('audio').forEach((audio) => audio.pause());
    phaseDetail.textContent = '';

    const row = rows[selectedIndex];
    if (!row) {
        return;
    }
    const hasMouseSection = isMousePhase(row) || Boolean(row.mouse);

    const topGrid = el('div', 'sr-detail-grid');
    const left = el('div', 'sr-detail-main');
    left.appendChild(renderPhaseHeading(row, selectedIndex));
    if (row.speech) {
        left.appendChild(renderAudioCard(row.speech));
    }
    topGrid.appendChild(left);
    topGrid.appendChild(renderPhaseSummary(row));
    phaseDetail.appendChild(topGrid);

    const bottomGrid = el('div', `sr-detail-grid${row.speech && hasMouseSection ? '' : ' is-single'}`);
    if (row.speech) {
        bottomGrid.appendChild(renderCognitiveCard(row.speech));
    }
    if (hasMouseSection) {
        bottomGrid.appendChild(renderMouseCard(row));
    }
    phaseDetail.appendChild(bottomGrid);

    if (row.mouse) {
        phaseDetail.appendChild(renderClickEventsCard(row));
    }
    if (row.speech) {
        phaseDetail.appendChild(renderTranscriptCard(row.speech));
    }
}

function phaseBadgeLabel(row) {
    if (row.phaseType === 'dual-task') {
        return 'Dual Task';
    }
    if (row.phaseType === 'motor') {
        return 'Clicking Task';
    }
    return 'Cognitive Task';
}

function renderPhaseHeading(row, index) {
    const wrap = el('div', 'sr-phase-heading');
    const titleRow = el('div', 'sr-phase-title-row');
    titleRow.appendChild(el('h3', 'sr-phase-title', `Phase ${index + 1}: ${row.phaseId}`));
    titleRow.appendChild(el('span', 'sr-type-badge', phaseBadgeLabel(row)));
    wrap.appendChild(titleRow);

    const speech = row.speech;
    wrap.appendChild(el('p', 'sr-meta', [
        conditionDescription(row),
        row.startingNumber != null ? `Starting number: ${row.startingNumber}` : null,
        // Dual-task phases only - see adminQueryService.js#_applyDualTaskContinuity:
        // the count continues from the count-only phase's last valid number.
        speech && speech.countOnlyFinalNumber != null ? `Count-only ended at ${speech.countOnlyFinalNumber}` : null,
        speech && speech.dualTaskContinuationNumber != null ? `Continued from ${speech.dualTaskContinuationNumber}` : null,
        row.durationSeconds != null ? `Duration: ${row.durationSeconds} seconds` : null
    ].filter(Boolean).join('  •  ')));
    return wrap;
}

function renderAudioCard(phase) {
    const card = el('section', 'sr-card');
    card.appendChild(el('h3', 'sr-card-title', 'Audio Recording (Speech)'));

    if (!phase.recording) {
        card.appendChild(el('p', 'empty-note', 'No recording available.'));
        return card;
    }

    const audioEl = document.createElement('audio');
    audioEl.controls = true;
    audioEl.preload = 'metadata';
    card.appendChild(audioEl);

    const { recordingId } = phase.recording;
    if (!audioUrlCache.has(recordingId)) {
        audioUrlCache.set(recordingId, fetchAudioObjectUrl(recordingId));
    }
    audioUrlCache.get(recordingId)
        .then((url) => { audioEl.src = url; })
        .catch((error) => {
            audioUrlCache.delete(recordingId);
            card.appendChild(el('p', 'error-box', `Unable to load recording. ${error.message}`));
        });
    return card;
}

function renderPhaseSummary(row) {
    const panel = el('section', 'sr-card sr-summary-panel');
    panel.appendChild(el('h3', 'sr-card-title', 'Phase Summary'));
    const cards = el('div', 'sr-summary-panel-cards');

    if (row.speech) {
        const phase = row.speech;
        const sub = [`Correct: ${phase.correctResponses}`, `Incorrect: ${phase.incorrectResponses}`];
        if (phase.unresolvedResponses > 0) {
            sub.push(`Unresolved: ${phase.unresolvedResponses}`);
        }
        cards.appendChild(summaryCard({ icon: 'mic', tone: 'blue', label: 'Cognitive (Counting)', value: formatAccuracy(phase), sub }));
    }
    if (row.mouse) {
        const m = row.mouse;
        const sub = [`Hits: ${m.totalHits}`, `Misses: ${m.totalMisses}`, `Total Clicks: ${m.totalClicks}`];
        if (m.avgReactionTimeMs != null) {
            sub.push(`Avg. Reaction Time: ${formatMs(m.avgReactionTimeMs)}`);
        }
        cards.appendChild(summaryCard({ icon: 'cursor', tone: 'amber', label: 'Mouse (Clicking)', value: formatPercent(m.totalAccuracy), sub }));
    }
    panel.appendChild(cards);
    return panel;
}

function renderCognitiveCard(phase) {
    const card = el('section', 'sr-card');
    card.appendChild(el('h3', 'sr-card-title', 'Cognitive Performance (Speech / Counting)'));

    if (phase.transcriptionStatus === 'failed') {
        card.appendChild(el('p', 'error-box', `Transcription failed: ${phase.transcriptionError || 'unknown error'}`));
    }
    if (phase.responses.length === 0) {
        card.appendChild(el('p', 'empty-note', 'No scored responses for this phase.'));
        return card;
    }
    card.appendChild(renderResponseTable(phase.responses));
    return card;
}

function renderResponseTable(responses) {
    const wrap = el('div', 'sr-table-wrap sr-scroll-wrap');
    const table = el('table', 'admin-table sr-table sr-sticky-table');
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>#</th><th>Expected</th><th>User Said</th><th class="sr-center">Correct</th><th>Next Expected</th><th>Transcript Segment</th></tr>';
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const response of responses) {
        const tr = document.createElement('tr');
        tr.appendChild(td(String(response.response_index + 1)));
        tr.appendChild(td(response.expected_number != null ? String(response.expected_number) : '—'));
        tr.appendChild(td(response.actual_number != null ? String(response.actual_number) : '—'));

        const correctness = response.correctness;
        const correctCell = td('', 'sr-center');
        const mark = el('span', `sr-verdict ${correctness}`);
        mark.textContent = correctness === 'correct' ? '✓' : correctness === 'incorrect' ? '✗' : '?';
        mark.title = correctness;
        correctCell.appendChild(mark);
        tr.appendChild(correctCell);

        tr.appendChild(td(response.next_expected_number != null ? String(response.next_expected_number) : '—'));
        tr.appendChild(td(response.raw_transcript_segment || '—', 'sr-segment'));
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
}

// --- Mouse performance ---------------------------------------------------

function loadMouseDetail(phaseId) {
    if (!mouseDetailCache.has(phaseId)) {
        const request = adminFetch(`/api/admin/sessions/${encodeURIComponent(sessionId)}/mouse/${encodeURIComponent(phaseId)}`);
        request.catch(() => mouseDetailCache.delete(phaseId));
        mouseDetailCache.set(phaseId, request);
    }
    return mouseDetailCache.get(phaseId);
}

function renderMouseCard(row) {
    const card = el('section', 'sr-card');
    card.appendChild(el('h3', 'sr-card-title', 'Mouse Performance (Clicking)'));

    const m = row.mouse;
    if (!m) {
        const note = el('div', 'sr-not-stored');
        note.appendChild(el('p', 'sr-not-stored-title', MOUSE_UNAVAILABLE));
        note.appendChild(el('p', null,
            'This session was recorded before mouse click data was saved to the research server, ' +
            'so no clicks were stored for this phase.'));
        card.appendChild(note);
        return card;
    }

    const tiles = el('div', 'sr-metric-grid');
    tiles.appendChild(metricTile({ icon: 'target', tone: 'green', label: 'Total Clicks', value: String(m.totalClicks) }));
    tiles.appendChild(metricTile({ icon: 'checkCircle', tone: 'blue', label: 'Successful Clicks', value: String(m.totalHits) }));
    tiles.appendChild(metricTile({ icon: 'xMark', tone: 'red', label: 'Missed Clicks', value: String(m.totalMisses) }));
    tiles.appendChild(metricTile({ icon: 'percent', tone: 'purple', label: 'Click Accuracy', value: formatPercent(m.totalAccuracy) }));
    tiles.appendChild(metricTile({ icon: 'list', tone: 'purple', label: 'Total Targets', value: String(m.totalTargets) }));
    tiles.appendChild(metricTile({
        icon: 'target', tone: 'green', label: 'Target Efficiency',
        value: m.targetEfficiency != null ? formatPercent(m.targetEfficiency) : '—'
    }));
    card.appendChild(tiles);

    const reaction = el('div', 'sr-reaction-strip');
    const reactionIcon = el('span', 'sr-icon amber');
    reactionIcon.innerHTML = ICONS.clock;
    reaction.appendChild(reactionIcon);
    const avg = el('div', 'sr-reaction-main');
    avg.appendChild(el('div', 'sr-summary-label', 'Avg. Reaction Time'));
    avg.appendChild(el('div', 'sr-summary-value', m.avgReactionTimeMs != null ? formatMs(m.avgReactionTimeMs) : '—'));
    reaction.appendChild(avg);
    for (const [label, value] of [['Min', m.minReactionTimeMs], ['Max', m.maxReactionTimeMs], ['Median', m.medianReactionTimeMs]]) {
        reaction.appendChild(el('div', 'sr-reaction-stat', `${label}: ${value != null ? formatMs(value) : '—'}`));
    }
    card.appendChild(reaction);

    const chartWrap = el('div', 'sr-chart');
    chartWrap.appendChild(el('h4', 'sr-chart-title', 'Click Performance Over Time'));
    const chartBody = el('div', 'sr-chart-body');
    chartBody.appendChild(el('p', 'empty-note', 'Loading click events…'));
    chartWrap.appendChild(chartBody);
    card.appendChild(chartWrap);

    loadMouseDetail(row.phaseId)
        .then((detail) => {
            chartBody.textContent = '';
            chartBody.appendChild(renderReactionChart(detail));
        })
        .catch((error) => {
            chartBody.textContent = '';
            chartBody.appendChild(el('p', 'error-box', `Unable to load click events. ${error.message}`));
        });
    return card;
}

function metricTile({ icon, tone, label, value }) {
    const tile = el('div', 'sr-metric-tile');
    const iconWrap = el('span', `sr-icon sm ${tone}`);
    iconWrap.innerHTML = ICONS[icon];
    tile.appendChild(iconWrap);
    const body = el('div', 'sr-summary-body');
    body.appendChild(el('div', 'sr-summary-label', label));
    body.appendChild(el('div', 'sr-metric-value', value));
    tile.appendChild(body);
    return tile;
}

// Scatter of every stored hit: x = seconds into the phase, y = reaction
// time. Misses have no reaction time, so they are counted, not plotted.
function renderReactionChart(detail) {
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const hits = detail.clickEvents.filter((c) => c.isHit && c.reactionTimeMs != null);
    const misses = detail.clickEvents.length - hits.length;
    const frag = document.createDocumentFragment();

    frag.appendChild(el('p', 'sr-chart-caption',
        `Reaction time of each successful click (${hits.length} hit${hits.length === 1 ? '' : 's'}). ` +
        `${misses} missed click${misses === 1 ? '' : 's'} ${misses === 1 ? 'has' : 'have'} no reaction time and ${misses === 1 ? 'is' : 'are'} not plotted.`));
    if (hits.length === 0) {
        frag.appendChild(el('p', 'empty-note', 'No successful clicks to plot.'));
        return frag;
    }

    const W = 640;
    const H = 240;
    const pad = { top: 12, right: 16, bottom: 40, left: 58 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;

    const lastClickSec = Math.max(...hits.map((c) => c.elapsedMs)) / 1000;
    const xMax = niceCeil(Math.max(detail.durationMs != null ? detail.durationMs / 1000 : 0, lastClickSec, 1));
    const yMax = niceCeil(Math.max(...hits.map((c) => c.reactionTimeMs), 1));
    const x = (sec) => pad.left + (sec / xMax) * plotW;
    const y = (ms) => pad.top + plotH - (ms / yMax) * plotH;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'sr-chart-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Reaction time of ${hits.length} successful clicks over the phase`);

    const add = (tag, attrs, text) => {
        const node = document.createElementNS(SVG_NS, tag);
        for (const [k, v] of Object.entries(attrs)) {
            node.setAttribute(k, v);
        }
        if (text != null) {
            node.textContent = text;
        }
        svg.appendChild(node);
        return node;
    };

    const Y_TICKS = 4;
    for (let i = 0; i <= Y_TICKS; i += 1) {
        const value = (yMax / Y_TICKS) * i;
        add('line', { x1: pad.left, x2: W - pad.right, y1: y(value), y2: y(value), class: i === 0 ? 'sr-axis-line' : 'sr-grid-line' });
        add('text', { x: pad.left - 8, y: y(value) + 4, 'text-anchor': 'end', class: 'sr-tick' }, formatTick(value));
    }
    const X_TICKS = 6;
    for (let i = 0; i <= X_TICKS; i += 1) {
        const value = (xMax / X_TICKS) * i;
        add('text', { x: x(value), y: pad.top + plotH + 16, 'text-anchor': 'middle', class: 'sr-tick' }, formatTick(value));
    }
    add('text', { x: pad.left + plotW / 2, y: H - 4, 'text-anchor': 'middle', class: 'sr-axis-label' }, 'Time (seconds)');
    add('text', { x: 14, y: pad.top + plotH / 2, 'text-anchor': 'middle', class: 'sr-axis-label', transform: `rotate(-90 14 ${pad.top + plotH / 2})` }, 'Reaction Time (ms)');

    for (const c of hits) {
        const cx = x(c.elapsedMs / 1000);
        const cy = y(c.reactionTimeMs);
        const group = document.createElementNS(SVG_NS, 'g');
        group.setAttribute('class', 'sr-dot');
        const hitArea = document.createElementNS(SVG_NS, 'circle');
        hitArea.setAttribute('cx', cx);
        hitArea.setAttribute('cy', cy);
        hitArea.setAttribute('r', 9);
        hitArea.setAttribute('class', 'sr-dot-hit');
        const dot = document.createElementNS(SVG_NS, 'circle');
        dot.setAttribute('cx', cx);
        dot.setAttribute('cy', cy);
        dot.setAttribute('r', 4);
        dot.setAttribute('class', 'sr-dot-mark');
        const title = document.createElementNS(SVG_NS, 'title');
        title.textContent = `Click #${c.clickSequence} · ${(c.elapsedMs / 1000).toFixed(2)}s · ${formatMs(c.reactionTimeMs)} (target ${c.targetId})`;
        group.appendChild(title);
        group.appendChild(hitArea);
        group.appendChild(dot);
        svg.appendChild(group);
    }

    frag.appendChild(svg);
    return frag;
}

function renderClickEventsCard(row) {
    const card = el('section', 'sr-card');
    const title = el('h3', 'sr-card-title', 'Click Events');
    card.appendChild(title);
    const body = el('div');
    body.appendChild(el('p', 'empty-note', 'Loading click events…'));
    card.appendChild(body);

    loadMouseDetail(row.phaseId)
        .then((detail) => {
            body.textContent = '';
            title.textContent = `Click Events (${detail.clickEvents.length} clicks, ${detail.targets.length} targets)`;
            if (detail.clickEvents.length === 0) {
                body.appendChild(el('p', 'empty-note', 'No clicks were made during this phase.'));
                return;
            }
            body.appendChild(renderClickTable(detail.clickEvents));
            if (detail.containerWidth != null && detail.containerHeight != null) {
                body.appendChild(el('p', 'sr-footnote',
                    `X/Y are pixels from the top-left of the ${Math.round(detail.containerWidth)} × ${Math.round(detail.containerHeight)} px target field. ` +
                    `Target size ${detail.targetSizePx ?? '—'} px; each target stays up to ${detail.targetLifetimeMs != null ? formatMs(detail.targetLifetimeMs) : '—'}.`));
            }
        })
        .catch((error) => {
            body.textContent = '';
            body.appendChild(el('p', 'error-box', `Unable to load click events. ${error.message}`));
        });
    return card;
}

function renderClickTable(clickEvents) {
    const wrap = el('div', 'sr-table-wrap sr-scroll-wrap');
    const table = el('table', 'admin-table sr-table sr-sticky-table');
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>#</th><th>Time (s)</th><th>X</th><th>Y</th><th class="sr-center">Hit/Miss</th><th>Target</th><th>Target X, Y</th><th>Reaction Time</th><th>Targets on Screen</th></tr>';
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const c of clickEvents) {
        const tr = document.createElement('tr');
        tr.appendChild(td(String(c.clickSequence)));
        tr.appendChild(td(c.elapsedMs != null ? (c.elapsedMs / 1000).toFixed(2) : '—'));
        tr.appendChild(td(c.x != null ? String(Math.round(c.x)) : '—'));
        tr.appendChild(td(c.y != null ? String(Math.round(c.y)) : '—'));

        const verdictCell = td('', 'sr-center');
        verdictCell.appendChild(el('span', `sr-verdict ${c.isHit ? 'correct' : 'incorrect'}`, c.isHit ? '✓ Hit' : '✗ Miss'));
        tr.appendChild(verdictCell);

        tr.appendChild(td(c.targetId != null ? `#${c.targetId}` : '—'));
        tr.appendChild(td(c.targetX != null && c.targetY != null ? `${Math.round(c.targetX)}, ${Math.round(c.targetY)}` : '—'));
        tr.appendChild(td(c.reactionTimeMs != null ? formatMs(c.reactionTimeMs) : '—'));
        tr.appendChild(td(c.activeTargetCount != null ? String(c.activeTargetCount) : (c.targetActive ? 'Yes' : 'No')));
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
}

function renderTranscriptCard(phase) {
    const card = el('section', 'sr-card');
    const title = phase.rawTranscript != null && phase.transcriptionVersion != null
        ? `Transcript (v${phase.transcriptionVersion}, exactly as returned by the transcription service)`
        : 'Transcript';
    card.appendChild(el('h3', 'sr-card-title', title));

    if (phase.rawTranscript != null) {
        card.appendChild(el('p', 'transcript-box', phase.rawTranscript));
    } else {
        card.appendChild(el('p', 'empty-note', 'No transcription available.'));
    }

    if (phase.recording) {
        const reprocessBtn = el('button', 'admin-button', 'Reprocess recording');
        reprocessBtn.type = 'button';
        const reprocessStatus = el('p', 'status-line');
        reprocessBtn.addEventListener('click', async () => {
            reprocessBtn.disabled = true;
            reprocessStatus.textContent = 'Reprocessing…';
            reprocessStatus.classList.remove('is-error');
            try {
                const result = await adminFetch(`/api/admin/recordings/${phase.recording.recordingId}/reprocess`, { method: 'POST' });
                reprocessStatus.textContent = result.status === 'succeeded'
                    ? `Reprocessed - now transcription version ${result.transcriptionVersion}. Reloading…`
                    : `Reprocessing failed: ${result.error}`;
                if (result.status === 'succeeded') {
                    setTimeout(() => window.location.reload(), 800);
                }
            } catch (error) {
                reprocessStatus.textContent = error.message;
                reprocessStatus.classList.add('is-error');
            } finally {
                reprocessBtn.disabled = false;
            }
        });
        card.appendChild(reprocessBtn);
        card.appendChild(reprocessStatus);
    }
    return card;
}

// --- Helpers ---------------------------------------------------------------

function isMousePhase(row) {
    return MOUSE_PHASE_TYPES.has(row.phaseType);
}

function conditionLabel(row) {
    if (row.phaseType === 'motor') {
        return 'Clicking only (baseline)';
    }
    if (row.speech && row.speech.subtractionValue != null) {
        const value = row.speech.subtractionValue;
        return row.phaseType === 'dual-task' ? `Count by ${value} + Clicking` : `Count by ${value} (cognitive)`;
    }
    return row.phaseType || '—';
}

function conditionDescription(row) {
    if (row.phaseType === 'motor') {
        return 'Click targets only (motor baseline)';
    }
    if (row.speech && row.speech.subtractionValue != null) {
        const value = row.speech.subtractionValue;
        return row.phaseType === 'dual-task'
            ? `Count backward by ${value} while clicking targets`
            : `Count backward by ${value}`;
    }
    return row.phaseType || '';
}

// overallAccuracy is the backend's own value (adminQueryService.js#summarizeResponses);
// it reports 0 when nothing was scored, so show "—" instead of a false 0%.
function formatAccuracy(source) {
    const scored = source.correctResponses + source.incorrectResponses;
    return scored > 0 ? `${source.overallAccuracy.toFixed(1)}%` : '—';
}

function formatPercent(value) {
    return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}%` : '—';
}

function formatMs(value) {
    return `${Math.round(value)} ms`;
}

function niceCeil(value) {
    const magnitude = 10 ** Math.floor(Math.log10(value));
    for (const step of [1, 2, 2.5, 5, 10]) {
        if (step * magnitude >= value) {
            return step * magnitude;
        }
    }
    return 10 * magnitude;
}

function formatTick(value) {
    return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1);
}

function formatSessionDate(sessionDate) {
    if (!sessionDate) {
        return null;
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(sessionDate);
    const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(sessionDate);
    return Number.isNaN(date.getTime())
        ? sessionDate
        : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatDuration(ms) {
    const totalSeconds = Math.round(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text != null) {
        node.textContent = text;
    }
    return node;
}

function td(text, className) {
    return el('td', className, text);
}

function setStatus(message, isError) {
    statusLine.textContent = message;
    statusLine.classList.toggle('is-error', isError);
}

load();
