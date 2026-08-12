// Static condition metadata: what the participant is supposed to be doing
// during each phase of a single subtraction condition (e.g. the "3", "7",
// or "17" condition), during the motor baseline, and during recovery.
//
// These functions take `config` as an explicit argument rather than
// importing config/experimentConfig.js directly. That keeps this module
// runnable unmodified from both the browser (which fetches config over
// HTTP) and Node test files (which read it straight off disk) - see
// experimentController.js for how the two are wired up.

export function buildMotorBaselineMetadata(config) {
    return {
        phaseType: 'motor',
        mouseActive: true,
        cognitiveActive: false,
        subtractionValue: null,
        duration: config.motorBaselineDurationSeconds
    };
}

// The ONE reusable pre-task countdown builder - used for all 7 active
// tasks (motor baseline, 3x subtraction-only, 3x dual-task) rather than
// duplicated per task. `taskMetadata` is that task's own metadata object
// (from buildMotorBaselineMetadata or buildSubtractionConditionMetadata);
// this just borrows its subtractionValue/phaseType so the "get ready"
// screen knows what it's counting down to (starting number, which
// wording), without needing 7 separate implementations.
//
// The configured preTaskCountdownSeconds (default 3) is the "3, 2, 1"
// portion; one additional second is added so "BEGIN" has a real, visible
// moment on screen before the task actually starts - see
// ui/experimentScreen.js for how that extra second is displayed. Neither
// second is ever added to the task's own duration, since preparation and
// the task itself are always separate phases.
export function buildPreparationMetadata(taskMetadata, config) {
    return {
        phaseType: 'preparation',
        mouseActive: false,
        cognitiveActive: false,
        subtractionValue: taskMetadata.subtractionValue ?? null,
        duration: config.preTaskCountdownSeconds + 1,
        precedesPhaseType: taskMetadata.phaseType
    };
}

// A recovery period is identical regardless of which task it follows -
// motor baseline, subtraction-only, or dual-task all lead into the same
// 90-second, mouse-off/cognitive-off recovery. Which task it followed is
// captured by the phaseId (see experiment/phases.js), not by this
// metadata.
export function buildRecoveryMetadata(config) {
    return {
        phaseType: 'recovery',
        mouseActive: false,
        cognitiveActive: false,
        duration: config.recoveryDurationSeconds
    };
}

// Returns the two phase-metadata templates for one subtraction condition's
// active tasks. Recovery is built separately (via buildRecoveryMetadata)
// since it now happens after both of these, not just after the dual-task.
export function buildSubtractionConditionMetadata(subtractionValue, config) {
    return {
        subtractionOnly: {
            phaseType: 'cognitive',
            mouseActive: false,
            cognitiveActive: true,
            subtractionValue,
            duration: config.subtractionOnlyDurationSeconds
        },
        dualTask: {
            phaseType: 'dual-task',
            mouseActive: true,
            cognitiveActive: true,
            subtractionValue,
            duration: config.dualTaskDurationSeconds
        }
    };
}
