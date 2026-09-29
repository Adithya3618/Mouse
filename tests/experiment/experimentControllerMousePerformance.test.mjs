// Regression coverage for the "SUBTRACTION_17 + CLICKING mouse results
// missing after the phase finishes" bug report.
//
// ROOT CAUSE: the mouse task runs on its own independent real-time
// duration (mouse/mouseSession.js, started after an async dynamic import in
// experimentController.js's defaultMouseTaskAdapter), separate from the
// phase's own Timer that actually calls advance() - see
// experiment/experimentController.js's own comment on this. Its
// onComplete callback (which is what actually populates
// phase.mousePerformance, via data/sessionData.js#recordMousePerformance)
// therefore typically fires slightly AFTER the phase's own Timer reaches
// zero. For every mouseActive phase except the final condition's own
// DUAL_TASK_<n>, the phase that follows (a REST/RECOVERY_AFTER_DUAL_<n>, or
// MOTOR_BASELINE's own RECOVERY_AFTER_MOTOR) runs for real seconds before
// the participant ever reaches the results screen - plenty of buffer for
// onComplete to have already fired. DUAL_TASK_17 (the last condition) has
// no recovery phase after it (see experiment/phases.js) - COMPLETE follows
// immediately - so without tracking this explicitly, its mousePerformance
// could still be null at the moment the results screen renders/exports.
//
// The fix (getPendingMousePerformance(), mirroring the pre-existing
// getPendingCognitiveProcessing() pattern) is exercised directly here,
// without any DOM/browser dependency - ui/resultsScreen.js's own use of it
// is verified live (see the session's report for that).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExperimentController } from '../../app/frontend/js/experiment/experimentController.js';
import { experimentConfig } from '../../config/experimentConfig.js';

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

// A mouse task adapter whose onComplete only fires when the test
// explicitly triggers it (mirroring the real adapter's own onComplete,
// which fires on the mouse task's own independent duration, not this
// phase's Timer) - lets these tests directly control the exact race the
// bug report is about, instead of relying on real wall-clock timing.
function createDeferredMouseTaskAdapter() {
    const pendingByPhaseId = new Map();
    const startedFor = [];

    const adapter = {
        async start(phaseDescriptor, onComplete) {
            startedFor.push(phaseDescriptor.phaseId);
            return new Promise((resolve) => {
                pendingByPhaseId.set(phaseDescriptor.phaseId, {
                    complete(result) {
                        onComplete(result);
                        resolve({ started: true });
                    }
                });
            });
        },
        stop() {}
    };
    adapter.startedFor = startedFor;
    adapter.completeFor = (phaseId, result) => {
        const pending = pendingByPhaseId.get(phaseId);
        assert.ok(pending, `no pending mouse task for phase ${phaseId}`);
        pendingByPhaseId.delete(phaseId);
        pending.complete(result);
    };
    return adapter;
}

// Finishes each named phase's still-pending mouse task with a throwaway
// result, purely so no promise from createDeferredMouseTaskAdapter is left
// permanently unresolved when a test ends (an unresolved promise chain
// left dangling across tests fails Node's test runner, independent of
// anything these tests are actually asserting).
function completeRemaining(mouseAdapter, phaseIds) {
    for (const phaseId of phaseIds) {
        mouseAdapter.completeFor(phaseId, { numberOfTargets: 0, clickCount: 0, hitCount: 0 });
    }
}

function createTestController(overrides = {}) {
    const timers = createControllableTimerFactory();
    const mouseAdapter = createDeferredMouseTaskAdapter();
    const controller = new ExperimentController({
        config: experimentConfig,
        timerFactory: timers.factory,
        mouseTaskAdapter: mouseAdapter,
        logger: () => {},
        ...overrides
    });
    return { controller, timers, mouseAdapter };
}

// Drives the controller forward exactly like
// experimentControllerCognitiveSpeech.test.mjs's own runFullExperiment,
// but stops as soon as `targetPhaseId` is reached instead of running all
// the way to COMPLETE.
function runToPhase(controller, timers, targetPhaseId) {
    controller.start();
    while (controller.getCurrentPhaseId() !== targetPhaseId) {
        const phase = controller.getCurrentPhase();
        if (phase.duration == null) {
            controller.advance();
        } else {
            timers.complete();
            if (phase.phaseType === 'recovery' || phase.phaseType === 'recovery-info') {
                controller.proceedFromRecovery();
            }
        }
    }
}

