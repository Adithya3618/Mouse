// Maps a phase descriptor (see experiment/phases.js) to human-readable
// screen copy. This is the ONE place phase wording lives, so the
// participant-facing text can change without touching the renderer or the
// experiment engine. Never expose internal phase ids (e.g. "DUAL_TASK_3")
// here - only plain-language labels.

// The literal digit countdown shown before the clicking-only task (see
// getPreparationDisplay below for the other two active tasks' own
// countdown sequences). Counts all the way down to 0 - the task starts the
// instant 0's own second ends, with no separate "BEGIN" moment. Its length
// must match config/experimentConfig.js's motorBaselineCountdownSeconds -
// see that field's own comment.
export const MOTOR_COUNTDOWN_SEQUENCE = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];

// The digit countdown shown before each condition's count-back-only block
// (PREPARE_SUBTRACTION_<n>) - the same digit-countdown treatment as
// MOTOR_COUNTDOWN_SEQUENCE above, just a fixed, shorter 3-second sequence.
// Its length must match config/experimentConfig.js's
// preCountingTransitionSeconds - see that field's own comment.
export const SUBTRACTION_PREP_COUNTDOWN_SEQUENCE = [3, 2, 1, 0];

// The digit countdown shown before each condition's dual-task
// (count-back-and-clicking) block (PREPARE_DUAL_TASK_<n>) - same
// big-digit-countdown treatment as the two sequences above, except this one
// deliberately does NOT count down to 0: the clicking task begins the
// instant 1's own second ends. Its length must match
// config/experimentConfig.js's dualTaskTransitionSeconds - see that
// field's own comment.
export const DUAL_TASK_PREP_COUNTDOWN_SEQUENCE = [5, 4, 3, 2, 1];

// Spelled-out word form of each configured subtraction value (this
// protocol's own three conditions - see config/experimentConfig.js's
// subtractionValues), used ONLY for the count-back-only screens'
// "Count backward by multiples of <word>" heading/instruction
// (researcher-requested wording - the starting number itself is always
// shown as a digit, since it must be read back exactly as displayed).
const SUBTRACTION_VALUE_WORDS = {
    3: 'Three',
    7: 'Seven',
    17: 'Seventeen'
};

function subtractionValueWord(value) {
    return SUBTRACTION_VALUE_WORDS[value] || String(value);
}

// phaseId -> the subtraction value of the NEXT series, for the short
// "Next Task" REST screens shown before series 2 and 3 (before series 1,
// RECOVERY_AFTER_MOTOR gets the long combined explanation instead - see
// below). Fixed to this shape because config.subtractionValues' running
// order ([3, 7, 17]) is itself fixed.
const NEXT_SUBTRACTION_VALUE_BY_RECOVERY_PHASE_ID = {
    RECOVERY_AFTER_DUAL_3: 7,
    RECOVERY_AFTER_DUAL_7: 17
};

export function getPhaseDisplay(phase, phaseRecord) {
    if (!phase) {
        return null;
    }

    const startingNumber = phaseRecord ? phaseRecord.startingNumber : null;
    const startingNumberLabel = startingNumber != null ? startingNumber : '—';

    switch (phase.phaseType) {
        case 'preparation':
            return getPreparationDisplay(phase, startingNumber, startingNumberLabel);

        case 'motor':
            return {
                title: 'Clicking Only',
                instruction: 'Click each target as quickly and accurately as possible. Continue clicking the targets until the timer reaches zero.',
                showTimer: true,
                showStartingNumber: false,
                showPrepCountdown: false,
                startingNumber: null
            };

        case 'cognitive':
            // Deliberately just the one instruction line - the starting
            // number is shown separately in its own labeled box
            // (showStartingNumber below), never restated in prose here.
            return {
                title: `Count Backward by Multiples of ${subtractionValueWord(phase.subtractionValue)}`,
                instruction: '',
                showTimer: true,
                showStartingNumber: true,
                showPrepCountdown: false,
                startingNumber
            };

        case 'dual-task':
            // No starting number shown here (researcher-requested removal) -
            // the participant continues counting from wherever they
            // actually left off during the count-only phase, not from the
            // series' own shared starting number, so redisplaying it here
            // would be misleading. See cognitive/dualTaskContinuity.js.
            return {
                title: `Count Backward by Multiples of ${phase.subtractionValue} and Clicking`,
                instruction: `Count backward by multiples of ${phase.subtractionValue} while clicking on the targets, until the timer reaches zero.`,
                showTimer: true,
                showStartingNumber: false,
                showPrepCountdown: false,
                startingNumber
            };

        case 'recovery':
            return getRecoveryDisplay(phase);

        case 'recovery-info':
            return getRecoveryInfoDisplay();

        default:
            return {
                title: '',
                instruction: '',
                showTimer: false,
                showStartingNumber: false,
                showPrepCountdown: false,
                startingNumber: null
            };
    }
}

