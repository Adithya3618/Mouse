import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpeechRecognitionEngine } from '../../app/frontend/js/cognitive/speechRecognition.js';

// A fully controllable stand-in for the browser's native
// SpeechRecognition/webkitSpeechRecognition instance - the same
// dependency-injection seam used by experiment/experimentController.js's
// tests (a controllable Timer/mouse adapter instead of real ones). No real
// microphone or browser API is touched anywhere in this file.
function createFakeRecognitionFactory() {
    const instances = [];
    const factory = (lang) => {
        const instance = {
            lang,
            startCalls: 0,
            stopCalls: 0,
            abortCalls: 0,
            onstart: null,
            onresult: null,
            onerror: null,
            onend: null,
            start() {
                this.startCalls += 1;
            },
            stop() {
                this.stopCalls += 1;
                if (this.onend) this.onend();
            },
            abort() {
                this.abortCalls += 1;
                if (this.onend) this.onend();
            }
        };
        instances.push(instance);
        return instance;
    };
    factory.instances = instances;
    factory.current = () => instances[instances.length - 1];
    return factory;
}

function makeResultEvent(results, resultIndex = 0) {
    return { resultIndex, results };
}

function finalResult(transcript, confidence = 0.9) {
    const result = [{ transcript, confidence }];
    result.isFinal = true;
    return result;
}

function interimResult(transcript) {
    const result = [{ transcript, confidence: null }];
    result.isFinal = false;
    return result;
}

test('isSupported() is false with no browser SpeechRecognition available (e.g. this Node test environment)', () => {
    assert.equal(SpeechRecognitionEngine.isSupported(), false);
    const engine = new SpeechRecognitionEngine();
    assert.equal(engine.isSupported(), false);
});

test('an injected recognitionFactory is treated as supported regardless of the native API', () => {
    const factory = createFakeRecognitionFactory();
    const engine = new SpeechRecognitionEngine({ recognitionFactory: factory });
    assert.equal(engine.isSupported(), true);
});

test('start() on an unsupported engine reports an "unsupported" error and does not throw', () => {
    const engine = new SpeechRecognitionEngine();
    let error = null;
    engine.onError = (e) => { error = e; };

    const started = engine.start();

    assert.equal(started, false);
    assert.equal(error.type, 'unsupported');
});

test('start() constructs and starts a recognition instance, firing onStart when the engine reports onstart', () => {
    const factory = createFakeRecognitionFactory();
    const engine = new SpeechRecognitionEngine({ recognitionFactory: factory });
    let started = false;
    engine.onStart = () => { started = true; };

    engine.start();
    assert.equal(factory.current().startCalls, 1);
    assert.equal(started, false, 'onStart should not fire until the underlying engine reports it');

    factory.current().onstart();
    assert.equal(started, true);
});

test('interim results fire onResult; final results fire onFinalResult, not onResult', () => {
    const factory = createFakeRecognitionFactory();
    const engine = new SpeechRecognitionEngine({ recognitionFactory: factory });
    const interimCalls = [];
    const finalCalls = [];
    engine.onResult = (r) => interimCalls.push(r.transcript);
    engine.onFinalResult = (r) => finalCalls.push(r.transcript);

    engine.start();
    const recognition = factory.current();

    recognition.onresult(makeResultEvent([interimResult('nine hundred')]));
    assert.deepEqual(interimCalls, ['nine hundred']);
    assert.deepEqual(finalCalls, []);

    recognition.onresult(makeResultEvent([finalResult('nine hundred forty four')]));
    assert.deepEqual(finalCalls, ['nine hundred forty four']);
    assert.deepEqual(interimCalls, ['nine hundred'], 'a final result must not also fire onResult');
});

test('recognition ending unexpectedly while still listening restarts automatically', () => {
    const factory = createFakeRecognitionFactory();
    const engine = new SpeechRecognitionEngine({ recognitionFactory: factory });
    engine.start();

    assert.equal(factory.instances.length, 1);
    // Simulate the browser's own silence-timeout ending the underlying
    // engine, without stop()/abort() ever being called on our wrapper.
    factory.current().onend();

    assert.equal(factory.instances.length, 2, 'a fresh recognition instance should have been started automatically');
    assert.equal(factory.instances[1].startCalls, 1);
});

test('stop() does not trigger an automatic restart', () => {
    const factory = createFakeRecognitionFactory();
    const engine = new SpeechRecognitionEngine({ recognitionFactory: factory });
    let ended = 0;
    engine.onEnd = () => { ended += 1; };

    engine.start();
    engine.stop();

    assert.equal(factory.instances.length, 1, 'no new instance should be created after an intentional stop()');
    assert.equal(ended, 1);
    assert.equal(engine.isListening(), false);
});

