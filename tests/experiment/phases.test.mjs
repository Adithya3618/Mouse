import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPhaseSequence, PhaseId } from '../../app/frontend/js/experiment/phases.js';
import { experimentConfig } from '../../config/experimentConfig.js';

// Every one of the 7 active tasks (motor baseline, 3x subtraction-only,
// 3x dual-task) is preceded by its own PREPARE_<task> countdown phase.
// Recovery still occurs in exactly 3 places: after motor baseline, and
// after the dual-task blocks for conditions 3 and 7 (none after
// subtraction-only, none after the final condition's (17) dual-task).
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

const PREPARATION_PHASE_IDS = [
    'PREPARE_MOTOR_BASELINE',
    'PREPARE_SUBTRACTION_3',
    'PREPARE_DUAL_TASK_3',
    'PREPARE_SUBTRACTION_7',
    'PREPARE_DUAL_TASK_7',
    'PREPARE_SUBTRACTION_17',
    'PREPARE_DUAL_TASK_17'
];

test('buildPhaseSequence produces exactly the required phase order', () => {
    const sequence = buildPhaseSequence(experimentConfig);
    assert.deepEqual(sequence.map((p) => p.phaseId), EXPECTED_ORDER);
});

test('buildPhaseSequence throws without a config', () => {
    assert.throws(() => buildPhaseSequence(undefined));
});

test('MOTOR_BASELINE metadata matches the spec shape and keeps its original 120s duration', () => {
    const sequence = buildPhaseSequence(experimentConfig);
    const motorBaseline = sequence.find((p) => p.phaseId === PhaseId.MOTOR_BASELINE);
    assert.deepEqual(motorBaseline, {
        phaseId: 'MOTOR_BASELINE',
        phaseType: 'motor',
        mouseActive: true,
        cognitiveActive: false,
        subtractionValue: null,
        duration: experimentConfig.motorBaselineDurationSeconds
    });
    assert.equal(motorBaseline.duration, 120);
});

test('SUBTRACTION_<n> and DUAL_TASK_<n> phases keep their original 120s duration, unaffected by preparation', () => {
    const sequence = buildPhaseSequence(experimentConfig);
    for (const value of experimentConfig.subtractionValues) {
        const subtraction = sequence.find((p) => p.phaseId === `SUBTRACTION_${value}`);
        const dualTask = sequence.find((p) => p.phaseId === `DUAL_TASK_${value}`);
        assert.equal(subtraction.duration, experimentConfig.subtractionOnlyDurationSeconds);
        assert.equal(dualTask.duration, experimentConfig.dualTaskDurationSeconds);
        assert.equal(subtraction.mouseActive, false);
        assert.equal(subtraction.cognitiveActive, true);
        assert.equal(dualTask.mouseActive, true);
        assert.equal(dualTask.cognitiveActive, true);
    }
});

test('there are exactly 7 preparation phases, one before every active task', () => {
    const sequence = buildPhaseSequence(experimentConfig);
    const preparationPhases = sequence.filter((p) => p.phaseType === 'preparation');
    assert.equal(preparationPhases.length, 7);
    assert.deepEqual(preparationPhases.map((p) => p.phaseId), PREPARATION_PHASE_IDS);
});

test('every preparation phase has mouseActive=false and cognitiveActive=false (neither task starts during the countdown)', () => {
    const sequence = buildPhaseSequence(experimentConfig);
    for (const phaseId of PREPARATION_PHASE_IDS) {
        const phase = sequence.find((p) => p.phaseId === phaseId);
        assert.ok(phase, `missing ${phaseId}`);
        assert.equal(phase.mouseActive, false, `${phaseId}.mouseActive`);
        assert.equal(phase.cognitiveActive, false, `${phaseId}.cognitiveActive`);
    }
});

test('preparation duration is preTaskCountdownSeconds + 1, and is NOT counted in the task\'s own 2:00 duration', () => {
    const sequence = buildPhaseSequence(experimentConfig);
    const expectedPrepDuration = experimentConfig.preTaskCountdownSeconds + 1;
    assert.equal(experimentConfig.preTaskCountdownSeconds, 3);

    for (const phaseId of PREPARATION_PHASE_IDS) {
        const phase = sequence.find((p) => p.phaseId === phaseId);
        assert.equal(phase.duration, expectedPrepDuration);
    }

    // The task immediately after each preparation phase must still have
    // its full, unmodified duration - the countdown is additive, separate
    // time, never merged into the task.
    const motorBaseline = sequence.find((p) => p.phaseId === 'MOTOR_BASELINE');
    assert.equal(motorBaseline.duration, 120);
    for (const value of experimentConfig.subtractionValues) {
        assert.equal(sequence.find((p) => p.phaseId === `SUBTRACTION_${value}`).duration, 120);
        assert.equal(sequence.find((p) => p.phaseId === `DUAL_TASK_${value}`).duration, 120);
    }
});

