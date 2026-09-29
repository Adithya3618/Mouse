// Integration coverage (real repositories, no mocking of the DB layer -
// same pattern as speechProcessingService.test.mjs) for the silence/
// hallucination bug fix: the transcription service can hallucinate a
// REPEATED PREVIOUS NUMBER during genuine silence (e.g. "759, 759, 759,
// 759, 759..."), which must never become scored participant responses -
// see cognitive/speechSilenceFilter.js's own header for the full
// reasoning. These tests exercise the full pipeline (a fake
// verbose_json-shaped transcription provider -> speechProcessingService.js
// -> stored responses), not just the pure filter function (already covered
// in tests/cognitive/speechSilenceFilter.test.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../../app/backend/database/db.js';
import { RecordingRepository } from '../../app/backend/repositories/recordingRepository.js';
import { TranscriptionRepository } from '../../app/backend/repositories/transcriptionRepository.js';
import { ResponseRepository } from '../../app/backend/repositories/responseRepository.js';
import { PhaseRepository } from '../../app/backend/repositories/phaseRepository.js';
import { SessionRepository } from '../../app/backend/repositories/sessionRepository.js';
import { ParticipantRepository } from '../../app/backend/repositories/participantRepository.js';
import { SpeechProcessingService } from '../../app/backend/services/speechProcessingService.js';

function makeFakeAudioStorage() {
    return { async read() { return Buffer.from('fake audio'); } };
}

// A fake transcription provider that returns a real UF-NaviGator/Whisper-
// shaped verbose_json response (text + segments, each carrying
// no_speech_prob/avg_logprob/compression_ratio) - unlike StubTranscriptionProvider
// (used elsewhere), which never returns segments at all.
function makeVerboseJsonProvider({ text, segments, fail = false }) {
    return {
        name: 'fake-verbose-json',
        async transcribe() {
            if (fail) {
                throw new Error('transcription service unavailable');
            }
            return { text, model: 'whisper-large-v3', raw: { text, segments } };
        }
    };
}

async function setupWorld({ startingNumber = 825, subtractionValue = 3 } = {}) {
    const db = createDatabase(':memory:');
    const participantRepository = new ParticipantRepository(db);
    const sessionRepository = new SessionRepository(db);
    const phaseRepository = new PhaseRepository(db);
    const recordingRepository = new RecordingRepository(db);
    const transcriptionRepository = new TranscriptionRepository(db);
    const responseRepository = new ResponseRepository(db);

    const participant = await participantRepository.upsertByCode('P825');
    const session = await sessionRepository.upsertById({ sessionId: 'session-silence', participantId: participant.id });
    const phase = await phaseRepository.upsert({
        sessionId: session.id, phaseId: `SUBTRACTION_${subtractionValue}`, phaseType: 'SUBTRACTION',
        subtractionValue, startingNumber, duration: 90, startedAt: new Date().toISOString(),
        scoringMode: 'adaptive', expectedResponseDigits: 3
    });
    const recording = await recordingRepository.insert({ phaseId: phase.id, storagePath: 'x/y.webm', mimeType: 'audio/webm' });

    return { recording, phase, recordingRepository, transcriptionRepository, responseRepository };
}

function seg({ text, start = 0, end = 1, no_speech_prob = 0.02, avg_logprob = -0.15, compression_ratio = 1.0 }) {
    return { text, start, end, no_speech_prob, avg_logprob, compression_ratio };
}

test('test case 1+2: a genuine response followed by real silence produces exactly one response, not a fabricated repeat', async () => {
    const { recording, phase, recordingRepository, transcriptionRepository, responseRepository } = await setupWorld();

    // Participant says "822", then falls silent - Whisper hallucinates
    // "822" again as a low-confidence, highly repetitive segment over the
    // silent audio (the exact bug report pattern).
    const text = '822 822, 822, 822, 822, 822.';
    const segments = [
        seg({ text: ' 822', start: 0, end: 1 }),
        seg({ text: ' 822, 822, 822, 822, 822.', start: 1, end: 8, no_speech_prob: 0.4, avg_logprob: -1.5, compression_ratio: 3.0 })
    ];

    const service = new SpeechProcessingService({
        audioStorage: makeFakeAudioStorage(),
        transcriptionProvider: makeVerboseJsonProvider({ text, segments }),
        recordingRepository, transcriptionRepository, responseRepository
    });

    const result = await service.process({ recordingId: recording.id, phase, scoringOptions: { scoringMode: 'adaptive', expectedResponseDigits: 3 } });

    assert.equal(result.status, 'succeeded');
    // Research record: the raw transcript is preserved EXACTLY as returned,
    // hallucinated repeats and all - never altered.
    assert.equal(result.transcription.raw_text, text);

    // But only ONE genuine response was scored - the hallucinated repeats
    // never became response records.
    assert.equal(result.results.responses.length, 1);
    assert.equal(result.results.responses[0].parsedNumber, 822);
    assert.equal(result.results.correctResponses, 1);
});

