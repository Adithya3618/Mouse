// Static condition metadata: what the participant is supposed to be doing
// during each phase of a single subtraction condition (e.g. the "3", "7",
// or "17" condition), during the clicking-only baseline, and during REST.
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

// The ONE reusable pre-task lead-in builder - used for all 7 active tasks
// (clicking-only, 3x count-back-only, 3x dual-task) rather than duplicated
// per task. `taskMetadata` is that task's own metadata object (from
// buildMotorBaselineMetadata or buildSubtractionConditionMetadata); this
// just borrows its subtractionValue/phaseType so the lead-in screen knows
// what it's counting down to (starting number, which wording), without
// needing 7 separate implementations.
//
// What this screen actually looks/behaves like differs by which task it
// precedes (see ui/phaseCopy.js/ui/experimentScreen.js for the display
// side of each):
//   - precedes 'motor': a short digit countdown (motorBaselineCountdownSeconds)
//   - precedes 'cognitive': a "transition" screen (preCountingTransitionSeconds)
//     whose second line reveals only near the end, plus a popping 3/2/1 in
//     its final 3 seconds
//   - precedes 'dual-task': a short "transition" screen
//     (dualTaskTransitionSeconds) whose final 3 seconds show that same
//     popping 3/2/1 (no separate reveal point - see revealTimingFor below)
// None of these seconds are ever added to the task's own duration, since
// the lead-in and the task itself are always separate phases.
export function buildPreparationMetadata(taskMetadata, config) {
    return {
        phaseType: 'preparation',
        mouseActive: false,
        cognitiveActive: false,
        subtractionValue: taskMetadata.subtractionValue ?? null,
        duration: preparationDurationFor(taskMetadata.phaseType, config),
        precedesPhaseType: taskMetadata.phaseType,
        ...revealTimingFor(taskMetadata.phaseType, config)
    };
}

function preparationDurationFor(precedesPhaseType, config) {
    switch (precedesPhaseType) {
        case 'cognitive':
            return config.preCountingTransitionSeconds;
        case 'dual-task':
            return config.dualTaskTransitionSeconds;
        case 'motor':
        default:
            return config.motorBaselineCountdownSeconds;
    }
}

// When a lead-in screen has a second line that reveals partway through
// (see ui/phaseCopy.js's transitionLines - currently only the 'cognitive'
// lead-in has one), the threshold is carried on the phase descriptor
// itself - ui/experimentScreen.js reads it straight off the `phase` it
// already receives on every tick, rather than needing its own copy of
// config. Absent (undefined) for 'motor' (no transitionLines at all) and
// 'dual-task' (a single static line - its final 3 seconds are instead a
// popping 3/2/1, timed the same fixed way as 'cognitive''s own pop
// countdown, so it needs no separate configurable reveal point).
function revealTimingFor(precedesPhaseType, config) {
    if (precedesPhaseType === 'cognitive') {
        return { revealSecondLineAtRemaining: config.preCountingTransitionRevealSeconds };
    }
    return {};
}

// A REST period is identical regardless of which task it follows -
// clicking-only, count-back-only, or dual-task all lead into the same
// mouse-off/cognitive-off REST. Which task it followed is captured by the
// phaseId (see experiment/phases.js), not by this metadata. `duration`
// defaults to the shared config.recoveryDurationSeconds (used by
// RECOVERY_AFTER_DUAL_3/_7); RECOVERY_AFTER_MOTOR passes its own dedicated
// duration instead (see buildRecoveryInfoMetadata below for why).
export function buildRecoveryMetadata(config, { duration } = {}) {
    return {
        phaseType: 'recovery',
        mouseActive: false,
        cognitiveActive: false,
        duration: duration ?? config.recoveryDurationSeconds
    };
}

// RECOVERY_AFTER_MOTOR_INFO: a second screen shown only right after
// RECOVERY_AFTER_MOTOR (the REST before series 1 - see experiment/phases.js),
// carrying the count-back-only -> dual-task transition procedure that used
// to be part of RECOVERY_AFTER_MOTOR's own paragraphs. Unlike 'recovery',
// this auto-advances on its own Timer like any other phase (no
// proceedFromRecovery() gate) - config.recoveryAfterMotorDurationSeconds +
// config.recoveryAfterMotorInfoDurationSeconds together are this pair's
// combined 60-second budget.
export function buildRecoveryInfoMetadata(config) {
    return {
        phaseType: 'recovery-info',
        mouseActive: false,
        cognitiveActive: false,
        duration: config.recoveryAfterMotorInfoDurationSeconds
    };
}

// Returns the two phase-metadata templates for one subtraction condition's
// active tasks. REST is built separately (via buildRecoveryMetadata) since
// it now happens after both of these, not just after the dual-task.
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