test('abort() does not trigger an automatic restart either', () => {
    const factory = createFakeRecognitionFactory();
    const engine = new SpeechRecognitionEngine({ recognitionFactory: factory });

    engine.start();
    engine.abort();

    assert.equal(factory.instances.length, 1);
    assert.equal(factory.current().abortCalls, 1);
    assert.equal(engine.isListening(), false);
});

test('a "not-allowed" (microphone denied) error stops listening and does not restart', () => {
    const factory = createFakeRecognitionFactory();
    const engine = new SpeechRecognitionEngine({ recognitionFactory: factory });
    let reportedError = null;
    engine.onError = (e) => { reportedError = e; };

    engine.start();
    factory.current().onerror({ error: 'not-allowed' });
    // Browsers typically also fire onend right after a fatal onerror.
    factory.current().onend();

    assert.equal(reportedError.type, 'not-allowed');
    assert.equal(engine.isListening(), false);
    assert.equal(factory.instances.length, 1, 'must not restart after permission is denied');
});

test('a transient error (e.g. "no-speech") does not stop listening or prevent the normal restart-on-end behavior', () => {
    const factory = createFakeRecognitionFactory();
    const engine = new SpeechRecognitionEngine({ recognitionFactory: factory });
    let reportedError = null;
    engine.onError = (e) => { reportedError = e; };

    engine.start();
    factory.current().onerror({ error: 'no-speech' });
    assert.equal(reportedError.type, 'no-speech');
    assert.equal(engine.isListening(), true, 'a transient error should not turn off listening intent');

    factory.current().onend();
    assert.equal(factory.instances.length, 2, 'should still auto-restart after a transient error ends the instance');
});

test('cleanup: calling stop() when nothing has started is a safe no-op', () => {
    const factory = createFakeRecognitionFactory();
    const engine = new SpeechRecognitionEngine({ recognitionFactory: factory });
    assert.doesNotThrow(() => engine.stop());
});

test('start() called twice while already listening does not create a second recognition instance', () => {
    const factory = createFakeRecognitionFactory();
    const engine = new SpeechRecognitionEngine({ recognitionFactory: factory });
    engine.start();
    engine.start();
    assert.equal(factory.instances.length, 1);
});

test('an "audio-capture" (no microphone hardware) error stops listening and does not restart, like "not-allowed"', () => {
    const factory = createFakeRecognitionFactory();
    const engine = new SpeechRecognitionEngine({ recognitionFactory: factory });
    let reportedError = null;
    engine.onError = (e) => { reportedError = e; };

    engine.start();
    factory.current().onerror({ error: 'audio-capture' });
    factory.current().onend();

    assert.equal(reportedError.type, 'audio-capture');
    assert.equal(engine.isListening(), false);
    assert.equal(factory.instances.length, 1, 'must not restart when the microphone hardware itself is unavailable');
});

// --- Restart-loop guard: "controlled restart is acceptable... do not
// create an infinite restart loop" ---

test('a controlled restart is allowed after a normal, successfully-started cycle - the failure counter resets on success', () => {
    const factory = createFakeRecognitionFactory();
    const engine = new SpeechRecognitionEngine({ recognitionFactory: factory });
    engine.start();

    // Several genuine restart cycles, each one actually starting
    // successfully before ending - this must never trip the loop guard,
    // no matter how many times it happens over a long cognitive phase.
    for (let i = 0; i < 10; i += 1) {
        factory.current().onstart();
        factory.current().onend();
    }

    assert.equal(engine.isListening(), true, 'many successful restart cycles must never be treated as a failure loop');
    assert.equal(factory.instances.length, 11);
});

test('the engine stops itself with a "restart-loop" error after repeated consecutive failures to even start, instead of retrying forever', () => {
    const factory = createFakeRecognitionFactory();
    const engine = new SpeechRecognitionEngine({ recognitionFactory: factory });
    let reportedError = null;
    engine.onError = (e) => { reportedError = e; };

    engine.start();
    // Simulate the underlying engine ending immediately every time,
    // without ever successfully firing onstart() - a pathological
    // fast-crash-loop scenario.
    for (let i = 0; i < 10; i += 1) {
        factory.current().onend();
    }

    assert.equal(engine.isListening(), false, 'must give up rather than restart indefinitely');
    assert.equal(reportedError.type, 'restart-loop');
    assert.ok(
        factory.instances.length <= 6,
        `expected the engine to stop after a small, bounded number of attempts, got ${factory.instances.length}`
    );

    // And, crucially, it must not restart again even if onend() fires
    // again afterward (e.g. a stray late event).
    const countAfterGivingUp = factory.instances.length;
    factory.current().onend();
    assert.equal(factory.instances.length, countAfterGivingUp, 'no further restart attempts once the engine has given up');
});
