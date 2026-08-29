import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../../app/backend/database/db.js';
import { RecordingRepository } from '../../app/backend/repositories/recordingRepository.js';
import { TranscriptionRepository } from '../../app/backend/repositories/transcriptionRepository.js';
import { ResponseRepository } from '../../app/backend/repositories/responseRepository.js';
import { PhaseRepository } from '../../app/backend/repositories/phaseRepository.js';
import { SessionRepository } from '../../app/backend/repositories/sessionRepository.js';
import { ParticipantRepository } from '../../app/backend/repositories/participantRepository.js';
import { StubTranscriptionProvider } from '../../app/backend/transcription/stubProvider.js';
import { SpeechProcessingService } from '../../app/backend/services/speechProcessingService.js';

// Fake audio storage - the service only calls read(), and this suite never
// touches the filesystem, matching this repo's dependency-injection style.
function makeFakeAudioStorage() {
    return { async read() { return Buffer.from('fake audio'); } };
}

function setupWorld({ transcriptText } = {}) {
    const db = createDatabase(':memory:');
    const participantRepository = new ParticipantRepository(db);
    const sessionRepository = new SessionRepository(db);
    const phaseRepository = new PhaseRepository(db);
    const recordingRepository = new RecordingRepository(db);
    const transcriptionRepository = new TranscriptionRepository(db);
    const responseRepository = new ResponseRepository(db);

    const participant = participantRepository.upsertByCode('P001');
    const session = sessionRepository.upsertById({ sessionId: 'session-1', participantId: participant.id, experimentId: 'motor-cognitive-dual-task' });
    const phase = phaseRepository.upsert({
        sessionId: session.id, phaseId: 'SUBTRACTION_3', phaseType: 'SUBTRACTION',
        subtractionValue: 3, startingNumber: 800, duration: 120, startedAt: new Date().toISOString(),
        scoringMode: 'adaptive', expectedResponseDigits: 3
    });
    const recording = recordingRepository.insert({ phaseId: phase.id, storagePath: 'session-1/phase.webm', mimeType: 'audio/webm', durationSeconds: 120, fileSizeBytes: 1000 });

    const service = new SpeechProcessingService({
        audioStorage: makeFakeAudioStorage(),
        transcriptionProvider: new StubTranscriptionProvider({ text: transcriptText }),
        recordingRepository, transcriptionRepository, responseRepository
    });

    return { service, recording, phase, transcriptionRepository, responseRepository };
}

test('processes a stub transcript end-to-end: raw transcript preserved, numbers parsed, adaptively scored, and persisted', async () => {
    const { service, recording, phase, transcriptionRepository, responseRepository } = setupWorld({
        transcriptText: '797 794 792 789 786'
    });

    const result = await service.process({
        recordingId: recording.id, phase, scoringOptions: { scoringMode: 'adaptive', expectedResponseDigits: 3 }
    });

    assert.equal(result.status, 'succeeded');
    // Raw transcript preserved EXACTLY, not collapsed into digits or altered.
    assert.equal(result.transcription.raw_text, '797 794 792 789 786');
    assert.equal(result.transcription.version, 1);

    // Adaptive-continuation scoring, per the spec's worked example: starting
    // 800, subtract 3 -> 797, 794, 791, 788, 785 expected; participant
    // actually says 797, 794, 792, 789, 786 - one wrong answer (792 instead
    // of 791) that becomes the new reference point rather than being
    // silently corrected.
    const responses = result.results.responses;
    assert.deepEqual(responses.map((r) => r.parsedNumber), [797, 794, 792, 789, 786]);
    assert.deepEqual(responses.map((r) => r.expectedNumber), [797, 794, 791, 789, 786]);
    assert.deepEqual(responses.map((r) => r.correctness), ['correct', 'correct', 'incorrect', 'correct', 'correct']);

    // Persisted rows exist and match.
    const storedTranscription = transcriptionRepository.getLatestForRecording(recording.id);
    assert.equal(storedTranscription.raw_text, '797 794 792 789 786');
    const run = responseRepository.getLatestProcessingRunForTranscription(storedTranscription.id);
    const storedResponses = responseRepository.listResponsesForRun(run.id);
    assert.equal(storedResponses.length, 5);
});

test('a wrong answer becomes the reference point for the next expected number, and is never silently corrected', async () => {
    const { service, recording, phase, responseRepository } = setupWorld({ transcriptText: '797 794 792 789 786' });
    const result = await service.process({ recordingId: recording.id, phase, scoringOptions: { scoringMode: 'adaptive', expectedResponseDigits: 3 } });

    const run = responseRepository.getLatestProcessingRunForTranscription(result.transcription.id);
    const rows = responseRepository.listResponsesForRun(run.id);

    // Response 3 (index 2): expected 791, actual 792, incorrect.
    assert.equal(rows[2].expected_number, 791);
    assert.equal(rows[2].actual_number, 792);
    assert.equal(rows[2].correctness, 'incorrect');
    // The actual (wrong) answer becomes the new reference point...
    assert.equal(rows[2].reference_number_after_response, 792);
    // ...so the NEXT expected number is 792 - 3 = 789, not 791 - 3 = 788.
    assert.equal(rows[2].next_expected_number, 789);
    assert.equal(rows[3].expected_number, 789);
});

