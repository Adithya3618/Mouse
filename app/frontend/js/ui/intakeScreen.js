// Behavior for the session-intake (starting) screen: today's date default,
// enabling the Begin button once a code + date are entered, and the
// running clock in the top bar.
//
// The Begin button reads the participant code + session date, saves them
// into the experiment session object (the same object that will hold
// Motor Baseline / Subtract-3/7/17 results), starts the experiment
// controller (WELCOME -> INSTRUCTIONS), and shows the Instructions screen.

import { getExperimentController } from '../experiment/experimentRuntime.js';
import { showInstructionsScreen } from './instructionsScreen.js';

export function initIntakeScreen() {
    const codeInput = document.getElementById('code');
    const dateInput = document.getElementById('date');
    const beginBtn = document.getElementById('beginBtn');
    const clockElement = document.getElementById('clock');

    dateInput.value = todayISO();

    function validate() {
        beginBtn.disabled = !(codeInput.value.trim().length > 0 && dateInput.value.trim().length > 0);
    }
    codeInput.addEventListener('input', validate);
    dateInput.addEventListener('input', validate);
    validate();

    function tick() {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        clockElement.textContent = `${hours}:${minutes}:${seconds}`;
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
