// Renders every experimental phase after Instructions (Preparation, Motor
// Baseline, Subtraction, Dual Task, Recovery, Complete) into ONE reusable
// screen, driven entirely by the experiment controller's phase-change/tick
// subscriptions - there is no separate HTML page or template per phase,
// and no per-task countdown implementation (see phaseCopy.js's single
// getPreparationDisplay(), reused for all 7 pre-task countdowns).
//
// This module never creates its own timer. The on-screen "Time Remaining"
// value and the "GET READY / 3 / 2 / 1 / BEGIN" countdown are both written
// only from controller.onPhaseTick(), which is fed by the same Timer
// instance that actually advances the experiment - one source of truth
// for phase timing.

import { getExperimentController } from '../experiment/experimentRuntime.js';
import { getPhaseDisplay } from './phaseCopy.js';
import { formatTime } from '../timer/timer.js';
import { show, hide } from './transition.js';
import { renderResults } from './resultsScreen.js';

const PREPARATION_PHASE_TYPE = 'preparation';
const COMPLETE_PHASE_ID = 'COMPLETE';
const INSTRUCTIONS_PHASE_ID = 'INSTRUCTIONS';

// Task-status pills only make sense for the three phases where the
// participant is actively doing (or not doing) one or both tasks -
// Preparation/Recovery are "get ready"/"pause" phases, not task phases
// (and are correctly mouseActive=false/cognitiveActive=false throughout).
const PILL_ELIGIBLE_PHASE_TYPES = new Set(['motor', 'cognitive', 'dual-task']);

export function initExperimentScreen() {
    const controller = getExperimentController();

    const screenExperiment = document.getElementById('screen-experiment');
    const screenInstructions = document.getElementById('screen-instructions');

    const timerBadge = document.getElementById('timerBadge');
    const timerValue = document.getElementById('timerValue');

    const taskPanel = document.getElementById('taskPanel');
    const taskTitle = document.getElementById('taskTitle');
    const taskInstruction = document.getElementById('taskInstruction');

    const startingNumberBlock = document.getElementById('startingNumberBlock');
    const startingNumberValue = document.getElementById('startingNumberValue');

    const prepCountdown = document.getElementById('prepCountdown');
    const prepCountdownValue = document.getElementById('prepCountdownValue');

    const completePanel = document.getElementById('completePanel');

    const pillRow = document.getElementById('pillRow');
    const countPill = document.getElementById('countPill');
    const clickPill = document.getElementById('clickPill');
    const canvasCaption = document.getElementById('canvasCaption');

    controller.onPhaseChange((phase) => {
        if (!phase || phase.phaseId === INSTRUCTIONS_PHASE_ID) {
            return; // WELCOME/INSTRUCTIONS are handled by their own screens
        }

        hide(screenInstructions);
        show(screenExperiment);
        document.body.classList.add('experiment-active');
        screenExperiment.dataset.phaseType = phase.phaseType;

        if (phase.phaseId === COMPLETE_PHASE_ID) {
            renderComplete();
            return;
        }

        renderTaskScreen(phase, controller.getCurrentPhaseRecord());
    });

    controller.onPhaseTick((remainingSeconds, phase) => {
        if (!phase) {
            return;
        }
        if (phase.phaseType === PREPARATION_PHASE_TYPE) {
            prepCountdownValue.textContent = formatPrepCountdownValue(remainingSeconds);
        } else if (!timerBadge.hidden) {
            timerValue.textContent = formatTime(remainingSeconds);
        }
    });

    function renderTaskScreen(phase, phaseRecord) {
        completePanel.hidden = true;
        taskPanel.hidden = false;

        const display = getPhaseDisplay(phase, phaseRecord);

        taskTitle.textContent = display.title;
        taskInstruction.textContent = display.instruction;

        startingNumberBlock.hidden = !display.showStartingNumber;
        if (display.showStartingNumber) {
            startingNumberValue.textContent = display.startingNumber != null ? String(display.startingNumber) : '—';
        }

        prepCountdown.hidden = !display.showPrepCountdown;
        if (display.showPrepCountdown) {
            prepCountdownValue.textContent = formatPrepCountdownValue(phase.duration);
        }

        timerBadge.hidden = !display.showTimer;
        if (display.showTimer) {
            timerValue.textContent = formatTime(phase.duration);
        }

        const showPills = PILL_ELIGIBLE_PHASE_TYPES.has(phase.phaseType);
        pillRow.hidden = !showPills;
        if (showPills) {
            setPillState(countPill, 'Count aloud', phase.cognitiveActive);
            setPillState(clickPill, 'Click targets', phase.mouseActive);
        }

        // #gameScreen's own display is managed by mouse/mouseTask.js
        // itself; this caption just needs to match when that will
        // actually show something. mouseActive is false throughout
        // preparation, so the caption (and the mouse task itself) stays
        // hidden until the real task phase begins.
        canvasCaption.hidden = !phase.mouseActive;
    }

    function setPillState(pillEl, label, isActive) {
        pillEl.classList.toggle('active', isActive);
        pillEl.lastChild.textContent = `${label} — ${isActive ? 'on' : 'off'}`;
    }

    function renderComplete() {
        taskPanel.hidden = true;
        timerBadge.hidden = true;
        prepCountdown.hidden = true;
        pillRow.hidden = true;
        canvasCaption.hidden = true;
        completePanel.hidden = false;
        renderResults(controller.getSession());
    }
}

// The preparation phase's duration is preTaskCountdownSeconds + 1 (see
// conditions.js#buildPreparationMetadata) - the extra second is what makes
// "BEGIN" a real, visible moment instead of being instantly overwritten
// the instant the countdown's Timer completes and the next phase renders.
// remainingSeconds counts 4, 3, 2, 1 for a default 3-second countdown;
// this maps that to the displayed 3, 2, 1, BEGIN.
function formatPrepCountdownValue(remainingSeconds) {
    return remainingSeconds > 1 ? String(remainingSeconds - 1) : 'BEGIN';
}
