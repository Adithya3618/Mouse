import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPhaseSequence, PhaseId } from '../../app/frontend/js/experiment/phases.js';
import { experimentConfig } from '../../config/experimentConfig.js';

// Every one of the 7 active tasks (clicking-only, 3x count-back-only,
// 3x dual-task) is preceded by its own PREPARE_<task> lead-in phase.
// REST occurs in exactly 3 places: after clicking-only, and after the
// dual-task blocks for conditions 3 and 7 (none after count-back-only,
// none after the final condition's (17) dual-task). RECOVERY_AFTER_MOTOR
// alone is followed by one extra timed screen, RECOVERY_AFTER_MOTOR_INFO
// (phaseType "recovery-info", not "recovery" - see conditions.js#buildRecoveryInfoMetadata).
const EXPECTED_ORDER = [
    'INSTRUCTIONS',
    'PREPARE_MOTOR_BASELINE',
    'MOTOR_BASELINE',
    'RECOVERY_AFTER_MOTOR',
    'RECOVERY_AFTER_MOTOR_INFO',
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

test('MOTOR_BASELINE (Clicking Only) metadata matches the spec shape and its 80s duration', () => {
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
    assert.equal(motorBaseline.duration, 80);
});

test('SUBTRACTION_<n> (90s) and DUAL_TASK_<n> (120s) durations, unaffected by preparation', () => {
    const sequence = buildPhaseSequence(experimentConfig);
    for (const value of experimentConfig.subtractionValues) {
        const subtraction = sequence.find((p) => p.phaseId === `SUBTRACTION_${value}`);
        const dualTask = sequence.find((p) => p.phaseId === `DUAL_TASK_${value}`);
        assert.equal(subtraction.duration, experimentConfig.subtractionOnlyDurationSeconds);
        assert.equal(subtraction.duration, 90);
        assert.equal(dualTask.duration, experimentConfig.dualTaskDurationSeconds);
        assert.equal(dualTask.duration, 120);
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

test('every preparation phase has mouseActive=false and cognitiveActive=false (neither task starts during the lead-in)', () => {
    const sequence = buildPhaseSequence(experimentConfig);
    for (const phaseId of PREPARATION_PHASE_IDS) {
        const phase = sequence.find((p) => p.phaseId === phaseId);
        assert.ok(phase, `missing ${phaseId}`);
        assert.equal(phase.mouseActive, false, `${phaseId}.mouseActive`);
        assert.equal(phase.cognitiveActive, false, `${phaseId}.cognitiveActive`);
    }
});

// --- Lead-in durations: three different shapes now (see
// experiment/conditions.js#buildPreparationMetadata) - a short digit
// countdown before clicking-only, a long lead-in before each
// count-back-only block, and a short lead-in before each dual-task block.
// None of these are ever added to the task's own duration - the lead-in
// and the task itself are always separate phases. ---

test('PREPARE_MOTOR_BASELINE duration is motorBaselineCountdownSeconds, not counted in the clicking-only task\'s own duration', () => {
    const sequence = buildPhaseSequence(experimentConfig);
    assert.equal(experimentConfig.motorBaselineCountdownSeconds, 11);

    const prep = sequence.find((p) => p.phaseId === 'PREPARE_MOTOR_BASELINE');
    assert.equal(prep.duration, 11);

    const motorBaseline = sequence.find((p) => p.phaseId === 'MOTOR_BASELINE');
    assert.equal(motorBaseline.duration, 80);
});

test('PREPARE_SUBTRACTION_<n> duration is preCountingTransitionSeconds, not counted in the count-back-only task\'s own duration', () => {
    const sequence = buildPhaseSequence(experimentConfig);
    assert.equal(experimentConfig.preCountingTransitionSeconds, 30);

    for (const value of experimentConfig.subtractionValues) {
        const prep = sequence.find((p) => p.phaseId === `PREPARE_SUBTRACTION_${value}`);
        assert.equal(prep.duration, 30);
        assert.equal(prep.revealSecondLineAtRemaining, experimentConfig.preCountingTransitionRevealSeconds);

        assert.equal(sequence.find((p) => p.phaseId === `SUBTRACTION_${value}`).duration, 90);
    }
});

test('PREPARE_DUAL_TASK_<n> duration is dualTaskTransitionSeconds, not counted in the dual-task\'s own duration', () => {
    const sequence = buildPhaseSequence(experimentConfig);
    assert.equal(experimentConfig.dualTaskTransitionSeconds, 10);

    for (const value of experimentConfig.subtractionValues) {
        const prep = sequence.find((p) => p.phaseId === `PREPARE_DUAL_TASK_${value}`);
        assert.equal(prep.duration, 10);
        // No configurable reveal point - its final 3 seconds show a
        // popping 3/2/1 (see ui/experimentScreen.js#updatePopCountdown)
        // instead of a second transitionLines entry to reveal.
        assert.equal(prep.revealSecondLineAtRemaining, undefined);
        assert.equal(prep.revealSecondLineAfterElapsed, undefined);

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

test('there are exactly 3 REST phases: after clicking-only, after dual-task 3, and after dual-task 7', () => {
    const sequence = buildPhaseSequence(experimentConfig);
    const recoveryPhases = sequence.filter((p) => p.phaseType === 'recovery');
    assert.equal(recoveryPhases.length, 3);
    assert.deepEqual(recoveryPhases.map((p) => p.phaseId), RECOVERY_PHASE_IDS);
});

test('every REST phase has mouseActive=false, cognitiveActive=false', () => {
    const sequence = buildPhaseSequence(experimentConfig);
    for (const phaseId of RECOVERY_PHASE_IDS) {
        const phase = sequence.find((p) => p.phaseId === phaseId);
        assert.ok(phase, `missing ${phaseId}`);
        assert.equal(phase.mouseActive, false);
        assert.equal(phase.cognitiveActive, false);
    }
});

test('RECOVERY_AFTER_DUAL_3/_7 use the shared recoveryDurationSeconds; RECOVERY_AFTER_MOTOR uses its own dedicated duration instead', () => {
    const sequence = buildPhaseSequence(experimentConfig);
    for (const phaseId of ['RECOVERY_AFTER_DUAL_3', 'RECOVERY_AFTER_DUAL_7']) {
        const phase = sequence.find((p) => p.phaseId === phaseId);
        assert.equal(phase.duration, experimentConfig.recoveryDurationSeconds);
    }

    const recoveryAfterMotor = sequence.find((p) => p.phaseId === 'RECOVERY_AFTER_MOTOR');
    assert.equal(recoveryAfterMotor.duration, experimentConfig.recoveryAfterMotorDurationSeconds);
});

// --- RECOVERY_AFTER_MOTOR_INFO: the second, timed "REST" screen shown only
// right after RECOVERY_AFTER_MOTOR - see
// conditions.js#buildRecoveryInfoMetadata. Auto-advances like any normal
// phase (phaseType "recovery-info", NOT "recovery" - no proceedFromRecovery()
// gate), carrying the other half of that pair's fixed 60-second budget. ---

test('RECOVERY_AFTER_MOTOR_INFO: phaseType "recovery-info", duration is recoveryAfterMotorInfoDurationSeconds, no mouse/cognitive activity', () => {
    const sequence = buildPhaseSequence(experimentConfig);
    const info = sequence.find((p) => p.phaseId === 'RECOVERY_AFTER_MOTOR_INFO');
    assert.ok(info, 'missing RECOVERY_AFTER_MOTOR_INFO');
    assert.equal(info.phaseType, 'recovery-info');
    assert.equal(info.mouseActive, false);
    assert.equal(info.cognitiveActive, false);
    assert.equal(info.duration, experimentConfig.recoveryAfterMotorInfoDurationSeconds);
});

test('RECOVERY_AFTER_MOTOR and RECOVERY_AFTER_MOTOR_INFO together are a fixed 60-second combined budget', () => {
    assert.equal(experimentConfig.recoveryAfterMotorDurationSeconds + experimentConfig.recoveryAfterMotorInfoDurationSeconds, 60);
});

test('RECOVERY_AFTER_MOTOR_INFO immediately follows RECOVERY_AFTER_MOTOR, and PREPARE_SUBTRACTION_3 immediately follows it', () => {
    const sequence = buildPhaseSequence(experimentConfig);
    const ids = sequence.map((p) => p.phaseId);
    const recoveryIndex = ids.indexOf('RECOVERY_AFTER_MOTOR');
    assert.equal(ids[recoveryIndex + 1], 'RECOVERY_AFTER_MOTOR_INFO');
    assert.equal(ids[recoveryIndex + 2], 'PREPARE_SUBTRACTION_3');
});

test('RECOVERY_AFTER_MOTOR_INFO is NOT counted among the phaseType "recovery" REST phases (it does not use the proceedFromRecovery gate)', () => {
    const sequence = buildPhaseSequence(experimentConfig);
    const recoveryPhases = sequence.filter((p) => p.phaseType === 'recovery');
    assert.equal(recoveryPhases.length, 3);
    assert.ok(!recoveryPhases.some((p) => p.phaseId === 'RECOVERY_AFTER_MOTOR_INFO'));
});

test('there is no REST after any SUBTRACTION_<n> block, and no REST after DUAL_TASK_17', () => {
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

test('there is no distinct "transition" phaseType anywhere in the sequence - lead-in variants are all phaseType "preparation"', () => {
    const sequence = buildPhaseSequence(experimentConfig);
    assert.ok(!sequence.some((p) => p.phaseType === 'transition'));
    assert.ok(!sequence.some((p) => p.phaseId.startsWith('TRANSITION_')));
});
