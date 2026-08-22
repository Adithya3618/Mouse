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
