// Ties a speech-recognition engine (raw listening), numberParser.js (text
// -> numbers) and speechScoring.js (numbers -> correctness) together for
// ONE cognitive-active phase (SUBTRACTION_<n> or DUAL_TASK_<n>). This is
// the object experiment/experimentController.js creates, starts and stops
// alongside (never inside) its existing cognitive/subtractionTask.js
// SubtractionTask - subtractionTask.js itself is untouched.
//
// Deliberately independent of the mouse task: nothing here reads from or
// writes to mouse/*.js, and nothing in mouse/*.js knows this class exists.
//
// ENGINE: defaults to SpeechRecognitionEngine (cognitive/speechRecognition.js),
// a thin wrapper over the browser-native window.SpeechRecognition /
// window.webkitSpeechRecognition API - entirely client-side, no audio ever
// leaves the browser, no backend endpoint, no API key, no audio recording
// or storage of any kind. engineFactory is a swappable constructor option,
// so a different engine could be substituted later without any change to
// this file, numberParser.js, speechScoring.js, or experimentController.js.
import { SpeechRecognitionEngine } from './speechRecognition.js';
import { parseNumbersFromTranscript } from './numberParser.js';
import { scoreResponses, calculateCognitiveAccuracy, DEFAULT_SCORING_MODE } from './speechScoring.js';

export class CognitiveSpeechSession {
    constructor({
        subtractionValue,
        startingNumber,
        scoringMode = DEFAULT_SCORING_MODE,
        engineFactory = (options) => new SpeechRecognitionEngine(options),
        logger = () => {}
    } = {}) {
        this.subtractionValue = subtractionValue;
        this.startingNumber = startingNumber;
        this.scoringMode = scoringMode;
        this.phaseStartTime = null;
        this.phaseEndTime = null;

        this._logger = logger;
        this._engine = engineFactory({ logger });

        // Raw, unscored responses in the order they were recognized -
        // never mutated once appended, so the raw transcript is always
        // fully recoverable independent of scoring (see getResults()).
        this._rawResponses = [];
        this._interimTranscript = '';
        this._micActive = false;
        this._lastError = null;
        this._listeners = new Set();

        this._engine.onStart = () => {
            this._micActive = true;
            this._notify();
        };
        this._engine.onEnd = () => {
            this._micActive = false;
            this._notify();
        };
        this._engine.onError = (error) => {
            this._lastError = error;
            this._logger(`CognitiveSpeechSession: recognition error - ${error.type}`);
            this._notify();
        };
        this._engine.onResult = ({ transcript }) => {
            this._interimTranscript = transcript;
            this._notify();
        };
        this._engine.onFinalResult = ({ transcript, timestamp }) => {
            this._interimTranscript = '';
            this._recordFinalTranscript(transcript, timestamp);
        };
    }

    start() {
        this.phaseStartTime = new Date().toISOString();
        this._engine.start();
        this._notify();
    }

    // Always safe to call even if start() never actually got the engine
    // listening (e.g. unsupported browser / denied permission) - stop() on
    // an already-stopped engine is a no-op.
    stop() {
        this._engine.stop();
        this.phaseEndTime = new Date().toISOString();
        this._interimTranscript = '';
        this._notify();
    }

    isMicActive() {
        return this._micActive;
    }

    isSupported() {
        return this._engine.isSupported();
    }

    getInterimTranscript() {
        return this._interimTranscript;
    }

    getLastError() {
        return this._lastError;
    }

    // Subscribes to any change in this session's live state (mic
    // active/inactive, new interim/final transcript, error). Returns an
    // unsubscribe function, mirroring experiment/experimentController.js's
    // onPhaseChange/onPhaseTick pattern.
    onUpdate(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    _notify() {
        for (const listener of this._listeners) {
            listener(this);
        }
    }

    _recordFinalTranscript(transcript, timestamp) {
        const segments = parseNumbersFromTranscript(transcript);
        for (const segment of segments) {
            this._rawResponses.push({
                timestamp: timestamp || Date.now(),
                rawTranscript: segment.raw,
                parsedNumber: segment.value,
                resolved: segment.resolved
            });
        }
        this._notify();
    }

    // The full, never-truncated raw transcript for this phase - preserved
    // independently of parsing/scoring, per the "don't destroy the raw
    // transcript" requirement.
    getRawTranscript() {
        return this._rawResponses.map((response) => response.rawTranscript).join(' ');
    }

    // Scores every recorded response against the expected serial-subtraction
    // sequence (see speechScoring.js) and returns the full per-condition
    // result record described in DATA TO RECORD.
    getResults() {
        const scoredResponses = scoreResponses(this._rawResponses, {
            startingNumber: this.startingNumber,
            subtractionValue: this.subtractionValue,
            mode: this.scoringMode
        });

        const correctResponses = scoredResponses.filter((r) => r.correctness === 'correct').length;
        const incorrectResponses = scoredResponses.filter((r) => r.correctness === 'incorrect').length;
        const unresolvedResponses = scoredResponses.filter((r) => r.correctness === 'unresolved').length;

        return {
            subtractionRule: this.subtractionValue,
            startingNumber: this.startingNumber,
            phaseStartTime: this.phaseStartTime,
            phaseEndTime: this.phaseEndTime,
            rawTranscript: this.getRawTranscript(),
            parsedNumbers: scoredResponses.map((r) => r.parsedNumber),
            expectedNumbers: scoredResponses.map((r) => r.expectedNumber),
            responses: scoredResponses,
            correctResponses,
            incorrectResponses,
            unresolvedResponses,
            numberOfResponses: scoredResponses.length,
            cognitiveAccuracy: calculateCognitiveAccuracy(correctResponses, incorrectResponses),
            scoringMode: this.scoringMode
        };
    }
}
