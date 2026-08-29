// The provider seam speechProcessingService.js depends on. Any provider
// implementation just needs to satisfy this one method's contract - see
// ufNaviGatorProvider.js (real) and stubProvider.js (tests/no-API-key local
// dev), selected by transcription/index.js.
//
// transcribe() must NEVER normalize/parse the returned text into numbers -
// that is numberParser.js's job, strictly downstream and never here. It
// must return the provider's raw text exactly as received.

/**
 * @typedef {Object} TranscriptionResult
 * @property {string} text - the raw transcript exactly as the provider returned it
 * @property {string} model - the model name/id actually used
 * @property {Object} raw - the provider's full raw response, for audit/debugging (never logged with participant content at info level)
 */

class TranscriptionProvider {
    // eslint-disable-next-line no-unused-vars
    async transcribe(audioBuffer, mimeType) {
        throw new Error('TranscriptionProvider.transcribe() must be implemented by a subclass.');
    }

    // A short, stable name recorded on the transcriptions.provider column -
    // e.g. "uf-navigator-whisper-large-v3" or "stub".
    get name() {
        throw new Error('TranscriptionProvider.name must be implemented by a subclass.');
    }
}

module.exports = { TranscriptionProvider };
