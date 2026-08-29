import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioRecorder } from '../../app/frontend/js/cognitive/audioRecorder.js';

// Fake MediaRecorder - mirrors the real API's event-handler shape closely
// enough for AudioRecorder to drive it, without touching any real browser
// API (this repo's tests run under Node, not a browser - see
// speechRecognition.test.mjs's equivalent fake-engine-factory pattern for
// the now-deleted live recognition engine).
class FakeMediaRecorder {
    constructor(stream, options) {
        this.stream = stream;
        this.options = options;
        this.state = 'inactive';
        this.ondataavailable = null;
        this.onerror = null;
        this.onstop = null;
        FakeMediaRecorder.instances.push(this);
    }

    start() {
        this.state = 'recording';
    }

    stop() {
        this.state = 'inactive';
        if (this.ondataavailable) {
            this.ondataavailable({ data: new Blob(['fake audio chunk'], { type: 'audio/webm' }) });
        }
        if (this.onstop) {
            this.onstop();
        }
    }
}
FakeMediaRecorder.instances = [];

function makeFakeStream() {
    const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
    return { getTracks: () => tracks, _tracks: tracks };
}

function makeFakeMediaDevices({ shouldDenyPermission = false } = {}) {
    return {
        async getUserMedia() {
            if (shouldDenyPermission) {
                const error = new Error('Permission denied');
                error.name = 'NotAllowedError';
                throw error;
            }
            return makeFakeStream();
        }
    };
}

function makeRecorder(overrides = {}) {
    FakeMediaRecorder.instances = [];
    return new AudioRecorder({
        mediaDevices: makeFakeMediaDevices(),
        recorderFactory: (stream, options) => new FakeMediaRecorder(stream, options),
        ...overrides
    });
}

test('start() requests microphone permission and begins recording, firing onStart', async () => {
    const recorder = makeRecorder();
    let started = false;
    recorder.onStart = () => { started = true; };

    const result = await recorder.start();

    assert.equal(result, true);
    assert.equal(started, true);
    assert.equal(recorder.isRecording(), true);
    assert.equal(FakeMediaRecorder.instances.length, 1);
    assert.equal(FakeMediaRecorder.instances[0].state, 'recording');
});

test('stop() ends recording, releases the microphone stream, and resolves with a complete audio Blob', async () => {
    const recorder = makeRecorder();
    let stoppedBlob = null;
    recorder.onStop = (blob) => { stoppedBlob = blob; };

    await recorder.start();
    const resolvedBlob = await recorder.stop();

    assert.equal(recorder.isRecording(), false);
    assert.ok(resolvedBlob instanceof Blob);
    assert.equal(resolvedBlob, stoppedBlob, 'onStop and the stop() promise both receive the same complete Blob');
    assert.ok(FakeMediaRecorder.instances[0].stream.getTracks()[0].stopped, 'microphone track is released on stop');
});

test('stop() is safe to call when nothing was ever recording', async () => {
    const recorder = makeRecorder();
    const result = await recorder.stop();
    assert.equal(result, null);
});

test('start() is idempotent - calling it again while already recording is a no-op that returns true', async () => {
    const recorder = makeRecorder();
    await recorder.start();
    const secondStart = await recorder.start();
    assert.equal(secondStart, true);
    assert.equal(FakeMediaRecorder.instances.length, 1, 'no second MediaRecorder was created');
});

test('a denied microphone permission surfaces as a not-allowed error and never starts recording', async () => {
    const recorder = new AudioRecorder({
        mediaDevices: makeFakeMediaDevices({ shouldDenyPermission: true }),
        recorderFactory: (stream, options) => new FakeMediaRecorder(stream, options)
    });
    let capturedError = null;
    recorder.onError = (error) => { capturedError = error; };

    const result = await recorder.start();

    assert.equal(result, false);
    assert.equal(recorder.isRecording(), false);
    assert.equal(capturedError.type, 'not-allowed');
});

test('isSupported() reflects whether a mediaDevices implementation is available', () => {
    const supported = makeRecorder();
    assert.equal(supported.isSupported(), true);

    const unsupported = new AudioRecorder({ mediaDevices: null, recorderFactory: () => { throw new Error('should not be called'); } });
    assert.equal(unsupported.isSupported(), false);
});

test('an unsupported browser emits an unsupported error rather than throwing', async () => {
    const recorder = new AudioRecorder({ mediaDevices: null, recorderFactory: () => { throw new Error('should not be called'); } });
    let capturedError = null;
    recorder.onError = (error) => { capturedError = error; };

    const result = await recorder.start();

    assert.equal(result, false);
    assert.equal(capturedError.type, 'unsupported');
});

test('the recording continues across a long phase regardless of ondataavailable firing multiple times - one complete Blob on stop()', async () => {
    const recorder = makeRecorder();
    await recorder.start();
    const instance = FakeMediaRecorder.instances[0];

    // Simulate several periodic chunks arriving during a long recording
    // (see CHUNK_INTERVAL_MS) - none of these should end/split the
    // recording; only stop() does.
    instance.ondataavailable({ data: new Blob(['chunk 1']) });
    instance.ondataavailable({ data: new Blob(['chunk 2']) });
    assert.equal(recorder.isRecording(), true, 'still recording after intermediate chunks');

    const blob = await recorder.stop();
    assert.ok(blob instanceof Blob);
    assert.equal(recorder.isRecording(), false);
});
