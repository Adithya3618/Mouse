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

        // Comma-separates the recognized number segments for readability
        // (960, 967, 964, 961) - display formatting only. The underlying
        // stored/exported raw transcript (session.getRawTranscript(), used
        // by data/dataFormatter.js and the Excel export) is untouched by
        // this and remains space-joined.
        const finalDisplay = formatFinalSegmentsForDisplay(session.getRawResponseSegments());
        const interimText = session.getInterimTranscript();
        const combined = [finalDisplay, interimText].filter(Boolean).join(' ');
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

// Joins recognized number segments with ", " for on-screen readability
// (e.g. "960, 967, 964, 961" instead of "960 967 964 961"). Exported as a
// small, pure function - separate from the DOM-touching code above - so
// this presentation-only formatting can be tested directly. Never called
// anywhere data is stored or exported; see cognitiveSpeechSession.js's
// getRawTranscript() (space-joined, unchanged) for that.
export function formatFinalSegmentsForDisplay(segments) {
    return segments.filter(Boolean).join(', ');
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
