import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CognitiveAudioSession } from '../../app/frontend/js/cognitive/cognitiveAudioSession.js';

// Fake AudioRecorder - CognitiveAudioSession only ever calls
// start()/stop()/isSupported()/getMimeType() and sets onStart/onError, so
// this fake only needs to satisfy that surface (mirrors how
// cognitiveSpeechSession.test.mjs injected a fake recognition engine for
// the now-deleted live recognition class).
function makeFakeRecorder({ blob = new Blob(['fake audio']), mimeType = 'audio/webm;codecs=opus', supported = true } = {}) {
    return {
        onStart: null,
        onError: null,
        _recording: false,
        start() {
            this._recording = true;
            if (this.onStart) this.onStart();
        },
        async stop() {
            this._recording = false;
            return blob;
        },
        isSupported() { return supported; },
        getMimeType() { return mimeType; }
    };
}

function makeSession({ recorder = makeFakeRecorder(), uploadFn = async () => ({ status: 'succeeded', results: {} }), ...rest } = {}) {
    return new CognitiveAudioSession({
        subtractionValue: 3,
        startingNumber: 800,
        participantCode: 'P001',
        sessionId: 'session-1',
        phaseId: 'SUBTRACTION_3',
        recorderFactory: () => recorder,
        uploadFn,
        ...rest
    });
}

test('start() begins recording and marks the mic active', () => {
    const session = makeSession();
    session.start();
    assert.equal(session.isMicActive(), true);
    assert.ok(session.phaseStartTime);
});

test('stop() ends recording, marks the mic inactive, and uploads the complete audio Blob exactly once', async () => {
    let uploadCallCount = 0;
    let capturedArgs = null;
    const uploadFn = async (args) => {
        uploadCallCount += 1;
        capturedArgs = args;
        return { status: 'succeeded', results: { rawTranscript: '797 794 792' } };
    };

    const session = makeSession({ uploadFn });
    session.start();
    const result = await session.stop();

    assert.equal(session.isMicActive(), false);
    assert.ok(session.phaseEndTime);
    assert.equal(uploadCallCount, 1, 'exactly one upload for the whole phase - never split into multiple events');
    assert.ok(capturedArgs.blob instanceof Blob);
    assert.equal(capturedArgs.participantCode, 'P001');
    assert.equal(capturedArgs.sessionId, 'session-1');
    assert.equal(capturedArgs.phaseId, 'SUBTRACTION_3');
    assert.equal(capturedArgs.subtractionValue, 3);
    assert.equal(capturedArgs.startingNumber, 800);
    assert.equal(result.status, 'succeeded');
});

test('the caller can advance immediately after stop() resolves - stop() itself is what performs the (awaited) upload, never a fire-and-forget the caller must separately track', async () => {
    // This documents the actual integration contract used by
    // experiment/experimentController.js: it calls stop() but does not
    // await the returned promise before continuing to the next phase - see
    // experimentControllerCognitiveSpeech.test.mjs for that timing guarantee.
    let resolveUpload;
    const uploadFn = () => new Promise((resolve) => { resolveUpload = resolve; });
    const session = makeSession({ uploadFn });
    session.start();

    const stopPromise = session.stop();
    let settled = false;
    stopPromise.then(() => { settled = true; });

    await Promise.resolve(); // let microtasks flush
    assert.equal(settled, false, 'still pending until the upload resolves');

    resolveUpload({ status: 'succeeded', results: {} });
    await stopPromise;
    assert.equal(settled, true);
});

test('a failed upload is surfaced as its own status, never silently swallowed', async () => {
    const uploadFn = async () => { throw new Error('network error'); };
    const session = makeSession({ uploadFn });
    session.start();
    const result = await session.stop();

    assert.equal(result.status, 'failed');
    assert.match(result.error, /network error/);
    assert.equal(session.getLastError().type, 'upload-failed');
});

test('no audio recorded (empty Blob) is reported as a failed status without attempting an upload', async () => {
    let uploadCalled = false;
    const recorder = makeFakeRecorder({ blob: new Blob([]) });
    const session = makeSession({ recorder, uploadFn: async () => { uploadCalled = true; return { status: 'succeeded' }; } });
    session.start();
    const result = await session.stop();

    assert.equal(result.status, 'failed');
    assert.equal(uploadCalled, false);
});

test('never exposes any transcript/number state - only recording status', () => {
    const session = makeSession();
    assert.equal(typeof session.getInterimTranscript, 'undefined');
    assert.equal(typeof session.getRawTranscript, 'undefined');
    assert.equal(typeof session.getResults, 'undefined');
});

test('onUpdate notifies subscribers on start/error, always with only mic-active/error state - never transcript content', () => {
    const recorder = makeFakeRecorder();
    const session = makeSession({ recorder });
    const updates = [];
    session.onUpdate((s) => updates.push(s.isMicActive()));

    session.start();
    recorder.onError({ type: 'recording-error', message: 'device lost' });

    assert.ok(updates.length >= 2, 'at least one notification for start and one for the error');
    assert.ok(updates.every((active) => active === true), 'mic is still reported active - the error did not implicitly stop recording');
    assert.equal(session.getLastError().type, 'recording-error');
});

test('isSupported() delegates to the underlying recorder', () => {
    const unsupportedRecorder = makeFakeRecorder({ supported: false });
    const session = makeSession({ recorder: unsupportedRecorder });
    assert.equal(session.isSupported(), false);
});
