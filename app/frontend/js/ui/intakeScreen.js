// Behavior for the session-intake (starting) screen: the 3-step wizard
// (1 Overview -> 2 Protocol -> 3 Details), today's date default, enabling
// the Begin button once a code + date are entered, and the running clock
// in the top bar.
//
// The Begin button reads the participant code + session date, saves them
// into the experiment session object (the same object that will hold
// Motor Baseline / Subtract-3/7/17 results), starts the experiment
// controller (WELCOME -> INSTRUCTIONS), and shows the Instructions screen.

import { getExperimentController } from '../experiment/experimentRuntime.js';
import { showInstructionsScreen } from './instructionsScreen.js';
import { createIntakeWizardState } from './intakeWizardState.js';
import { show, hide } from './transition.js';

export function initIntakeScreen() {
    const codeInput = document.getElementById('code');
    const dateInput = document.getElementById('date');
    const beginBtn = document.getElementById('beginBtn');
    const clockElement = document.getElementById('clock');

    initWizard();

    dateInput.value = todayISO();

    function validate() {
        beginBtn.disabled = !(codeInput.value.trim().length > 0 && dateInput.value.trim().length > 0);
    }
    codeInput.addEventListener('input', validate);
    dateInput.addEventListener('input', validate);
    validate();

    // 12-hour Eastern Time (America/New_York handles EST/EDT automatically),
    // e.g. "2:54 AM" - deliberately independent of the machine's local
    // timezone. This is purely a display clock; it has no relationship to
    // the experiment's own phase timers/countdowns (see timer/timer.js),
    // which are untouched.
    const clockFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });

    function tick() {
        clockElement.textContent = clockFormatter.format(new Date());
    }
    tick();
    setInterval(tick, 1000);

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
// show()/hide() helpers - so the participant code/date inputs in step 3
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

    function render() {
        const current = wizard.getCurrentStep();

        for (const [step, el] of Object.entries(stepElements)) {
            if (Number(step) === current) {
                show(el);
            } else {
                hide(el);
            }
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
