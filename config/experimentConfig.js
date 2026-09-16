// Source of truth for the Motor-Cognitive Dual-Task experiment's timing
// and conditions. app/frontend/js/experiment/experimentController.js reads
// every timing value from here (via dependency injection - see that file)
// instead of hardcoding them, so a researcher can retune the protocol by
// editing only this file.
//
// This is a plain ES module so it can be imported directly by frontend
// code and by tests. Nothing in app/backend currently uses it; if the
// backend ever needs these values, use a dynamic `import()` rather than
// `require()`, since this file is not CommonJS.

export const experimentConfig = {
    // Clicking-only mouse baseline at the start of the experiment
    // ("Clicking Only" on screen; MOTOR_BASELINE internally).
    motorBaselineDurationSeconds: 120,

    // The three serial-subtraction conditions, in the order they run.
    subtractionValues: [3, 7, 17],

    // Counting-only hold screen for each condition (no mouse task) -
    // "Count Back by N" on screen; SUBTRACTION_<n> internally.
    subtractionOnlyDurationSeconds: 120,

    // Combined counting + clicking block for each condition -
    // "Count Back by N and Clicking" on screen; DUAL_TASK_<n> internally.
    dualTaskDurationSeconds: 120,

    // REST break after every count-back-only block and every dual-task
    // block (RECOVERY_AFTER_DUAL_3/_7). There is no separate recovery
    // between a condition's count-back-only block and its own dual-task
    // block (they are joined instead by dualTaskTransitionSeconds below).
    // RECOVERY_AFTER_MOTOR (after clicking-only) uses its own dedicated
    // pair of durations instead - see the two fields directly below.
    recoveryDurationSeconds: 90,

    // RECOVERY_AFTER_MOTOR (the REST before series 1) is split across two
    // screens: the REST explanation itself, then RECOVERY_AFTER_MOTOR_INFO -
    // a second timed screen carrying the count-back-only -> dual-task
    // transition procedure, with its own running timer, that auto-advances
    // on its own (no Continue-button gate). These two together are a
    // deliberate 60-second combined budget for the pair - adjust either
    // value to change the split without changing the 60s total.
    recoveryAfterMotorDurationSeconds: 30,
    recoveryAfterMotorInfoDurationSeconds: 30,

    // Length of the digit countdown (10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0 - see
    // ui/phaseCopy.js/ui/experimentScreen.js) shown immediately before the
    // clicking-only task, and ONLY before it - every other active task
    // (count-back-only, dual-task) is instead preceded by its own
    // "transition" screen (see preCountingTransitionSeconds/
    // dualTaskTransitionSeconds below), not a digit countdown. This time is
    // separate from and NOT included in the clicking-only task's own
    // duration above. Must match MOTOR_COUNTDOWN_SEQUENCE.length
    // (ui/phaseCopy.js).
    motorBaselineCountdownSeconds: 11,

    // PREPARE_SUBTRACTION_<n>: the screen shown before each condition's
    // count-back-only block, explaining what's about to happen. Its second
    // line (revealing the actual starting-number prompt) appears only in
    // the final preCountingTransitionRevealSeconds of this duration - see
    // ui/phaseCopy.js/ui/experimentScreen.js.
    preCountingTransitionSeconds: 10,
    preCountingTransitionRevealSeconds: 10,

    // PREPARE_DUAL_TASK_<n>: the screen shown between a condition's
    // count-back-only block and its dual-task block, telling the
    // participant to keep counting while the mouse task starts. Its final
    // 3 seconds show a popping 3/2/1 (same treatment as
    // preCountingTransitionSeconds's own pop countdown - see
    // ui/experimentScreen.js#updatePopCountdown), not a separate
    // configurable reveal point.
    dualTaskTransitionSeconds: 10,

    // Range for the random number each subtraction condition counts down
    // from. A new number is drawn per condition and must differ from the
    // previous condition's number (see cognitive/randomNumber.js).
    randomStartingNumberRange: {
        min: 799,
        max: 999
    },

    // How a spoken response's "expected number" is computed for cognitive
    // (SUBTRACTION_<n>/DUAL_TASK_<n>) scoring - see
    // cognitive/speechScoring.js for the full rationale. 'adaptive'
    // (default, researcher-selected) continues the expected sequence from
    // the participant's own previous spoken number, so a single slip does
    // not cascade into every later response being marked incorrect.
    // 'strict' instead always compares against the pure mathematical
    // sequence from startingNumber. Change this value to switch scoring
    // methodology for all future sessions; it does not require touching
    // cognitive/speechScoring.js itself.
    cognitiveScoringMode: 'adaptive',

    // Every participant response in this protocol is expected to be
    // exactly this many digits (the starting number is always drawn from
    // randomStartingNumberRange above, which is 3-digit). Threaded through
    // to the backend transcription/parsing pipeline (see
    // app/backend/services/speechProcessingService.js and
    // cognitive/numberParser.js) as the target length for reconstructing a
    // number from spoken fragments - never to alter, guess, or "correct" a
    // recognized value.
    expectedResponseDigits: 3
};

export default experimentConfig;
