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
import { parseNumbersFromTranscript, looksLikeNumberFragment } from './numberParser.js';
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

// FRAGMENT SEGMENTATION - Chrome's own utterance endpointer (voice-
// activity detection deciding where one recognition result ends) can
// misfire mid-number, finalizing e.g. "8" and "65" as two separate final
// events for one spoken "865". Neither event is "wrong" on its own - the
// browser genuinely finalized that text - so this cannot be fixed by
// parsing more cleverly; it has to be detected at the sequencing level.
//
// The strategy (see _looksComplete()/_ingestFinalText() below) combines
// TWO signals, deliberately NOT timing alone, because a short pause is
// exactly as likely between a genuine fragment and its continuation as it
// is between two separate spoken numbers at a natural counting pace (see
// requirement C/G in the brief this was built against):
//
//   1. CONTENT completeness - does the trailing segment already look like
//      a plausible finished response (a digit run at least as long as the
//      digit-length of the numbers seen so far in this phase, or a
//      resolved word-form number already anchored by "hundred")? If so it
//      is committed immediately, REGARDLESS of how soon the next event
//      arrives - this is what guarantees two genuinely separate complete
//      numbers spoken close together (e.g. "865" then, 300ms later,
//      "862") are never merged into "865862".
//   2. TIMING - only a segment that does NOT look complete is held
//      pending, and only for FRAGMENT_COMMIT_DEBOUNCE_MS: if nothing
//      arrives in that short window, it is committed as-is (never
//      silently dropped); if another final event arrives within the
//      window, its text is concatenated onto the pending fragment
//      (digit fragments joined with no separator so "8"+"65"="865";
//      word-form fragments joined with a space so "nine"+"hundred
//      sixty"="nine hundred sixty") and re-evaluated the same way -
//      correctly handling a number split into more than 2 pieces.
//
// A pending fragment's own raw text is never invented or guessed at
// mathematically - it is exactly the concatenation of what the browser
// actually returned. Every individual raw recognition event, whether or
// not it ends up merged, is still preserved unmodified in
// getRawRecognitionEvents() (see _recordFinalTranscript below) - nothing
// in this mechanism destroys the original browser transcripts.
const FRAGMENT_COMMIT_DEBOUNCE_MS = 400;

export class CognitiveSpeechSession {
    constructor({
        subtractionValue,
        startingNumber,
        scoringMode = DEFAULT_SCORING_MODE,
        engineFactory = (options) => new SpeechRecognitionEngine(options),
        fragmentCommitDebounceMs = FRAGMENT_COMMIT_DEBOUNCE_MS,
        scheduleFragmentCommit = (callback, ms) => setTimeout(callback, ms),
        clearFragmentCommit = (handle) => clearTimeout(handle),
        logger = () => {}
    } = {}) {
        this.subtractionValue = subtractionValue;
        this.startingNumber = startingNumber;
        this.scoringMode = scoringMode;
        this.phaseStartTime = null;
        this.phaseEndTime = null;

        this._logger = logger;
        this._engine = engineFactory({ logger });

        this._fragmentCommitDebounceMs = fragmentCommitDebounceMs;
        this._scheduleFragmentCommit = scheduleFragmentCommit;
        this._clearFragmentCommit = clearFragmentCommit;
        this._pendingFragment = null; // { rawTranscript, timestamp } | null - see FRAGMENT_COMMIT_DEBOUNCE_MS above
        this._scheduledFragmentCommit = null;
        // The "how many digits does a complete response look like right
        // now" reference for _looksComplete()'s digit-run check - starts
        // from the given starting number and updates to whatever was last
        // actually committed, so it tracks the sequence's real magnitude
        // as it decreases over a long phase rather than staying frozen at
        // the start value. A documented heuristic, not a guarantee.
        this._expectedDigitLength = Number.isFinite(startingNumber) ? String(Math.abs(startingNumber)).length : 3;

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
        // Commit whatever's still pending rather than silently losing it -
        // the phase ending is not a reason to discard the last thing the
        // participant said, even if it was still mid-debounce-window.
        this._flushPendingFragment();
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

        // ALWAYS recorded, unconditionally and unmodified, exactly as the
        // browser delivered it - see the module-level comment on
        // DUPLICATE_FINAL_EVENT_WINDOW_MS. This is the complete audit
        // trail regardless of what happens next, including fragments that
        // get merged below - nothing in the fragment-segmentation logic
        // touches this array.
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

        this._ingestFinalText(transcript, alternatives, resolvedTimestamp);
        this._notify();
    }

