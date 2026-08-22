// Renders the live microphone/transcript UI for cognitive-active phases
// (SUBTRACTION_<n> and DUAL_TASK_<n>). Purely a subscriber to the
// experiment controller and to whichever CognitiveSpeechSession is
// currently running (see experiment/experimentController.js -
// getCurrentCognitiveSpeechSession()) - it never touches mouse/*.js or the
// #gameScreen/#game target-field elements, so it cannot interfere with the
// mouse task during dual-task conditions.

export function initSpeechTranscriptPanel(controller) {
    const panel = document.getElementById('speechPanel');
    const micStatus = document.getElementById('speechMicStatus');
    const liveResponse = document.getElementById('speechLiveResponse');
    const errorEl = document.getElementById('speechError');

    if (!panel || !micStatus || !liveResponse || !errorEl) {
        return; // this screen hasn't been built yet (e.g. under test)
    }

    let unsubscribeSession = null;

    function clearSessionSubscription() {
        if (unsubscribeSession) {
            unsubscribeSession();
            unsubscribeSession = null;
        }
    }

    function renderSessionState(session) {
        const active = session.isMicActive();
        micStatus.textContent = active ? '🎤 MICROPHONE ACTIVE' : '🎤 MICROPHONE INACTIVE';
        micStatus.classList.toggle('is-active', active);

        const finalText = session.getRawTranscript();
        const interimText = session.getInterimTranscript();
        const combined = [finalText, interimText].filter(Boolean).join(' ');
        liveResponse.textContent = combined || '—';

        const error = session.getLastError();
        if (error && error.type !== 'no-speech') {
            errorEl.hidden = false;
            errorEl.textContent = describeSpeechError(error);
        } else {
            errorEl.hidden = true;
            errorEl.textContent = '';
        }
    }

    controller.onPhaseChange((phase) => {
        clearSessionSubscription();

        if (!phase || !phase.cognitiveActive) {
            panel.hidden = true;
            return;
        }

        const session = controller.getCurrentCognitiveSpeechSession();
        if (!session) {
            panel.hidden = true;
            return;
        }

        panel.hidden = false;
        renderSessionState(session);
        unsubscribeSession = session.onUpdate(renderSessionState);
    });
}

// Deliberately generic/participant-facing wording - never exposes
// technical detail (error codes, engine internals) to the participant.
// The full error object (see cognitive/speechRecognition.js's onError
// shape) is still available via session.getLastError() for logging/
// debugging if ever needed.
function describeSpeechError(error) {
    switch (error.type) {
        case 'unsupported':
            return 'Speech recognition is not supported in this browser.';
        case 'not-allowed':
        case 'service-not-allowed':
            return 'Microphone access was denied. Allow microphone access to enable live transcription.';
        default:
            return 'Speech recognition unavailable.';
    }
}
