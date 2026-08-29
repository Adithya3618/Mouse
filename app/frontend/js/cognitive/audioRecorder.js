// Thin abstraction over the browser's native MediaRecorder API. Nothing
// else in the cognitive pipeline (cognitiveAudioSession.js) touches
// MediaRecorder/getUserMedia directly - they only see this class's
// start/stop/isSupported methods and its onStart/onStop/onError callbacks.
//
// Replaces speechRecognition.js (deleted): the participant's speech is no
// longer recognized live in the browser at all. This class only ever
// captures and hands back raw audio - it has no concept of transcripts,
// numbers, or scoring. The complete recording is transcribed and scored
// later, on the backend (see app/backend/services/speechProcessingService.js).
//
// AUDIO FORMAT: audio/webm;codecs=opus is requested first (broad support -
// Chrome, Firefox, Edge - and small file size for a ~2 minute recording),
// falling back to plain audio/webm, then audio/mp4 (Safari), then whatever
// MediaRecorder.isTypeSupported reports nothing for, in which case the
// browser's own default is used. Whatever format is actually chosen is
// recorded on the resulting Blob's `type` and uploaded alongside the audio
// (see recordingUploadService.js) so the backend/transcription provider
// always knows exactly what it received.

const DEFAULT_MIME_TYPE_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

// How often MediaRecorder is asked to hand over a chunk of already-recorded
// audio, in ms. This is NOT a segmentation point recognized speech gets
// split on (there is no live recognition anymore) - it only bounds how much
// audio could be lost if the browser tab crashes mid-phase; every chunk is
// still concatenated into exactly ONE Blob for the whole phase when stop()
// is called (see onstop below).
const CHUNK_INTERVAL_MS = 1000;

function getNativeMediaRecorderCtor() {
    return typeof MediaRecorder === 'undefined' ? null : MediaRecorder;
}

function pickSupportedMimeType(candidates) {
    const Ctor = getNativeMediaRecorderCtor();
    if (!Ctor || typeof Ctor.isTypeSupported !== 'function') {
        // No feature-detection available (e.g. this environment has no
        // MediaRecorder at all) - let the browser pick its own default
        // rather than asserting an unsupported type.
        return '';
    }
    for (const candidate of candidates) {
        if (Ctor.isTypeSupported(candidate)) {
            return candidate;
        }
    }
    return '';
}

function defaultRecorderFactory(stream, options) {
    const Ctor = getNativeMediaRecorderCtor();
    if (!Ctor) {
        throw new Error('MediaRecorder is not supported in this browser.');
    }
    return options ? new Ctor(stream, options) : new Ctor(stream);
}

export class AudioRecorder {
    constructor({
        mimeTypeCandidates = DEFAULT_MIME_TYPE_CANDIDATES,
        mediaDevices = (typeof navigator !== 'undefined' ? navigator.mediaDevices : null),
        recorderFactory = defaultRecorderFactory,
        chunkIntervalMs = CHUNK_INTERVAL_MS,
        logger = () => {}
    } = {}) {
        this._mimeTypeCandidates = mimeTypeCandidates;
        this._mediaDevices = mediaDevices;
        this._recorderFactory = recorderFactory;
        this._chunkIntervalMs = chunkIntervalMs;
        this._logger = logger;

        this._stream = null;
        this._recorder = null;
        this._chunks = [];
        this._mimeType = null;
        this._recording = false;
        this._pendingStopResolve = null;

        this.onStart = null;
        this.onStop = null; // (blob, mimeType) - fired once, with the COMPLETE phase recording
        this.onError = null; // ({ type, message })
    }

    static isSupported() {
        return typeof navigator !== 'undefined' && !!navigator.mediaDevices && getNativeMediaRecorderCtor() !== null;
    }

    isSupported() {
        return this._mediaDevices != null && (this._recorderFactory !== defaultRecorderFactory || getNativeMediaRecorderCtor() !== null);
    }

    isRecording() {
        return this._recording;
    }

    getMimeType() {
        return this._mimeType;
    }

    // Requests microphone permission and begins recording. Resolves true if
    // recording actually started, false otherwise (permission denied,
    // unsupported browser, etc. - see onError for details).
    async start() {
        if (this._recording) {
            return true;
        }
        if (!this.isSupported()) {
            this._emitError({ type: 'unsupported', message: 'Audio recording is not supported in this browser.' });
            return false;
        }

        try {
            this._stream = await this._mediaDevices.getUserMedia({ audio: true });
        } catch (error) {
            const type = error && error.name === 'NotAllowedError' ? 'not-allowed' : 'start-failed';
            this._emitError({ type, message: error.message });
            return false;
        }

        this._mimeType = pickSupportedMimeType(this._mimeTypeCandidates) || null;
        this._chunks = [];

        try {
            this._recorder = this._recorderFactory(this._stream, this._mimeType ? { mimeType: this._mimeType } : undefined);
        } catch (error) {
            this._logger(`AudioRecorder: failed to construct MediaRecorder - ${error.message}`);
            this._emitError({ type: 'start-failed', message: error.message });
            this._releaseStream();
            return false;
        }

        this._recorder.ondataavailable = (event) => {
            if (event && event.data && event.data.size > 0) {
                this._chunks.push(event.data);
            }
        };
        this._recorder.onerror = (event) => {
            const message = event && event.error ? event.error.message : 'unknown';
            this._logger(`AudioRecorder error: ${message}`);
            this._emitError({ type: 'recording-error', message });
        };
        this._recorder.onstop = () => {
            this._recording = false;
            this._releaseStream();
            // Never actual audio content in this log line - only that a
            // recording of some size/type completed. Participant speech
            // itself is never logged anywhere in this pipeline.
            const blob = new Blob(this._chunks, { type: this._mimeType || 'audio/webm' });
            this._chunks = [];
            if (this.onStop) {
                this.onStop(blob, this._mimeType);
            }
            if (this._pendingStopResolve) {
                const resolve = this._pendingStopResolve;
                this._pendingStopResolve = null;
                resolve(blob);
            }
        };

        try {
            this._recorder.start(this._chunkIntervalMs);
        } catch (error) {
            this._logger(`AudioRecorder: MediaRecorder.start() failed - ${error.message}`);
            this._emitError({ type: 'start-failed', message: error.message });
            this._releaseStream();
            return false;
        }

        this._recording = true;
        if (this.onStart) {
            this.onStart();
        }
        return true;
    }

    // Stops recording and resolves with the complete audio Blob for the
    // whole phase (or null if nothing was ever recording). Never called
    // because the participant paused speaking - only when the cognitive
    // phase itself ends (see cognitiveAudioSession.js).
    stop() {
        if (!this._recording || !this._recorder) {
            return Promise.resolve(null);
        }
        return new Promise((resolve) => {
            this._pendingStopResolve = resolve;
            try {
                this._recorder.stop();
            } catch (error) {
                this._logger(`AudioRecorder.stop() failed: ${error.message}`);
                this._pendingStopResolve = null;
                this._recording = false;
                this._releaseStream();
                resolve(null);
            }
        });
    }

    _releaseStream() {
        if (this._stream) {
            for (const track of this._stream.getTracks()) {
                track.stop();
            }
            this._stream = null;
        }
    }

    _emitError(error) {
        if (this.onError) {
            this.onError(error);
        }
    }
}