test('test case 3: a spoken number followed by two silent stretches produces no repeated-response hallucinations, and the expected sequence does not advance during silence', async () => {
    const { recording, phase, recordingRepository, transcriptionRepository, responseRepository } = await setupWorld({ startingNumber: 825, subtractionValue: 3 });

    const text = '822 822, 822, 822. 822, 822.';
    const segments = [
        seg({ text: ' 822', start: 0, end: 1 }),
        seg({ text: ' 822, 822, 822.', start: 1, end: 6, no_speech_prob: 0.5, avg_logprob: -1.3, compression_ratio: 2.8 }),
        seg({ text: ' 822, 822.', start: 6, end: 10, no_speech_prob: 0.9, avg_logprob: -0.2, compression_ratio: 2.5 })
    ];

    const service = new SpeechProcessingService({
        audioStorage: makeFakeAudioStorage(),
        transcriptionProvider: makeVerboseJsonProvider({ text, segments }),
        recordingRepository, transcriptionRepository, responseRepository
    });

    const result = await service.process({ recordingId: recording.id, phase, scoringOptions: { scoringMode: 'adaptive', expectedResponseDigits: 3 } });

    assert.equal(result.results.responses.length, 1, 'only the genuine "822" is scored - neither silent stretch adds a response');
    // The next expected number continues from the real spoken 822 (822 - 3
    // = 819), never advanced further by the silence that followed it.
    assert.equal(result.results.responses[0].expectedNumber, 822);
});

test('test case 4: "822", silence, then "819" - responses are exactly [822, 819]', async () => {
    const { recording, phase, recordingRepository, transcriptionRepository, responseRepository } = await setupWorld({ startingNumber: 825, subtractionValue: 3 });

    const text = '822 819, 819, 819. 819';
    const segments = [
        seg({ text: ' 822', start: 0, end: 1 }),
        seg({ text: ' 819, 819, 819.', start: 1, end: 5, no_speech_prob: 0.55, avg_logprob: -1.4, compression_ratio: 2.9 }),
        seg({ text: ' 819', start: 5, end: 6 })
    ];

    const service = new SpeechProcessingService({
        audioStorage: makeFakeAudioStorage(),
        transcriptionProvider: makeVerboseJsonProvider({ text, segments }),
        recordingRepository, transcriptionRepository, responseRepository
    });

    const result = await service.process({ recordingId: recording.id, phase, scoringOptions: { scoringMode: 'adaptive', expectedResponseDigits: 3 } });

    assert.deepEqual(result.results.responses.map((r) => r.parsedNumber), [822, 819]);
    assert.deepEqual(result.results.responses.map((r) => r.correctness), ['correct', 'correct']);
});

test('test case 5: an empty transcription result produces zero responses, not a fabricated one', async () => {
    const { recording, phase, recordingRepository, transcriptionRepository, responseRepository } = await setupWorld();

    const service = new SpeechProcessingService({
        audioStorage: makeFakeAudioStorage(),
        transcriptionProvider: makeVerboseJsonProvider({ text: '', segments: [] }),
        recordingRepository, transcriptionRepository, responseRepository
    });

    const result = await service.process({ recordingId: recording.id, phase, scoringOptions: { scoringMode: 'adaptive', expectedResponseDigits: 3 } });

    assert.equal(result.status, 'succeeded');
    assert.equal(result.results.responses.length, 0);
});

