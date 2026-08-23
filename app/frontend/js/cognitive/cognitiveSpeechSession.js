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
// misfire mid-number, finalizing e.g. "8" and "47" as two separate final
// events for one spoken "847". Neither event is "wrong" on its own - the
// browser genuinely finalized that text - so this cannot be fixed by
// parsing more cleverly; it has to be detected at the sequencing level.
//
// THREE-DIGIT SIGNAL (researcher request, 2026): every valid participant
// response in this study's protocol is exactly `expectedResponseDigits`
// digits (default 3 - see config/experimentConfig.js#expectedResponseDigits
// and DEFAULT_EXPECTED_RESPONSE_DIGITS below) - the experiment always
// generates a 3-digit starting number and the participant counts backward
// by a fixed rule. This is used PURELY as a segmentation signal (is a
// recognized fragment likely incomplete?) - it is NEVER used to alter,
// guess, or "correct" a recognized value. If Chrome recognizes "8"+"46",
// the committed response is 846, not 847, even though 847 may have been
// mathematically expected; speechScoring.js (unmodified) is the only
// place that comparison happens, and only for scoring, never for
// rewriting what was recognized.
//
// The strategy (see _looksComplete()/_looksLikeContinuation()/
// _ingestFinalText() below) combines multiple signals:
//
//   1. DIGIT LENGTH - a resolved digit-only segment is "complete" once it
//      reaches expectedResponseDigits; a resolved word-form number
//      (numberParser.js's "<ones> hundred ..." pattern) is always exactly
//      expectedResponseDigits by construction, so it is always complete
//      the moment it resolves.
//   2. TIMING - only a segment that does NOT look complete is held
//      pending, and only for FRAGMENT_COMMIT_DEBOUNCE_MS: if nothing
//      arrives in that short window, it is committed as-is (see "phase
//      end" handling below - never silently dropped); if another final
//      event arrives within the window, merging is considered.
//   3/4/5. PENDING/INCOMING COMPLETENESS - merging is only considered
//      while something is genuinely pending, and only if the incoming
//      text does NOT already look like a complete response on its own -
//      this is what stops an unrelated, already-complete number (e.g.
//      "957" arriving shortly after a stray "8") from being absorbed.
//      Critically, a merge is also refused if the COMBINED digit count
//      would EXCEED expectedResponseDigits - this is the "do not blindly
//      concatenate everything" guard: two genuinely separate short
//      fragments are never forced together past the expected length.
//   6/7. RECOGNITION EVENT BOUNDARIES / INTERIM-FINAL - untouched from
//      the engine's own distinction (see speechRecognition.js); only
//      final events are ever segmented/committed, interim text is purely
//      transient display state (see getInterimTranscript()).
//   8. DUPLICATE-EVENT HANDLING - unchanged, applied before any of the
//      above (see DUPLICATE_FINAL_EVENT_WINDOW_MS above).
//
// A pending fragment's own raw text is never invented or guessed at
// mathematically - it is exactly the concatenation of what the browser
// actually returned. If a fragment never reaches expectedResponseDigits
// (nothing more arrives, or the phase ends - see stop()), it is still
// committed, but flagged `incomplete: true` and scored as `resolved:
// false` (routes into speechScoring.js's existing "unresolved" bucket,
// unmodified) rather than guessed at - see _flushPendingFragment(). Every
// individual raw recognition event, whether or not it ends up merged, is
// still preserved unmodified in getRawRecognitionEvents() (see
// _recordFinalTranscript below) - nothing in this mechanism destroys the
// original browser transcripts.
const FRAGMENT_COMMIT_DEBOUNCE_MS = 400;

// Default number of digits a complete response is expected to have -
// overridable per session (see config/experimentConfig.js
// #expectedResponseDigits, threaded through by experimentController.js).
// Named/configurable per the "do not scatter the number 3 throughout the
// code" requirement - every place that cares about response length reads
// this.expectedResponseDigits (see below), never a literal 3.
const DEFAULT_EXPECTED_RESPONSE_DIGITS = 3;

const DEFAULT_SPEECH_RECOGNITION_LANGUAGE = 'en-US';

