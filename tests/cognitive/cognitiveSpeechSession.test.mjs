import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CognitiveSpeechSession } from '../../app/frontend/js/cognitive/cognitiveSpeechSession.js';

// A fake SpeechRecognitionEngine (same shape/contract as
// cognitive/speechRecognition.js's real class) so these tests exercise
// CognitiveSpeechSession's own orchestration logic - parsing, scoring,
// transcript bookkeeping, mic-state tracking - without touching the real
// Web Speech API or cognitive/speechRecognition.js's internals.
function createFakeEngine() {
    const engine = {
        startCalls: 0,
        stopCalls: 0,
        onStart: null,
        onResult: null,
        onFinalResult: null,
        onError: null,
        onEnd: null,
        isSupported: () => true,
        start() {
            this.startCalls += 1;
        },
        stop() {
            this.stopCalls += 1;
        }
    };
    return engine;
}

function createSession(overrides = {}) {
    let fakeEngine;
    const session = new CognitiveSpeechSession({
        subtractionValue: 3,
        startingNumber: 947,
        engineFactory: () => {
            fakeEngine = createFakeEngine();
            return fakeEngine;
        },
        ...overrides
    });
    return { session, engine: () => fakeEngine };
}

test('start() begins listening and records a phaseStartTime', () => {
    const { session, engine } = createSession();
    assert.equal(session.phaseStartTime, null);
    session.start();
    assert.equal(engine().startCalls, 1);
    assert.ok(session.phaseStartTime);
});

test('stop() stops listening and records a phaseEndTime', () => {
    const { session, engine } = createSession();
    session.start();
    session.stop();
    assert.equal(engine().stopCalls, 1);
    assert.ok(session.phaseEndTime);
});

test('mic-active state tracks the engine\'s onStart/onEnd callbacks', () => {
    const { session, engine } = createSession();
    assert.equal(session.isMicActive(), false);

    session.start();
    engine().onStart();
    assert.equal(session.isMicActive(), true);

    engine().onEnd();
    assert.equal(session.isMicActive(), false);
});

test('interim results are exposed via getInterimTranscript() and cleared on a final result', () => {
    const { session, engine } = createSession();
    session.start();

    engine().onResult({ transcript: 'nine hundred', timestamp: Date.now() });
    assert.equal(session.getInterimTranscript(), 'nine hundred');

    engine().onFinalResult({ transcript: '944', timestamp: Date.now() });
    assert.equal(session.getInterimTranscript(), '', 'interim transcript clears once a final result lands');
});

test('final results are parsed into numbers and preserved in the raw transcript', () => {
    const { session, engine } = createSession();
    session.start();

    engine().onFinalResult({ transcript: '944, 941', timestamp: 1000 });
    engine().onFinalResult({ transcript: 'nine hundred thirty eight', timestamp: 2000 });

    assert.equal(session.getRawTranscript(), '944 941 nine hundred thirty eight');

    const results = session.getResults();
    assert.deepEqual(results.parsedNumbers, [944, 941, 938]);
});

test('getResults() scores responses against the expected sequence (adaptive default) and reports accuracy', () => {
    const { session, engine } = createSession();
    session.start();
    engine().onFinalResult({ transcript: '944', timestamp: 1 });
    engine().onFinalResult({ transcript: '941', timestamp: 2 });
    engine().onFinalResult({ transcript: '999', timestamp: 3 }); // wrong
    session.stop();

    const results = session.getResults();
    assert.equal(results.subtractionRule, 3);
    assert.equal(results.startingNumber, 947);
    assert.equal(results.numberOfResponses, 3);
    assert.equal(results.correctResponses, 2);
    assert.equal(results.incorrectResponses, 1);
    assert.equal(results.unresolvedResponses, 0);
    assert.equal(results.cognitiveAccuracy, (2 / 3) * 100);
    assert.equal(results.responses.length, 3);
    assert.ok(results.phaseStartTime);
    assert.ok(results.phaseEndTime);
});

