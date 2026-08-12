import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExperimentController } from '../../app/frontend/js/experiment/experimentController.js';
import { Timer } from '../../app/frontend/js/timer/timer.js';
import { experimentConfig } from '../../config/experimentConfig.js';

// Every one of the 7 active tasks (motor baseline, 3x subtraction-only,
// 3x dual-task) is preceded by its own PREPARE_<task> countdown phase.
// Recovery still occurs in exactly 3 places: after motor baseline, and
// after the dual-task blocks for conditions 3 and 7.
const EXPECTED_ORDER = [
    'INSTRUCTIONS',
    'PREPARE_MOTOR_BASELINE',
    'MOTOR_BASELINE',
    'RECOVERY_AFTER_MOTOR',
    'PREPARE_SUBTRACTION_3',
    'SUBTRACTION_3',
    'PREPARE_DUAL_TASK_3',
    'DUAL_TASK_3',
    'RECOVERY_AFTER_DUAL_3',
    'PREPARE_SUBTRACTION_7',
    'SUBTRACTION_7',
    'PREPARE_DUAL_TASK_7',
    'DUAL_TASK_7',
    'RECOVERY_AFTER_DUAL_7',
    'PREPARE_SUBTRACTION_17',
    'SUBTRACTION_17',
    'PREPARE_DUAL_TASK_17',
    'DUAL_TASK_17',
    'COMPLETE'
];

const RECOVERY_PHASE_IDS = ['RECOVERY_AFTER_MOTOR', 'RECOVERY_AFTER_DUAL_3', 'RECOVERY_AFTER_DUAL_7'];
const PREP_DURATION = experimentConfig.preTaskCountdownSeconds + 1;

// A fully synchronous, test-controlled stand-in for timer/timer.js's real
// Timer. start() records the requested duration but does NOT complete on
// its own - the test calls complete() when it wants to simulate "this
// phase's time ran out". This is the dependency-injection seam requested
// for testing: no real (or even sped-up) waiting happens anywhere.
function createControllableTimerFactory() {
    const durations = [];
    let pendingOnComplete = null;
    let pendingOnTick = null;
    return {
        durations,
        factory: (callbacks) => ({
            start(duration) {
                durations.push(duration);
                pendingOnComplete = callbacks.onComplete;
                pendingOnTick = callbacks.onTick;
            },
            stop() {
                pendingOnComplete = null;
                pendingOnTick = null;
            }
        }),
        complete() {
            const onComplete = pendingOnComplete;
            pendingOnComplete = null;
            assert.ok(onComplete, 'complete() called with no phase timer pending');
            onComplete();
        },
        tick(remainingSeconds) {
            assert.ok(pendingOnTick, 'tick() called with no phase timer pending');
            pendingOnTick(remainingSeconds);
        }
    };
}

const fakeMouseTaskAdapter = { start() {}, stop() {} };

function createTestController(overrides = {}) {
    const timers = createControllableTimerFactory();
    const logMessages = [];
    const controller = new ExperimentController({
        config: experimentConfig,
        timerFactory: timers.factory,
        mouseTaskAdapter: fakeMouseTaskAdapter,
        logger: (message) => logMessages.push(message),
        ...overrides
    });
    return { controller, timers, logMessages };
}

// Advances the controller all the way to COMPLETE, calling timers.complete()
// for every timed phase and controller.advance() for INSTRUCTIONS (the only
// untimed phase before COMPLETE).
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

test('1. Experiment initializes correctly', () => {
    const { controller } = createTestController();
    const session = controller.initialize();
    assert.ok(session.sessionId);
    assert.equal(session.participantId, null);
    assert.equal(session.experimentId, 'motor-cognitive-dual-task');
    assert.ok(session.startTime);
    assert.equal(session.endTime, null);
    assert.deepEqual(session.phases, []);
});

test('initialize() saves the intake screen\'s participantCode and sessionDate onto the session', () => {
    const { controller } = createTestController();
    const session = controller.initialize({ participantCode: 'P014', sessionDate: '2026-08-10' });
    assert.equal(session.participantCode, 'P014');
    assert.equal(session.sessionDate, '2026-08-10');
});