export class CognitiveSpeechSession {
    constructor({
        subtractionValue,
        startingNumber,
        scoringMode = DEFAULT_SCORING_MODE,
        expectedResponseDigits = DEFAULT_EXPECTED_RESPONSE_DIGITS,
        speechRecognitionLanguage = DEFAULT_SPEECH_RECOGNITION_LANGUAGE,
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
        this._expectedResponseDigits = expectedResponseDigits;
        // Participants may have different English accents - the browser's
        // own recognition language/model is the only lever this app has
        // for that (no AI accent-identification is added). This does not
        // and cannot guarantee accurate recognition across accents; the
        // raw browser result is always preserved regardless (see
        // getRawRecognitionEvents()/getRawTranscript()).
        this._engine = engineFactory({ logger, lang: speechRecognitionLanguage });

        this._fragmentCommitDebounceMs = fragmentCommitDebounceMs;
        this._scheduleFragmentCommit = scheduleFragmentCommit;
        this._clearFragmentCommit = clearFragmentCommit;
        this._pendingFragment = null; // { rawTranscript, timestamp, sourceEventIndexes, sourceRawTranscripts } | null
        this._scheduledFragmentCommit = null;

        // Raw, unscored responses in the order they were recognized -
        // never mutated once appended, so the raw transcript is always
        // fully recoverable independent of scoring (see getResults()).
        this._rawResponses = [];

        // The complete, unfiltered audit trail of every final recognition
        // EVENT as received from the engine (one entry per onFinalResult
        // call, before any parsing/splitting into individual numbers) -
        // includes every alternative transcript the browser offered.
        // rawTranscript/alternatives/timestamp are never mutated once
        // pushed; `merged`, `contributedToResponses` and `incomplete` ARE
        // filled in afterward (see _commitSegment below) purely as
        // cross-reference metadata for research/audit purposes.
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
        // participant said, even if it was still mid-debounce-window (see
        // _flushPendingFragment() - it is marked incomplete rather than
        // guessed at if it never reached expectedResponseDigits).
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
        // browser delivered it - nothing in the fragment-segmentation
        // logic touches rawTranscript/alternatives/timestamp on this
        // entry. `merged`/`contributedToResponses`/`incomplete` are
        // cross-reference metadata filled in afterward (see
        // _commitSegment below).
        const eventIndex = this._rawRecognitionEvents.length;
        this._rawRecognitionEvents.push({
            rawTranscript: transcript,
            alternatives: [...alternatives],
            timestamp: resolvedTimestamp,
            treatedAsDuplicate: isDuplicate,
            merged: false,
            contributedToResponses: [],
            incomplete: false
        });

        if (isDuplicate) {
            this._notify();
            return;
        }
        this._lastRecordedFinalEvent = { transcript, timestamp: resolvedTimestamp };

        this._ingestFinalText(transcript, alternatives, resolvedTimestamp, eventIndex);
        this._notify();
    }

    // Decides whether `transcript` continues a still-pending fragment from
    // a previous final event (see FRAGMENT_COMMIT_DEBOUNCE_MS above) or
    // starts fresh, then commits every resulting segment that already
    // looks like a complete response - holding back at most the LAST one
    // if it still looks incomplete, to give one more event a chance to
    // complete it.
    _ingestFinalText(transcript, alternatives, timestamp, eventIndex) {
        let textToParse = transcript;
        let isMerge = false;
        let sourceEventIndexes = [eventIndex];
        let sourceRawTranscripts = [transcript];

        if (this._pendingFragment) {
            const gap = timestamp - this._pendingFragment.timestamp;
            if (gap >= 0 && gap < this._fragmentCommitDebounceMs && this._looksLikeContinuation(this._pendingFragment, transcript)) {
                // Digit fragments must be joined with no separator so
                // "8" + "47" reforms "847"; word-form fragments need a
                // space so "nine" + "hundred sixty" reforms "nine hundred
                // sixty" rather than the unparseable "ninehundred sixty".
                const pendingIsDigits = /^\d+$/.test(this._pendingFragment.rawTranscript.replace(/[.,]+$/, ''));
                textToParse = this._pendingFragment.rawTranscript + (pendingIsDigits ? '' : ' ') + transcript;
                isMerge = true;
                sourceEventIndexes = [...this._pendingFragment.sourceEventIndexes, eventIndex];
                sourceRawTranscripts = [...this._pendingFragment.sourceRawTranscripts, transcript];
                this._pendingFragment = null;
                this._clearScheduledFragmentCommit();
            } else {
                // Too long since the pending fragment arrived, or the new
                // event already stands on its own, or merging would
                // overshoot expectedResponseDigits - either way the
                // pending fragment must be committed as-is before this
                // new event is considered, never silently merged away.
                this._flushPendingFragment();
            }
        }

        const segments = parseNumbersFromTranscript(textToParse, { expectedDigits: this._expectedResponseDigits });
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
                this._pendingFragment = { rawTranscript: segment.raw, timestamp, sourceEventIndexes, sourceRawTranscripts };
                this._scheduledFragmentCommit = this._scheduleFragmentCommit(
                    () => this._flushPendingFragment(),
                    this._fragmentCommitDebounceMs
                );
                return;
            }

            const candidateNumbers = isMerge ? [] : this._computeCandidateNumbers(segment, index, alternativeSegmentsByAlt);
            this._commitSegment(segment, candidateNumbers, timestamp, sourceEventIndexes, sourceRawTranscripts);
        });
    }

    // Content-completeness check - see the module-level comment on
    // FRAGMENT_COMMIT_DEBOUNCE_MS for the full rationale. A response in
    // this study's protocol is normally exactly `expectedResponseDigits`
    // digits; this checks a SEGMENT against that target purely to decide
    // whether it might still be an in-progress fragment - it never
    // changes what the segment's own recognized value is. Returns true
    // ("commit now, do not wait") for anything that already looks like a
    // finished response, including unrelated/unintelligible speech (which
    // must never be held pending a merge attempt just because it failed
    // to parse).
    _looksComplete(segment) {
        if (!segment.resolved) {
            // Only an actual number-vocabulary fragment (e.g. "nine" cut
            // off before "hundred sixty") is worth buffering.
            return !looksLikeNumberFragment(segment.raw);
        }
        const digitsOnly = /^\d+$/.test(segment.raw.replace(/[.,]+$/, ''));
        if (!digitsOnly) {
            // A resolved word-form number (numberParser.js's mandatory
            // "<ones> hundred ..." pattern) is always exactly
            // expectedResponseDigits by construction - it never needs a
            // digit-count check.
            return true;
        }
        const digitCount = segment.raw.replace(/[.,]+$/, '').length;
        return digitCount >= this._expectedResponseDigits;
    }

    // Whether `transcript`, arriving while `pendingFragment` is still
    // buffered, looks like ITS continuation rather than an unrelated,
    // already-complete response. Deliberately NOT "blindly concatenate
    // until 3 digits" - a merge is only ever considered when the incoming
    // text does not already look complete on its own, AND is refused
    // outright if combining it with the pending fragment would EXCEED
    // expectedResponseDigits (the guard that keeps two genuinely separate
    // short fragments, e.g. after the sequence crosses below 100, from
    // being forced together into something like "9895").
    _looksLikeContinuation(pendingFragment, transcript) {
        const segments = parseNumbersFromTranscript(transcript, { expectedDigits: this._expectedResponseDigits });
        if (segments.length === 0) {
            return true;
        }
        const incoming = segments[0];
        if (this._looksComplete(incoming)) {
            return false; // already complete (or unrelated gibberish) on its own - never absorb it
        }
        if (!incoming.resolved) {
            return true; // both sides look like genuine number-word fragments (e.g. "nine" + "hundred sixty") - let the merge proceed, re-checked for completeness afterward
        }

        const pendingDigitsOnly = /^\d+$/.test(pendingFragment.rawTranscript.replace(/[.,]+$/, ''));
        if (!pendingDigitsOnly) {
            return true; // pending side is word-form - digit-count math doesn't apply; let the merge happen, re-checked afterward
        }

        const pendingDigitCount = pendingFragment.rawTranscript.replace(/[.,]+$/, '').length;
        const incomingDigitCount = incoming.raw.replace(/[.,]+$/, '').length;
        return pendingDigitCount + incomingDigitCount <= this._expectedResponseDigits;
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

    // incomplete: true marks a response that was flushed (debounce
    // timeout, phase end, or superseded by a non-continuation) WITHOUT
    // ever reaching expectedResponseDigits. Its raw recognized value is
    // still fully preserved (rawTranscript/parsedNumber) - never guessed
    // at or discarded - but `resolved` is forced to false so
    // speechScoring.js's existing, unmodified "unresolved" handling
    // excludes it from correct/incorrect scoring, since it is not a
    // complete response.
    _commitSegment(segment, alternativeNumbers, timestamp, sourceEventIndexes, sourceRawTranscripts, { incomplete = false } = {}) {
        this._rawResponses.push({
            timestamp,
            rawTranscript: segment.raw, // RAW RECOGNITION - exactly as recognized (post-merge text for a reconstructed number), never overwritten
            parsedNumber: segment.value, // SELECTED/VALIDATED NUMBER - always the raw value above; alternatives (and the mathematically expected value) are never substituted in
            resolved: incomplete ? false : segment.resolved,
            alternativeNumbers, // ALTERNATIVE RECOGNITION candidates, for review only
            mergedFromFragments: sourceEventIndexes.length > 1, // true if this response was reconstructed from more than one recognition event
            contributingRawTranscripts: [...sourceRawTranscripts], // the individual raw event transcript(s) that combined to produce this response
            incomplete // true if this response never reached expectedResponseDigits - preserved, never guessed at (see stop()/H)
        });

        const responseIndex = this._rawResponses.length - 1;
        for (const idx of sourceEventIndexes) {
            const event = this._rawRecognitionEvents[idx];
            if (!event) {
                continue;
            }
            event.contributedToResponses.push(responseIndex);
            if (sourceEventIndexes.length > 1) {
                event.merged = true;
            }
            if (incomplete) {
                event.incomplete = true;
            }
        }
    }

    // Commits whatever is currently pending, exactly as-is - called when
    // the debounce window elapses with no continuation arriving, when a
    // new event arrives too late (or already stands on its own, or would
    // overshoot expectedResponseDigits) to still count as a continuation,
    // or when the phase ends (see stop() above). Never silently drops a
    // fragment, and never invents the missing digits to reach
    // expectedResponseDigits - the participant's actual recognized text
    // is preserved and flagged incomplete (see _commitSegment) if it
    // never got a chance to be completed by a later event.
    _flushPendingFragment() {
        if (!this._pendingFragment) {
            return;
        }
        const fragment = this._pendingFragment;
        this._pendingFragment = null;
        this._clearScheduledFragmentCommit();

        for (const segment of parseNumbersFromTranscript(fragment.rawTranscript, { expectedDigits: this._expectedResponseDigits })) {
            this._commitSegment(segment, [], fragment.timestamp, fragment.sourceEventIndexes, fragment.sourceRawTranscripts, {
                incomplete: !this._looksComplete(segment)
            });
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
    // getRawResponseSegments() below for the UI-presentation form. Commas
    // are a display-only concern (ui/speechTranscriptPanel.js) and never
    // appear in this stored value.
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
        return this._rawRecognitionEvents.map((event) => ({
            ...event,
            alternatives: [...event.alternatives],
            contributedToResponses: [...event.contributedToResponses]
        }));
    }

    // Scores every recorded response against the expected serial-subtraction
    // sequence (see speechScoring.js, UNMODIFIED - it never sees or knows
    // about alternativeNumbers/incomplete, it just spreads {...response}
    // through) and returns the full per-condition result record described
    // in DATA TO RECORD.
    //
    // Each response in the returned .responses array distinguishes:
    //   RAW RECOGNITION         -> rawTranscript, parsedNumber,
    //                              contributingRawTranscripts (never
    //                              auto-corrected - always what was
    //                              actually recognized, even when merged
    //                              from fragments)
    //   ALTERNATIVE RECOGNITION -> alternativeNumbers (other candidates
    //                              from the same recognition event, only
    //                              ever informational)
    //   EXPECTED NUMBER          -> expectedNumber (from speechScoring.js,
    //                              unchanged scoring architecture)
    //   SELECTED/VALIDATED       -> parsedNumber IS the selected/validated
    //                              number - it is always the raw result;
    //                              this pipeline never substitutes an
    //                              alternative OR the mathematically
    //                              expected value in its place
    //   CONFIDENCE/REASON        -> correctness (from speechScoring.js;
    //                              'unresolved' for anything flagged
    //                              incomplete) plus alternativeMatchesExpected,
    //                              a read-only annotation added here (not
    //                              in speechScoring.js) noting whether one
    //                              of the alternatives would have matched
    //                              the expected sequence - visibility
    //                              only, never fed back into scoring
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