test('an unresolved response is preserved in the raw transcript and counted separately, not silently dropped', () => {
    const { session, engine } = createSession();
    session.start();
    engine().onFinalResult({ transcript: '944', timestamp: 1 });
    engine().onFinalResult({ transcript: 'uh I lost it', timestamp: 2 });

    const results = session.getResults();
    assert.equal(results.numberOfResponses, 2);
    assert.equal(results.unresolvedResponses, 1);
    assert.ok(results.rawTranscript.includes('uh I lost it'), 'raw transcript is never destroyed by parsing/scoring');
});

test('recognition errors are exposed via getLastError() for the UI to surface', () => {
    const { session, engine } = createSession();
    session.start();
    assert.equal(session.getLastError(), null);

    engine().onError({ type: 'not-allowed', message: 'denied' });
    assert.deepEqual(session.getLastError(), { type: 'not-allowed', message: 'denied' });
});

// --- Raw recognition preservation, alternatives, and sequence-aware
// candidate exposure (never auto-correction) ---

test('every final recognition event is preserved exactly, with its full alternatives list, via getRawRecognitionEvents()', () => {
    const { session, engine } = createSession();
    session.start();

    engine().onFinalResult({
        transcript: '960 967 964 961',
        alternatives: ['960 967 964 961', '962 967 964 961', '960 967 965 961'],
        timestamp: 1000
    });

    const events = session.getRawRecognitionEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].rawTranscript, '960 967 964 961');
    assert.deepEqual(events[0].alternatives, ['960 967 964 961', '962 967 964 961', '960 967 965 961']);
    assert.equal(events[0].timestamp, 1000);
    assert.equal(events[0].treatedAsDuplicate, false);
});

test('getRawRecognitionEvents() returns a defensive copy - mutating it does not affect the session', () => {
    const { session, engine } = createSession();
    session.start();
    engine().onFinalResult({ transcript: '960', alternatives: ['960'], timestamp: 1 });

    const events = session.getRawRecognitionEvents();
    events[0].rawTranscript = 'TAMPERED';
    events[0].alternatives.push('TAMPERED');

    assert.equal(session.getRawRecognitionEvents()[0].rawTranscript, '960');
    assert.deepEqual(session.getRawRecognitionEvents()[0].alternatives, ['960']);
});

test('when the engine does not supply alternatives at all, the primary transcript is used as a single-item alternatives list (backward compatible)', () => {
    const { session, engine } = createSession();
    session.start();
    engine().onFinalResult({ transcript: '944', timestamp: 1 }); // no `alternatives` field

    const events = session.getRawRecognitionEvents();
    assert.deepEqual(events[0].alternatives, ['944']);
});

test('an alternative that differs from the primary at the same position is exposed as an alternativeNumbers candidate, without changing parsedNumber', () => {
    const { session, engine } = createSession(); // subtractionValue 3, startingNumber 947
    session.start();

    // Primary heard "963 962 957"; one alternative correctly heard "960" at position 2.
    engine().onFinalResult({
        transcript: '963 962 957',
        alternatives: ['963 962 957', '963 960 957'],
        timestamp: 1
    });

    const results = session.getResults();
    const responses = results.responses;
    assert.equal(responses.length, 3);

    const secondResponse = responses[1];
    assert.equal(secondResponse.parsedNumber, 962, 'RAW/SELECTED number is always the primary recognition - never silently replaced');
    assert.deepEqual(secondResponse.alternativeNumbers, [960], 'the alternative candidate is exposed, not substituted');
});

