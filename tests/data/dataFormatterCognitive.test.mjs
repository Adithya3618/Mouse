import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSessionForExport } from '../../app/frontend/js/data/dataFormatter.js';
import { createSession, startPhaseRecord, recordCognitivePerformance } from '../../app/frontend/js/data/sessionData.js';

function fakeCognitiveResults() {
    return {
        subtractionRule: 3,
        startingNumber: 947,
        phaseStartTime: '2026-08-22T00:00:00.000Z',
        phaseEndTime: '2026-08-22T00:02:00.000Z',
        rawTranscript: '944 941 938',
        parsedNumbers: [944, 941, 938],
        expectedNumbers: [944, 941, 938],
        responses: [{ timestamp: 1, rawTranscript: '944', parsedNumber: 944, expectedNumber: 944, correctness: 'correct' }],
        correctResponses: 3,
        incorrectResponses: 0,
        unresolvedResponses: 0,
        numberOfResponses: 3,
        cognitiveAccuracy: 100,
        scoringMode: 'adaptive'
    };
}

test('formatSessionForExport includes cognitivePerformance only for phases that have it', () => {
    const session = createSession({ participantCode: 'P014', sessionDate: '2026-08-11' });
    const cognitiveRecord = startPhaseRecord(session, {
        phaseId: 'SUBTRACTION_3',
        phaseType: 'cognitive',
        mouseActive: false,
        cognitiveActive: true,
        subtractionValue: 3,
        duration: 120
    }, { startingNumber: 947 });
    recordCognitivePerformance(cognitiveRecord, fakeCognitiveResults());

    startPhaseRecord(session, {
        phaseId: 'RECOVERY_AFTER_MOTOR',
        phaseType: 'recovery',
        mouseActive: false,
        cognitiveActive: false,
        duration: 90
    });

    const formatted = formatSessionForExport(session);

    const subtractionPhase = formatted.phases.find((p) => p.phaseId === 'SUBTRACTION_3');
    assert.equal(subtractionPhase.cognitivePerformance.correctResponses, 3);
    assert.equal(subtractionPhase.cognitivePerformance.rawTranscript, '944 941 938');

    const recoveryPhase = formatted.phases.find((p) => p.phaseId === 'RECOVERY_AFTER_MOTOR');
    assert.equal('cognitivePerformance' in recoveryPhase, false, 'non-cognitive phases should not carry a cognitivePerformance key');
});

test('formatSessionForExport does not mutate the original session\'s cognitive data', () => {
    const session = createSession({ participantCode: 'P014', sessionDate: '2026-08-11' });
    const record = startPhaseRecord(session, { phaseId: 'SUBTRACTION_3', phaseType: 'cognitive', mouseActive: false, cognitiveActive: true, subtractionValue: 3, duration: 120 });
    recordCognitivePerformance(record, fakeCognitiveResults());

    const formatted = formatSessionForExport(session);
    formatted.phases[0].cognitivePerformance.correctResponses = 999;
    formatted.phases[0].cognitivePerformance.responses[0].correctness = 'incorrect';

    assert.equal(session.phases[0].cognitivePerformance.correctResponses, 3);
    assert.equal(session.phases[0].cognitivePerformance.responses[0].correctness, 'correct');
});