test('2. Correct first state is WELCOME before start()', () => {
    const { controller } = createTestController();
    assert.equal(controller.getCurrentPhaseId(), 'WELCOME');
    controller.initialize();
    assert.equal(controller.getCurrentPhaseId(), 'WELCOME', 'initialize() alone should not enter a phase');
});

test('start() moves from WELCOME into PREPARE_MOTOR_BASELINE, not straight into MOTOR_BASELINE', () => {
    const { controller, timers } = createTestController();
    controller.start(); // INSTRUCTIONS
    controller.advance();
    assert.equal(controller.getCurrentPhaseId(), 'PREPARE_MOTOR_BASELINE');
    assert.equal(controller.getCurrentPhase().phaseType, 'preparation');
    assert.equal(controller.getCurrentPhase().mouseActive, false);
    assert.equal(timers.durations.at(-1), PREP_DURATION);
});

test('3. Motor baseline lasts 120 seconds according to configuration, starting only after its preparation countdown', () => {
    const { controller, timers } = createTestController();
    controller.start(); // INSTRUCTIONS
    controller.advance(); // -> PREPARE_MOTOR_BASELINE
    timers.complete(); // preparation's own timer completes -> MOTOR_BASELINE
    assert.equal(controller.getCurrentPhaseId(), 'MOTOR_BASELINE');
    assert.equal(timers.durations.at(-1), experimentConfig.motorBaselineDurationSeconds);
    assert.equal(experimentConfig.motorBaselineDurationSeconds, 120);
});

test('Recovery immediately follows motor baseline, and lasts 90 seconds', () => {
    const { controller, timers } = createTestController();
    controller.start();
    controller.advance(); // -> PREPARE_MOTOR_BASELINE
    timers.complete(); // -> MOTOR_BASELINE
    timers.complete(); // -> RECOVERY_AFTER_MOTOR
    assert.equal(controller.getCurrentPhaseId(), 'RECOVERY_AFTER_MOTOR');
    assert.equal(timers.durations.at(-1), 90);
});

test('4. Subtraction 3 is created correctly, and is preceded by its own preparation phase', () => {
    const { controller, timers } = createTestController();
    controller.start();
    controller.advance(); // PREPARE_MOTOR_BASELINE
    timers.complete(); // MOTOR_BASELINE
    timers.complete(); // RECOVERY_AFTER_MOTOR
    timers.complete(); // -> PREPARE_SUBTRACTION_3
    assert.equal(controller.getCurrentPhaseId(), 'PREPARE_SUBTRACTION_3');
    assert.equal(controller.getCurrentPhase().precedesPhaseType, 'cognitive');

    timers.complete(); // -> SUBTRACTION_3
    const phase = controller.getCurrentPhase();
    assert.equal(phase.phaseId, 'SUBTRACTION_3');
    assert.equal(phase.phaseType, 'cognitive');
    assert.equal(phase.subtractionValue, 3);
    assert.equal(phase.duration, experimentConfig.subtractionOnlyDurationSeconds);
});

test('5, 6, 7. Each subtraction condition gets a number in range, and each differs from the previous condition', () => {
    const { controller, timers } = createTestController();
    controller.start();
    controller.advance(); // PREPARE_MOTOR_BASELINE
    timers.complete(); // MOTOR_BASELINE
    timers.complete(); // RECOVERY_AFTER_MOTOR
    timers.complete(); // PREPARE_SUBTRACTION_3
    timers.complete(); // SUBTRACTION_3
    const session = controller.getSession();

    const numberFor = (subtractionValue) =>
        session.phases.find((p) => p.phaseId === `SUBTRACTION_${subtractionValue}`).startingNumber;

    const inRange = (n) => n >= 799 && n <= 999;

    assert.ok(inRange(numberFor(3)));

    timers.complete(); // PREPARE_DUAL_TASK_3
    timers.complete(); // DUAL_TASK_3
    timers.complete(); // RECOVERY_AFTER_DUAL_3
    timers.complete(); // PREPARE_SUBTRACTION_7
    timers.complete(); // SUBTRACTION_7
    assert.ok(inRange(numberFor(7)));
    assert.notEqual(numberFor(7), numberFor(3));

    timers.complete(); // PREPARE_DUAL_TASK_7
    timers.complete(); // DUAL_TASK_7
    timers.complete(); // RECOVERY_AFTER_DUAL_7
    timers.complete(); // PREPARE_SUBTRACTION_17
    timers.complete(); // SUBTRACTION_17
    assert.ok(inRange(numberFor(17)));
    assert.notEqual(numberFor(17), numberFor(7));
});