test('sequence-aware validation: a recognized number inconsistent with the expected sequence is flagged, and a matching alternative is surfaced separately', () => {
    const { session, engine } = createSession({ startingNumber: 963 }); // subtractionValue 3 (default)
    session.start();

    // Expected first response: 963 - 3 = 960 (the existing, unmodified
    // adaptive scoring rule - the starting number itself is given, not
    // spoken as a response; see the pre-existing "getResults() scores..."
    // test above for the same convention).
    engine().onFinalResult({ transcript: '962', alternatives: ['962', '960'], timestamp: 1 }); // misrecognized; 960 was an alternative
    engine().onFinalResult({ transcript: '957', alternatives: ['957'], timestamp: 2 });

    const results = session.getResults();
    const [first, second] = results.responses;

    assert.equal(first.parsedNumber, 962, 'raw recognition is preserved exactly - never silently replaced with 960');
    assert.equal(first.expectedNumber, 960);
    assert.equal(first.correctness, 'incorrect', 'inconsistent with the expected sequence');
    assert.deepEqual(first.alternativeNumbers, [960], 'the matching alternative is exposed as a candidate');
    assert.equal(first.alternativeMatchesExpected, true, 'flagged that an alternative WOULD have matched, for review');

    // Adaptive scoring continues the chain from what was actually
    // recorded (962), NOT from the alternative (960) or the pure
    // mathematical sequence - speechScoring.js's existing, unmodified rule.
    assert.equal(second.parsedNumber, 957);
    assert.equal(second.expectedNumber, 959);
    assert.equal(second.correctness, 'incorrect');
    assert.equal(second.alternativeMatchesExpected, false, 'no alternative offered 959');
});

test('an alternative equal to the primary result is never listed as a candidate (it offers nothing new)', () => {
    const { session, engine } = createSession();
    session.start();
    engine().onFinalResult({ transcript: '944', alternatives: ['944', '944', '944'], timestamp: 1 });

    const responses = session.getResults().responses;
    assert.deepEqual(responses[0].alternativeNumbers, []);
});

// --- Duplicate/overlapping final-event handling ---

test('two final events with the exact same transcript arriving close together are treated as one browser-level duplicate delivery, not double-recorded', () => {
    const { session, engine } = createSession();
    session.start();

    engine().onFinalResult({ transcript: '960 957', alternatives: ['960 957'], timestamp: 1000 });
    engine().onFinalResult({ transcript: '960 957', alternatives: ['960 957'], timestamp: 1200 }); // 200ms later - duplicate

    const results = session.getResults();
    assert.equal(results.numberOfResponses, 2, 'must not double-count 960 and 957');
    assert.deepEqual(results.parsedNumbers, [960, 957]);

    // But the raw audit trail still shows both events actually happened.
    const events = session.getRawRecognitionEvents();
    assert.equal(events.length, 2);
    assert.equal(events[0].treatedAsDuplicate, false);
    assert.equal(events[1].treatedAsDuplicate, true);
});

test('a genuinely repeated number spoken well apart in time is preserved, not treated as a duplicate (conservative)', () => {
    const { session, engine } = createSession();
    session.start();

    engine().onFinalResult({ transcript: '960', alternatives: ['960'], timestamp: 1000 });
    engine().onFinalResult({ transcript: '960', alternatives: ['960'], timestamp: 5000 }); // 4s later - legitimate

    const results = session.getResults();
    assert.equal(results.numberOfResponses, 2, 'a real repeat outside the duplicate window must be kept, not deleted');
    assert.deepEqual(results.parsedNumbers, [960, 960]);
    assert.equal(session.getRawRecognitionEvents().every((e) => e.treatedAsDuplicate === false), true);
});

test('two DIFFERENT final events are never treated as duplicates, no matter how close in time', () => {
    const { session, engine } = createSession();
    session.start();

    engine().onFinalResult({ transcript: '960', alternatives: ['960'], timestamp: 1000 });
    engine().onFinalResult({ transcript: '957', alternatives: ['957'], timestamp: 1010 });

    const results = session.getResults();
    assert.equal(results.numberOfResponses, 2);
    assert.deepEqual(results.parsedNumbers, [960, 957]);
});

