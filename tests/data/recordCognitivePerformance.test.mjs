import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    createSession,
    startPhaseRecord,
    recordCognitivePerformance,
    recordCognitiveProcessingPending,
    recordCognitiveProcessingFailed
} from '../../app/frontend/js/data/sessionData.js';

function fakeCognitiveResults(overrides = {}) {
    return {
        subtractionRule: 3,
        startingNumber: 947,
        phaseStartTime: '2026-08-22T00:00:00.000Z',
        phaseEndTime: '2026-08-22T00:02:00.000Z',
        rawTranscript: '944 941 938',
        parsedNumbers: [944, 941, 938],
        expectedNumbers: [944, 941, 938],
        responses: [],
        correctResponses: 3,
        incorrectResponses: 0,
        unresolvedResponses: 0,
        numberOfResponses: 3,
        cognitiveAccuracy: 100,
        scoringMode: 'adaptive',
        ...overrides
    };
}

test('a freshly started phase record has cognitivePerformance: null, mirroring mousePerformance', () => {
    const session = createSession();
    const record = startPhaseRecord(session, {
        phaseId: 'SUBTRACTION_3',
        phaseType: 'cognitive',
        mouseActive: false,
        cognitiveActive: true,
        subtractionValue: 3,
        duration: 120
    }, { startingNumber: 947 });

    assert.equal(record.cognitivePerformance, null);
    assert.equal(record.cognitiveProcessing, null);
});

test('recordCognitiveProcessingPending marks the phase as pending without touching cognitivePerformance', () => {
    const session = createSession();
    const record = startPhaseRecord(session, { phaseId: 'SUBTRACTION_3', phaseType: 'cognitive', mouseActive: false, cognitiveActive: true, subtractionValue: 3, duration: 120 });

    recordCognitiveProcessingPending(record);

    assert.equal(record.cognitiveProcessing.status, 'pending');
    assert.equal(record.cognitivePerformance, null);
});

test('recordCognitivePerformance marks processing as ready alongside the results', () => {
    const session = createSession();
    const record = startPhaseRecord(session, { phaseId: 'SUBTRACTION_3', phaseType: 'cognitive', mouseActive: false, cognitiveActive: true, subtractionValue: 3, duration: 120 });

    recordCognitiveProcessingPending(record);
    recordCognitivePerformance(record, fakeCognitiveResults());

    assert.equal(record.cognitiveProcessing.status, 'ready');
    assert.equal(record.cognitivePerformance.correctResponses, 3);
});

test('recordCognitiveProcessingFailed records the failure without fabricating cognitivePerformance', () => {
    const session = createSession();
    const record = startPhaseRecord(session, { phaseId: 'SUBTRACTION_3', phaseType: 'cognitive', mouseActive: false, cognitiveActive: true, subtractionValue: 3, duration: 120 });

    recordCognitiveProcessingPending(record);
    recordCognitiveProcessingFailed(record, 'network error');

    assert.equal(record.cognitiveProcessing.status, 'failed');
    assert.equal(record.cognitiveProcessing.error, 'network error');
    assert.equal(record.cognitivePerformance, null);
});

test('recordCognitivePerformance stores the results object on the phase record', () => {
    const session = createSession();
    const record = startPhaseRecord(session, { phaseId: 'SUBTRACTION_3', phaseType: 'cognitive', mouseActive: false, cognitiveActive: true, subtractionValue: 3, duration: 120 });

    const stored = recordCognitivePerformance(record, fakeCognitiveResults());

    assert.equal(record.cognitivePerformance, stored);
    assert.equal(record.cognitivePerformance.correctResponses, 3);
    assert.equal(record.cognitivePerformance.cognitiveAccuracy, 100);
});

test('cognitive and mouse performance are stored independently on the same dual-task phase record', () => {
    const session = createSession();
    const record = startPhaseRecord(session, { phaseId: 'DUAL_TASK_3', phaseType: 'dual-task', mouseActive: true, cognitiveActive: true, subtractionValue: 3, duration: 120 });

    recordCognitivePerformance(record, fakeCognitiveResults({ correctResponses: 14, cognitiveAccuracy: 77.8 }));
    record.mousePerformance = { totalTargets: 18, totalClicks: 22, totalHits: 18, totalMisses: 4, totalAccuracy: 81.8, targetEfficiency: 100 };

    assert.notDeepEqual(record.cognitivePerformance, record.mousePerformance);
    assert.equal(record.cognitivePerformance.cognitiveAccuracy, 77.8);
    assert.equal(record.mousePerformance.totalAccuracy, 81.8);
});

test('cognitive performance for two different conditions is stored independently, not combined', () => {
    const session = createSession();
    const subtraction3 = startPhaseRecord(session, { phaseId: 'SUBTRACTION_3', phaseType: 'cognitive', mouseActive: false, cognitiveActive: true, subtractionValue: 3, duration: 120 });
    const subtraction7 = startPhaseRecord(session, { phaseId: 'SUBTRACTION_7', phaseType: 'cognitive', mouseActive: false, cognitiveActive: true, subtractionValue: 7, duration: 120 });

    recordCognitivePerformance(subtraction3, fakeCognitiveResults({ subtractionRule: 3, cognitiveAccuracy: 85 }));
    recordCognitivePerformance(subtraction7, fakeCognitiveResults({ subtractionRule: 7, cognitiveAccuracy: 60 }));

    assert.notDeepEqual(subtraction3.cognitivePerformance, subtraction7.cognitivePerformance);
});
