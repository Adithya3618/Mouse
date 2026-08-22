import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExperimentController } from '../../app/frontend/js/experiment/experimentController.js';
import { experimentConfig } from '../../config/experimentConfig.js';

// Verifies experimentController.js's wiring of the microphone/speech
// system (see cognitive/cognitiveSpeechSession.js) - kept in its own file,
// separate from tests/experiment/experimentController.test.mjs, so the
// pre-existing mouse-task-focused test suite there stays untouched.
//
// A fully synchronous, test-controlled Timer stand-in - identical in
// spirit to the one in experimentController.test.mjs.
function createControllableTimerFactory() {
    let pendingOnComplete = null;
    return {
        factory: (callbacks) => ({
            start() {
                pendingOnComplete = callbacks.onComplete;
            },
            stop() {
                pendingOnComplete = null;
            }
        }),
        complete() {
            const onComplete = pendingOnComplete;
            pendingOnComplete = null;
            assert.ok(onComplete, 'complete() called with no phase timer pending');
            onComplete();
        }
    };
}

const fakeMouseTaskAdapter = { start() {}, stop() {} };

// A fake CognitiveSpeechSession + factory that records its own lifecycle
// (which phaseIds it was started/stopped for) without touching the real
// Web Speech API, mirroring the mouse task's spy-adapter test pattern.
function createSpyCognitiveSpeechSessionFactory() {
    const startedFor = [];
    const stoppedFor = [];
    const sessions = [];

    const factory = ({ subtractionValue, startingNumber }) => {
        const session = {
            subtractionValue,
            startingNumber,
            micActive: false,
            started: false,
            stopped: false,
            start() {
                this.started = true;
                this.micActive = true;
                startedFor.push({ subtractionValue, startingNumber });
            },
            stop() {
                this.stopped = true;
                this.micActive = false;
                stoppedFor.push({ subtractionValue, startingNumber });
            },
            isMicActive() {
                return this.micActive;
            },
            getResults() {
                return {
                    subtractionRule: subtractionValue,
                    startingNumber,
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
                    scoringMode: 'adaptive'
                };
            }
        };
        sessions.push(session);
        return session;
    };

    factory.startedFor = startedFor;
    factory.stoppedFor = stoppedFor;
    factory.sessions = sessions;
    return factory;
}

function createTestController(overrides = {}) {
    const timers = createControllableTimerFactory();
    const cognitiveSpeechSessionFactory = createSpyCognitiveSpeechSessionFactory();
    const controller = new ExperimentController({
        config: experimentConfig,
        timerFactory: timers.factory,
        mouseTaskAdapter: fakeMouseTaskAdapter,
        cognitiveSpeechSessionFactory,
        logger: () => {},
        ...overrides
    });
    return { controller, timers, cognitiveSpeechSessionFactory };
}

function runFullExperiment(controller, timers) {
    controller.start();
    while (controller.getCurrentPhaseId() !== 'COMPLETE') {
        const phase = controller.getCurrentPhase();
        if (phase.duration == null) {
            controller.advance();
        } else {
            timers.complete();
        }
    }
}

test('the microphone/speech session is started only for SUBTRACTION_<n> and DUAL_TASK_<n>, never any other phase', () => {
    const { controller, timers, cognitiveSpeechSessionFactory } = createTestController();
    runFullExperiment(controller, timers);

    const startedSubtractionValues = cognitiveSpeechSessionFactory.startedFor.map((s) => s.subtractionValue).sort((a, b) => a - b);
    assert.deepEqual(startedSubtractionValues, [3, 3, 7, 7, 17, 17], 'started exactly twice per condition (subtraction-only + dual-task)');
    assert.equal(cognitiveSpeechSessionFactory.startedFor.length, 6, 'exactly 6 cognitive-active phases in the whole protocol');
});

test('the microphone does not start during INSTRUCTIONS, preparation, motor baseline, recovery, or COMPLETE', () => {
    const { controller, timers, cognitiveSpeechSessionFactory } = createTestController();

    controller.start(); // INSTRUCTIONS
    assert.equal(cognitiveSpeechSessionFactory.sessions.length, 0);

    controller.advance(); // PREPARE_MOTOR_BASELINE
    assert.equal(controller.getCurrentPhaseId(), 'PREPARE_MOTOR_BASELINE');
    assert.equal(controller.getCurrentCognitiveSpeechSession(), null);

    timers.complete(); // MOTOR_BASELINE (mouse-only, no cognitive)
    assert.equal(controller.getCurrentPhaseId(), 'MOTOR_BASELINE');
    assert.equal(controller.getCurrentCognitiveSpeechSession(), null);

    timers.complete(); // RECOVERY_AFTER_MOTOR
    assert.equal(controller.getCurrentPhaseId(), 'RECOVERY_AFTER_MOTOR');
    assert.equal(controller.getCurrentCognitiveSpeechSession(), null, 'microphone must be inactive during recovery');

    timers.complete(); // PREPARE_SUBTRACTION_3
    assert.equal(controller.getCurrentPhaseId(), 'PREPARE_SUBTRACTION_3');
    assert.equal(controller.getCurrentCognitiveSpeechSession(), null, 'microphone must be inactive during preparation, even though the starting number is already known');

    assert.equal(cognitiveSpeechSessionFactory.sessions.length, 0, 'no speech session should have been created yet at all');
});

