// Builds the full, ordered phase sequence for the Motor-Cognitive
// Dual-Task experiment, and the explicit set of phase identifiers.
//
// WELCOME is not part of the generated sequence - it is the controller's
// idle state before start() is called (see experimentController.js).
// Everything from INSTRUCTIONS through COMPLETE below is produced
// automatically from configuration.
//
// Every one of the 7 active tasks (motor baseline, 3x subtraction-only,
// 3x dual-task) is preceded by a "PREPARE_<task>" countdown phase, built
// once via conditions.js#buildPreparationMetadata and reused for all 7 -
// there is no per-task countdown implementation. mouseActive and
// cognitiveActive are both false during preparation, so neither the mouse
// task nor cognitive-task timing starts until the countdown's own Timer
// completes and the real task phase begins.
//
// Recovery occurs in exactly 3 places: after the motor baseline, and
// after each of the first two conditions' dual-task blocks (3 and 7).
// There is NO recovery between a condition's subtraction-only block and
// its own dual-task block (they run back-to-back, save for that pair's own
// preparation countdown), and NO recovery after the final condition's (17)
// dual-task block - the experiment ends right there. RECOVERY_AFTER_MOTOR
// specifically is followed by one extra timed screen,
// RECOVERY_AFTER_MOTOR_INFO (see conditions.js#buildRecoveryInfoMetadata) -
// the count-back-only -> dual-task transition procedure, on its own page.
// RECOVERY_AFTER_DUAL_3/_7 have no such second screen.
//
// PROTOCOL CHANGE (see experimentController.js#_taskFamilyFor): the
// starting number is now independently randomized per real task phase - 6
// numbers total (count-back-only and count-back-and-clicking for each of
// 3/7/17), not the 3 numbers ("Random Number #1/#2/#3") the protocol
// previously called for. A PREPARE_SUBTRACTION_<n>/PREPARE_DUAL_TASK_<n>
// phase still shares its number with the task phase it immediately leads
// into (so the "get ready" screen previews the correct upcoming number),
// but SUBTRACTION_<n> and DUAL_TASK_<n> no longer share one - update the
// written protocol document to match this before running further sessions.

import {
    buildMotorBaselineMetadata,
    buildPreparationMetadata,
    buildRecoveryMetadata,
    buildRecoveryInfoMetadata,
    buildSubtractionConditionMetadata
} from './conditions.js';

export const PhaseId = Object.freeze({
    WELCOME: 'WELCOME',
    INSTRUCTIONS: 'INSTRUCTIONS',
    PREPARE_MOTOR_BASELINE: 'PREPARE_MOTOR_BASELINE',
    MOTOR_BASELINE: 'MOTOR_BASELINE',
    RECOVERY_AFTER_MOTOR: 'RECOVERY_AFTER_MOTOR',
    RECOVERY_AFTER_MOTOR_INFO: 'RECOVERY_AFTER_MOTOR_INFO',
    COMPLETE: 'COMPLETE'
    // PREPARE_SUBTRACTION_<n>, SUBTRACTION_<n>, PREPARE_DUAL_TASK_<n>,
    // DUAL_TASK_<n>, and RECOVERY_AFTER_DUAL_<n> are generated per
    // configured subtraction value below rather than listed individually
    // here.
});

export function buildPhaseSequence(config) {
    if (!config) {
        throw new Error('buildPhaseSequence requires a config object (see config/experimentConfig.js).');
    }

    const motorBaselineMetadata = buildMotorBaselineMetadata(config);

    const sequence = [
        {
            phaseId: PhaseId.INSTRUCTIONS,
            phaseType: 'instructions',
            mouseActive: false,
            cognitiveActive: false,
            duration: null
        },
        {
            phaseId: PhaseId.PREPARE_MOTOR_BASELINE,
            ...buildPreparationMetadata(motorBaselineMetadata, config)
        },
        {
            phaseId: PhaseId.MOTOR_BASELINE,
            ...motorBaselineMetadata
        },
        {
            phaseId: PhaseId.RECOVERY_AFTER_MOTOR,
            ...buildRecoveryMetadata(config, { duration: config.recoveryAfterMotorDurationSeconds })
        },
        {
            phaseId: PhaseId.RECOVERY_AFTER_MOTOR_INFO,
            ...buildRecoveryInfoMetadata(config)
        }
    ];

    config.subtractionValues.forEach((value, index) => {
        const metadata = buildSubtractionConditionMetadata(value, config);
        const isLastCondition = index === config.subtractionValues.length - 1;

        sequence.push(
            { phaseId: `PREPARE_SUBTRACTION_${value}`, ...buildPreparationMetadata(metadata.subtractionOnly, config) },
            { phaseId: `SUBTRACTION_${value}`, ...metadata.subtractionOnly },
            { phaseId: `PREPARE_DUAL_TASK_${value}`, ...buildPreparationMetadata(metadata.dualTask, config) },
            { phaseId: `DUAL_TASK_${value}`, ...metadata.dualTask }
        );

        // No recovery after the final condition's dual-task - the
        // experiment ends immediately after it.
        if (!isLastCondition) {
            sequence.push({ phaseId: `RECOVERY_AFTER_DUAL_${value}`, ...buildRecoveryMetadata(config) });
        }
    });

    sequence.push({
        phaseId: PhaseId.COMPLETE,
        phaseType: 'complete',
        mouseActive: false,
        cognitiveActive: false,
        duration: null
    });

    return sequence;
}
