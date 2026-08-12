import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    isValidPhaseId,
    isValidDuration,
    isValidSubtractionValue,
    isValidStartingNumber,
    isValidMouseStatistics,
    validateSession
} from '../../app/frontend/js/data/dataValidator.js';
import { createSession, startPhaseRecord, recordMousePerformance } from '../../app/frontend/js/data/sessionData.js';
import { buildPhaseSequence } from '../../app/frontend/js/experiment/phases.js';
import { experimentConfig } from '../../config/experimentConfig.js';

const VALID_PHASE_IDS = buildPhaseSequence(experimentConfig).map((p) => p.phaseId);

test('isValidPhaseId', () => {
    assert.equal(isValidPhaseId('SUBTRACTION_3', VALID_PHASE_IDS), true);
    assert.equal(isValidPhaseId('NOT_A_PHASE', VALID_PHASE_IDS), false);
    assert.equal(isValidPhaseId(123, VALID_PHASE_IDS), false);
});

test('isValidDuration', () => {
    assert.equal(isValidDuration(120), true);
    assert.equal(isValidDuration(null), true, 'null duration is valid for untimed phases');
    assert.equal(isValidDuration(0), false);
    assert.equal(isValidDuration(-5), false);
    assert.equal(isValidDuration('120'), false);
});

test('isValidSubtractionValue', () => {
    assert.equal(isValidSubtractionValue(3, experimentConfig), true);
    assert.equal(isValidSubtractionValue(null, experimentConfig), true);
    assert.equal(isValidSubtractionValue(4, experimentConfig), false);
});

test('isValidStartingNumber', () => {
    assert.equal(isValidStartingNumber(900, experimentConfig), true);
    assert.equal(isValidStartingNumber(null, experimentConfig), true);
    assert.equal(isValidStartingNumber(798, experimentConfig), false);
    assert.equal(isValidStartingNumber(1000, experimentConfig), false);
    assert.equal(isValidStartingNumber(900.5, experimentConfig), false);
});

test('isValidMouseStatistics', () => {
    assert.equal(isValidMouseStatistics(null), true);
    assert.equal(
        isValidMouseStatistics({ totalTargets: 1, totalClicks: 1, totalHits: 1, totalMisses: 0, totalAccuracy: 100, targetEfficiency: 100 }),
        true
    );
    assert.equal(isValidMouseStatistics({ totalTargets: '1', totalClicks: 1, totalHits: 1, totalMisses: 0, totalAccuracy: 100, targetEfficiency: 100 }), false);
    assert.equal(isValidMouseStatistics({ totalTargets: NaN, totalClicks: 1, totalHits: 1, totalMisses: 0, totalAccuracy: 100, targetEfficiency: 100 }), false);
});

test('validateSession passes for a well-formed session', () => {
    const session = createSession({ participantId: 'P1' });
    const record = startPhaseRecord(session, {
        phaseId: 'MOTOR_BASELINE',
        phaseType: 'motor',
        mouseActive: true,
        cognitiveActive: false,
        subtractionValue: null,
        duration: 120
    });
    recordMousePerformance(record, { totalTargets: 10, totalClicks: 8, totalHits: 4 });

    const result = validateSession(session, VALID_PHASE_IDS, experimentConfig);
    assert.deepEqual(result, { valid: true, errors: [] });
});

test('validateSession flags a missing sessionId', () => {
    const session = createSession();
    session.sessionId = '';
    startPhaseRecord(session, { phaseId: 'MOTOR_BASELINE', phaseType: 'motor', mouseActive: true, cognitiveActive: false, duration: 120 });
    const result = validateSession(session, VALID_PHASE_IDS, experimentConfig);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('sessionId')));
});

test('validateSession flags an invalid phaseId', () => {
    const session = createSession();
    startPhaseRecord(session, { phaseId: 'NOT_REAL', phaseType: 'motor', mouseActive: true, cognitiveActive: false, duration: 120 });
    const result = validateSession(session, VALID_PHASE_IDS, experimentConfig);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('invalid phaseId')));
});

test('validateSession flags an out-of-range starting number', () => {
    const session = createSession();
    startPhaseRecord(
        session,
        { phaseId: 'SUBTRACTION_3', phaseType: 'cognitive', mouseActive: false, cognitiveActive: true, subtractionValue: 3, duration: 120 },
        { startingNumber: 1500 }
    );
    const result = validateSession(session, VALID_PHASE_IDS, experimentConfig);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('startingNumber')));
});

test('validateSession flags a session with no phases', () => {
    const session = createSession();
    const result = validateSession(session, VALID_PHASE_IDS, experimentConfig);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('no recorded phases')));
});
