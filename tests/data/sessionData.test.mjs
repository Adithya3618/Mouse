import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    createSession,
    startPhaseRecord,
    endPhaseRecord,
    recordMousePerformance,
    endSession
} from '../../app/frontend/js/data/sessionData.js';

test('createSession returns the expected shape and a unique sessionId', () => {
    const a = createSession({ participantId: 'P1' });
    const b = createSession();
    assert.equal(a.participantId, 'P1');
    assert.equal(b.participantId, null);
    assert.notEqual(a.sessionId, b.sessionId);
    assert.deepEqual(a.phases, []);
    assert.equal(a.endTime, null);
});

test('createSession stores participantCode and sessionDate from the intake screen', () => {
    const session = createSession({ participantCode: 'P014', sessionDate: '2026-08-10' });
    assert.equal(session.participantCode, 'P014');
    assert.equal(session.sessionDate, '2026-08-10');
});

test('createSession defaults participantCode and sessionDate to null when omitted', () => {
    const session = createSession();
    assert.equal(session.participantCode, null);
    assert.equal(session.sessionDate, null);
});

test('startPhaseRecord copies phase descriptor fields and adds runtime fields', () => {
    const session = createSession();
    const descriptor = {
        phaseId: 'SUBTRACTION_3',
        phaseType: 'cognitive',
        mouseActive: false,
        cognitiveActive: true,
        subtractionValue: 3,
        duration: 120
    };
    const record = startPhaseRecord(session, descriptor, { startingNumber: 947 });

    assert.equal(record.phaseId, 'SUBTRACTION_3');
    assert.equal(record.startingNumber, 947);
    assert.equal(record.mousePerformance, null);
    assert.equal(record.endedAt, null);
    assert.equal(session.phases.length, 1);
    assert.equal(session.phases[0], record);
});

test('startPhaseRecord defaults startingNumber to null when not provided', () => {
    const session = createSession();
    const record = startPhaseRecord(session, {
        phaseId: 'MOTOR_BASELINE',
        phaseType: 'motor',
        mouseActive: true,
        cognitiveActive: false,
        subtractionValue: null,
        duration: 120
    });
    assert.equal(record.startingNumber, null);
});

test('endPhaseRecord sets endedAt', () => {
    const session = createSession();
    const record = startPhaseRecord(session, { phaseId: 'X', phaseType: 'x', mouseActive: false, cognitiveActive: false, duration: 1 });
    assert.equal(record.endedAt, null);
    endPhaseRecord(record);
    assert.ok(record.endedAt);
});

test('recordMousePerformance reuses the existing mouse scoring formulas', () => {
    const session = createSession();
    const record = startPhaseRecord(session, { phaseId: 'MOTOR_BASELINE', phaseType: 'motor', mouseActive: true, cognitiveActive: false, duration: 120 });
    const stats = recordMousePerformance(record, { totalTargets: 10, totalClicks: 8, totalHits: 4 });

    assert.equal(stats.totalMisses, 4);
    assert.equal(stats.totalAccuracy, 50); // 4/8 * 100
    assert.equal(stats.targetEfficiency, 40); // 4/10 * 100
    assert.equal(record.mousePerformance, stats);
});

test('mouse performance for two different phases is stored independently', () => {
    const session = createSession();
    const dualTask3 = startPhaseRecord(session, { phaseId: 'DUAL_TASK_3', phaseType: 'dual-task', mouseActive: true, cognitiveActive: true, subtractionValue: 3, duration: 120 });
    const dualTask7 = startPhaseRecord(session, { phaseId: 'DUAL_TASK_7', phaseType: 'dual-task', mouseActive: true, cognitiveActive: true, subtractionValue: 7, duration: 120 });

    recordMousePerformance(dualTask3, { totalTargets: 10, totalClicks: 10, totalHits: 5 });
    recordMousePerformance(dualTask7, { totalTargets: 20, totalClicks: 20, totalHits: 19 });

    assert.notDeepEqual(dualTask3.mousePerformance, dualTask7.mousePerformance);
    assert.equal(dualTask3.mousePerformance.totalAccuracy, 50);
    assert.equal(dualTask7.mousePerformance.totalAccuracy, 95);
});

test('endSession sets endTime', () => {
    const session = createSession();
    assert.equal(session.endTime, null);
    endSession(session);
    assert.ok(session.endTime);
});
