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
    // 2-minute motor-only mouse baseline at the start of the experiment.
    motorBaselineDurationSeconds: 120,

    // The three serial-subtraction conditions, in the order they run.
    subtractionValues: [3, 7, 17],

    // 2-minute subtraction-only block for each condition (no mouse task).
    subtractionOnlyDurationSeconds: 120,

    // 2-minute combined subtraction + mouse block for each condition.
    dualTaskDurationSeconds: 120,

    // 90-second recovery break after EVERY task - motor baseline, each
    // subtraction-only block, and each dual-task block. There is no
    // separate "transition" phase anymore; the recovery period after a
    // subtraction-only block is what precedes that condition's dual-task
    // block.
    recoveryDurationSeconds: 90,

    // Length of the "3, 2, 1" countdown shown immediately before EVERY
    // active 2-minute task (motor baseline, each subtraction-only block,
    // each dual-task block). This time is separate from and NOT included
    // in that task's own duration above - see
    // experiment/conditions.js#buildPreparationMetadata.
    preTaskCountdownSeconds: 3,

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
    // randomStartingNumberRange above, which is 3-digit). Used only as a
    // speech-recognition SEGMENTATION signal - deciding whether a
    // recognized fragment like "8" is likely incomplete and should wait
    // for a continuation - never to alter, guess, or "correct" a
    // recognized value. See cognitive/cognitiveSpeechSession.js.
    expectedResponseDigits: 3,

    // Passed through to the browser's SpeechRecognition/
    // webkitSpeechRecognition engine as its recognition language/locale.
    // Participants may have different English accents; this is the only
    // lever the browser-native API offers for that (see
    // cognitive/speechRecognition.js) - it does not guarantee accurate
    // recognition across accents, and no AI-based accent detection is
    // used to choose or adjust it automatically.
    speechRecognitionLanguage: 'en-US'
};

export default experimentConfig;
