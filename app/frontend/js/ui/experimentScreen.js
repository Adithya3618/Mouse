// Renders every experimental phase after Instructions (Preparation, Motor
// Baseline, Subtraction, Dual Task, Recovery, Recovery Info, Complete) into
// ONE reusable screen, driven entirely by the experiment controller's
// phase-change/tick subscriptions - there is no separate HTML page or
// template per phase.
//
// This module never creates its own timer. The on-screen "Time Remaining"
// value, the "10/9/8/.../1/0" clicking-only countdown, the pre-counting
// lead-in's second-line reveal, and both lead-ins' popping 3/2/1 are all
// written only from controller.onPhaseTick(), which is fed by the same
// Timer instance that actually advances the experiment - one source of
// truth for phase timing.

import { getExperimentController } from '../experiment/experimentRuntime.js';
import { getPhaseDisplay, MOTOR_COUNTDOWN_SEQUENCE } from './phaseCopy.js';
import { formatTime } from '../timer/timer.js';
import { show, hide } from './transition.js';
import { renderResults } from './resultsScreen.js';
import { initRecordingPanel } from './recordingPanel.js';
import { loadAudioSrc, hideAudioPlayer, initAudioPlayerControls } from './audioPlayer.js';

const PREPARATION_PHASE_TYPE = 'preparation';
const COMPLETE_PHASE_ID = 'COMPLETE';
const INSTRUCTIONS_PHASE_ID = 'INSTRUCTIONS';

// All 3 REST screens now have narration mapped. Any phase not listed here
// gets no audio player at all (see hideAudioPlayer('recovery') below).
const RECOVERY_AUDIO_FILE_BY_PHASE_ID = {
    RECOVERY_AFTER_MOTOR: '/audio/experiment/recovery-after-motor.mp3',
    RECOVERY_AFTER_DUAL_3: '/audio/experiment/recovery-after-dual-3.mp3',
    RECOVERY_AFTER_DUAL_7: '/audio/experiment/recovery-after-dual-7.mp3'
};

// Task-status pills only make sense for the three phases where the
// participant is actively doing (or not doing) one or both tasks -
// Preparation/Recovery are "get ready"/"pause" phases, not task phases
// (and are correctly mouseActive=false/cognitiveActive=false throughout).
const PILL_ELIGIBLE_PHASE_TYPES = new Set(['motor', 'cognitive', 'dual-task']);

// A phase is shown "stripped down to just the box with the dots" - no
// header, nav, or other chrome - only while the participant is actively
// clicking (motor baseline, either dual-task block) or is in the digit
// countdown leading straight into the clicking-only task. This is a
// display-only concern: it never touches mouseActive/cognitiveActive or
// any timing.
function isFullscreenTaskPhase(phase) {
    return phase.phaseType === 'motor'
        || phase.phaseType === 'dual-task'
        || (phase.phaseType === PREPARATION_PHASE_TYPE && phase.precedesPhaseType === 'motor');
}