test('DUAL_TASK_<n> reuses its condition\'s starting number rather than generating a new one', () => {
    const { controller, timers } = createTestController();
    runFullExperiment(controller, timers);
    const session = controller.getSession();
    for (const value of [3, 7, 17]) {
        const subtraction = session.phases.find((p) => p.phaseId === `SUBTRACTION_${value}`);
        const dualTask = session.phases.find((p) => p.phaseId === `DUAL_TASK_${value}`);
        assert.equal(dualTask.startingNumber, subtraction.startingNumber);
    }
});

test('8. Dual-task conditions have mouseActive=true', () => {
    const { controller, timers } = createTestController();
    runFullExperiment(controller, timers);
    const session = controller.getSession();
    for (const value of [3, 7, 17]) {
        const phase = session.phases.find((p) => p.phaseId === `DUAL_TASK_${value}`);
        assert.equal(phase.mouseActive, true);
    }
});

test('9. Cognitive-only conditions have mouseActive=false', () => {
    const { controller, timers } = createTestController();
    runFullExperiment(controller, timers);
    const session = controller.getSession();
    for (const value of [3, 7, 17]) {
        const phase = session.phases.find((p) => p.phaseId === `SUBTRACTION_${value}`);
        assert.equal(phase.mouseActive, false);
    }
});

test('10, 11. Every one of the 3 recovery phases has mouseActive=false, cognitiveActive=false, duration=90', () => {
    const { controller, timers } = createTestController();
    runFullExperiment(controller, timers);
    const session = controller.getSession();

    const recoveryRecords = session.phases.filter((p) => p.phaseType === 'recovery');
    assert.equal(recoveryRecords.length, 3, 'expected exactly 3 recovery phases in the recorded session');
    assert.deepEqual(recoveryRecords.map((p) => p.phaseId), RECOVERY_PHASE_IDS);

    for (const phase of recoveryRecords) {
        assert.equal(phase.mouseActive, false);
        assert.equal(phase.cognitiveActive, false);
        assert.equal(phase.duration, 90);
    }
});

test('12. Final state is COMPLETE', () => {
    const { controller, timers } = createTestController();
    runFullExperiment(controller, timers);
    assert.equal(controller.getCurrentPhaseId(), 'COMPLETE');
    assert.equal(controller.isComplete(), true);
});

test('13. Every phase has correct metadata (phaseType/mouseActive/cognitiveActive) recorded in the session', () => {
    const { controller, timers } = createTestController();
    runFullExperiment(controller, timers);
    const session = controller.getSession();

    const expectations = {
        INSTRUCTIONS: { phaseType: 'instructions', mouseActive: false, cognitiveActive: false },
        PREPARE_MOTOR_BASELINE: { phaseType: 'preparation', mouseActive: false, cognitiveActive: false },
        MOTOR_BASELINE: { phaseType: 'motor', mouseActive: true, cognitiveActive: false },
        RECOVERY_AFTER_MOTOR: { phaseType: 'recovery', mouseActive: false, cognitiveActive: false },
        PREPARE_SUBTRACTION_3: { phaseType: 'preparation', mouseActive: false, cognitiveActive: false },
        SUBTRACTION_3: { phaseType: 'cognitive', mouseActive: false, cognitiveActive: true },
        PREPARE_DUAL_TASK_3: { phaseType: 'preparation', mouseActive: false, cognitiveActive: false },
        DUAL_TASK_3: { phaseType: 'dual-task', mouseActive: true, cognitiveActive: true },
        RECOVERY_AFTER_DUAL_3: { phaseType: 'recovery', mouseActive: false, cognitiveActive: false },
        PREPARE_SUBTRACTION_7: { phaseType: 'preparation', mouseActive: false, cognitiveActive: false },
        SUBTRACTION_7: { phaseType: 'cognitive', mouseActive: false, cognitiveActive: true },
        PREPARE_DUAL_TASK_7: { phaseType: 'preparation', mouseActive: false, cognitiveActive: false },
        DUAL_TASK_7: { phaseType: 'dual-task', mouseActive: true, cognitiveActive: true },
        RECOVERY_AFTER_DUAL_7: { phaseType: 'recovery', mouseActive: false, cognitiveActive: false },
        PREPARE_SUBTRACTION_17: { phaseType: 'preparation', mouseActive: false, cognitiveActive: false },
        SUBTRACTION_17: { phaseType: 'cognitive', mouseActive: false, cognitiveActive: true },
        PREPARE_DUAL_TASK_17: { phaseType: 'preparation', mouseActive: false, cognitiveActive: false },
        DUAL_TASK_17: { phaseType: 'dual-task', mouseActive: true, cognitiveActive: true },
        COMPLETE: { phaseType: 'complete', mouseActive: false, cognitiveActive: false }
    };

    for (const [phaseId, expected] of Object.entries(expectations)) {
        const phase = session.phases.find((p) => p.phaseId === phaseId);
        assert.ok(phase, `missing phase record for ${phaseId}`);
        assert.equal(phase.phaseType, expected.phaseType, `${phaseId}.phaseType`);
        assert.equal(phase.mouseActive, expected.mouseActive, `${phaseId}.mouseActive`);
        assert.equal(phase.cognitiveActive, expected.cognitiveActive, `${phaseId}.cognitiveActive`);
    }
});

