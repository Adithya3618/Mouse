// Behavior for the session-intake (starting) screen: the 3-step wizard
// (1 Title -> 2 Details -> 3 Protocol), today's date default, and enabling
// step 2's own "Begin session" button once a code + date are entered - that
// gate lives on #step2NextBtn (not #beginBtn) because Details now comes
// before Protocol, so the participant must supply a valid code/date before
// they can even reach the Protocol overview, rather than being let through
// to the last screen only to find a disabled button there.
//
// #beginBtn (on Protocol, now the final step) is what actually reads the
// participant code + session date, saves them into the experiment session
// object (the same object that will hold Motor Baseline / Subtract-3/7/17
// results), starts the experiment controller (WELCOME -> INSTRUCTIONS), and
// shows the Instructions screen.

import { getExperimentController } from '../experiment/experimentRuntime.js';
import { showInstructionsScreen } from './instructionsScreen.js';
import { createIntakeWizardState } from './intakeWizardState.js';
import { show, hide } from './transition.js';

export function initIntakeScreen() {
    const codeInput = document.getElementById('code');
    const dateInput = document.getElementById('date');
    const step2NextBtn = document.getElementById('step2NextBtn');
    const beginBtn = document.getElementById('beginBtn');

    initWizard();

    dateInput.value = todayISO();

    function validate() {
        step2NextBtn.disabled = !(codeInput.value.trim().length > 0 && dateInput.value.trim().length > 0);
    }
    codeInput.addEventListener('input', validate);
    dateInput.addEventListener('input', validate);
    validate();

    beginBtn.addEventListener('click', () => {
        const controller = getExperimentController();
        const session = controller.initialize({
            participantCode: codeInput.value.trim(),
            sessionDate: dateInput.value
        });
        controller.start(); // WELCOME -> INSTRUCTIONS
        showInstructionsScreen(session);
    });
}

function todayISO() {
    return new Date().toISOString().slice(0, 10);
}

// Drives the 3-step wizard's DOM from intakeWizardState.js's pure step
// logic. The step content itself (#intakeStep1/2/3) is never
// unmounted/re-created - only shown/hidden via the app's existing
// show()/hide() helpers - so the participant code/date inputs in step 2
// keep whatever value they had regardless of how many times the
// participant goes back and forth between steps; there is no separate
// "wizard state" to sync them with.
function initWizard() {
    const stepElements = {
        1: document.getElementById('intakeStep1'),
        2: document.getElementById('intakeStep2'),
        3: document.getElementById('intakeStep3')
    };
    const railItems = [...document.querySelectorAll('.step-rail-item')];
    const wizard = createIntakeWizardState({ totalSteps: Object.keys(stepElements).length });
    // Debug-only frame number (see css/intake.css#.frame-debug-label) -
    // conveniently, intake steps are already numbered 1/2/3, so this is
    // just the wizard's own current step.
    const frameLabelIntake = document.getElementById('frameLabelIntake');

    function render() {
        const current = wizard.getCurrentStep();

        for (const [step, el] of Object.entries(stepElements)) {
            if (Number(step) === current) {
                show(el);
            } else {
                hide(el);
            }
        }

        if (frameLabelIntake) {
            frameLabelIntake.textContent = String(current);
        }

        for (const item of railItems) {
            const step = Number(item.dataset.step);
            const isActive = step === current;
            item.classList.toggle('is-active', isActive);
            item.classList.toggle('is-done', step < current);
            item.classList.toggle('is-clickable', !isActive && wizard.canNavigateTo(step));
        }

        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function advance() {
        wizard.next();
        render();
    }

    function retreat() {
        wizard.back();
        render();
    }

    document.getElementById('step1NextBtn').addEventListener('click', advance);
    document.getElementById('step2BackBtn').addEventListener('click', retreat);
    document.getElementById('step2NextBtn').addEventListener('click', advance);
    document.getElementById('step3BackBtn').addEventListener('click', retreat);

    for (const item of railItems) {
        item.addEventListener('click', () => {
            const step = Number(item.dataset.step);
            if (!wizard.canNavigateTo(step)) {
                return; // never lets the rail jump ahead to an unreached step
            }
            wizard.goTo(step);
            render();
        });
    }

    render();
}