// --- UI-presentation helper (formatting only, never mutates stored data) ---

test('getRawResponseSegments() returns the per-number segments as an array, in order, for the UI to format separately', () => {
    const { session, engine } = createSession();
    session.start();
    engine().onFinalResult({ transcript: '960, 967, 964, 961', timestamp: 1 });

    assert.deepEqual(session.getRawResponseSegments(), ['960', '967', '964', '961']);
    // The underlying stored/exported transcript remains space-joined,
    // untouched by any presentation concern.
    assert.equal(session.getRawTranscript(), '960 967 964 961');
});

// --- End-to-end adaptive continuation scoring, through the full
// speech-recognition -> numberParser -> speechScoring pipeline (not just
// speechScoring.js in isolation - see tests/cognitive/speechScoring.test.mjs
// for the pure-scoring-layer version of this same worked example) ---

test('end-to-end: the full pipeline scores an adaptive-continuation example exactly like speechScoring.js does in isolation', () => {
    const { session, engine } = createSession({ startingNumber: 97 }); // subtractionValue 3 (default)
    session.start();

    for (const n of [94, 91, 87, 84, 81]) {
        engine().onFinalResult({ transcript: String(n), timestamp: n });
    }
    session.stop();

    const results = session.getResults();
    assert.deepEqual(results.parsedNumbers, [94, 91, 87, 84, 81], 'raw participant responses are preserved exactly, never corrected');
    assert.deepEqual(results.expectedNumbers, [94, 91, 88, 84, 81]);
    assert.deepEqual(results.responses.map((r) => r.correctness), ['correct', 'correct', 'incorrect', 'correct', 'correct']);
    assert.equal(results.correctResponses, 4);
    assert.equal(results.incorrectResponses, 1);
    assert.equal(results.numberOfResponses, 5);
    assert.equal(results.cognitiveAccuracy, 80);
});

// --- Robustness pass (researcher request, 2026): reliable segmentation of
// a spoken number sequence into independent responses, regardless of
// whether the browser delivers them as one recognition event or several
// (pauses), in digit or word form, with or without alternatives/
// duplicates. Response boundaries always come from parsed number
// segments, never from recognition event boundaries. ---

test('multiple word-form numbers inside ONE final recognition event become independent responses (the numberParser segmentation fix)', () => {
    const { session, engine } = createSession();
    session.start();

    engine().onFinalResult({
        transcript: 'nine hundred sixty nine hundred fifty seven nine hundred fifty four',
        timestamp: 1
    });

    const results = session.getResults();
    assert.deepEqual(results.parsedNumbers, [960, 957, 954]);
    assert.equal(results.numberOfResponses, 3);
    // The raw transcript for this one recognition event is preserved
    // exactly, even though it was split into 3 responses.
    assert.ok(results.rawRecognitionEvents[0].rawTranscript.includes('nine hundred sixty nine hundred fifty seven nine hundred fifty four'));
});

test('a spoken sequence delivered as SEPARATE final recognition events (simulating pauses between numbers) still produces one ordered set of independent responses', () => {
    const { session, engine } = createSession();
    session.start();

    // Each number arrives as its own final event, several seconds apart -
    // exactly what a participant pausing between numbers looks like.
    engine().onFinalResult({ transcript: '960', timestamp: 1000 });
    engine().onFinalResult({ transcript: '957', timestamp: 3400 });
    engine().onFinalResult({ transcript: '954', timestamp: 6100 });
    engine().onFinalResult({ transcript: '951', timestamp: 8900 });

    const results = session.getResults();
    assert.deepEqual(results.parsedNumbers, [960, 957, 954, 951]);
    assert.equal(results.numberOfResponses, 4);
    assert.equal(results.rawRecognitionEvents.length, 4, 'response boundaries came from 4 separate recognition events here, not from splitting one transcript');
});