test('14. Session data contains all conditions in the exact required order', () => {
    const { controller, timers } = createTestController();
    runFullExperiment(controller, timers);
    const session = controller.getSession();
    assert.deepEqual(session.phases.map((p) => p.phaseId), EXPECTED_ORDER);
    assert.ok(session.endTime, 'session should be closed out once COMPLETE is reached');
});

test('15. Mouse data is stored separately per mouse-containing condition, not combined', () => {
    const { controller, timers } = createTestController();
    controller.start();
    controller.advance(); // PREPARE_MOTOR_BASELINE
    timers.complete(); // -> MOTOR_BASELINE
    controller.reportMousePerformance({ totalTargets: 40, totalClicks: 50, totalHits: 35 });
    timers.complete(); // -> RECOVERY_AFTER_MOTOR
    timers.complete(); // -> PREPARE_SUBTRACTION_3
    timers.complete(); // -> SUBTRACTION_3
    timers.complete(); // -> PREPARE_DUAL_TASK_3
    timers.complete(); // -> DUAL_TASK_3
    controller.reportMousePerformance({ totalTargets: 20, totalClicks: 30, totalHits: 18 });
    timers.complete(); // -> RECOVERY_AFTER_DUAL_3
    timers.complete(); // -> PREPARE_SUBTRACTION_7
    timers.complete(); // -> SUBTRACTION_7
    timers.complete(); // -> PREPARE_DUAL_TASK_7
    timers.complete(); // -> DUAL_TASK_7
    controller.reportMousePerformance({ totalTargets: 22, totalClicks: 28, totalHits: 15 });
    timers.complete(); // -> RECOVERY_AFTER_DUAL_7
    timers.complete(); // -> PREPARE_SUBTRACTION_17
    timers.complete(); // -> SUBTRACTION_17
    timers.complete(); // -> PREPARE_DUAL_TASK_17
    timers.complete(); // -> DUAL_TASK_17
    controller.reportMousePerformance({ totalTargets: 25, totalClicks: 33, totalHits: 20 });
    timers.complete(); // -> COMPLETE (no recovery after the final dual-task)

    const session = controller.getSession();
    const byId = (id) => session.phases.find((p) => p.phaseId === id);

    assert.deepEqual(byId('MOTOR_BASELINE').mousePerformance, {
        totalTargets: 40,
        totalClicks: 50,
        totalHits: 35,
        totalMisses: 15,
        totalAccuracy: 70,
        targetEfficiency: 87.5
    });
    assert.deepEqual(byId('DUAL_TASK_3').mousePerformance, {
        totalTargets: 20,
        totalClicks: 30,
        totalHits: 18,
        totalMisses: 12,
        totalAccuracy: 60,
        targetEfficiency: 90
    });
    assert.notDeepEqual(byId('DUAL_TASK_3').mousePerformance, byId('DUAL_TASK_7').mousePerformance);
    assert.notDeepEqual(byId('DUAL_TASK_7').mousePerformance, byId('DUAL_TASK_17').mousePerformance);

    // Non-mouse phases must not have mouse data.
    assert.equal(byId('SUBTRACTION_3').mousePerformance, null);
    assert.equal(byId('RECOVERY_AFTER_MOTOR').mousePerformance, null);
    assert.equal(byId('RECOVERY_AFTER_DUAL_3').mousePerformance, null);
    assert.equal(byId('PREPARE_MOTOR_BASELINE').mousePerformance, null);
    assert.equal(byId('PREPARE_DUAL_TASK_3').mousePerformance, null);
});