    // Decides whether `transcript` continues a still-pending fragment from
    // a previous final event (see FRAGMENT_COMMIT_DEBOUNCE_MS above) or
    // starts fresh, then commits every resulting segment that already
    // looks like a complete response - holding back at most the LAST one
    // if it still looks incomplete, to give one more event a chance to
    // complete it.
    _ingestFinalText(transcript, alternatives, timestamp) {
        let textToParse = transcript;
        let isMerge = false;

        if (this._pendingFragment) {
            const gap = timestamp - this._pendingFragment.timestamp;
            if (gap >= 0 && gap < this._fragmentCommitDebounceMs) {
                // Digit fragments must be joined with no separator so
                // "8" + "65" reforms "865"; word-form fragments need a
                // space so "nine" + "hundred sixty" reforms "nine hundred
                // sixty" rather than the unparseable "ninehundred sixty".
                const pendingIsDigits = /^\d+$/.test(this._pendingFragment.rawTranscript.replace(/[.,]+$/, ''));
                textToParse = this._pendingFragment.rawTranscript + (pendingIsDigits ? '' : ' ') + transcript;
                isMerge = true;
            } else {
                // Too long since the pending fragment arrived - it stands
                // on its own; commit it before considering this new event.
                this._flushPendingFragment();
            }
            this._pendingFragment = null;
            this._clearScheduledFragmentCommit();
        }

        const segments = parseNumbersFromTranscript(textToParse);
        if (segments.length === 0) {
            return;
        }

        // Alternatives cannot be meaningfully position-matched across a
        // merge (the combined text no longer corresponds 1:1 with this
        // event's own alternatives array) - a documented simplification,
        // not a correctness issue: alternatives are for recognition
        // confidence/audit, they do not need to also solve fragmentation.
        const alternativeSegmentsByAlt = !isMerge ? alternatives.map((altText) => parseNumbersFromTranscript(altText)) : [];
        const lastIndex = segments.length - 1;

        segments.forEach((segment, index) => {
            if (index === lastIndex && !this._looksComplete(segment)) {
                this._pendingFragment = { rawTranscript: segment.raw, timestamp };
                this._scheduledFragmentCommit = this._scheduleFragmentCommit(
                    () => this._flushPendingFragment(),
                    this._fragmentCommitDebounceMs
                );
                return;
            }

            const candidateNumbers = isMerge ? [] : this._computeCandidateNumbers(segment, index, alternativeSegmentsByAlt);
            this._commitSegment(segment, candidateNumbers, timestamp, isMerge);
        });
    }

    // Content-completeness check - see the module-level comment on
    // FRAGMENT_COMMIT_DEBOUNCE_MS for the full rationale. Returns true
    // ("commit now, do not wait") for anything that already looks like a
    // finished response, including unrelated/unintelligible speech (which
    // must never be held pending a merge attempt just because it failed
    // to parse).
    _looksComplete(segment) {
        if (segment.resolved) {
            const digitsOnly = /^\d+$/.test(segment.raw.replace(/[.,]+$/, ''));
            if (!digitsOnly) {
                return true; // word-form number, already anchored by "hundred"
            }
            const digitCount = segment.raw.replace(/[.,]+$/, '').length;
            return digitCount >= this._expectedDigitLength;
        }
        // Unresolved: only an actual number-vocabulary fragment (e.g.
        // "nine" cut off before "hundred sixty") is worth buffering.
        return !looksLikeNumberFragment(segment.raw);
    }

    _computeCandidateNumbers(segment, index, alternativeSegmentsByAlt) {
        const candidateNumbers = new Set();
        for (const altSegments of alternativeSegmentsByAlt) {
            const altSegment = altSegments[index];
            if (altSegment && altSegment.resolved && altSegment.value != null && altSegment.value !== segment.value) {
                candidateNumbers.add(altSegment.value);
            }
        }
        return [...candidateNumbers];
    }

    _commitSegment(segment, alternativeNumbers, timestamp, mergedFromFragments) {
        this._rawResponses.push({
            timestamp,
            rawTranscript: segment.raw, // RAW RECOGNITION - exactly as recognized (post-merge text for a reconstructed number), never overwritten
            parsedNumber: segment.value, // SELECTED/VALIDATED NUMBER - always the raw value above; alternatives are never substituted in
            resolved: segment.resolved,
            alternativeNumbers, // ALTERNATIVE RECOGNITION candidates, for review only
            mergedFromFragments // true if this response was reconstructed from more than one recognition event
        });
        if (segment.resolved && segment.value != null) {
            this._expectedDigitLength = String(Math.abs(segment.value)).length;
        }
    }

    // Commits whatever is currently pending, exactly as-is - called when
    // the debounce window elapses with no continuation arriving, when a
    // new event arrives too late to still count as a continuation, or
    // when the phase ends (see stop() above). Never silently drops a
    // fragment; the participant's actual recognized text is preserved
    // even if it never got a chance to be completed by a later event.
    _flushPendingFragment() {
        if (!this._pendingFragment) {
            return;
        }
        const fragment = this._pendingFragment;
        this._pendingFragment = null;
        this._clearScheduledFragmentCommit();

        for (const segment of parseNumbersFromTranscript(fragment.rawTranscript)) {
            this._commitSegment(segment, [], fragment.timestamp, true);
        }
        this._notify();
    }

    _clearScheduledFragmentCommit() {
        if (this._scheduledFragmentCommit != null) {
            this._clearFragmentCommit(this._scheduledFragmentCommit);
            this._scheduledFragmentCommit = null;
        }
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