test('response boundaries come from parsed number segments, not recognition event boundaries - a mix of single- and multi-number events combines correctly', () => {
    const { session, engine } = createSession();
    session.start();

    engine().onFinalResult({ transcript: '960', timestamp: 1000 }); // 1 number, 1 event
    engine().onFinalResult({ transcript: '957 954', timestamp: 4000 }); // 2 numbers, 1 event (browser grouped them)
    engine().onFinalResult({ transcript: '951', timestamp: 7000 }); // 1 number, 1 event

    const results = session.getResults();
    assert.deepEqual(results.parsedNumbers, [960, 957, 954, 951]);
    assert.equal(results.numberOfResponses, 4, '4 independent responses regardless of how they were grouped into 3 recognition events');
});

test('an interim result followed by its final result: only the final is parsed/scored, and the interim never leaks into stored responses', () => {
    const { session, engine } = createSession();
    session.start();

    engine().onResult({ transcript: 'nine hundred', timestamp: 1 });
    assert.equal(session.getInterimTranscript(), 'nine hundred');
    assert.equal(session.getResults().numberOfResponses, 0, 'an interim result must never be scored as a response');

    engine().onResult({ transcript: 'nine hundred sixty', timestamp: 2 }); // revised interim, still not final
    assert.equal(session.getInterimTranscript(), 'nine hundred sixty');
    assert.equal(session.getResults().numberOfResponses, 0);

    engine().onFinalResult({ transcript: 'nine hundred sixty', timestamp: 3 });
    assert.equal(session.getInterimTranscript(), '', 'interim clears once finalized');
    const results = session.getResults();
    assert.deepEqual(results.parsedNumbers, [960]);
    assert.equal(results.numberOfResponses, 1, 'exactly one response, not one per interim revision');
});

test('combined scenario: word-form segmentation + alternatives + a duplicate event, exactly as they would occur together in one phase', () => {
    const { session, engine } = createSession({ startingNumber: 963 }); // subtractionValue 3 (default)
    session.start();

    // First utterance: two word-form numbers in one event, with a
    // misrecognition on the second (962 heard, 960 was an alternative).
    engine().onFinalResult({
        transcript: 'nine hundred sixty nine hundred sixty two',
        alternatives: ['nine hundred sixty nine hundred sixty two', 'nine hundred sixty nine hundred sixty'],
        timestamp: 1000
    });
    // Browser glitch: the same event fires again almost immediately.
    engine().onFinalResult({
        transcript: 'nine hundred sixty nine hundred sixty two',
        alternatives: ['nine hundred sixty nine hundred sixty two', 'nine hundred sixty nine hundred sixty'],
        timestamp: 1100
    });
    // A later, genuinely new number.
    engine().onFinalResult({ transcript: '957', timestamp: 4000 });

    const results = session.getResults();
    assert.deepEqual(results.parsedNumbers, [960, 962, 957], 'the duplicate event contributed no extra responses');
    assert.equal(results.numberOfResponses, 3);
    assert.equal(results.rawRecognitionEvents.length, 3, 'all 3 raw events are preserved in the audit trail, including the duplicate');
    assert.equal(results.rawRecognitionEvents[1].treatedAsDuplicate, true);

    const secondResponse = results.responses[1];
    assert.equal(secondResponse.parsedNumber, 962, 'raw recognition preserved - never silently replaced with the alternative 960');
    assert.deepEqual(secondResponse.alternativeNumbers, [960]);
});

// --- Fragment segmentation (researcher request, 2026): Chrome's own
// utterance endpointer can misfire mid-number, finalizing e.g. "8" then
// "65" as two separate final events for one spoken "865". See the
// module-level comment on FRAGMENT_COMMIT_DEBOUNCE_MS in
// cognitiveSpeechSession.js for the full strategy. A controllable
// fragment-commit scheduler is used here so debounce-timeout behavior
// (case where nothing else arrives) can be tested deterministically,
// without a real setTimeout wait. ---

