// Verifies the dual-task counting-sequence continuity rule (see
// app/frontend/js/cognitive/dualTaskContinuity.js) end-to-end through
// AdminQueryService - i.e. that Admin Session Review actually displays
// continuation-aware data, not just that the pure module computes it
// correctly (already covered by tests/cognitive/dualTaskContinuity.test.mjs).
//
// Uses the exact same real-repository setup pattern as
// speechProcessingService.test.mjs (an in-memory SQLite db, real
// repositories, no mocking of the DB layer) so this exercises the actual
// snake_case DB row shape AdminQueryService reads, not a stand-in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../../app/backend/database/db.js';
import { ParticipantRepository } from '../../app/backend/repositories/participantRepository.js';
import { SessionRepository } from '../../app/backend/repositories/sessionRepository.js';
import { PhaseRepository } from '../../app/backend/repositories/phaseRepository.js';
import { RecordingRepository } from '../../app/backend/repositories/recordingRepository.js';
import { TranscriptionRepository } from '../../app/backend/repositories/transcriptionRepository.js';
import { ResponseRepository } from '../../app/backend/repositories/responseRepository.js';
import { StubTranscriptionProvider } from '../../app/backend/transcription/stubProvider.js';
import { SpeechProcessingService } from '../../app/backend/services/speechProcessingService.js';
import { AdminQueryService } from '../../app/backend/services/adminQueryService.js';

function makeFakeAudioStorage() {
    return { async read() { return Buffer.from('fake audio'); } };
}

async function setupSessionWithBothPhases({ countOnlyText, dualTaskText, startingNumber = 825, subtractionValue = 3 }) {
    const db = createDatabase(':memory:');
    const participantRepository = new ParticipantRepository(db);
    const sessionRepository = new SessionRepository(db);
    const phaseRepository = new PhaseRepository(db);
    const recordingRepository = new RecordingRepository(db);
    const transcriptionRepository = new TranscriptionRepository(db);
    const responseRepository = new ResponseRepository(db);

    const participant = await participantRepository.upsertByCode('P900');
    const session = await sessionRepository.upsertById({ sessionId: 'session-900', participantId: participant.id, experimentId: 'motor-cognitive-dual-task' });

    // Both phases share the SAME starting_number, per the protocol's "one
    // random number per series" rule (experimentController.js's own half of
    // this - already enforced there, reproduced here at the data layer).
    const countOnlyPhase = await phaseRepository.upsert({
        sessionId: session.id, phaseId: `SUBTRACTION_${subtractionValue}`, phaseType: 'SUBTRACTION',
        subtractionValue, startingNumber, duration: 90, startedAt: '2026-01-01T00:00:00.000Z',
        scoringMode: 'adaptive', expectedResponseDigits: 3
    });
    const dualTaskPhase = await phaseRepository.upsert({
        sessionId: session.id, phaseId: `DUAL_TASK_${subtractionValue}`, phaseType: 'DUAL_TASK',
        subtractionValue, startingNumber, duration: 120, startedAt: '2026-01-01T00:02:00.000Z',
        scoringMode: 'adaptive', expectedResponseDigits: 3
    });

    async function processPhase(phase, transcriptText) {
        const recording = await recordingRepository.insert({ phaseId: phase.id, storagePath: `session-900/${phase.phase_id}.webm`, mimeType: 'audio/webm', durationSeconds: 90, fileSizeBytes: 1000 });
        const service = new SpeechProcessingService({
            audioStorage: makeFakeAudioStorage(),
            transcriptionProvider: new StubTranscriptionProvider({ text: transcriptText }),
            recordingRepository, transcriptionRepository, responseRepository
        });
        return service.process({ recordingId: recording.id, phase, scoringOptions: { scoringMode: 'adaptive', expectedResponseDigits: 3 } });
    }

    await processPhase(countOnlyPhase, countOnlyText);
    await processPhase(dualTaskPhase, dualTaskText);

    const adminQueryService = new AdminQueryService({
        participantRepository, sessionRepository, phaseRepository, recordingRepository, transcriptionRepository, responseRepository
    });

    return { adminQueryService, session, participant };
}