// The ONE reusable pre-task lead-in screen builder, used for all 7 lead-ins
// (clicking-only, 3x count-back-only, 3x dual-task) - see
// experiment/conditions.js#buildPreparationMetadata, which is what
// produces the `precedesPhaseType` this switches on.
//
// All three (motor/cognitive/dual-task) now get the big digit-countdown
// treatment (showPrepCountdown) - MOTOR_COUNTDOWN_SEQUENCE /
// SUBTRACTION_PREP_COUNTDOWN_SEQUENCE / DUAL_TASK_PREP_COUNTDOWN_SEQUENCE
// respectively (see ui/experimentScreen.js) - with no running timer
// (showTimer: false) shown until the countdown itself finishes and the
// real task phase begins. 'cognitive' additionally shows the upcoming
// starting number alongside its heading; 'dual-task' deliberately does
// not (the participant continues from wherever they actually left off,
// not from any displayed number).
function getPreparationDisplay(phase, startingNumber, startingNumberLabel) {
    const value = phase.subtractionValue;

    switch (phase.precedesPhaseType) {
        case 'cognitive':
            // Same digit-countdown treatment as 'motor' below, just shown
            // alongside the upcoming starting number - see
            // SUBTRACTION_PREP_COUNTDOWN_SEQUENCE (3, 2, 1, 0). The single
            // instruction line is the only copy on this screen; no
            // transitionLines/running timer, matching the
            // "count-back-only screen" requirement that no other
            // instructional text appears here.
            return {
                title: `Count Backward by Multiples of ${subtractionValueWord(value)}`,
                instruction: '',
                showTimer: false,
                showStartingNumber: true,
                showPrepCountdown: true,
                startingNumber
            };

        case 'dual-task':
            // Same digit-countdown treatment as 'cognitive'/'motor' -
            // DUAL_TASK_PREP_COUNTDOWN_SEQUENCE (5, 4, 3, 2, 1). No
            // starting number here (the participant continues counting
            // from wherever the count-only block actually left them, not
            // from a displayed number - see dualTaskContinuity.js), and no
            // running timer until the countdown itself finishes.
            return {
                title: `Continue counting backward by multiples of ${value} and click the dots`,
                instruction: '',
                showTimer: false,
                showStartingNumber: false,
                showPrepCountdown: true,
                startingNumber
            };

        case 'motor':
        default:
            return {
                title: 'Clicking Only',
                instruction: 'Get ready to begin clicking the targets.',
                showTimer: false,
                showStartingNumber: false,
                showPrepCountdown: true,
                startingNumber: null
            };
    }
}

// RECOVERY_AFTER_MOTOR (the first REST, before series 1) gets one long,
// combined explanation covering both the 3/7/17 series in general and how
// the count-back-only -> dual-task transition within each series works.
// RECOVERY_AFTER_DUAL_3/RECOVERY_AFTER_DUAL_7 (before series 2 and 3) get a
// short "Next Task" version instead, naming only the upcoming subtraction
// value - see NEXT_SUBTRACTION_VALUE_BY_RECOVERY_PHASE_ID above.
function getRecoveryDisplay(phase) {
    const nextValue = NEXT_SUBTRACTION_VALUE_BY_RECOVERY_PHASE_ID[phase.phaseId];

    const paragraphs = nextValue != null
        ? [
            `After this rest, you will count backward by multiples of ${nextValue}, starting from a random number that will appear on the next screen.`,
            `Once the count-back-only block ends, watch for the short countdown. You will then continue counting backward from the number you are on while clicking the targets as soon as they appear.`
        ]
        : [
            'As you rest, I will explain the three upcoming series of counting backward and counting backward while clicking.',
            'You will count backward by 3, 7, and 17, starting from a random number that will be provided on the screen.',
            'Please count out loud, clearly, and at an audible volume so that the recording can capture each number you say.',
            'If you make a mistake, continue counting backward from the last number you stated. Do not go back and correct the mistake. If you forget which number you were on, choose a number in the same general range and continue counting backward.',
            'If you reach negative numbers, that is completely fine. Continue counting backward using the same pattern.'
        ];

    return {
        title: 'REST',
        eyebrow: nextValue != null ? 'Next Task' : null,
        instruction: paragraphs.join('\n\n'),
        paragraphs,
        showTimer: true,
        showStartingNumber: false,
        showPrepCountdown: false,
        startingNumber: null
    };
}

// RECOVERY_AFTER_MOTOR_INFO: the second, timed screen shown only right
// after RECOVERY_AFTER_MOTOR (see experiment/conditions.js#buildRecoveryInfoMetadata) -
// the count-back-only -> dual-task transition procedure, on its own page.
function getRecoveryInfoDisplay() {
    return {
        title: 'REST',
        instruction: '',
        paragraphs: [
            'After the counting-only portion, you will immediately begin the counting and clicking portion without a rest period. Continue counting backward from the number you reached during the counting-only portion.',

            'When the dots appear, continue counting backward and begin clicking them as quickly and accurately as possible. Continue both tasks at the same time until the timer runs out.',

            'This same procedure will be used for counting backward by 3, by 7, and by 17. For each series, you will first count backward for 2 minutes without clicking. Immediately afterward, continue counting backward from the number you are currently on. Pay attention to the screen so you are ready to begin clicking as soon as the dots appear. When the dots appear, begin clicking them while continuing to count backward without stopping or restarting. Each series will last a total of 4 minutes.',

            'Remember to speak clearly and at an audible volume throughout the task so that the recording can capture each number you say.'
        ],
        // Index 2 (the 3rd paragraph) is rendered bold via a real <strong>
        // element (see ui/experimentScreen.js's paragraph renderer) -
        // never literal "<strong>" tags in the text itself, which would
        // just show up as raw text rather than actually bolding anything.
        emphasizedParagraphs: [2],
        showTimer: true,
        showStartingNumber: false,
        showPrepCountdown: false,
        startingNumber: null
    };
}
