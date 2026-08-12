import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPercentage, formatSessionForExport } from '../../app/frontend/js/data/dataFormatter.js';
import { createSession, startPhaseRecord, recordMousePerformance } from '../../app/frontend/js/data/sessionData.js';

test('formatPercentage formats to 2 decimal places by default', () => {
    assert.equal(formatPercentage(87.5), '87.50%');
    assert.equal(formatPercentage(100), '100.00%');
    assert.equal(formatPercentage(33.333, 1), '33.3%');
});

test('formatSessionForExport carries participantCode and sessionDate through (needed for the Excel export)', () => {
    const session = createSession({ participantCode: 'P014', sessionDate: '2026-08-11' });
    const formatted = formatSessionForExport(session);
    assert.equal(formatted.participantCode, 'P014');
    assert.equal(formatted.sessionDate, '2026-08-11');
    assert.equal(formatted.sessionId, session.sessionId);
    assert.equal(formatted.experimentId, session.experimentId);
});

test('formatSessionForExport includes every phase, with mousePerformance only where it exists', () => {
    const session = createSession({ participantCode: 'P014', sessionDate: '2026-08-11' });
    const motorRecord = startPhaseRecord(session, {
        phaseId: 'MOTOR_BASELINE',
        phaseType: 'motor',
        mouseActive: true,
        cognitiveActive: false,
        subtractionValue: null,
        duration: 120
    });
    recordMousePerformance(motorRecord, { totalTargets: 40, totalClicks: 50, totalHits: 35 });

    startPhaseRecord(session, {
        phaseId: 'RECOVERY_AFTER_MOTOR',
        phaseType: 'recovery',
        mouseActive: false,
        cognitiveActive: false,
        duration: 90
    });

    const formatted = formatSessionForExport(session);
    assert.equal(formatted.phases.length, 2);

    const motorPhase = formatted.phases.find((p) => p.phaseId === 'MOTOR_BASELINE');
    assert.deepEqual(motorPhase.mousePerformance, {
        totalTargets: 40,
        totalClicks: 50,
        totalHits: 35,
        totalMisses: 15,
        totalAccuracy: 70,
        targetEfficiency: 87.5
    });

    const recoveryPhase = formatted.phases.find((p) => p.phaseId === 'RECOVERY_AFTER_MOTOR');
    assert.equal('mousePerformance' in recoveryPhase, false, 'non-mouse phases should not carry a mousePerformance key');
});

test('formatSessionForExport does not mutate the original session', () => {
    const session = createSession({ participantCode: 'P014', sessionDate: '2026-08-11' });
    const record = startPhaseRecord(session, {
        phaseId: 'DUAL_TASK_3',
        phaseType: 'dual-task',
        mouseActive: true,
        cognitiveActive: true,
        subtractionValue: 3,
        duration: 120
    });
    recordMousePerformance(record, { totalTargets: 20, totalClicks: 30, totalHits: 18 });

    const formatted = formatSessionForExport(session);
    formatted.phases[0].mousePerformance.totalHits = 999;

    assert.equal(session.phases[0].mousePerformance.totalHits, 18, 'mutating the formatted output must not affect the live session');
});