test('reportMousePerformance() throws when called during a non-mouse-active phase', () => {
    const { controller, timers } = createTestController();
    controller.start();
    controller.advance(); // PREPARE_MOTOR_BASELINE
    timers.complete(); // -> MOTOR_BASELINE (mouse-active)
    timers.complete(); // -> RECOVERY_AFTER_MOTOR (not mouse-active)
    assert.throws(() => controller.reportMousePerformance({ totalTargets: 1, totalClicks: 1, totalHits: 1 }));
});

test('logger emits the "[phase] started"/"[phase] completed" sequence in order', () => {
    const { controller, timers, logMessages } = createTestController();
    runFullExperiment(controller, timers);

    for (const phaseId of EXPECTED_ORDER) {
        assert.ok(logMessages.includes(`${phaseId} started`), `missing "${phaseId} started"`);
        assert.ok(logMessages.includes(`${phaseId} completed`), `missing "${phaseId} completed"`);
    }
    assert.ok(logMessages.indexOf('PREPARE_MOTOR_BASELINE started') < logMessages.indexOf('PREPARE_MOTOR_BASELINE completed'));
    assert.ok(logMessages.indexOf('PREPARE_MOTOR_BASELINE completed') < logMessages.indexOf('MOTOR_BASELINE started'));
    assert.ok(logMessages.indexOf('MOTOR_BASELINE completed') < logMessages.indexOf('RECOVERY_AFTER_MOTOR started'));
});

// --- Pre-task countdown: the actual task timer must start only after the
// countdown finishes, and neither the mouse task nor cognitive-task
// timing may start during it. ---

test('the task timer starts only after the pre-task countdown finishes, not during it', () => {
    const { controller, timers } = createTestController();
    controller.start(); // INSTRUCTIONS
    controller.advance(); // -> PREPARE_MOTOR_BASELINE
    assert.equal(controller.getCurrentPhaseId(), 'PREPARE_MOTOR_BASELINE');

    // Only the preparation phase's own (short) timer has been requested so far.
    assert.equal(timers.durations.length, 1);
    assert.equal(timers.durations[0], PREP_DURATION);
    assert.notEqual(timers.durations[0], experimentConfig.motorBaselineDurationSeconds);

    timers.complete(); // preparation's timer finishes -> MOTOR_BASELINE begins
    assert.equal(controller.getCurrentPhaseId(), 'MOTOR_BASELINE');

    // Only NOW is the real 120-second task timer requested - a second,
    // separate Timer.start() call, not a continuation of the first.
    assert.equal(timers.durations.length, 2);
    assert.equal(timers.durations[1], 120);
});

test('this holds for every one of the 7 active tasks, not just motor baseline', () => {
    const { controller, timers } = createTestController();
    controller.start();

    const checks = [
        { prep: 'PREPARE_MOTOR_BASELINE', task: 'MOTOR_BASELINE', taskDuration: 120 },
        { prep: 'PREPARE_SUBTRACTION_3', task: 'SUBTRACTION_3', taskDuration: 120 },
        { prep: 'PREPARE_DUAL_TASK_3', task: 'DUAL_TASK_3', taskDuration: 120 },
        { prep: 'PREPARE_SUBTRACTION_7', task: 'SUBTRACTION_7', taskDuration: 120 },
        { prep: 'PREPARE_DUAL_TASK_7', task: 'DUAL_TASK_7', taskDuration: 120 },
        { prep: 'PREPARE_SUBTRACTION_17', task: 'SUBTRACTION_17', taskDuration: 120 },
        { prep: 'PREPARE_DUAL_TASK_17', task: 'DUAL_TASK_17', taskDuration: 120 }
    ];

    controller.advance(); // INSTRUCTIONS -> PREPARE_MOTOR_BASELINE

    for (const { prep, task, taskDuration } of checks) {
        assert.equal(controller.getCurrentPhaseId(), prep, `expected to be at ${prep}`);
        assert.equal(timers.durations.at(-1), PREP_DURATION, `${prep} must use the preparation duration, not the task's`);

        timers.complete(); // preparation finishes -> the task itself begins
        assert.equal(controller.getCurrentPhaseId(), task, `expected to be at ${task} after ${prep} completes`);
        assert.equal(timers.durations.at(-1), taskDuration, `${task}'s timer must be its own full duration`);

        timers.complete(); // advance past the task to whatever comes next
        // Skip any recovery phase to get back to the next preparation phase.
        while (controller.getCurrentPhase() && controller.getCurrentPhase().phaseType === 'recovery') {
            timers.complete();
        }
    }

    assert.equal(controller.getCurrentPhaseId(), 'COMPLETE');
});

