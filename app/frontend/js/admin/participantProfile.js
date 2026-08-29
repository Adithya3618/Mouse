import { adminFetch } from './adminApi.js';

const params = new URLSearchParams(window.location.search);
const participantId = params.get('id');

const heading = document.getElementById('participantHeading');
const statRow = document.getElementById('statRow');
const sessionsList = document.getElementById('sessionsList');
const statusLine = document.getElementById('statusLine');

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
    if (!participantId) {
        statusLine.textContent = 'No participant id in the URL.';
        statusLine.classList.add('is-error');
        return;
    }

    try {
        const profile = await adminFetch(`/api/admin/participants/${encodeURIComponent(participantId)}`);
        render(profile);
    } catch (error) {
        statusLine.textContent = error.message;
        statusLine.classList.add('is-error');
    }
}

function render(profile) {
    heading.textContent = `Participant ${profile.participantCode}`;

    statRow.textContent = '';
    statRow.appendChild(statCard('Overall accuracy', `${profile.overallAccuracy.toFixed(1)}%`));
    statRow.appendChild(statCard('Total sessions', String(profile.sessionCount)));
    statRow.appendChild(statCard('Total responses', String(profile.totalResponses)));
    statRow.appendChild(statCard('Correct', String(profile.correctResponses)));
    statRow.appendChild(statCard('Incorrect', String(profile.incorrectResponses)));
    statRow.appendChild(statCard('Unresolved', String(profile.unresolvedResponses)));

    sessionsList.textContent = '';
    if (profile.sessions.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'status-line';
        empty.textContent = 'No sessions recorded yet.';
        sessionsList.appendChild(empty);
        return;
    }

    profile.sessions.forEach((session, index) => {
        const card = document.createElement('div');
        card.className = 'session-card';
        card.addEventListener('click', () => {
            window.location.href = `session.html?id=${encodeURIComponent(session.sessionId)}`;
        });

        const title = document.createElement('h3');
        const rules = session.subtractionRules && session.subtractionRules.length > 0
            ? `Subtract by ${session.subtractionRules.join(', ')}`
            : 'No subtraction phases recorded';
        title.textContent = `Session ${index + 1} — ${rules}`;
        card.appendChild(title);

        const meta = document.createElement('p');
        meta.className = 'mono';
        meta.style.color = 'var(--slate)';
        meta.style.fontSize = '12px';
        meta.style.margin = '0';
        meta.textContent = `${session.overallAccuracy.toFixed(1)}% accuracy · ${session.totalResponses} responses · ${session.incorrectResponses} incorrect`;
        card.appendChild(meta);

        const badge = document.createElement('span');
        badge.className = `badge ${session.needsReview ? 'review' : (session.completionStatus === 'Complete' ? 'complete' : 'incomplete')}`;
        badge.style.marginTop = '8px';
        badge.style.display = 'inline-block';
        badge.textContent = session.needsReview ? 'Needs review' : session.completionStatus;
        card.appendChild(document.createElement('br'));
        card.appendChild(badge);

        sessionsList.appendChild(card);
    });
}

load();
