import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidCognitivePerformance, validateSession } from '../../app/frontend/js/data/dataValidator.js';
import { createSession, startPhaseRecord, recordCognitivePerformance } from '../../app/frontend/js/data/sessionData.js';
import { buildPhaseSequence } from '../../app/frontend/js/experiment/phases.js';
import { experimentConfig } from '../../config/experimentConfig.js';

const VALID_PHASE_IDS = buildPhaseSequence(experimentConfig).map((p) => p.phaseId);

function validCognitivePerformance() {
    return {
        subtractionRule: 3,
        startingNumber: 947,
        rawTranscript: '944 941 938',
        parsedNumbers: [944, 941, 938],
        expectedNumbers: [944, 941, 938],
        responses: [],
        correctResponses: 3,
        incorrectResponses: 0,
        unresolvedResponses: 0,
        numberOfResponses: 3,
        cognitiveAccuracy: 100
    };
}

test('isValidCognitivePerformance accepts null (non-cognitive phases)', () => {
    assert.equal(isValidCognitivePerformance(null), true);
});

test('isValidCognitivePerformance accepts a well-formed result', () => {
    assert.equal(isValidCognitivePerformance(validCognitivePerformance()), true);
});

test('isValidCognitivePerformance rejects non-numeric accuracy/response counts', () => {
    assert.equal(isValidCognitivePerformance({ ...validCognitivePerformance(), cognitiveAccuracy: '100' }), false);
    assert.equal(isValidCognitivePerformance({ ...validCognitivePerformance(), correctResponses: NaN }), false);
});

test('isValidCognitivePerformance rejects a missing/non-string rawTranscript', () => {
    assert.equal(isValidCognitivePerformance({ ...validCognitivePerformance(), rawTranscript: null }), false);
});

test('isValidCognitivePerformance rejects non-array parsedNumbers/expectedNumbers/responses', () => {
    assert.equal(isValidCognitivePerformance({ ...validCognitivePerformance(), parsedNumbers: 944 }), false);
    assert.equal(isValidCognitivePerformance({ ...validCognitivePerformance(), responses: null }), false);
});

test('validateSession passes for a well-formed session with cognitive data', () => {
    const session = createSession({ participantId: 'P1' });
    const record = startPhaseRecord(session, {
        phaseId: 'SUBTRACTION_3',
        phaseType: 'cognitive',
        mouseActive: false,
        cognitiveActive: true,
        subtractionValue: 3,
        duration: 120
    }, { startingNumber: 947 });
    recordCognitivePerformance(record, validCognitivePerformance());

    const result = validateSession(session, VALID_PHASE_IDS, experimentConfig);
    assert.deepEqual(result, { valid: true, errors: [] });
});

test('validateSession flags a malformed cognitivePerformance', () => {
    const session = createSession();
    const record = startPhaseRecord(session, { phaseId: 'SUBTRACTION_3', phaseType: 'cognitive', mouseActive: false, cognitiveActive: true, subtractionValue: 3, duration: 120 });
    recordCognitivePerformance(record, { ...validCognitivePerformance(), cognitiveAccuracy: 'not-a-number' });

    const result = validateSession(session, VALID_PHASE_IDS, experimentConfig);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('cognitivePerformance')));
});