export function initExperimentScreen() {
    const controller = getExperimentController();

    initRecordingPanel(controller);
    initAudioPlayerControls('recovery');

    const screenExperiment = document.getElementById('screen-experiment');
    // The pre-experiment informational screens (see ui/instructionsScreen.js) -
    // must be hidden the moment the real, timed experiment begins.
    const preExperimentScreens = [
        document.getElementById('screen-instructions'),
        document.getElementById('screen-experiment-entry')
    ];

    const experimentTopbar = document.getElementById('experimentTopbar');
    const timerBadge = document.getElementById('timerBadge');
    const timerValue = document.getElementById('timerValue');

    const taskPanel = document.getElementById('taskPanel');
    const taskEyebrow = document.getElementById('taskEyebrow');
    const taskTitle = document.getElementById('taskTitle');
    const taskInstruction = document.getElementById('taskInstruction');
    const taskParagraphs = document.getElementById('taskParagraphs');
    const transitionLines = document.getElementById('transitionLines');
    const transitionLine1 = document.getElementById('transitionLine1');
    const transitionLine2 = document.getElementById('transitionLine2');
    const transitionPopCountdown = document.getElementById('transitionPopCountdown');
    const transitionPopCountdownValue = document.getElementById('transitionPopCountdownValue');

    const startingNumberBlock = document.getElementById('startingNumberBlock');
    const startingNumberValue = document.getElementById('startingNumberValue');

    const prepCountdown = document.getElementById('prepCountdown');
    const prepCountdownValue = document.getElementById('prepCountdownValue');

    const completePanel = document.getElementById('completePanel');

    const pillRow = document.getElementById('pillRow');
    const countPill = document.getElementById('countPill');
    const clickPill = document.getElementById('clickPill');
    const canvasCaption = document.getElementById('canvasCaption');
    const recoveryProceedBtn = document.getElementById('recoveryProceedBtn');
    // Debug-only frame number (see css/intake.css#.frame-debug-label) -
    // #screen-experiment is reused for every timed phase, so this is set
    // dynamically per phase rather than once in markup.
    const frameLabelExperiment = document.getElementById('frameLabelExperiment');

    controller.onPhaseChange((phase) => {
        if (!phase || phase.phaseId === INSTRUCTIONS_PHASE_ID) {
            return; // WELCOME/INSTRUCTIONS are handled by their own screens
        }

        for (const screen of preExperimentScreens) {
            hide(screen);
        }
        show(screenExperiment);
        document.body.classList.add('experiment-active');
        document.body.classList.toggle('fullscreen-task', isFullscreenTaskPhase(phase));
        screenExperiment.dataset.phaseType = phase.phaseType;
        screenExperiment.dataset.precedes = phase.precedesPhaseType || '';
        if (frameLabelExperiment) {
            frameLabelExperiment.textContent = String(computeDebugFrameNumber(phase));
        }

        if (phase.phaseId === COMPLETE_PHASE_ID) {
            renderComplete();
            return;
        }

        renderTaskScreen(phase, controller.getCurrentPhaseRecord());
    });

    // Fires only when a recovery phase's timer reaches zero (see
    // experimentController.js#onRecoveryReady) - never a real phase change,
    // so this only ever needs to reveal the button, not re-render anything
    // else (which would otherwise reset the just-finished countdown display
    // back to its starting value).
    controller.onRecoveryReady((phase) => {
        if (!phase || phase.phaseType !== 'recovery') {
            return;
        }
        recoveryProceedBtn.hidden = false;
        recoveryProceedBtn.disabled = false;
    });

    recoveryProceedBtn.addEventListener('click', () => {
        // Disable/hide immediately, before the controller call even
        // returns - this is the UI-side half of the "advance exactly
        // once" guarantee (experimentController.js#proceedFromRecovery is
        // the other half, via its own _recoveryReadyToProceed flag, for
        // phaseType 'recovery'; 'recovery-info' below has no such gate to
        // begin with, so hiding/disabling here is just the ordinary
        // double-click guard). A second click on an already-hidden,
        // already-disabled button cannot dispatch another click event at all.
        recoveryProceedBtn.disabled = true;
        recoveryProceedBtn.hidden = true;

        // RECOVERY_AFTER_MOTOR_INFO (phaseType 'recovery-info', shown only
        // right after RECOVERY_AFTER_MOTOR) auto-advances on its own Timer
        // like any normal phase - this button is available from the moment
        // it starts purely as an early-skip, so it calls advance()
        // directly rather than proceedFromRecovery() (which only ever
        // applies to phaseType 'recovery').
        const currentPhase = controller.getCurrentPhase();
        if (currentPhase && currentPhase.phaseType === 'recovery-info') {
            controller.advance();
            return;
        }

        controller.proceedFromRecovery();
    });

    controller.onPhaseTick((remainingSeconds, phase) => {
        if (!phase) {
            return;
        }

        if (phase.phaseType === PREPARATION_PHASE_TYPE && phase.precedesPhaseType === 'motor') {
            prepCountdownValue.textContent = formatMotorCountdownValue(remainingSeconds, phase.duration);
            return;
        }

        if (!timerBadge.hidden) {
            timerValue.textContent = formatTime(remainingSeconds);
        }

        if (phase.phaseType === PREPARATION_PHASE_TYPE) {
            updateTransitionReveal(remainingSeconds, phase);
            updatePopCountdown(remainingSeconds, phase);
        }
    });

    // Currently only the 'cognitive' lead-in (precedesPhaseType) has a
    // second transitionLines entry to reveal - 'dual-task' has just one
    // static line plus its own popping 3/2/1 (see updatePopCountdown
    // below), so phase.revealSecondLineAtRemaining is simply absent there
    // and this is a no-op.
    function updateTransitionReveal(remainingSeconds, phase) {
        if (phase.revealSecondLineAtRemaining == null) {
            return;
        }
        const shouldReveal = remainingSeconds <= phase.revealSecondLineAtRemaining;
        transitionLine2.classList.toggle('revealed', shouldReveal);
    }

    // Pre-counting and dual-task transitions (precedesPhaseType "cognitive"
    // or "dual-task"): pops a big 3/2/1 in the lead-in's final 3 seconds -
    // purely a visual addition, this phase's duration/advance timing is
    // entirely unaffected (still driven only by the phase's own Timer,
    // same as every other phase). Re-triggers the "pop" animation every
    // tick (remove -> forced reflow -> re-add), since the class staying
    // applied across ticks wouldn't replay the animation.
    function updatePopCountdown(remainingSeconds, phase) {
        const appliesToThisLeadIn = phase.precedesPhaseType === 'cognitive' || phase.precedesPhaseType === 'dual-task';
        const shouldShow = appliesToThisLeadIn && remainingSeconds >= 1 && remainingSeconds <= 3;
        if (!shouldShow) {
            hide(transitionPopCountdown);
            return;
        }
        transitionPopCountdownValue.textContent = String(remainingSeconds);
        transitionPopCountdownValue.classList.remove('pop');
        void transitionPopCountdownValue.offsetWidth; // force reflow so re-adding the class below replays the animation
        transitionPopCountdownValue.classList.add('pop');
        show(transitionPopCountdown);
    }

    function renderTaskScreen(phase, phaseRecord) {
        completePanel.hidden = true;
        taskPanel.hidden = false;

        // Reset on every real phase change. For phaseType 'recovery', this
        // stays hidden until onRecoveryReady fires, once THIS phase's timer
        // has actually finished (matches controller.js resetting
        // _recoveryReadyToProceed to false at the very top of every
        // _enterPhase() call). 'recovery-info' has no such gate - it's
        // available immediately, purely as an early-skip past its own
        // auto-advancing timer (see recoveryProceedBtn's click handler).
        if (phase.phaseType === 'recovery-info') {
            recoveryProceedBtn.hidden = false;
            recoveryProceedBtn.disabled = false;
        } else {
            recoveryProceedBtn.hidden = true;
            recoveryProceedBtn.disabled = true;
        }

        const display = getPhaseDisplay(phase, phaseRecord);

        // Fullscreen phases hide the topbar's only other possible content
        // (the eyebrow, via CSS) - if the timer badge is ALSO not shown
        // (only PREPARE_MOTOR_BASELINE, whose lead-in is the digit
        // countdown, not a running timer), the topbar box itself would
        // otherwise render as an empty bordered box with nothing in it.
        experimentTopbar.hidden = isFullscreenTaskPhase(phase) && !display.showTimer;

        // Reset every phase entry, even on phases that never show it - the
        // element is cheap to reset and this guarantees no stale "1" (with
        // its pop class already applied) can ever flash before the first
        // tick recomputes it.
        hide(transitionPopCountdown);
        transitionPopCountdownValue.classList.remove('pop');

        taskEyebrow.hidden = !display.eyebrow;
        taskEyebrow.textContent = display.eyebrow || '';

        taskTitle.textContent = display.title;

        // Exactly one of these three content modes is shown per phase:
        // a single instruction line (most active tasks), several
        // paragraphs (REST), or a transitionLines reveal (the lead-in
        // screens before count-back-only/dual-task) - two lines for
        // 'cognitive', one line (plus updatePopCountdown's own popping
        // 3/2/1) for 'dual-task'.
        if (display.transitionLines) {
            hide(taskInstruction);
            hide(taskParagraphs);
            transitionLine1.textContent = display.transitionLines[0];
            if (display.transitionLines.length > 1) {
                transitionLine2.textContent = display.transitionLines[1];
                transitionLine2.classList.remove('revealed');
                show(transitionLine2);
            } else {
                hide(transitionLine2);
            }
            show(transitionLines);
        } else if (display.paragraphs) {
            hide(taskInstruction);
            hide(transitionLines);
            taskParagraphs.innerHTML = '';
            for (const paragraph of display.paragraphs) {
                const p = document.createElement('p');
                p.textContent = paragraph;
                taskParagraphs.appendChild(p);
            }
            show(taskParagraphs);
        } else {
            hide(taskParagraphs);
            hide(transitionLines);
            taskInstruction.textContent = display.instruction;
            show(taskInstruction);
        }

        const recoveryAudioFile = RECOVERY_AUDIO_FILE_BY_PHASE_ID[phase.phaseId];
        if (recoveryAudioFile) {
            // Same opt-in autoplay as the Instructions walkthrough (see
            // ui/instructionsScreen.js) - the Play/Pause button stays fully
            // usable as a manual override either way. Leaving this screen
            // already stops the audio on its own: the next phase change
            // finds no mapped file for the new phaseId and falls through
            // to hideAudioPlayer('recovery') below, which pauses it.
            loadAudioSrc('recovery', recoveryAudioFile, { autoplay: true });
        } else {
            hideAudioPlayer('recovery');
        }

        startingNumberBlock.hidden = !display.showStartingNumber;
        if (display.showStartingNumber) {
            startingNumberValue.textContent = display.startingNumber != null ? String(display.startingNumber) : '—';
        }

        prepCountdown.hidden = !display.showPrepCountdown;
        if (display.showPrepCountdown) {
            prepCountdownValue.textContent = formatMotorCountdownValue(phase.duration, phase.duration);
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
        experimentTopbar.hidden = false;
        taskPanel.hidden = true;
        timerBadge.hidden = true;
        prepCountdown.hidden = true;
        transitionPopCountdown.hidden = true;
        pillRow.hidden = true;
        canvasCaption.hidden = true;
        completePanel.hidden = false;
        renderResults(controller.getSession(), controller);
    }
}

// Debug-only: maps a phase to the fixed frame number shown in
// css/intake.css's .frame-debug-label (frames 1-4 are the static
// intake/instructions screens - see index.html/intakeScreen.js; this
// covers every phase #screen-experiment ever renders, 5-14). Grouped by
// visual template rather than by exact phaseId - the three SUBTRACTION_<n>
// phases, say, all look identical apart from which number is shown, so
// they share one frame number rather than getting three.
function computeDebugFrameNumber(phase) {
    if (phase.phaseId === COMPLETE_PHASE_ID) {
        return 14;
    }
    switch (phase.phaseType) {
        case PREPARATION_PHASE_TYPE:
            if (phase.precedesPhaseType === 'motor') return 5;
            if (phase.precedesPhaseType === 'cognitive') return 9;
            if (phase.precedesPhaseType === 'dual-task') return 11;
            return '?';
        case 'motor': return 6;
        case 'recovery': return phase.phaseId === 'RECOVERY_AFTER_MOTOR' ? 7 : 13;
        case 'recovery-info': return 8;
        case 'cognitive': return 10;
        case 'dual-task': return 12;
        default: return '?';
    }
}

// The clicking-only lead-in counts down through exactly
// MOTOR_COUNTDOWN_SEQUENCE (10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0) - one entry
// per second of the phase's duration (config.motorBaselineCountdownSeconds),
// indexed by how much of it has elapsed. There is no "BEGIN" moment here:
// the task itself starts the instant 0's own second ends.
function formatMotorCountdownValue(remainingSeconds, duration) {
    const index = duration - remainingSeconds;
    const value = MOTOR_COUNTDOWN_SEQUENCE[index];
    return value != null ? String(value) : '';
}
