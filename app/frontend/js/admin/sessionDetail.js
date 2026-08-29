import { adminFetch, fetchAudioObjectUrl } from './adminApi.js';

const params = new URLSearchParams(window.location.search);
const sessionId = params.get('id');

const heading = document.getElementById('sessionHeading');
const statRow = document.getElementById('statRow');
const phasesContainer = document.getElementById('phasesContainer');
const statusLine = document.getElementById('statusLine');
const backLink = document.getElementById('backLink');

function statCard(label, value) {
    const card = document.createElement('div');
    card.className = 'stat-card';
    const valueEl = document.createElement('div');
    valueEl.className = 'value';
    valueEl.textContent = value;
    const labelEl = document.createElement('div');
    labelEl.className = 'label';
    labelEl.textContent = label;
    card.appendChild(valueEl);
    card.appendChild(labelEl);
    return card;
}

async function load() {
    if (!sessionId) {
        setStatus('No session id in the URL.', true);
        return;
    }
    try {
        const detail = await adminFetch(`/api/admin/sessions/${encodeURIComponent(sessionId)}`);
        render(detail);
    } catch (error) {
        setStatus(error.message, true);
    }
}

function render(detail) {
    if (detail.participantId) {
        backLink.href = `participant.html?id=${encodeURIComponent(detail.participantId)}`;
        backLink.textContent = `← Participant ${detail.participantCode}`;
    }

    heading.textContent = `Session ${detail.sessionId}`;

    statRow.textContent = '';
    statRow.appendChild(statCard('Overall accuracy', `${detail.overallAccuracy.toFixed(1)}%`));
    statRow.appendChild(statCard('Total responses', String(detail.totalResponses)));
    statRow.appendChild(statCard('Correct', String(detail.correctResponses)));
    statRow.appendChild(statCard('Incorrect (sequence deviations)', String(detail.incorrectResponses)));
    statRow.appendChild(statCard('Unresolved', String(detail.unresolvedResponses)));
    statRow.appendChild(statCard('Status', detail.completionStatus));

    phasesContainer.textContent = '';
    for (const phase of detail.phases) {
        phasesContainer.appendChild(renderPhaseBlock(phase));
    }

    setStatus('', false);
}

function renderPhaseBlock(phase) {
    const block = document.createElement('div');
    block.className = 'phase-block';

    const header = document.createElement('div');
    header.className = 'phase-block-header';
    const title = document.createElement('h3');
    title.textContent = phase.phaseId;
    header.appendChild(title);

    const meta = document.createElement('p');
    meta.className = 'mono';
    meta.style.margin = '0';
    meta.style.fontSize = '12px';
    meta.style.color = 'var(--slate)';
    meta.textContent = [
        phase.subtractionValue != null ? `Subtract by ${phase.subtractionValue}` : null,
        phase.startingNumber != null ? `Starting number ${phase.startingNumber}` : null,
        phase.duration != null ? `Duration ${phase.duration}s` : null,
        `Audio: ${phase.recording ? 'Available' : 'Unavailable'}`,
        `Transcript: ${phase.rawTranscript != null ? `Available (v${phase.transcriptionVersion})` : 'Unavailable'}`
    ].filter(Boolean).join(' · ');
    header.appendChild(meta);
    block.appendChild(header);

    const body = document.createElement('div');
    body.className = 'phase-block-body';

    if (phase.transcriptionStatus === 'failed') {
        const err = document.createElement('p');
        err.className = 'error-box';
        err.textContent = `Transcription failed: ${phase.transcriptionError || 'unknown error'}`;
        body.appendChild(err);
    }

    if (phase.recording) {
        const audioLabel = document.createElement('p');
        audioLabel.className = 'eyebrow';
        audioLabel.textContent = '🎧 Original Session Recording';
        body.appendChild(audioLabel);

        const audioEl = document.createElement('audio');
        audioEl.controls = true;
        body.appendChild(audioEl);
        fetchAudioObjectUrl(phase.recording.recordingId)
            .then((url) => { audioEl.src = url; })
            .catch((error) => {
                const err = document.createElement('p');
                err.className = 'error-box';
                err.textContent = `Could not load audio: ${error.message}`;
                body.appendChild(err);
            });
    }

    if (phase.rawTranscript != null) {
        const transcriptLabel = document.createElement('p');
        transcriptLabel.className = 'eyebrow';
        transcriptLabel.textContent = 'Raw transcript (exactly as returned by the transcription service)';
        body.appendChild(transcriptLabel);

        const transcriptBox = document.createElement('p');
        transcriptBox.className = 'transcript-box';
        transcriptBox.textContent = phase.rawTranscript;
        body.appendChild(transcriptBox);
    }

    if (phase.responses.length > 0) {
        body.appendChild(renderResponseTable(phase.responses));
    }

    if (phase.recording) {
        const reprocessBtn = document.createElement('button');
        reprocessBtn.className = 'admin-button';
        reprocessBtn.type = 'button';
        reprocessBtn.textContent = 'Reprocess recording';
        const reprocessStatus = document.createElement('p');
        reprocessStatus.className = 'status-line';
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
        body.appendChild(reprocessBtn);
        body.appendChild(reprocessStatus);
    }

    block.appendChild(body);
    return block;
}

function renderResponseTable(responses) {
    const wrap = document.createElement('div');
    wrap.className = 'admin-table-wrap';
    wrap.style.marginTop = '14px';

    const table = document.createElement('table');
    table.className = 'admin-table';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>#</th><th>Expected</th><th>User Said</th><th>Correct</th><th>Next Expected</th><th>Transcript Segment</th></tr>';
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const response of responses) {
        const tr = document.createElement('tr');
        const correctness = response.correctness;
        tr.classList.add(correctness === 'correct' ? 'row-correct' : correctness === 'incorrect' ? 'row-incorrect' : 'row-unresolved');

        tr.appendChild(td(String(response.response_index + 1)));
        tr.appendChild(td(response.expected_number != null ? String(response.expected_number) : '—'));
        tr.appendChild(td(response.actual_number != null ? String(response.actual_number) : '—'));

        const correctCell = document.createElement('td');
        correctCell.className = `row ${correctness}`;
        correctCell.textContent = correctness === 'correct' ? '✓' : correctness === 'incorrect' ? '✗' : '?';
        tr.appendChild(correctCell);

        tr.appendChild(td(response.next_expected_number != null ? String(response.next_expected_number) : '—'));
        tr.appendChild(td(response.raw_transcript_segment || '—'));

        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
}

function td(text) {
    const cell = document.createElement('td');
    cell.textContent = text;
    return cell;
}

function setStatus(message, isError) {
    statusLine.textContent = message;
    statusLine.classList.toggle('is-error', isError);
}

load();
