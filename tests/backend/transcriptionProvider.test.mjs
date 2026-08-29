import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StubTranscriptionProvider, DEFAULT_STUB_TEXT } from '../../app/backend/transcription/stubProvider.js';
import { UFNaviGatorProvider } from '../../app/backend/transcription/ufNaviGatorProvider.js';
import { createDefaultTranscriptionProvider } from '../../app/backend/transcription/index.js';

test('StubTranscriptionProvider returns its configured text verbatim, never modified', async () => {
    const provider = new StubTranscriptionProvider({ text: 'uh eight ... forty nine' });
    const result = await provider.transcribe(Buffer.from('irrelevant'), 'audio/webm');
    assert.equal(result.text, 'uh eight ... forty nine');
    assert.equal(provider.name, 'stub');
});

test('StubTranscriptionProvider defaults to a fixed transcript when none is given', async () => {
    const provider = new StubTranscriptionProvider();
    const result = await provider.transcribe(Buffer.from('x'), 'audio/webm');
    assert.equal(result.text, DEFAULT_STUB_TEXT);
});

test('createDefaultTranscriptionProvider falls back to the stub when UF_NAVIGATOR_API_KEY is unset', () => {
    const previous = process.env.UF_NAVIGATOR_API_KEY;
    delete process.env.UF_NAVIGATOR_API_KEY;
    try {
        const provider = createDefaultTranscriptionProvider(() => {});
        assert.equal(provider.name, 'stub');
    } finally {
        if (previous !== undefined) {
            process.env.UF_NAVIGATOR_API_KEY = previous;
        }
    }
});

test('createDefaultTranscriptionProvider selects the real UF NaviGator provider when a key is set', () => {
    const previous = process.env.UF_NAVIGATOR_API_KEY;
    process.env.UF_NAVIGATOR_API_KEY = 'test-key';
    try {
        const provider = createDefaultTranscriptionProvider(() => {});
        assert.equal(provider.name, 'uf-navigator-whisper-large-v3');
    } finally {
        if (previous === undefined) {
            delete process.env.UF_NAVIGATOR_API_KEY;
        } else {
            process.env.UF_NAVIGATOR_API_KEY = previous;
        }
    }
});

test('UFNaviGatorProvider posts multipart form data to the documented endpoint with a Bearer token, and preserves the raw returned text exactly', async () => {
    let capturedUrl = null;
    let capturedOptions = null;
    const fakeFetch = async (url, options) => {
        capturedUrl = url;
        capturedOptions = options;
        return {
            ok: true,
            json: async () => ({ text: 'uh eight ... forty nine', segments: [] })
        };
    };

    const provider = new UFNaviGatorProvider({ apiKey: 'secret-key', fetchImpl: fakeFetch });
    const result = await provider.transcribe(Buffer.from('fake audio bytes'), 'audio/webm');

    assert.equal(capturedUrl, 'https://api.ai.it.ufl.edu/v1/audio/transcriptions');
    assert.equal(capturedOptions.method, 'POST');
    assert.equal(capturedOptions.headers.Authorization, 'Bearer secret-key');
    assert.ok(capturedOptions.body instanceof FormData);
    assert.equal(capturedOptions.body.get('model'), 'whisper-large-v3');
    // Never normalized/parsed into digits here - that's numberParser.js's job downstream.
    assert.equal(result.text, 'uh eight ... forty nine');
});

test('UFNaviGatorProvider throws (never silently swallows) a non-OK response', async () => {
    const fakeFetch = async () => ({ ok: false, status: 401, statusText: 'Unauthorized', text: async () => 'invalid api key' });
    const provider = new UFNaviGatorProvider({ apiKey: 'bad-key', fetchImpl: fakeFetch });

    await assert.rejects(
        () => provider.transcribe(Buffer.from('x'), 'audio/webm'),
        /401/
    );
});

test('UFNaviGatorProvider requires an apiKey', () => {
    assert.throws(() => new UFNaviGatorProvider({ apiKey: '' }));
});
