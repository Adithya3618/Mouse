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

// If the underlying engine fires two final events with the EXACT same
// transcript within this many milliseconds of each other, the second is
// treated as a browser-level duplicate delivery (observed in some Chrome
// versions, particularly around a restart) rather than a genuine repeated
// utterance - it is still preserved verbatim in getRawRecognitionEvents()
// (flagged treatedAsDuplicate: true) but is not parsed into a second set
// of number responses, so it cannot inflate the response count or
// scoring. Deliberately conservative and narrow: only back-to-back EXACT
// text matches within a short window are ever suppressed - a participant
// who genuinely repeats a number a few seconds apart, or two final events
// with different text, are never touched.
const DUPLICATE_FINAL_EVENT_WINDOW_MS = 1500;

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

        // The complete, unfiltered audit trail of every final recognition
        // EVENT as received from the engine (one entry per onFinalResult
        // call, before any parsing/splitting into individual numbers) -
        // includes every alternative transcript the browser offered.
        // Never mutated, and an entry is added for every final event
        // without exception, even ones treated as duplicates (see
        // DUPLICATE_FINAL_EVENT_WINDOW_MS above) - this array is the
        // canonical "what did the browser actually report" record for
        // research/audit purposes.
        this._rawRecognitionEvents = [];
        this._lastRecordedFinalEvent = null; // { transcript, timestamp } of the last NON-duplicate final event

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
        this._engine.onFinalResult = ({ transcript, alternatives, timestamp }) => {
            this._interimTranscript = '';
            // Falls back to [transcript] when the engine doesn't supply
            // alternatives (e.g. an older/simpler injected fake in tests) -
            // the primary transcript is always itself a valid 1-alternative list.
            const resolvedAlternatives = Array.isArray(alternatives) && alternatives.length > 0 ? alternatives : [transcript];
            this._recordFinalTranscript(transcript, resolvedAlternatives, timestamp);
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

    _recordFinalTranscript(transcript, alternatives, timestamp) {
        const resolvedTimestamp = timestamp || Date.now();

        const isDuplicate = Boolean(
            this._lastRecordedFinalEvent &&
            transcript === this._lastRecordedFinalEvent.transcript &&
            Math.abs(resolvedTimestamp - this._lastRecordedFinalEvent.timestamp) < DUPLICATE_FINAL_EVENT_WINDOW_MS
        );

        // ALWAYS recorded, unconditionally and unmodified - see the
        // module-level comment on DUPLICATE_FINAL_EVENT_WINDOW_MS. This is
        // the complete audit trail regardless of what happens next.
        this._rawRecognitionEvents.push({
            rawTranscript: transcript,
            alternatives: [...alternatives],
            timestamp: resolvedTimestamp,
            treatedAsDuplicate: isDuplicate
        });

        if (isDuplicate) {
            this._notify();
            return;
        }
        this._lastRecordedFinalEvent = { transcript, timestamp: resolvedTimestamp };

        // Parse the primary transcript exactly as before (numberParser.js
        // is unmodified and unaware any of this exists), plus each
        // alternative transcript through the SAME parser, so per-number
        // alternative candidates can be offered without ever touching
        // numberParser.js or speechScoring.js.
        const primarySegments = parseNumbersFromTranscript(transcript);
        const alternativeSegmentsByAlt = alternatives.map((altText) => parseNumbersFromTranscript(altText));

        primarySegments.forEach((segment, index) => {
            // Candidate numbers from OTHER recognition alternatives at the
            // same position in the utterance - only values that actually
            // differ from what was recognized, so this never just echoes
            // the primary result back. Never used to change parsedNumber
            // below; it is exposed alongside it for review, see
            // getResults()'s alternativeMatchesExpected annotation.
            const candidateNumbers = new Set();
            for (const altSegments of alternativeSegmentsByAlt) {
                const altSegment = altSegments[index];
                if (altSegment && altSegment.resolved && altSegment.value != null && altSegment.value !== segment.value) {
                    candidateNumbers.add(altSegment.value);
                }
            }

            this._rawResponses.push({
                timestamp: resolvedTimestamp,
                rawTranscript: segment.raw, // RAW RECOGNITION - the primary/best result, exactly as recognized, never overwritten
                parsedNumber: segment.value, // SELECTED/VALIDATED NUMBER - always the raw value above; alternatives are never substituted in
                resolved: segment.resolved,
                alternativeNumbers: [...candidateNumbers] // ALTERNATIVE RECOGNITION candidates, for review only
            });
        });

        this._notify();
    }

    // The full, never-truncated raw transcript for this phase - preserved
    // independently of parsing/scoring, per the "don't destroy the raw
    // transcript" requirement. Space-joined; this is the stored/exported
    // research value (see data/dataFormatter.js, exportService.js) and is
    // deliberately NOT reformatted for display - see
    // getRawResponseSegments() below for the UI-presentation form.
    getRawTranscript() {
        return this._rawResponses.map((response) => response.rawTranscript).join(' ');
    }

    // The same per-number raw segments as getRawTranscript(), but as an
    // array rather than a pre-joined string - lets the UI layer format
    // them for display (e.g. comma-separated) without this method itself
    // making a presentation decision, and without ever touching the
    // underlying stored data. See ui/speechTranscriptPanel.js.
    getRawResponseSegments() {
        return this._rawResponses.map((response) => response.rawTranscript);
    }

    // The complete, unmodified audit trail of every final recognition
    // event received from the engine (see the constructor comment on
    // _rawRecognitionEvents) - one entry per browser onFinalResult call,
    // each with every alternative the browser offered, exactly as
    // received. Returned as a defensive copy.
    getRawRecognitionEvents() {
        return this._rawRecognitionEvents.map((event) => ({ ...event, alternatives: [...event.alternatives] }));
    }

    // Scores every recorded response against the expected serial-subtraction
    // sequence (see speechScoring.js, UNMODIFIED - it never sees or knows
    // about alternativeNumbers, it just spreads {...response} through) and
    // returns the full per-condition result record described in DATA TO
    // RECORD.
    //
    // Each response in the returned .responses array distinguishes:
    //   RAW RECOGNITION        -> rawTranscript, parsedNumber (never
    //                              auto-corrected - always what the
    //                              primary/best recognition produced)
    //   ALTERNATIVE RECOGNITION -> alternativeNumbers (other candidates
    //                              from the same recognition event, only
    //                              ever informational)
    //   EXPECTED NUMBER         -> expectedNumber (from speechScoring.js,
    //                              unchanged scoring architecture)
    //   SELECTED/VALIDATED      -> parsedNumber IS the selected/validated
    //                              number - it is always the raw result;
    //                              this pipeline never substitutes an
    //                              alternative in its place
    //   CONFIDENCE/REASON       -> correctness (from speechScoring.js) plus
    //                              alternativeMatchesExpected, a read-only
    //                              annotation added here (not in
    //                              speechScoring.js) noting whether one of
    //                              the alternatives would have matched the
    //                              expected sequence - visibility only,
    //                              never fed back into scoring
    getResults() {
        const scoredResponses = scoreResponses(this._rawResponses, {
            startingNumber: this.startingNumber,
            subtractionValue: this.subtractionValue,
            mode: this.scoringMode
        }).map((response) => ({
            ...response,
            alternativeMatchesExpected:
                Array.isArray(response.alternativeNumbers) && response.alternativeNumbers.includes(response.expectedNumber)
        }));

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
            // The complete, unfiltered audit trail (see
            // getRawRecognitionEvents()) - every final recognition event
            // exactly as received, including entries suppressed from
            // .responses above as likely browser-level duplicates
            // (treatedAsDuplicate: true), for research/audit purposes.
            rawRecognitionEvents: this.getRawRecognitionEvents(),
            correctResponses,
            incorrectResponses,
            unresolvedResponses,
            numberOfResponses: scoredResponses.length,
            cognitiveAccuracy: calculateCognitiveAccuracy(correctResponses, incorrectResponses),
            scoringMode: this.scoringMode
        };
    }
}
