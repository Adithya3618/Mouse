// Deterministic fake transcription provider - used automatically whenever
// UF_NAVIGATOR_API_KEY is unset (see index.js), and directly by the test
// suite so parsing/scoring/storage/versioning can all be tested end-to-end
// with zero network access and zero cost. Never used when a real API key is
// configured.
//
// Returns a fixed transcript unless a per-call override is supplied (tests
// inject specific transcripts to exercise numberParser.js's documented
// cases - "8 49", "eight hundred and forty nine", filler words, etc. -
// through the full pipeline).

const { TranscriptionProvider } = require('./transcriptionProvider');

const DEFAULT_STUB_TEXT = 'uh eight hundred forty nine';

class StubTranscriptionProvider extends TranscriptionProvider {
    constructor({ text = DEFAULT_STUB_TEXT } = {}) {
        super();
        this._text = text;
    }

    get name() {
        return 'stub';
    }

    async transcribe() {
        return { text: this._text, model: 'stub-model', raw: { stub: true, text: this._text } };
    }
}

module.exports = { StubTranscriptionProvider, DEFAULT_STUB_TEXT };