test('the mouse task does not start during preparation - only once the actual mouse-active task phase begins', () => {
    const startCalls = [];
    const spyMouseAdapter = {
        start(phaseDescriptor) {
            startCalls.push(phaseDescriptor.phaseId);
        },
        stop() {}
    };
    const { controller, timers } = createTestController({ mouseTaskAdapter: spyMouseAdapter });

    controller.start();
    controller.advance(); // -> PREPARE_MOTOR_BASELINE (mouseActive: false)
    assert.deepEqual(startCalls, [], 'mouse task must not start during preparation');

    timers.complete(); // -> MOTOR_BASELINE (mouseActive: true)
    assert.deepEqual(startCalls, ['MOTOR_BASELINE']);
});

test('cognitive task timing does not start during preparation - only once the actual subtraction/dual-task phase begins', () => {
    const { controller, timers } = createTestController();
    controller.start();
    controller.advance(); // PREPARE_MOTOR_BASELINE
    timers.complete(); // MOTOR_BASELINE
    timers.complete(); // RECOVERY_AFTER_MOTOR
    timers.complete(); // -> PREPARE_SUBTRACTION_3

    assert.equal(controller.getCurrentPhaseId(), 'PREPARE_SUBTRACTION_3');
    assert.equal(controller.getCurrentSubtractionTask(), null, 'cognitive timing must not be running during preparation');
    // But the starting number must already be known, so the "get ready"
    // screen can display it (see phaseCopy.js).
    assert.ok(controller.getCurrentPhaseRecord().startingNumber >= 799);
    assert.ok(controller.getCurrentPhaseRecord().startingNumber <= 999);

    timers.complete(); // -> SUBTRACTION_3
    assert.equal(controller.getCurrentPhaseId(), 'SUBTRACTION_3');
    const task = controller.getCurrentSubtractionTask();
    assert.ok(task, 'cognitive timing must be running now that the real task has begun');
    assert.equal(task.isRunning(), true);
    assert.equal(task.subtractionValue, 3);

    const numberDuringSubtraction = controller.getCurrentPhaseRecord().startingNumber;

    timers.complete(); // -> PREPARE_DUAL_TASK_3
    assert.equal(controller.getCurrentSubtractionTask(), null, 'cognitive timing must stop again during the next preparation');
    assert.equal(controller.getCurrentPhaseRecord().startingNumber, numberDuringSubtraction, 'same condition, same starting number');

    timers.complete(); // -> DUAL_TASK_3
    const dualTaskCognitiveTask = controller.getCurrentSubtractionTask();
    assert.ok(dualTaskCognitiveTask, 'cognitive timing must be running during the dual-task phase too');
    assert.equal(dualTaskCognitiveTask.isRunning(), true);
});

// --- Regression tests for the mouse-task crash / phase-racing bug report ---