function createControllableFragmentScheduler() {
    const scheduled = [];
    return {
        scheduleFragmentCommit: (callback) => {
            const handle = { callback, cleared: false };
            scheduled.push(handle);
            return handle;
        },
        clearFragmentCommit: (handle) => { handle.cleared = true; },
        fireLatestPending: () => {
            const pending = scheduled.filter((h) => !h.cleared);
            const handle = pending[pending.length - 1];
            assert.ok(handle, 'fireLatestPending() called with nothing pending');
            handle.callback();
        },
        hasPending: () => scheduled.some((h) => !h.cleared)
    };
}

// A. "8" + "65" -> 865
test('fragment segmentation A: "8" then "65" arriving close together are combined into 865, not recorded as 8 and 65', () => {
    const { session, engine } = createSession({ startingNumber: 865 });
    session.start();

    engine().onFinalResult({ transcript: '8', timestamp: 1000 });
    engine().onFinalResult({ transcript: '65', timestamp: 1050 });

    const results = session.getResults();
    assert.deepEqual(results.parsedNumbers, [865]);
    assert.equal(results.numberOfResponses, 1);
    assert.equal(results.responses[0].mergedFromFragments, true);
});

// B. "865" + "862" + "859" -> 865, 862, 859 (three ALREADY-COMPLETE numbers
// must never be merged into one another, regardless of how close together
// their events arrive)
test('fragment segmentation B: three already-complete numbers stay independent, never merged', () => {
    const { session, engine } = createSession({ startingNumber: 865 });
    session.start();

    engine().onFinalResult({ transcript: '865', timestamp: 1000 });
    engine().onFinalResult({ transcript: '862', timestamp: 1300 });
    engine().onFinalResult({ transcript: '859', timestamp: 1600 });

    const results = session.getResults();
    assert.deepEqual(results.parsedNumbers, [865, 862, 859]);
    assert.equal(results.numberOfResponses, 3);
    assert.ok(results.responses.every((r) => r.mergedFromFragments === false));
});

// C. 865 [pause] 862 -> two numbers, never "865862"
test('fragment segmentation C: a real pause between two complete numbers never produces a merged "865862"', () => {
    const { session, engine } = createSession({ startingNumber: 865, fragmentCommitDebounceMs: 400 });
    session.start();

    engine().onFinalResult({ transcript: '865', timestamp: 1000 });
    engine().onFinalResult({ transcript: '862', timestamp: 2500 }); // 1.5s later, well past the debounce window

    const results = session.getResults();
    assert.deepEqual(results.parsedNumbers, [865, 862]);
    assert.equal(results.numberOfResponses, 2);
});

// D. A wrong response mid-sequence: adaptive scoring continues from the
// actual recognized (wrong) value, exactly as before - segmentation must
// not disturb this in any way.
test('fragment segmentation D: adaptive scoring after a wrong response continues from the actual recognized number, unaffected by segmentation', () => {
    const { session, engine } = createSession({ startingNumber: 865 }); // subtractionValue 3 (default)
    session.start();

    for (const [n, t] of [[862, 1000], [861, 1400], [858, 1800], [855, 2200]]) {
        engine().onFinalResult({ transcript: String(n), timestamp: t });
    }

    const results = session.getResults();
    assert.deepEqual(results.parsedNumbers, [862, 861, 858, 855]);
    assert.deepEqual(results.expectedNumbers, [862, 859, 858, 855]);
    assert.deepEqual(results.responses.map((r) => r.correctness), ['correct', 'incorrect', 'correct', 'correct']);
    // 861 is wrong (859 was expected), but the NEXT expected number (858)
    // is derived from the actual recognized 861, not the mathematically
    // expected 859 - the existing, unmodified adaptive scoring rule.
    assert.equal(results.responses[2].expectedNumber, 858, '861 - 3, not 859 - 3');
});

