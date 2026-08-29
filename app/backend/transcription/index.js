// Selects the transcription provider: the real UF NaviGator Whisper
// endpoint when UF_NAVIGATOR_API_KEY is set in the server environment,
// otherwise a deterministic stub (loudly logged, so a missing key is never
// silently mistaken for a working real transcription in local
// development). This is the single place that decides which provider is
// "the" transcription system - speechProcessingService.js only ever depends
// on the TranscriptionProvider interface (transcriptionProvider.js).

const { UFNaviGatorProvider } = require('./ufNaviGatorProvider');
const { StubTranscriptionProvider } = require('./stubProvider');

function createDefaultTranscriptionProvider(logger = console.log) {
    const apiKey = process.env.UF_NAVIGATOR_API_KEY;
    if (apiKey) {
        return new UFNaviGatorProvider({ apiKey });
    }
    logger('[transcription] UF_NAVIGATOR_API_KEY is not set - using the STUB transcription provider. Set it in .env for real transcription (see .env.example).');
    return new StubTranscriptionProvider();
}

module.exports = { createDefaultTranscriptionProvider };