test('DUAL_TASK_17 (the final condition\'s dual-task phase, with no recovery phase after it) is tracked as pending mouse performance, and stays null until its mouse task actually completes', async () => {
    const { controller, timers, mouseAdapter } = createTestController();
    runToPhase(controller, timers, 'DUAL_TASK_17');

    assert.deepEqual(
        mouseAdapter.startedFor,
        ['MOTOR_BASELINE', 'DUAL_TASK_3', 'DUAL_TASK_7', 'DUAL_TASK_17'],
        'every mouseActive phase so far has started its own mouse task'
    );
    assert.equal(controller.getPendingMousePerformance().length, 4, 'none of the four mouse tasks have completed yet');

    // DUAL_TASK_17's own Timer reaches zero - exactly the real race: the
    // phase's own Timer, never the mouse task, is what advances the
    // experiment. There is no RECOVERY_AFTER_DUAL_17, so this goes
    // straight to COMPLETE.
    timers.complete();
    assert.equal(controller.getCurrentPhaseId(), 'COMPLETE');

    const session = controller.getSession();
    const dualTask17 = session.phases.find((p) => p.phaseId === 'DUAL_TASK_17');
    assert.equal(dualTask17.mousePerformance, null, 'not yet recorded - DUAL_TASK_17\'s own mouse task has not finished yet');

    // This is exactly what ui/resultsScreen.js#renderResults does, right
    // before rendering the mouse-performance table.
    mouseAdapter.completeFor('DUAL_TASK_17', { numberOfTargets: 12, clickCount: 15, hitCount: 10 });
    // The other three mouse tasks (MOTOR_BASELINE/DUAL_TASK_3/DUAL_TASK_7)
    // are left uncompleted by this test on purpose - finish them too so no
    // promise is left permanently unresolved once the test ends.
    completeRemaining(mouseAdapter, ['MOTOR_BASELINE', 'DUAL_TASK_3', 'DUAL_TASK_7']);
    await Promise.allSettled(controller.getPendingMousePerformance());

    assert.ok(dualTask17.mousePerformance, 'now populated, after awaiting the pending mouse performance promises');
    assert.equal(dualTask17.mousePerformance.totalTargets, 12);
    assert.equal(dualTask17.mousePerformance.totalClicks, 15);
    assert.equal(dualTask17.mousePerformance.totalHits, 10);
    assert.equal(dualTask17.mousePerformance.totalMisses, 5);
});

test('the same tracking applies uniformly to every mouseActive phase (MOTOR_BASELINE, DUAL_TASK_3, DUAL_TASK_7), not just DUAL_TASK_17 - the bug is a phase-sequence timing gap, not phase-specific code', async () => {
    const { controller, timers, mouseAdapter } = createTestController();
    runToPhase(controller, timers, 'DUAL_TASK_17');

    const session = controller.getSession();
    for (const phaseId of ['MOTOR_BASELINE', 'DUAL_TASK_3', 'DUAL_TASK_7']) {
        const phase = session.phases.find((p) => p.phaseId === phaseId);
        assert.equal(phase.mousePerformance, null, `${phaseId} has not completed its mouse task yet either`);
    }

    mouseAdapter.completeFor('MOTOR_BASELINE', { numberOfTargets: 5, clickCount: 5, hitCount: 5 });
    mouseAdapter.completeFor('DUAL_TASK_3', { numberOfTargets: 8, clickCount: 9, hitCount: 7 });
    mouseAdapter.completeFor('DUAL_TASK_7', { numberOfTargets: 10, clickCount: 11, hitCount: 9 });
    // DUAL_TASK_17 is left uncompleted by this test on purpose - finish it
    // too so no promise is left permanently unresolved once the test ends.
    completeRemaining(mouseAdapter, ['DUAL_TASK_17']);
    await Promise.allSettled(controller.getPendingMousePerformance());

    assert.equal(session.phases.find((p) => p.phaseId === 'MOTOR_BASELINE').mousePerformance.totalHits, 5);
    assert.equal(session.phases.find((p) => p.phaseId === 'DUAL_TASK_3').mousePerformance.totalHits, 7);
    assert.equal(session.phases.find((p) => p.phaseId === 'DUAL_TASK_7').mousePerformance.totalHits, 9);
});

test('a mouse task that never starts (adapter reports { started: false }, e.g. the mouse task screen was never mounted) resolves its pending promise instead of hanging forever', async () => {
    const skippingAdapter = {
        async start() {
            return { started: false };
        },
        stop() {}
    };
    const { controller, timers } = createTestController({ mouseTaskAdapter: skippingAdapter });

    controller.start();
    controller.advance(); // -> PREPARE_MOTOR_BASELINE
    timers.complete(); // -> MOTOR_BASELINE (mouseActive: true)

    assert.equal(controller.getPendingMousePerformance().length, 1);
    // Must settle (not hang) even though onComplete is never called.
    await Promise.allSettled(controller.getPendingMousePerformance());

    const session = controller.getSession();
    assert.equal(session.phases.find((p) => p.phaseId === 'MOTOR_BASELINE').mousePerformance, null);
});

test('getPendingMousePerformance() is reset by initialize(), same as getPendingCognitiveProcessing()', async () => {
    const { controller, timers, mouseAdapter } = createTestController();
    runToPhase(controller, timers, 'DUAL_TASK_17');
    const stillPending = controller.getPendingMousePerformance();
    assert.ok(stillPending.length > 0);

    controller.initialize({ participantCode: 'P999', sessionDate: '2026-09-28' });
    assert.deepEqual(controller.getPendingMousePerformance(), []);

    // initialize() resets the controller's own tracking array, but the
    // pre-existing promises it had already handed out (e.g. to a caller
    // mid-await) are unaffected - finish them so none is left dangling.
    completeRemaining(mouseAdapter, ['MOTOR_BASELINE', 'DUAL_TASK_3', 'DUAL_TASK_7', 'DUAL_TASK_17']);
    await Promise.allSettled(stillPending);
});
