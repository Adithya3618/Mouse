// Each mouse phase's click history is uploaded as soon as its mouse task
// finishes, and getPendingMousePerformance() (what the COMPLETE screen
// awaits) only settles after that upload - so the final DUAL_TASK_17,
// whose mouse task finishes after the phase timer has already moved to
// COMPLETE, is persisted before results are shown. Phase timing itself is
// never delayed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExperimentController } from '../../app/frontend/js/experiment/experimentController.js';
import { experimentConfig } from '../../config/experimentConfig.js';

function createControllableTimerFactory() {
    let pendingOnComplete = null;
    return {
        factory: (callbacks) => ({
            start() { pendingOnComplete = callbacks.onComplete; },
            stop() { pendingOnComplete = null; }
        }),
        complete() {
            const onComplete = pendingOnComplete;
            pendingOnComplete = null;
            onComplete();
        }
    };
}

function createDeferredMouseTaskAdapter() {
    const pending = new Map();
    return {
        async start(phaseDescriptor, onComplete) {
            return new Promise((resolve) => {
                pending.set(phaseDescriptor.phaseId, (result) => { onComplete(result); resolve({ started: true }); });
            });
        },
        stop() {},
        completeFor(phaseId, result) {
            pending.get(phaseId)(result);
            pending.delete(phaseId);
        }
    };
}

function mouseResult(hits, misses) {
    const targets = Array.from({ length: hits + 1 }, (_, i) => ({ targetId: i + 1, appearedElapsedMs: 1750 * (i + 1), outcome: i < hits ? 'hit' : 'expired' }));
    const clickEvents = [];
    for (let i = 0; i < hits; i += 1) {
        clickEvents.push({ clickSequence: clickEvents.length + 1, isHit: true, targetId: i + 1, elapsedMs: 1750 * (i + 1) + 400, reactionTimeMs: 400 });
    }
    for (let i = 0; i < misses; i += 1) {
        clickEvents.push({ clickSequence: clickEvents.length + 1, isHit: false, targetId: null, elapsedMs: 9000 + i, reactionTimeMs: null });
    }
    return { clickCount: hits + misses, hitCount: hits, numberOfTargets: targets.length, clickEvents, targets, taskInfo: { durationMs: 10000 } };
}

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

function setup(uploader) {
    const timers = createControllableTimerFactory();
    const mouseAdapter = createDeferredMouseTaskAdapter();
    const controller = new ExperimentController({
        config: experimentConfig,
        timerFactory: timers.factory,
        mouseTaskAdapter: mouseAdapter,
        logger: () => {},
        mouseDataUploader: uploader
    });
    controller.initialize({ participantCode: 'P_UPLOAD', sessionDate: '2026-09-29' });
    return { controller, timers, mouseAdapter };
}

test('every mouse phase (MOTOR_BASELINE, DUAL_TASK_3/7/17) uploads its full click history', async () => {
    const uploads = [];
    const { controller, timers, mouseAdapter } = setup(async (payload) => { uploads.push(payload); return { status: 'saved' }; });
    runToPhase(controller, timers, 'DUAL_TASK_17');
    timers.complete(); // -> COMPLETE

    mouseAdapter.completeFor('MOTOR_BASELINE', mouseResult(3, 1));
    mouseAdapter.completeFor('DUAL_TASK_3', mouseResult(2, 2));
    mouseAdapter.completeFor('DUAL_TASK_7', mouseResult(1, 0));
    mouseAdapter.completeFor('DUAL_TASK_17', mouseResult(4, 3));
    await Promise.allSettled(controller.getPendingMousePerformance());

    assert.deepEqual(uploads.map((u) => u.phaseId), ['MOTOR_BASELINE', 'DUAL_TASK_3', 'DUAL_TASK_7', 'DUAL_TASK_17']);
    const final = uploads[3];
    assert.equal(final.participantCode, 'P_UPLOAD');
    assert.equal(final.sessionId, controller.getSession().sessionId);
    assert.equal(final.phaseType, 'dual-task');
    assert.equal(final.clickEvents.length, 7);
    assert.equal(final.targets.length, 5);
    assert.deepEqual(final.reportedTotals, { totalTargets: 5, totalClicks: 7, totalHits: 4 });

    const phase17 = controller.getSession().phases.find((p) => p.phaseId === 'DUAL_TASK_17');
    assert.equal(phase17.mouseDataPersistence.status, 'saved');
    assert.equal(phase17.mouseClickData.clickEvents.length, 7);
    assert.equal(phase17.mousePerformance.totalClicks, 7); // existing summary unchanged
});

test('DUAL_TASK_17: pending mouse performance does not settle until its upload has finished', async () => {
    let finishUpload;
    const events = [];
    const { controller, timers, mouseAdapter } = setup((payload) => {
        events.push(`upload started ${payload.phaseId}`);
        return new Promise((resolve) => { finishUpload = () => { events.push('upload finished'); resolve({ status: 'saved' }); }; });
    });
    runToPhase(controller, timers, 'DUAL_TASK_17');
    for (const phaseId of ['MOTOR_BASELINE', 'DUAL_TASK_3', 'DUAL_TASK_7']) {
        mouseAdapter.completeFor(phaseId, { clickCount: 0, hitCount: 0, numberOfTargets: 0 }); // counts-only: no upload
    }

    timers.complete(); // DUAL_TASK_17's timer ends first - the phase advances on time
    assert.equal(controller.getCurrentPhaseId(), 'COMPLETE');

    let settled = false;
    const allSettled = Promise.allSettled(controller.getPendingMousePerformance()).then(() => {
        settled = true;
        events.push('results may render');
    });

    mouseAdapter.completeFor('DUAL_TASK_17', mouseResult(2, 1)); // mouse task finishes slightly later
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false, 'results must wait for the final phase upload');

    finishUpload();
    await allSettled;
    assert.deepEqual(events, ['upload started DUAL_TASK_17', 'upload finished', 'results may render']);
});

test('a failed upload is recorded on the phase and never blocks the results screen forever', async () => {
    const { controller, timers, mouseAdapter } = setup(async () => { throw new Error('network down'); });
    runToPhase(controller, timers, 'DUAL_TASK_17');
    timers.complete();
    for (const phaseId of ['MOTOR_BASELINE', 'DUAL_TASK_3', 'DUAL_TASK_7', 'DUAL_TASK_17']) {
        mouseAdapter.completeFor(phaseId, mouseResult(1, 1));
    }
    await Promise.allSettled(controller.getPendingMousePerformance());

    const phase = controller.getSession().phases.find((p) => p.phaseId === 'DUAL_TASK_17');
    assert.equal(phase.mouseDataPersistence.status, 'failed');
    assert.equal(phase.mouseDataPersistence.error, 'network down');
    assert.equal(phase.mousePerformance.totalClicks, 2, 'local results are still recorded');
});

test('phases with no mouse task (count-only, recovery) never upload anything', async () => {
    const uploads = [];
    const { controller, timers, mouseAdapter } = setup(async (p) => { uploads.push(p.phaseId); return { status: 'saved' }; });
    runToPhase(controller, timers, 'SUBTRACTION_3');
    mouseAdapter.completeFor('MOTOR_BASELINE', mouseResult(1, 0));
    await Promise.allSettled(controller.getPendingMousePerformance());
    assert.deepEqual(uploads, ['MOTOR_BASELINE']);
});