// E. A single number split across MORE than two recognition events.
test('fragment segmentation E: a number split across three separate recognition events (e.g. "8", "6", "5") still reconstructs to 865', () => {
    const { session, engine } = createSession({ startingNumber: 865, fragmentCommitDebounceMs: 400 });
    session.start();

    engine().onFinalResult({ transcript: '8', timestamp: 1000 });
    engine().onFinalResult({ transcript: '6', timestamp: 1080 });
    engine().onFinalResult({ transcript: '5', timestamp: 1150 });

    const results = session.getResults();
    assert.deepEqual(results.parsedNumbers, [865]);
    assert.equal(results.responses[0].mergedFromFragments, true);
});

// F. Numbers spoken continuously with very short pauses - must not
// require a long pause, and must not merge complete numbers together.
test('fragment segmentation F: complete numbers spoken with very short (150ms) pauses between them are still recorded as independent responses', () => {
    const { session, engine } = createSession({ startingNumber: 865 });
    session.start();

    engine().onFinalResult({ transcript: '865', timestamp: 1000 });
    engine().onFinalResult({ transcript: '862', timestamp: 1150 });
    engine().onFinalResult({ transcript: '859', timestamp: 1300 });
    engine().onFinalResult({ transcript: '856', timestamp: 1450 });

    const results = session.getResults();
    assert.deepEqual(results.parsedNumbers, [865, 862, 859, 856]);
    assert.equal(results.numberOfResponses, 4);
});

// G. Do not accidentally merge two genuinely separate numbers - word-form
// variant, and a case where the running expected length has already
// adapted downward.
test('fragment segmentation G: two genuinely separate word-form numbers spoken close together are not merged', () => {
    const { session, engine } = createSession({ startingNumber: 865 });
    session.start();

    engine().onFinalResult({ transcript: 'eight hundred sixty five', timestamp: 1000 });
    engine().onFinalResult({ transcript: 'eight hundred sixty two', timestamp: 1150 });

    const results = session.getResults();
    assert.deepEqual(results.parsedNumbers, [865, 862]);
});

test('fragment segmentation G2: once the sequence legitimately drops to fewer digits, a later short number is still recorded correctly (delayed, never lost or merged)', () => {
    const scheduler = createControllableFragmentScheduler();
    const { session, engine } = createSession({
        startingNumber: 104, // subtractionValue 3 (default)
        scheduleFragmentCommit: scheduler.scheduleFragmentCommit,
        clearFragmentCommit: scheduler.clearFragmentCommit
    });
    session.start();

    engine().onFinalResult({ transcript: '101', timestamp: 1000 }); // 3 digits, commits normally, updates expected length to 3
    engine().onFinalResult({ transcript: '98', timestamp: 1300 }); // now genuinely 2 digits - below the still-3 expected length

    // "98" alone doesn't immediately look "complete" by the digit-length
    // heuristic (a known, documented limitation - see the final report),
    // so it is held pending; nothing else arrives to merge with it, so it
    // must still be committed via the debounce flush, not lost or merged
    // with anything else.
    assert.deepEqual(session.getResults().parsedNumbers, [101], '98 not yet committed - still within its debounce window');
    scheduler.fireLatestPending();

    const results = session.getResults();
    assert.deepEqual(results.parsedNumbers, [101, 98], '98 must still be recorded correctly - delayed, never dropped or corrupted');
});

// Explicit debounce-timeout test: a fragment with NOTHING arriving after
// it must still be committed (not lost), once the debounce window elapses.
test('a pending fragment with no continuation is committed as-is once the debounce window elapses, never silently dropped', () => {
    const scheduler = createControllableFragmentScheduler();
    const { session, engine } = createSession({
        startingNumber: 865,
        scheduleFragmentCommit: scheduler.scheduleFragmentCommit,
        clearFragmentCommit: scheduler.clearFragmentCommit
    });
    session.start();

    engine().onFinalResult({ transcript: '8', timestamp: 1000 }); // looks incomplete (1 digit, expects 3) - buffered
    assert.equal(session.getResults().numberOfResponses, 0, 'not yet committed - still waiting for a possible continuation');
    assert.equal(scheduler.hasPending(), true);

    scheduler.fireLatestPending(); // simulates the debounce window elapsing with nothing more arriving

    const results = session.getResults();
    assert.deepEqual(results.parsedNumbers, [8], 'committed as-is - the raw recognized "8" is preserved, never dropped or guessed at');
    assert.equal(results.responses[0].mergedFromFragments, true);
});