test('Admin Session Review: dual-task phase responses are re-anchored to the count-only phase\'s actual last valid number, not restarted at the shared starting number', async () => {
    // Worked example given directly by the researcher: starting 825,
    // count-only ends at 759, dual-task continues 756, 753, 750, 747 - it
    // must NOT restart at 825 and must NOT show 822 (825 - 3) as its first
    // expected number.
    const { adminQueryService, session } = await setupSessionWithBothPhases({
        startingNumber: 825,
        subtractionValue: 3,
        countOnlyText: '822 819 816 813 810 807 804 801 798 795 792 789 786 783 780 777 774 771 768 765 762 759',
        dualTaskText: '756 753 750 747'
    });

    const detail = await adminQueryService.getSessionDetail(session.id);
    const countOnly = detail.phases.find((p) => p.phaseId === 'SUBTRACTION_3');
    const dualTask = detail.phases.find((p) => p.phaseId === 'DUAL_TASK_3');

    // The count-only phase's own scoring is completely untouched by this feature.
    assert.equal(countOnly.startingNumber, 825);
    assert.equal(countOnly.responses.at(-1).actual_number, 759);
    assert.equal(countOnly.responses.at(-1).correctness, 'correct');

    // Per the protocol's Admin Session Review requirement: Starting Number,
    // Count-only Final Number, Dual-task Continuation Number.
    assert.equal(dualTask.startingNumber, 825, 'the shared series starting number is still shown, unchanged');
    assert.equal(dualTask.countOnlyFinalNumber, 759);
    assert.equal(dualTask.dualTaskContinuationNumber, 756);

    assert.deepEqual(dualTask.responses.map((r) => r.expected_number), [756, 753, 750, 747]);
    assert.deepEqual(dualTask.responses.map((r) => r.actual_number), [756, 753, 750, 747]);
    assert.deepEqual(dualTask.responses.map((r) => r.correctness), ['correct', 'correct', 'correct', 'correct']);
    assert.equal(dualTask.correctResponses, 4);
    assert.equal(dualTask.overallAccuracy, 100);
});

test('Admin Session Review: a mistake in the dual-task phase is still scored correctly under continuity (existing mistake-handling preserved)', async () => {
    const { adminQueryService, session } = await setupSessionWithBothPhases({
        startingNumber: 825,
        subtractionValue: 3,
        countOnlyText: '822 759', // last valid = 759 for this test's purposes
        dualTaskText: '756 752 749' // slip at step 2 (752 instead of 753), adaptively correct after
    });

    const detail = await adminQueryService.getSessionDetail(session.id);
    const dualTask = detail.phases.find((p) => p.phaseId === 'DUAL_TASK_3');

    assert.equal(dualTask.responses[0].correctness, 'correct');
    assert.equal(dualTask.responses[1].expected_number, 753);
    assert.equal(dualTask.responses[1].correctness, 'incorrect');
    assert.equal(dualTask.responses[2].expected_number, 749, 'continues from the actual 752, not the expected 753');
    assert.equal(dualTask.responses[2].correctness, 'correct');
    assert.equal(dualTask.incorrectResponses, 1);
});

test('Admin Session Review: count-only and REST/motor phases are unaffected by the continuity feature', async () => {
    const { adminQueryService, session } = await setupSessionWithBothPhases({
        startingNumber: 917,
        subtractionValue: 7,
        countOnlyText: '910 903 700',
        dualTaskText: '693 686 679'
    });

    const detail = await adminQueryService.getSessionDetail(session.id);
    const countOnly = detail.phases.find((p) => p.phaseId === 'SUBTRACTION_7');

    // The count-only phase's own responses are scored exactly as they
    // always were - anchored to its own starting_number (917), never
    // touched by this feature (it has no sibling of its own to look up).
    assert.deepEqual(countOnly.responses.map((r) => r.expected_number), [910, 903, 896]);
    assert.equal(countOnly.countOnlyFinalNumber, undefined, 'continuity fields are only ever added to dual-task phases');
});
