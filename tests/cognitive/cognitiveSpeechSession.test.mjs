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