test('Bug fix: the real default mouse task adapter does not throw or advance the phase when no DOM/containers exist', async () => {
    const timers = createControllableTimerFactory();
    const logMessages = [];
    // Deliberately NOT overriding mouseTaskAdapter - this exercises the
    // real default adapter from experimentController.js, in an
    // environment with no `document` at all (like this test runner).
    const controller = new ExperimentController({
        config: experimentConfig,
        timerFactory: timers.factory,
        logger: (message) => logMessages.push(message)
    });

    controller.start(); // INSTRUCTIONS
    controller.advance(); // -> PREPARE_MOTOR_BASELINE
    timers.complete(); // -> MOTOR_BASELINE (mouseActive: true)
    assert.equal(controller.getCurrentPhaseId(), 'MOTOR_BASELINE');

    // Give any dynamic import()/promise inside the adapter a chance to
    // settle. If it were to throw unhandled, Node's test runner would
    // report this test as failed.
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(controller.getCurrentPhaseId(), 'MOTOR_BASELINE', 'the missing mouse-task screen must not skip or break the phase');
    assert.ok(
        logMessages.some((m) => m.includes('MOTOR_BASELINE') && m.includes('mouse task screen not built yet')),
        'expected a clear, handled log message instead of a crash'
    );

    // The phase's own timer is unaffected and still advances normally.
    timers.complete();
    assert.equal(controller.getCurrentPhaseId(), 'RECOVERY_AFTER_MOTOR');
});

test('Bug fix: phases genuinely wait for real elapsed time before advancing (uses the real Timer, not a fake)', async () => {
    const controller = new ExperimentController({
        config: experimentConfig,
        // The real Timer class (same one used in the browser), just sped
        // up via msPerSecond so this test doesn't take 2 real minutes -
        // NOT a fake/instant timer.
        timerFactory: (callbacks) => new Timer({ ...callbacks, msPerSecond: 5 })
    });

    controller.start(); // INSTRUCTIONS
    controller.advance(); // -> PREPARE_MOTOR_BASELINE

    await new Promise((resolve) => {
        const check = setInterval(() => {
            if (controller.getCurrentPhaseId() !== 'PREPARE_MOTOR_BASELINE') {
                clearInterval(check);
                resolve();
            }
        }, 5);
    });
    assert.equal(controller.getCurrentPhaseId(), 'MOTOR_BASELINE');

    const startedAt = Date.now();

    await new Promise((resolve) => {
        const check = setInterval(() => {
            if (controller.getCurrentPhaseId() !== 'MOTOR_BASELINE') {
                clearInterval(check);
                resolve();
            }
        }, 10);
    });

    const elapsedMs = Date.now() - startedAt;
    assert.equal(controller.getCurrentPhaseId(), 'RECOVERY_AFTER_MOTOR');
    // 120 simulated seconds * 5ms/second = 600ms minimum real wait.
    assert.ok(elapsedMs >= 500, `expected a genuine wait of ~600ms; only ${elapsedMs}ms actually elapsed`);
});

test('onPhaseChange listeners fire on every phase transition, including automatic (timer-driven) ones', () => {
    const { controller, timers } = createTestController();
    const observedPhaseIds = [];
    controller.onPhaseChange((phase) => observedPhaseIds.push(phase.phaseId));

    controller.start(); // INSTRUCTIONS
    controller.advance(); // -> PREPARE_MOTOR_BASELINE (button-driven)
    timers.complete(); // -> MOTOR_BASELINE (timer-driven, no button involved)
    timers.complete(); // -> RECOVERY_AFTER_MOTOR (timer-driven)

    assert.deepEqual(observedPhaseIds, ['INSTRUCTIONS', 'PREPARE_MOTOR_BASELINE', 'MOTOR_BASELINE', 'RECOVERY_AFTER_MOTOR']);
});

test('onPhaseChange returns a working unsubscribe function', () => {
    const { controller, timers } = createTestController();
    const observedPhaseIds = [];
    const unsubscribe = controller.onPhaseChange((phase) => observedPhaseIds.push(phase.phaseId));

    controller.start();
    controller.advance(); // -> PREPARE_MOTOR_BASELINE
    unsubscribe();
    timers.complete(); // -> MOTOR_BASELINE, but listener is gone

    assert.deepEqual(observedPhaseIds, ['INSTRUCTIONS', 'PREPARE_MOTOR_BASELINE']);
});

