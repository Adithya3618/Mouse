// Thin abstraction over the browser's native speech-recognition engine
// (window.SpeechRecognition / window.webkitSpeechRecognition). Nothing
// else in the cognitive pipeline (cognitiveSpeechSession.js,
// numberParser.js, speechScoring.js) touches the Web Speech API directly -
// they only see this class's start/stop/abort/isSupported methods and its
// onStart/onResult/onFinalResult/onError/onEnd callbacks.
//
// Entirely client-side by design: no network request, no backend
// endpoint, no API key, and no audio recording or storage of any kind -
// this class never touches MediaRecorder or raw audio at all. The browser
// handles microphone capture and recognition internally; this wrapper only
// ever sees the resulting text.

const DEFAULT_LANG = 'en-US';

function getNativeSpeechRecognitionCtor() {
    if (typeof window === 'undefined') {
        return null; // no DOM at all (Node test environment)
    }
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function defaultRecognitionFactory(lang) {
    const Ctor = getNativeSpeechRecognitionCtor();
    if (!Ctor) {
        throw new Error('SpeechRecognition is not supported in this browser.');
    }
    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    return recognition;
}

// Errors after which retrying automatically would be pointless or
// actively unwanted (the participant explicitly denied the mic, the
// microphone hardware itself is unavailable, or the browser has no
// recognition support at all).
const NON_RECOVERABLE_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture']);

// Safety valve against an infinite restart loop: if the underlying engine
// ends without ever successfully firing onstart, MAX_CONSECUTIVE_FAILED_RESTARTS
// times in a row, stop trying rather than spin forever (some browsers can
// fail fast and repeatedly, e.g. immediately erroring on every start()
// call). A single normal, successful cycle resets the counter, so this
// never interferes with ordinary continuous listening across many
// legitimate restarts over a 2-minute cognitive phase.
const MAX_CONSECUTIVE_FAILED_RESTARTS = 5;

export class SpeechRecognitionEngine {
    constructor({
        recognitionFactory = defaultRecognitionFactory,
        lang = DEFAULT_LANG,
        autoRestart = true,
        logger = () => {}
    } = {}) {
        this._recognitionFactory = recognitionFactory;
        this._usesDefaultFactory = recognitionFactory === defaultRecognitionFactory;
        this._lang = lang;
        this._autoRestart = autoRestart;
        this._logger = logger;

        this._recognition = null;
        this._listening = false; // "should be listening" intent, survives auto-restarts
        this._stoppedIntentionally = true;
        this._currentAttemptStarted = false; // did onstart fire for the in-flight _startRecognitionInstance() call?
        this._consecutiveFailedRestarts = 0;

        this.onStart = null;
        this.onResult = null; // ({ transcript, timestamp }) - interim (non-final)
        this.onFinalResult = null; // ({ transcript, confidence, timestamp })
        this.onError = null; // ({ type, message })
        this.onEnd = null; // () - fires on every underlying engine stop, incl. auto-restarts
    }

    // Static form lets callers check support before ever constructing an
    // engine (e.g. to decide whether to show a "not supported" notice).
    static isSupported() {
        return getNativeSpeechRecognitionCtor() !== null;
    }

    isSupported() {
        // An injected factory (tests, or a future non-Web-Speech backend)
        // is assumed available by construction - only the default,
        // browser-native factory depends on runtime feature detection.
        if (!this._usesDefaultFactory) {
            return true;
        }
        return SpeechRecognitionEngine.isSupported();
    }

    isListening() {
        return this._listening;
    }

    start() {
        if (this._listening) {
            return true; // already running/intending to run
        }
        if (!this.isSupported()) {
            this._emitError({ type: 'unsupported', message: 'Speech recognition is not supported in this browser.' });
            return false;
        }

        this._listening = true;
        this._stoppedIntentionally = false;
        this._startRecognitionInstance();
        return true;
    }

    // Graceful stop: lets the engine finish emitting any pending result,
    // and will NOT auto-restart even though onend fires.
    stop() {
        this._listening = false;
        this._stoppedIntentionally = true;
        if (this._recognition) {
            try {
                this._recognition.stop();
            } catch (error) {
                this._logger(`SpeechRecognition.stop() failed: ${error.message}`);
            }
        }
    }

    // Hard stop: discards any in-flight result. Used for cleanup when a
    // phase ends abruptly (e.g. the experiment is torn down mid-phase).
    abort() {
        this._listening = false;
        this._stoppedIntentionally = true;
        if (this._recognition) {
            try {
                this._recognition.abort();
            } catch (error) {
                this._logger(`SpeechRecognition.abort() failed: ${error.message}`);
            }
        }
    }

    _startRecognitionInstance() {
        this._currentAttemptStarted = false;

        let recognition;
        try {
            recognition = this._recognitionFactory(this._lang);
        } catch (error) {
            this._listening = false;
            this._emitError({ type: 'start-failed', message: error.message });
            return;
        }
        this._recognition = recognition;

        recognition.onstart = () => {
            this._currentAttemptStarted = true;
            this._consecutiveFailedRestarts = 0;
            if (this.onStart) {
                this.onStart();
            }
        };

        recognition.onresult = (event) => {
            this._handleRecognitionResult(event);
        };

        recognition.onerror = (event) => {
            const type = event && event.error ? event.error : 'unknown';
            this._logger(`SpeechRecognition error: ${type}`);
            if (NON_RECOVERABLE_ERRORS.has(type)) {
                // Stop trying to listen at all - restarting after a denied
                // permission would just re-trigger the same error forever.
                this._listening = false;
                this._stoppedIntentionally = true;
            }
            this._emitError({ type, message: (event && event.message) || type });
        };

        recognition.onend = () => {
            this._recognition = null;
            if (this.onEnd) {
                this.onEnd();
            }
            // The underlying engine can end on its own (e.g. a browser's
            // internal silence timeout) well before the cognitive phase is
            // over. Restart it so listening stays effectively continuous
            // for the rest of the phase - but never after an intentional
            // stop()/abort(), and never once the caller no longer wants us
            // listening (this._listening false).
            if (this._listening && !this._stoppedIntentionally && this._autoRestart) {
                if (!this._currentAttemptStarted) {
                    this._consecutiveFailedRestarts += 1;
                }
                if (this._consecutiveFailedRestarts >= MAX_CONSECUTIVE_FAILED_RESTARTS) {
                    // Controlled stop, not an infinite loop: this engine
                    // has failed to even start MAX_CONSECUTIVE_FAILED_RESTARTS
                    // times in a row - retrying further is not going to help.
                    this._listening = false;
                    this._stoppedIntentionally = true;
                    this._emitError({
                        type: 'restart-loop',
                        message: 'Speech recognition repeatedly failed to start and has been stopped.'
                    });
                    return;
                }
                this._startRecognitionInstance();
            }
        };

        try {
            recognition.start();
        } catch (error) {
            this._logger(`SpeechRecognition failed to start: ${error.message}`);
            this._emitError({ type: 'start-failed', message: error.message });
        }
    }

    _handleRecognitionResult(event) {
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const result = event.results[i];
            const alternative = result[0];
            const transcript = alternative ? alternative.transcript : '';
            const timestamp = Date.now();

            if (result.isFinal) {
                if (this.onFinalResult) {
                    this.onFinalResult({
                        transcript,
                        confidence: alternative ? alternative.confidence : null,
                        timestamp
                    });
                }
            } else if (this.onResult) {
                this.onResult({ transcript, timestamp });
            }
        }
    }

    _emitError(error) {
        if (this.onError) {
            this.onError(error);
        }
    }
}