test('preparation phases carry subtractionValue and precedesPhaseType matching the task they lead into', () => {
    const sequence = buildPhaseSequence(experimentConfig);

    const prepMotor = sequence.find((p) => p.phaseId === 'PREPARE_MOTOR_BASELINE');
    assert.equal(prepMotor.subtractionValue, null);
    assert.equal(prepMotor.precedesPhaseType, 'motor');

    for (const value of experimentConfig.subtractionValues) {
        const prepSubtraction = sequence.find((p) => p.phaseId === `PREPARE_SUBTRACTION_${value}`);
        assert.equal(prepSubtraction.subtractionValue, value);
        assert.equal(prepSubtraction.precedesPhaseType, 'cognitive');

        const prepDualTask = sequence.find((p) => p.phaseId === `PREPARE_DUAL_TASK_${value}`);
        assert.equal(prepDualTask.subtractionValue, value);
        assert.equal(prepDualTask.precedesPhaseType, 'dual-task');
    }
});

test('each preparation phase immediately precedes its own task, with nothing in between', () => {
    const sequence = buildPhaseSequence(experimentConfig);
    const ids = sequence.map((p) => p.phaseId);

    const pairs = [
        ['PREPARE_MOTOR_BASELINE', 'MOTOR_BASELINE'],
        ['PREPARE_SUBTRACTION_3', 'SUBTRACTION_3'],
        ['PREPARE_DUAL_TASK_3', 'DUAL_TASK_3'],
        ['PREPARE_SUBTRACTION_7', 'SUBTRACTION_7'],
        ['PREPARE_DUAL_TASK_7', 'DUAL_TASK_7'],
        ['PREPARE_SUBTRACTION_17', 'SUBTRACTION_17'],
        ['PREPARE_DUAL_TASK_17', 'DUAL_TASK_17']
    ];

    for (const [prep, task] of pairs) {
        const prepIndex = ids.indexOf(prep);
        const taskIndex = ids.indexOf(task);
        assert.equal(taskIndex, prepIndex + 1, `${task} must immediately follow ${prep}`);
    }
});

test('there are exactly 3 recovery phases: after motor baseline, after dual-task 3, and after dual-task 7', () => {
    const sequence = buildPhaseSequence(experimentConfig);
    const recoveryPhases = sequence.filter((p) => p.phaseType === 'recovery');
    assert.equal(recoveryPhases.length, 3);
    assert.deepEqual(recoveryPhases.map((p) => p.phaseId), RECOVERY_PHASE_IDS);
});

test('every recovery phase has mouseActive=false, cognitiveActive=false, duration=90', () => {
    const sequence = buildPhaseSequence(experimentConfig);
    for (const phaseId of RECOVERY_PHASE_IDS) {
        const phase = sequence.find((p) => p.phaseId === phaseId);
        assert.ok(phase, `missing ${phaseId}`);
        assert.equal(phase.mouseActive, false);
        assert.equal(phase.cognitiveActive, false);
        assert.equal(phase.duration, 90);
        assert.equal(phase.duration, experimentConfig.recoveryDurationSeconds);
    }
});

test('there is no recovery after any SUBTRACTION_<n> block, and no recovery after DUAL_TASK_17', () => {
    const sequence = buildPhaseSequence(experimentConfig);
    const ids = sequence.map((p) => p.phaseId);

    assert.ok(!ids.includes('RECOVERY_AFTER_SUBTRACTION_3'));
    assert.ok(!ids.includes('RECOVERY_AFTER_SUBTRACTION_7'));
    assert.ok(!ids.includes('RECOVERY_AFTER_SUBTRACTION_17'));
    assert.ok(!ids.includes('RECOVERY_AFTER_DUAL_17'));

    // The experiment ends immediately after DUAL_TASK_17.
    const dualTask17Index = ids.indexOf('DUAL_TASK_17');
    assert.equal(ids[dualTask17Index + 1], 'COMPLETE');
});

test('there is no transition phase anywhere in the sequence', () => {
    const sequence = buildPhaseSequence(experimentConfig);
    assert.ok(!sequence.some((p) => p.phaseType === 'transition'));
    assert.ok(!sequence.some((p) => p.phaseId.startsWith('TRANSITION_')));
});