test('the microphone starts exactly when SUBTRACTION_3 begins, and stops exactly when it ends', () => {
    const { controller, timers, cognitiveSpeechSessionFactory } = createTestController();
    controller.start();
    controller.advance(); // PREPARE_MOTOR_BASELINE
    timers.complete(); // MOTOR_BASELINE
    timers.complete(); // RECOVERY_AFTER_MOTOR
    timers.complete(); // PREPARE_SUBTRACTION_3

    timers.complete(); // -> SUBTRACTION_3
    assert.equal(controller.getCurrentPhaseId(), 'SUBTRACTION_3');
    const session = controller.getCurrentCognitiveSpeechSession();
    assert.ok(session, 'a speech session must be running now that the real cognitive phase has begun');
    assert.equal(session.isMicActive(), true);
    assert.equal(session.subtractionValue, 3);

    timers.complete(); // -> PREPARE_DUAL_TASK_3
    assert.equal(session.stopped, true, 'the SUBTRACTION_3 session must be stopped the instant the phase ends');
    assert.equal(controller.getCurrentCognitiveSpeechSession(), null, 'microphone must be inactive again during the next preparation');
    assert.equal(cognitiveSpeechSessionFactory.stoppedFor.length, 1);
});

test('cognitive results are recorded onto the correct phase record in session data', () => {
    const { controller, timers } = createTestController();
    runFullExperiment(controller, timers);

    const session = controller.getSession();
    const subtraction3 = session.phases.find((p) => p.phaseId === 'SUBTRACTION_3');
    assert.ok(subtraction3.cognitivePerformance);
    assert.equal(subtraction3.cognitivePerformance.correctResponses, 3);
    assert.equal(subtraction3.cognitivePerformance.cognitiveAccuracy, 100);
    assert.equal(subtraction3.cognitivePerformance.rawTranscript, '944 941 938');

    // Non-cognitive phases must not have cognitive data.
    const motor = session.phases.find((p) => p.phaseId === 'MOTOR_BASELINE');
    assert.equal(motor.cognitivePerformance, null);
    const recovery = session.phases.find((p) => p.phaseId === 'RECOVERY_AFTER_MOTOR');
    assert.equal(recovery.cognitivePerformance, null);
});

test('dual-task: the mouse task and the speech session both run for DUAL_TASK_3, independently', () => {
    const mouseStartCalls = [];
    const spyMouseAdapter = {
        start(phaseDescriptor) { mouseStartCalls.push(phaseDescriptor.phaseId); },
        stop() {}
    };
    const { controller, timers, cognitiveSpeechSessionFactory } = createTestController({ mouseTaskAdapter: spyMouseAdapter });

    controller.start();
    controller.advance(); // PREPARE_MOTOR_BASELINE
    timers.complete(); // MOTOR_BASELINE
    timers.complete(); // RECOVERY_AFTER_MOTOR
    timers.complete(); // PREPARE_SUBTRACTION_3
    timers.complete(); // SUBTRACTION_3
    timers.complete(); // PREPARE_DUAL_TASK_3

    timers.complete(); // -> DUAL_TASK_3
    assert.equal(controller.getCurrentPhaseId(), 'DUAL_TASK_3');
    assert.ok(mouseStartCalls.includes('DUAL_TASK_3'), 'mouse task must have started for the dual-task phase');
    const session = controller.getCurrentCognitiveSpeechSession();
    assert.ok(session, 'speech session must also be running for the same dual-task phase');
    assert.equal(session.isMicActive(), true);
    assert.equal(session.subtractionValue, 3);

    // Reporting mouse performance must not touch or clear the concurrently
    // running speech session, and vice versa - each system is independent.
    controller.reportMousePerformance({ totalTargets: 10, totalClicks: 12, totalHits: 9 });
    assert.equal(controller.getCurrentCognitiveSpeechSession(), session, 'speech session is unaffected by mouse reporting');
    assert.equal(session.stopped, false);

    timers.complete(); // -> RECOVERY_AFTER_DUAL_3
    const finishedSession = cognitiveSpeechSessionFactory.sessions.find((s) => s.subtractionValue === 3 && s.startingNumber === session.startingNumber);
    assert.equal(finishedSession.stopped, true);

    const dualTaskRecord = controller.getSession().phases.find((p) => p.phaseId === 'DUAL_TASK_3');
    assert.ok(dualTaskRecord.mousePerformance, 'mouse results recorded');
    assert.ok(dualTaskRecord.cognitivePerformance, 'cognitive results also recorded, independently');
    assert.notDeepEqual(dualTaskRecord.mousePerformance, dualTaskRecord.cognitivePerformance);
});

test('the microphone remains inactive throughout recovery and preparation surrounding a dual-task condition', () => {
    const { controller, timers } = createTestController();
    controller.start();
    controller.advance(); // PREPARE_MOTOR_BASELINE
    timers.complete(); // MOTOR_BASELINE
    timers.complete(); // RECOVERY_AFTER_MOTOR
    timers.complete(); // PREPARE_SUBTRACTION_3
    timers.complete(); // SUBTRACTION_3
    timers.complete(); // PREPARE_DUAL_TASK_3
    assert.equal(controller.getCurrentPhaseId(), 'PREPARE_DUAL_TASK_3');
    assert.equal(controller.getCurrentCognitiveSpeechSession(), null, 'microphone inactive during preparation before dual-task');

    timers.complete(); // DUAL_TASK_3
    timers.complete(); // -> RECOVERY_AFTER_DUAL_3
    assert.equal(controller.getCurrentPhaseId(), 'RECOVERY_AFTER_DUAL_3');
    assert.equal(controller.getCurrentCognitiveSpeechSession(), null, 'microphone inactive during recovery after dual-task');
});