test('a continuation that arrives before the debounce window elapses cancels the pending timeout and merges instead', () => {
    const scheduler = createControllableFragmentScheduler();
    const { session, engine } = createSession({
        startingNumber: 865,
        scheduleFragmentCommit: scheduler.scheduleFragmentCommit,
        clearFragmentCommit: scheduler.clearFragmentCommit
    });
    session.start();

    engine().onFinalResult({ transcript: '8', timestamp: 1000 });
    assert.equal(scheduler.hasPending(), true);

    engine().onFinalResult({ transcript: '65', timestamp: 1050 }); // arrives well within the debounce window
    assert.equal(scheduler.hasPending(), false, 'the pending timeout must be cancelled once merged');

    assert.deepEqual(session.getResults().parsedNumbers, [865]);
});

// stop() must flush a still-pending fragment rather than lose it when the
// phase ends mid-debounce-window.
test('stop() commits a still-pending fragment instead of losing it when the phase ends mid-debounce-window', () => {
    const scheduler = createControllableFragmentScheduler();
    const { session, engine } = createSession({
        startingNumber: 865,
        scheduleFragmentCommit: scheduler.scheduleFragmentCommit,
        clearFragmentCommit: scheduler.clearFragmentCommit
    });
    session.start();

    engine().onFinalResult({ transcript: '8', timestamp: 1000 });
    assert.equal(session.getResults().numberOfResponses, 0);

    session.stop();

    assert.deepEqual(session.getResults().parsedNumbers, [8]);
    assert.equal(scheduler.hasPending(), false, 'the pending timer must be cleared once flushed by stop()');
});

// A trailing fragment of a multi-number event correctly waits for its own
// continuation, while the earlier, already-complete numbers in that same
// event commit immediately.
test('a multi-number event ending in an incomplete trailing fragment commits the earlier numbers immediately and buffers only the trailing piece', () => {
    const scheduler = createControllableFragmentScheduler();
    const { session, engine } = createSession({
        startingNumber: 865,
        scheduleFragmentCommit: scheduler.scheduleFragmentCommit,
        clearFragmentCommit: scheduler.clearFragmentCommit
    });
    session.start();

    engine().onFinalResult({ transcript: '862 8', timestamp: 1000 }); // "8" here is the start of the next number, cut off
    assert.deepEqual(session.getResults().parsedNumbers, [862], '862 commits immediately - it already looks complete');
    assert.equal(scheduler.hasPending(), true, 'the trailing "8" is held pending, not discarded');

    engine().onFinalResult({ transcript: '61', timestamp: 1080 });
    assert.deepEqual(session.getResults().parsedNumbers, [862, 861]);
});

test('onUpdate() notifies subscribers on mic state, interim, final, and error changes; unsubscribe stops further notifications', () => {
    const { session, engine } = createSession();
    let updateCount = 0;
    const unsubscribe = session.onUpdate(() => { updateCount += 1; });

    session.start();
    engine().onStart();
    engine().onResult({ transcript: 'nine', timestamp: 1 });
    engine().onFinalResult({ transcript: '944', timestamp: 2 });
    const countBeforeUnsubscribe = updateCount;
    assert.ok(countBeforeUnsubscribe > 0);

    unsubscribe();
    engine().onError({ type: 'network', message: 'x' });
    assert.equal(updateCount, countBeforeUnsubscribe, 'no further notifications after unsubscribe');
});