test('deterministic number reconstruction cases flow through unmodified (numberParser.js is untouched)', async () => {
    const cases = [
        { text: '8 49', expected: [849] },
        { text: '8-49', expected: [849] },
        { text: 'eight forty nine', expected: [849] },
        { text: 'eight hundred forty nine', expected: [849] },
        { text: 'eight hundred and forty nine', expected: [849] },
        { text: 'uh eight ... forty nine', expected: [849] },
        { text: '86 5', expected: [865] },
        { text: '8 65', expected: [865] }
    ];

    for (const { text, expected } of cases) {
        const { service, recording, phase } = setupWorld({ transcriptText: text });
        const result = await service.process({ recordingId: recording.id, phase, scoringOptions: { scoringMode: 'adaptive', expectedResponseDigits: 3 } });
        assert.deepEqual(
            result.results.responses.filter((r) => r.parsedNumber != null).map((r) => r.parsedNumber),
            expected,
            `transcript "${text}" should parse to ${expected}`
        );
    }
});

test('unrelated speech never becomes a fabricated number - status is unresolved, raw transcript untouched', async () => {
    const { service, recording, phase } = setupWorld({ transcriptText: 'hey darling' });
    const result = await service.process({ recordingId: recording.id, phase, scoringOptions: { scoringMode: 'adaptive', expectedResponseDigits: 3 } });

    assert.equal(result.transcription.raw_text, 'hey darling');
    assert.equal(result.results.responses[0].parsedNumber, null);
    assert.equal(result.results.responses[0].correctness, 'unresolved');
});

test('a failed transcription is recorded as its own status and never fabricates a transcript or scores anything', async () => {
    const db = (await import('../../app/backend/database/db.js')).createDatabase(':memory:');
    const participantRepository = new ParticipantRepository(db);
    const sessionRepository = new SessionRepository(db);
    const phaseRepository = new PhaseRepository(db);
    const recordingRepository = new RecordingRepository(db);
    const transcriptionRepository = new TranscriptionRepository(db);
    const responseRepository = new ResponseRepository(db);

    const participant = participantRepository.upsertByCode('P002');
    const session = sessionRepository.upsertById({ sessionId: 'session-2', participantId: participant.id });
    const phase = phaseRepository.upsert({ sessionId: session.id, phaseId: 'SUBTRACTION_3', subtractionValue: 3, startingNumber: 800, scoringMode: 'adaptive', expectedResponseDigits: 3 });
    const recording = recordingRepository.insert({ phaseId: phase.id, storagePath: 'x', mimeType: 'audio/webm' });

    const failingProvider = { name: 'failing', async transcribe() { throw new Error('service unavailable'); } };
    const service = new SpeechProcessingService({
        audioStorage: makeFakeAudioStorage(), transcriptionProvider: failingProvider,
        recordingRepository, transcriptionRepository, responseRepository
    });

    const result = await service.process({ recordingId: recording.id, phase, scoringOptions: { scoringMode: 'adaptive', expectedResponseDigits: 3 } });

    assert.equal(result.status, 'failed');
    assert.equal(result.results, null);
    assert.equal(result.transcription.status, 'failed');
    assert.match(result.transcription.error_message, /service unavailable/);
});

test('reprocessing creates a new transcription version and new responses without touching the previous version', async () => {
    const { service, recording, phase, transcriptionRepository, responseRepository } = setupWorld({ transcriptText: '944 941 938' });

    const first = await service.process({ recordingId: recording.id, phase, scoringOptions: { scoringMode: 'adaptive', expectedResponseDigits: 3 } });
    assert.equal(first.transcription.version, 1);

    // Simulate an improved transcription on reprocess by giving the service
    // a differently-configured stub provider, then reprocessing the SAME recording.
    const improvedService = new SpeechProcessingService({
        audioStorage: makeFakeAudioStorage(),
        transcriptionProvider: { name: 'stub-v2', async transcribe() { return { text: '944 940 937', model: 'stub-v2' }; } },
        recordingRepository: service._recordingRepository,
        transcriptionRepository,
        responseRepository
    });
    const second = await improvedService.process({ recordingId: recording.id, phase, scoringOptions: { scoringMode: 'adaptive', expectedResponseDigits: 3 } });

    assert.equal(second.transcription.version, 2);
    assert.equal(second.transcription.raw_text, '944 940 937');

    // The original (version 1) row is untouched.
    const allVersions = transcriptionRepository.listForRecording(recording.id);
    assert.equal(allVersions.length, 2);
    assert.equal(allVersions[0].version, 1);
    assert.equal(allVersions[0].raw_text, '944 941 938');
    assert.equal(allVersions[1].version, 2);

    // Both processing runs' responses independently exist.
    const runsV1 = responseRepository.listProcessingRunsForTranscription(allVersions[0].id);
    const runsV2 = responseRepository.listProcessingRunsForTranscription(allVersions[1].id);
    assert.equal(runsV1.length, 1);
    assert.equal(runsV2.length, 1);
});
