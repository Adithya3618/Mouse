// Maps a phase descriptor (see experiment/phases.js) to human-readable
// screen copy. This is the ONE place phase wording lives, so the
// participant-facing text can change without touching the renderer or the
// experiment engine. Never expose internal phase ids (e.g. "DUAL_TASK_3")
// here - only plain-language labels.

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
                title: 'Task 1 — Click Targets (2 min)',
                instruction: 'Click each target as quickly and accurately as possible. Continue clicking the targets until the timer reaches zero.',
                showTimer: true,
                showStartingNumber: false,
                showPrepCountdown: false,
                startingNumber: null
            };

        case 'cognitive':
            return {
                title: `Count Backward by Multiples of ${phase.subtractionValue}`,
                instruction: `Starting with ${startingNumberLabel}, count backward by multiples of ${phase.subtractionValue} as many times as possible (2 minutes).`,
                showTimer: true,
                showStartingNumber: true,
                showPrepCountdown: false,
                startingNumber
            };

        case 'dual-task':
            return {
                title: `Count Backward by Multiples of ${phase.subtractionValue} + Click Targets`,
                instruction: `Count backward by multiples of ${phase.subtractionValue} while clicking on the targets (2 minutes).`,
                showTimer: true,
                showStartingNumber: true,
                showPrepCountdown: false,
                startingNumber
            };

        // Dead code: no phase in the current sequence has phaseType
        // 'transition' (removed when preparation replaced it as the
        // lead-in to dual-task), but this stays a valid, tested case in
        // case that changes again.
        case 'transition':
            return {
                title: 'Next: Dual Task',
                instruction: `Continue counting backward by ${phase.subtractionValue}. Now also click every target that appears. Prepare to perform both tasks simultaneously.`,
                showTimer: false,
                showStartingNumber: false,
                showPrepCountdown: false,
                startingNumber: null
            };

        case 'recovery': {
            // RECOVERY_AFTER_DUAL_3 is the one recovery immediately before
            // the by-7 series begins - it gets an extra transition line so
            // the participant knows what's coming next. The other two
            // recoveries (after the motor baseline, and before the by-17
            // series) are unchanged aside from the "(1.5 min)" addition
            // below, since only this one transition was requested.
            const isBeforeSubtraction7 = phase.phaseId === 'RECOVERY_AFTER_DUAL_3';
            const instruction = 'Please stop counting and stop clicking. Sit quietly and relax until the timer reaches zero.'
                + (isBeforeSubtraction7 ? ' Next you will click and count back by 7.' : '');
            return {
                title: 'Recovery Period (1.5 min)',
                instruction,
                showTimer: true,
                showStartingNumber: false,
                showPrepCountdown: false,
                startingNumber: null
            };
        }

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

// The ONE reusable "get ready" screen builder, used for all 7 pre-task
// countdowns (motor baseline, 3x subtraction-only, 3x dual-task) - see
// experiment/conditions.js#buildPreparationMetadata, which is what
// produces the `precedesPhaseType` this switches on. Reuses the same
// title the task itself will use, so the countdown reads as a lead-in to
// that same screen rather than a separate one.
function getPreparationDisplay(phase, startingNumber, startingNumberLabel) {
    const value = phase.subtractionValue;

    switch (phase.precedesPhaseType) {
        case 'cognitive':
            return {
                title: `Count Backward by Multiples of ${value}`,
                instruction: `Starting with ${startingNumberLabel}, get ready to count backward by multiples of ${value}.`,
                showTimer: false,
                showStartingNumber: true,
                showPrepCountdown: true,
                startingNumber
            };

        case 'dual-task':
            return {
                title: `Count Backward by Multiples of ${value} + Click Targets`,
                instruction: `Get ready to count backward by multiples of ${value} while clicking the targets.`,
                showTimer: false,
                showStartingNumber: true,
                showPrepCountdown: true,
                startingNumber
            };

        case 'motor':
        default:
            return {
                title: 'Task 1 — Click Targets (2 min)',
                instruction: 'Get ready to begin clicking the targets.',
                showTimer: false,
                showStartingNumber: false,
                showPrepCountdown: true,
                startingNumber: null
            };
    }
}
