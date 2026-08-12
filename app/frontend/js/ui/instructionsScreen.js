// Phase 1: Instructions screen. The intake screen's Begin button
// transitions here; Continue moves the experiment into its first real
// phase (Motor Baseline), rendered by ui/experimentScreen.js.
//
// This screen shows only participant-facing copy - no phase ids, no
// developer status lines.

import { show, hide } from './transition.js';
import { getExperimentController } from '../experiment/experimentRuntime.js';

export function initInstructionsScreen() {
    const continueBtn = document.getElementById('continueBtn');
    const controller = getExperimentController();

    continueBtn.addEventListener('click', () => {
        // Disabled immediately so a rapid double-click can't fire
        // advance() more than once for a single intended action.
        continueBtn.disabled = true;
        controller.advance();
    });
}

export function showInstructionsScreen(session) {
    const participantSummary = document.getElementById('participantSummary');
    if (participantSummary) {
        participantSummary.textContent = `Participant ${session.participantCode} · ${session.sessionDate}`;
    }
    hide(document.getElementById('screen-intake'));
    show(document.getElementById('screen-instructions'));
}
