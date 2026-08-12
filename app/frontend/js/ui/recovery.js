// Controls the 90-second recovery/break screens shown between sessions.
// `finishedIteration` is the session number that just ended (1 or 2) -
// session 3 is followed by results, not a recovery screen.

import { show, hide } from './transition.js';

export function startRecovery(finishedIteration, { breakContainer1, breakContainer2 }) {
    if (finishedIteration === 1) {
        show(breakContainer1);
    } else if (finishedIteration === 2) {
        show(breakContainer2);
    }
}

export function endRecovery(finishedIteration, {
    breakContainer1,
    breakContainer2,
    instructionsContainer2,
    instructionsContainer3,
    startButton
}) {
    if (finishedIteration === 1) {
        hide(breakContainer1);
        show(instructionsContainer2);
        show(startButton);
    } else {
        hide(breakContainer2);
        show(instructionsContainer3);
        show(startButton);
    }
}