test('test case 6: a failed transcription never reuses a previous recognized number - no response is fabricated, and nothing carries over to the next call', async () => {
    const { recording, phase, recordingRepository, transcriptionRepository, responseRepository } = await setupWorld();

    // First, a genuine successful transcription establishes a "previous
    // number" (825 - 3 = 822) in the database.
    const goodService = new SpeechProcessingService({
        audioStorage: makeFakeAudioStorage(),
        transcriptionProvider: makeVerboseJsonProvider({ text: '822', segments: [seg({ text: ' 822' })] }),
        recordingRepository, transcriptionRepository, responseRepository
    });
    const first = await goodService.process({ recordingId: recording.id, phase, scoringOptions: { scoringMode: 'adaptive', expectedResponseDigits: 3 } });
    assert.equal(first.results.responses[0].parsedNumber, 822);

    // A second recording (a different phase's audio) then fails to
    // transcribe entirely - this must produce a 'failed' result with ZERO
    // responses, never silently reusing the 822 from the previous call
    // (there is no shared/cached "last known number" state anywhere in
    // this service to begin with - this proves it).
    const secondRecording = await recordingRepository.insert({ phaseId: phase.id, storagePath: 'x/z.webm', mimeType: 'audio/webm' });
    const failingService = new SpeechProcessingService({
        audioStorage: makeFakeAudioStorage(),
        transcriptionProvider: makeVerboseJsonProvider({ fail: true }),
        recordingRepository, transcriptionRepository, responseRepository
    });
    const second = await failingService.process({ recordingId: secondRecording.id, phase, scoringOptions: { scoringMode: 'adaptive', expectedResponseDigits: 3 } });

    assert.equal(second.status, 'failed');
    assert.equal(second.responses.length, 0);
    assert.equal(second.results, null);
});

test('test case 7: the same number legitimately spoken twice (two separate confident utterances) is preserved as two responses', async () => {
    const { recording, phase, recordingRepository, transcriptionRepository, responseRepository } = await setupWorld({ startingNumber: 825, subtractionValue: 3 });

    // A participant who makes a mistake and restates 822, per the
    // pre-existing mistake-handling rule ("continue counting from the last
    // number you stated") - two genuine, separately-timed, confident
    // utterances of the same number.
    const text = '822 822';
    const segments = [
        seg({ text: ' 822', start: 0, end: 1 }),
        seg({ text: ' 822', start: 9, end: 10 })
    ];

    const service = new SpeechProcessingService({
        audioStorage: makeFakeAudioStorage(),
        transcriptionProvider: makeVerboseJsonProvider({ text, segments }),
        recordingRepository, transcriptionRepository, responseRepository
    });

    const result = await service.process({ recordingId: recording.id, phase, scoringOptions: { scoringMode: 'adaptive', expectedResponseDigits: 3 } });

    assert.deepEqual(result.results.responses.map((r) => r.parsedNumber), [822, 822]);
});

test('test case 8: a structurally duplicated segment (same time range reported twice) does not create a duplicate response', async () => {
    const { recording, phase, recordingRepository, transcriptionRepository, responseRepository } = await setupWorld({ startingNumber: 825, subtractionValue: 3 });

    const text = '822 822';
    const segments = [
        seg({ text: ' 822', start: 1.0, end: 1.5 }),
        seg({ text: ' 822', start: 1.0, end: 1.5 }) // exact duplicate record - not a second utterance
    ];

    const service = new SpeechProcessingService({
        audioStorage: makeFakeAudioStorage(),
        transcriptionProvider: makeVerboseJsonProvider({ text, segments }),
        recordingRepository, transcriptionRepository, responseRepository
    });

    const result = await service.process({ recordingId: recording.id, phase, scoringOptions: { scoringMode: 'adaptive', expectedResponseDigits: 3 } });

    assert.equal(result.results.responses.length, 1);
});

test('a stub-style provider (no segments at all) is completely unaffected by this fix - existing behavior preserved', async () => {
    const { recording, phase, recordingRepository, transcriptionRepository, responseRepository } = await setupWorld({ startingNumber: 825, subtractionValue: 3 });

    const service = new SpeechProcessingService({
        audioStorage: makeFakeAudioStorage(),
        transcriptionProvider: { name: 'stub', async transcribe() { return { text: '822 819 816', model: 'stub', raw: { stub: true } }; } },
        recordingRepository, transcriptionRepository, responseRepository
    });

    const result = await service.process({ recordingId: recording.id, phase, scoringOptions: { scoringMode: 'adaptive', expectedResponseDigits: 3 } });

    assert.deepEqual(result.results.responses.map((r) => r.parsedNumber), [822, 819, 816]);
});