test('onPhaseTick reports the phase\'s configured duration immediately, then live countdown values', () => {
    const { controller, timers } = createTestController();
    const ticks = [];
    controller.onPhaseTick((remainingSeconds, phase) => ticks.push({ phaseId: phase.phaseId, remainingSeconds }));

    controller.start();
    controller.advance(); // -> PREPARE_MOTOR_BASELINE
    timers.complete(); // -> MOTOR_BASELINE, duration 120
    timers.tick(90);
    timers.tick(45);

    const motorBaselineTicks = ticks.filter((t) => t.phaseId === 'MOTOR_BASELINE');
    assert.deepEqual(motorBaselineTicks, [
        { phaseId: 'MOTOR_BASELINE', remainingSeconds: 120 },
        { phaseId: 'MOTOR_BASELINE', remainingSeconds: 90 },
        { phaseId: 'MOTOR_BASELINE', remainingSeconds: 45 }
    ]);
});

test('getCurrentPhaseRecord() returns the session record for whatever phase is current, including its startingNumber', () => {
    const { controller, timers } = createTestController();
    controller.start();
    controller.advance(); // -> PREPARE_MOTOR_BASELINE
    assert.equal(controller.getCurrentPhaseRecord().phaseId, 'PREPARE_MOTOR_BASELINE');
    assert.equal(controller.getCurrentPhaseRecord().startingNumber, null);

    timers.complete(); // -> MOTOR_BASELINE
    assert.equal(controller.getCurrentPhaseRecord().startingNumber, null);

    timers.complete(); // -> RECOVERY_AFTER_MOTOR
    timers.complete(); // -> PREPARE_SUBTRACTION_3
    timers.complete(); // -> SUBTRACTION_3
    const record = controller.getCurrentPhaseRecord();
    assert.equal(record.phaseId, 'SUBTRACTION_3');
    assert.ok(record.startingNumber >= 799 && record.startingNumber <= 999);
});

test('a mouse task adapter that calls its onComplete callback automatically stores results, with no manual reportMousePerformance() call needed', () => {
    let capturedOnComplete = null;
    const recordingMouseAdapter = {
        start(phaseDescriptor, onComplete) {
            capturedOnComplete = onComplete;
        },
        stop() {}
    };

    const { controller, timers } = createTestController({ mouseTaskAdapter: recordingMouseAdapter });
    controller.start();
    controller.advance(); // -> PREPARE_MOTOR_BASELINE
    timers.complete(); // -> MOTOR_BASELINE, mouse-active

    // Simulate the mouse task finishing mid-phase, exactly like
    // mouse/mouseTask.js's own internal duration timer firing.
    capturedOnComplete({ clickCount: 40, hitCount: 30, numberOfTargets: 35 });

    const motorBaselineRecord = controller
        .getSession()
        .phases.find((p) => p.phaseId === 'MOTOR_BASELINE');
    assert.deepEqual(motorBaselineRecord.mousePerformance, {
        totalTargets: 35,
        totalClicks: 40,
        totalHits: 30,
        totalMisses: 10,
        totalAccuracy: 75,
        targetEfficiency: 30 / 35 * 100
    });

    // And the phase timer (independent of the mouse task) still advances normally.
    timers.complete();
    assert.equal(controller.getCurrentPhaseId(), 'RECOVERY_AFTER_MOTOR');
});

test('mouse task results still land on the correct phase record even if the mouse task callback fires after _exitPhase has already run', () => {
    let capturedOnComplete = null;
    const recordingMouseAdapter = {
        start(phaseDescriptor, onComplete) {
            capturedOnComplete = onComplete;
        },
        stop() {}
    };

    const { controller, timers } = createTestController({ mouseTaskAdapter: recordingMouseAdapter });
    controller.start();
    controller.advance(); // -> PREPARE_MOTOR_BASELINE
    timers.complete(); // -> MOTOR_BASELINE

    // Phase timer fires FIRST, advancing past MOTOR_BASELINE (clearing
    // this._currentPhaseRecord internally) BEFORE the mouse task's own
    // completion callback fires - the exact race this fix guards against.
    timers.complete(); // -> RECOVERY_AFTER_MOTOR
    assert.equal(controller.getCurrentPhaseId(), 'RECOVERY_AFTER_MOTOR');

    capturedOnComplete({ clickCount: 10, hitCount: 5, numberOfTargets: 8 });

    const motorBaselineRecord = controller
        .getSession()
        .phases.find((p) => p.phaseId === 'MOTOR_BASELINE');
    assert.ok(motorBaselineRecord.mousePerformance, 'results should still land on MOTOR_BASELINE, not be lost or misattributed');
    assert.equal(motorBaselineRecord.mousePerformance.totalHits, 5);
});
