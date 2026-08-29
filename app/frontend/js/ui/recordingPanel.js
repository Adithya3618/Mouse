// Renders the participant-facing recording indicator for cognitive-active
// phases (SUBTRACTION_<n> and DUAL_TASK_<n>). Replaces
// ui/speechTranscriptPanel.js (deleted): there is no live transcript to
// show anymore - the participant sees only a microphone icon, a recording
// status line, and an elapsed/duration timer. NEVER renders recognized
// text or numbers - there is none available here at all (see
// cognitive/cognitiveAudioSession.js, which exposes only mic-active/error
// state, nothing transcript-shaped).
//
// Purely a subscriber to the experiment controller and to whichever
// CognitiveAudioSession is currently running, exactly like
// speechTranscriptPanel.js was - it never touches mouse/*.js or the
// #gameScreen/#game target-field elements.

const TICK_INTERVAL_MS = 250;

export function initRecordingPanel(controller, { setInterval: setIntervalFn = setInterval, clearInterval: clearIntervalFn = clearInterval } = {}) {
    const panel = document.getElementById('speechPanel');
    const micStatus = document.getElementById('recordingStatus');
    const timerEl = document.getElementById('recordingTimer');
    const errorEl = document.getElementById('speechError');

    if (!panel || !micStatus || !timerEl || !errorEl) {
        return; // this screen hasn't been built yet (e.g. under test)
    }

    let unsubscribeSession = null;
    let tickHandle = null;
    let currentSession = null;
    let currentDuration = null;

    function clearSessionSubscription() {
        if (unsubscribeSession) {
            unsubscribeSession();
            unsubscribeSession = null;
        }
        if (tickHandle != null) {
            clearIntervalFn(tickHandle);
            tickHandle = null;
        }
        currentSession = null;
        currentDuration = null;
    }

    function renderSessionState(session) {
        const active = session.isMicActive();
        panel.classList.toggle('is-recording', active);
        micStatus.textContent = active ? 'RECORDING ACTIVE' : 'Preparing microphone…';

        const error = session.getLastError();
        if (error && error.type !== 'no-speech') {
            errorEl.hidden = false;
            errorEl.textContent = describeRecordingError(error);
        } else {
            errorEl.hidden = true;
            errorEl.textContent = '';
        }

        renderTimer(session);
    }

    function renderTimer(session) {
        if (!session.phaseStartTime || currentDuration == null) {
            timerEl.textContent = '00:00';
            return;
        }
        const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(session.phaseStartTime).getTime()) / 1000));
        const clampedElapsed = Math.min(elapsedSeconds, currentDuration);
        timerEl.textContent = `${formatSeconds(clampedElapsed)} / ${formatSeconds(currentDuration)}`;
    }

    controller.onPhaseChange((phase) => {
        clearSessionSubscription();

        if (!phase || !phase.cognitiveActive) {
            panel.hidden = true;
            return;
        }

        const session = controller.getCurrentCognitiveAudioSession();
        if (!session) {
            panel.hidden = true;
            return;
        }

        panel.hidden = false;
        currentSession = session;
        currentDuration = phase.duration ?? null;
        renderSessionState(session);
        unsubscribeSession = session.onUpdate(renderSessionState);
        // The timer needs to advance even when nothing else about the
        // session changes (no new onUpdate events fire mid-recording, since
        // there is no transcript activity to notify on anymore) - a small
        // local tick keeps 00:00/00:01/... moving smoothly.
        tickHandle = setIntervalFn(() => {
            if (currentSession) {
                renderTimer(currentSession);
            }
        }, TICK_INTERVAL_MS);
    });
}

function formatSeconds(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Deliberately generic/participant-facing wording - never exposes
// technical detail (error codes, engine internals) to the participant. The
// full error object is still available via session.getLastError() for
// logging/debugging if ever needed.
function describeRecordingError(error) {
    switch (error.type) {
        case 'unsupported':
            return 'Audio recording is not supported in this browser.';
        case 'not-allowed':
            return 'Microphone access was denied. Allow microphone access to continue.';
        default:
            return 'Recording is currently unavailable.';
    }
}
