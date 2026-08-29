// Ties an AudioRecorder (raw microphone capture) and
// data/recordingUploadService.js (upload + backend transcription/parsing/
// scoring) together for ONE cognitive-active phase (SUBTRACTION_<n> or
// DUAL_TASK_<n>). This is the object experiment/experimentController.js
// creates, starts and stops - replacing cognitiveSpeechSession.js (deleted)
// now that live, participant-facing transcription no longer exists.
//
// This class has NO concept of transcripts or numbers at all - it only
// tracks recording/upload state (mic active, last error) for the
// participant-facing recording indicator (see ui/recordingPanel.js). The
// actual transcription -> parsing -> scoring pipeline runs entirely on the
// backend (see app/backend/services/speechProcessingService.js), using the
// SAME cognitive/numberParser.js and cognitive/speechScoring.js this
// codebase already had - only where they run has changed.
//
// Deliberately independent of the mouse task, exactly like its predecessor:
// nothing here reads from or writes to mouse/*.js.

import { AudioRecorder } from './audioRecorder.js';
import { uploadRecording } from '../data/recordingUploadService.js';
import { DEFAULT_SCORING_MODE } from './speechScoring.js';

const DEFAULT_EXPECTED_RESPONSE_DIGITS = 3;

export class CognitiveAudioSession {
    constructor({
        subtractionValue,
        startingNumber,
        scoringMode = DEFAULT_SCORING_MODE,
        expectedResponseDigits = DEFAULT_EXPECTED_RESPONSE_DIGITS,
        participantCode = null,
        sessionId = null,
        experimentId = null,
        sessionDate = null,
        phaseId = null,
        phaseType = null,
        duration = null,
        recorderFactory = (options) => new AudioRecorder(options),
        uploadFn = uploadRecording,
        logger = () => {}
    } = {}) {
        this.subtractionValue = subtractionValue;
        this.startingNumber = startingNumber;
        this.scoringMode = scoringMode;
        this.expectedResponseDigits = expectedResponseDigits;
        this.phaseStartTime = null;
        this.phaseEndTime = null;

        this._participantCode = participantCode;
        this._sessionId = sessionId;
        this._experimentId = experimentId;
        this._sessionDate = sessionDate;
        this._phaseId = phaseId;
        this._phaseType = phaseType;
        this._duration = duration;

        this._logger = logger;
        this._uploadFn = uploadFn;
        this._recorder = recorderFactory({ logger });

        this._micActive = false;
        this._lastError = null;
        this._listeners = new Set();

        this._recorder.onStart = () => {
            this._micActive = true;
            this._notify();
        };
        this._recorder.onError = (error) => {
            this._lastError = error;
            this._logger(`CognitiveAudioSession: recording error - ${error.type}`);
            this._notify();
        };
    }

    start() {
        this.phaseStartTime = new Date().toISOString();
        this._recorder.start();
        this._notify();
    }

    isMicActive() {
        return this._micActive;
    }

    isSupported() {
        return this._recorder.isSupported();
    }

    getLastError() {
        return this._lastError;
    }

    // Subscribes to any change in this session's live recording state (mic
    // active/inactive, error) - see cognitiveSpeechSession.js's identical
    // onUpdate pattern (kept for continuity with
    // experiment/experimentController.js's onPhaseChange/onPhaseTick style).
    // NEVER carries transcript/number state - there is none here.
    onUpdate(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    _notify() {
        for (const listener of this._listeners) {
            listener(this);
        }
    }

    // Stops recording, finalizes the phase's complete audio Blob, and
    // starts the upload -> transcription -> parsing -> scoring pipeline in
    // the background. Returns a promise that resolves once that pipeline
    // finishes.
    //
    // CRITICAL: the caller (experiment/experimentController.js) does NOT
    // await this before advancing to the next phase - only
    // ui/resultsScreen.js waits on the promises this returns, right before
    // the participant can export results. This is what keeps the
    // experiment's phase timing completely unaffected by how long
    // transcription takes (see docs/data-flow.md).
    async stop() {
        this.phaseEndTime = new Date().toISOString();
        const blob = await this._recorder.stop();
        this._micActive = false;
        this._notify();

        if (!blob || blob.size === 0) {
            this._logger('CognitiveAudioSession: no audio was recorded for this phase - nothing to upload.');
            return { status: 'failed', error: 'No audio was recorded for this phase.' };
        }

        try {
            return await this._uploadFn({
                blob,
                mimeType: this._recorder.getMimeType(),
                participantCode: this._participantCode,
                sessionId: this._sessionId,
                experimentId: this._experimentId,
                sessionDate: this._sessionDate,
                phaseId: this._phaseId,
                phaseType: this._phaseType,
                subtractionValue: this.subtractionValue,
                startingNumber: this.startingNumber,
                duration: this._duration,
                startedAt: this.phaseStartTime,
                endedAt: this.phaseEndTime,
                expectedResponseDigits: this.expectedResponseDigits,
                scoringMode: this.scoringMode
            });
        } catch (error) {
            this._logger(`CognitiveAudioSession: upload/processing failed - ${error.message}`);
            this._lastError = { type: 'upload-failed', message: error.message };
            this._notify();
            return { status: 'failed', error: error.message };
        }
    }
}
