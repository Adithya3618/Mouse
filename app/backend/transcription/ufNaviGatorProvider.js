// Real transcription provider: UF NaviGator's hosted Whisper Large v3
// endpoint. Confirmed against the current UF NaviGator documentation
// (https://docs.ai.it.ufl.edu/docs/navigator_models/models/oai-whisper-large-v3/)
// on 2026-08-25 - an OpenAI-Whisper-API-shaped multipart endpoint UF hosts
// itself, NOT a call to OpenAI's own service:
//
//   POST https://api.ai.it.ufl.edu/v1/audio/transcriptions
//   Authorization: Bearer <UF_NAVIGATOR_API_KEY>
//   Content-Type: multipart/form-data
//     file  - the audio file
//     model - "whisper-large-v3"
//   -> { text: "<raw transcript>" }
//
// Built on Node's built-in fetch/FormData/Blob - no extra HTTP dependency,
// and deliberately not the `openai` SDK package, to keep this obviously and
// only a call to UF's own self-hosted endpoint.
//
// The API key is read from the server environment only (see .env.example)
// and never appears in a request the browser can see, never in a log line,
// and this file never logs the audio bytes or the returned transcript text
// itself - only status/error metadata.

const { TranscriptionProvider } = require('./transcriptionProvider');

const DEFAULT_BASE_URL = 'https://api.ai.it.ufl.edu/v1';
const MODEL = 'whisper-large-v3';

class UFNaviGatorProvider extends TranscriptionProvider {
    constructor({ apiKey, baseUrl = process.env.UF_NAVIGATOR_BASE_URL || DEFAULT_BASE_URL, fetchImpl = fetch } = {}) {
        super();
        if (!apiKey) {
            throw new Error('UFNaviGatorProvider requires an apiKey (see UF_NAVIGATOR_API_KEY in .env).');
        }
        this._apiKey = apiKey;
        this._baseUrl = baseUrl;
        this._fetch = fetchImpl;
    }

    get name() {
        return 'uf-navigator-whisper-large-v3';
    }

    async transcribe(audioBuffer, mimeType) {
        const formData = new FormData();
        formData.append('model', MODEL);
        formData.append('file', new Blob([audioBuffer], { type: mimeType }), `recording.${extensionFor(mimeType)}`);
        // Standard field on the OpenAI-Whisper-API-shaped contract UF's
        // endpoint follows - requests segment-level timestamps alongside the
        // plain text, purely so responses can carry a best-effort
        // audio timestamp (see speechProcessingService.js). Not
        // documented explicitly on UF's own docs page (which only shows the
        // bare default call), so this is defensive: if UF's deployment
        // ignores it or omits `segments`, everything downstream already
        // tolerates that and simply leaves timestamps null.
        formData.append('response_format', 'verbose_json');

        const response = await this._fetch(`${this._baseUrl}/audio/transcriptions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${this._apiKey}` },
            body: formData
        });

        if (!response.ok) {
            // The provider's own error body may legitimately be logged
            // (it's a service error, not participant speech) - but never
            // the request body/audio.
            const errorBody = await safeReadText(response);
            throw new Error(`UF NaviGator transcription failed (${response.status}): ${errorBody || response.statusText}`);
        }

        const json = await response.json();
        if (typeof json.text !== 'string') {
            throw new Error('UF NaviGator transcription response did not include a text field.');
        }

        return { text: json.text, model: MODEL, raw: json };
    }
}

function extensionFor(mimeType) {
    if (!mimeType) {
        return 'webm';
    }
    if (mimeType.includes('mp4')) {
        return 'mp4';
    }
    if (mimeType.includes('ogg')) {
        return 'ogg';
    }
    return 'webm';
}

async function safeReadText(response) {
    try {
        return await response.text();
    } catch {
        return '';
    }
}

module.exports = { UFNaviGatorProvider };
