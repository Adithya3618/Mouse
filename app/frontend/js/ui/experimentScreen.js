// Renders every experimental phase after Instructions (Preparation, Motor
// Baseline, Subtraction, Dual Task, Recovery, Recovery Info, Complete) into
// ONE reusable screen, driven entirely by the experiment controller's
// phase-change/tick subscriptions - there is no separate HTML page or
// template per phase.
//
// This module never creates its own timer. The on-screen "Time Remaining"
// value, the clicking-only/count-back-only digit countdowns, and the
// dual-task lead-in's popping 3/2/1 are all written only from
// controller.onPhaseTick(), which is fed by the same Timer instance that
// actually advances the experiment - one source of truth for phase timing.

import { getExperimentController } from '../experiment/experimentRuntime.js';
import { getPhaseDisplay, MOTOR_COUNTDOWN_SEQUENCE, SUBTRACTION_PREP_COUNTDOWN_SEQUENCE } from './phaseCopy.js';
import { formatTime } from '../timer/timer.js';
import { show, hide } from './transition.js';
import { renderResults } from './resultsScreen.js';
import { initRecordingPanel } from './recordingPanel.js';
import { loadAudioSrc, hideAudioPlayer, initAudioPlayerControls } from './audioPlayer.js';

const PREPARATION_PHASE_TYPE = 'preparation';
const COMPLETE_PHASE_ID = 'COMPLETE';
const INSTRUCTIONS_PHASE_ID = 'INSTRUCTIONS';

// All 3 REST screens (phaseType 'recovery') plus RECOVERY_AFTER_MOTOR_INFO
// (phaseType 'recovery-info', the count-back-only -> dual-task transition
// procedure shown right after the first REST) now have narration mapped.
// Any phase not listed here gets no audio player at all (see
// hideAudioPlayer('recovery') below). Keyed by phase.phaseId, same as
// before - the code path that reads this map (see the onPhaseChange
// subscription below) already runs for every phase change regardless of
// phaseType, so RECOVERY_AFTER_MOTOR_INFO needed no new code of its own,
// just this one additional entry.
const RECOVERY_AUDIO_FILE_BY_PHASE_ID = {
    RECOVERY_AFTER_MOTOR: '/audio/experiment/recovery-after-motor.mp3',
    RECOVERY_AFTER_MOTOR_INFO: '/audio/experiment/rest-counting-clicking.mp3',
    RECOVERY_AFTER_DUAL_3: '/audio/experiment/recovery-after-dual-3.mp3',
    RECOVERY_AFTER_DUAL_7: '/audio/experiment/recovery-after-dual-7.mp3'
};

// Task-status pills - only shown for phases where more than one task
// modality could plausibly be active at once (currently just 'dual-task';
// 'motor' keeps a single "Click targets" pill for consistency). The
// count-back-only screen ('cognitive') never shows these - it has exactly
// one thing happening (counting aloud) and no toggle-able status to report.
const PILL_ELIGIBLE_PHASE_TYPES = new Set(['motor', 'dual-task']);

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
    const prepCountdownHeading = document.getElementById('prepCountdownHeading');
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

    // recovery-info's audio/timer synchronization (see
    // experimentController.js#_enterPhase's own comment on why
    // recovery-info now routes through onRecoveryReady instead of
    // advance()-ing directly): at most one 'ended' listener is ever pending
    // at a time (recovery-info occurs exactly once per session), but it's
    // still explicitly cleared whenever it's no longer relevant - either
    // because it fired, or because the participant early-skipped before it
    // did - so a later, unrelated phase's audio finishing naturally can
    // never be mistaken for this one and trigger a spurious advance.
    let pendingRecoveryInfoAudioEndedListener = null;

    function clearPendingRecoveryInfoAudioEndedListener() {
        if (pendingRecoveryInfoAudioEndedListener) {
            document.getElementById('recoveryAudioPlayer').removeEventListener('ended', pendingRecoveryInfoAudioEndedListener);
            pendingRecoveryInfoAudioEndedListener = null;
        }
    }

    // Fires only when a recovery/recovery-info phase's timer reaches zero
    // (see experimentController.js#onRecoveryReady) - never a real phase
    // change, so this only ever needs to reveal the button (or, for
    // recovery-info, decide when to proceed), not re-render anything else
    // (which would otherwise reset the just-finished countdown display back
    // to its starting value).
    controller.onRecoveryReady((phase) => {
        if (!phase) {
            return;
        }
        if (phase.phaseType === 'recovery') {
            recoveryProceedBtn.hidden = false;
            recoveryProceedBtn.disabled = false;
            return;
        }
        if (phase.phaseType === 'recovery-info') {
            // The configured duration/timer already fully elapsed by the
            // time this fires (unchanged from before - see
            // experimentController.js) - this only decides the moment
            // proceedFromRecovery() actually runs, never whether or how
            // long the timer itself ran. If the narration audio is
            // genuinely still playing right now, wait for it to finish
            // naturally instead of cutting it off; otherwise (already
            // finished, never started, or autoplay didn't fire) proceed
            // immediately - identical to the old "timer ends -> advance"
            // behavior for every case that isn't "audio outlasted the
            // timer."
            const player = document.getElementById('recoveryAudioPlayer');
            if (player.paused) {
                controller.proceedFromRecovery();
                return;
            }
            clearPendingRecoveryInfoAudioEndedListener();
            pendingRecoveryInfoAudioEndedListener = () => {
                pendingRecoveryInfoAudioEndedListener = null;
                controller.proceedFromRecovery();
            };
            player.addEventListener('ended', pendingRecoveryInfoAudioEndedListener, { once: true });
        }
    });

    recoveryProceedBtn.addEventListener('click', () => {
        // Disable/hide immediately, before the controller call even
        // returns - this is the UI-side half of the "advance exactly
        // once" guarantee (experimentController.js#proceedFromRecovery is
        // the other half, via its own _recoveryReadyToProceed flag). A
        // second click on an already-hidden, already-disabled button
        // cannot dispatch another click event at all.
        recoveryProceedBtn.disabled = true;
        recoveryProceedBtn.hidden = true;

        // RECOVERY_AFTER_MOTOR_INFO (phaseType 'recovery-info', shown only
        // right after RECOVERY_AFTER_MOTOR) makes this button available
        // from the moment the phase starts, purely as an early-skip - the
        // participant can jump ahead at any time, even before the timer
        // (and thus before any audio-completion wait above) would
        // otherwise proceed on their own. It still calls advance()
        // directly rather than proceedFromRecovery() (which only takes
        // effect once the timer has genuinely finished - see that
        // method's own comment) - an early-skip is explicitly allowed to
        // cut in before that. Clearing the pending audio-ended listener
        // here prevents it from later firing against whatever unrelated
        // phase's audio happens to finish next.
        const currentPhase = controller.getCurrentPhase();
        if (currentPhase && currentPhase.phaseType === 'recovery-info') {
            clearPendingRecoveryInfoAudioEndedListener();
            controller.advance();
            return;
        }

        controller.proceedFromRecovery();
    });

    controller.onPhaseTick((remainingSeconds, phase) => {
        if (!phase) {
            return;
        }

        if (phase.phaseType === PREPARATION_PHASE_TYPE && (phase.precedesPhaseType === 'motor' || phase.precedesPhaseType === 'cognitive')) {
            prepCountdownValue.textContent = formatCountdownValue(countdownSequenceFor(phase.precedesPhaseType), remainingSeconds, phase.duration);
            return;
        }

        if (!timerBadge.hidden) {
            timerValue.textContent = formatTime(remainingSeconds);
        }

        if (phase.phaseType === PREPARATION_PHASE_TYPE) {
            updatePopCountdown(remainingSeconds, phase);
        }
    });

    // Dual-task transition (precedesPhaseType "dual-task"): pops a big
    // 3/2/1 in the lead-in's final 3 seconds - purely a visual addition,
    // this phase's duration/advance timing is entirely unaffected (still
    // driven only by the phase's own Timer, same as every other phase).
    // Re-triggers the "pop" animation every tick (remove -> forced reflow
    // -> re-add), since the class staying applied across ticks wouldn't
    // replay the animation. 'cognitive' no longer uses this - its own
    // lead-in is a full digit countdown instead (see prepCountdown above).
    function updatePopCountdown(remainingSeconds, phase) {
        const appliesToThisLeadIn = phase.precedesPhaseType === 'dual-task';
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

        // The topbar's only content besides the timer badge is the
        // eyebrow, and eyebrow is only ever set alongside showTimer: true
        // (see phaseCopy.js#getRecoveryDisplay) - so whenever showTimer is
        // false (PREPARE_MOTOR_BASELINE/PREPARE_SUBTRACTION_<n>, both of
        // whose lead-in is a digit countdown instead of a running timer),
        // the topbar box itself would otherwise render as an empty
        // bordered strip with nothing in it. Hiding it here covers both
        // fullscreen (motor) and non-fullscreen (count-back-only) cases.
        experimentTopbar.hidden = !display.showTimer;

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
            const emphasized = display.emphasizedParagraphs || [];
            display.paragraphs.forEach((paragraph, index) => {
                const p = document.createElement('p');
                if (emphasized.includes(index)) {
                    const strong = document.createElement('strong');
                    strong.textContent = paragraph;
                    p.appendChild(strong);
                } else {
                    p.textContent = paragraph;
                }
                taskParagraphs.appendChild(p);
            });
            show(taskParagraphs);
        } else {
            hide(taskParagraphs);
            hide(transitionLines);
            taskInstruction.textContent = display.instruction;
            if (display.instruction) {
                show(taskInstruction);
            } else {
                hide(taskInstruction);
            }
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
            prepCountdownHeading.textContent = phase.precedesPhaseType === 'motor' ? 'Begin clicking in' : 'Begin counting in';
            prepCountdownValue.textContent = formatCountdownValue(countdownSequenceFor(phase.precedesPhaseType), phase.duration, phase.duration);
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

// Both digit-countdown lead-ins (clicking-only and count-back-only) count
// down through their own fixed sequence - MOTOR_COUNTDOWN_SEQUENCE (10, 9,
// ..., 1, 0) or SUBTRACTION_PREP_COUNTDOWN_SEQUENCE (3, 2, 1, 0) - one
// entry per second of the phase's own duration
// (motorBaselineCountdownSeconds/preCountingTransitionSeconds), indexed by
// how much of it has elapsed. There is no "BEGIN" moment here: the real
// task itself starts the instant 0's own second ends.
function countdownSequenceFor(precedesPhaseType) {
    return precedesPhaseType === 'motor' ? MOTOR_COUNTDOWN_SEQUENCE : SUBTRACTION_PREP_COUNTDOWN_SEQUENCE;
}

function formatCountdownValue(sequence, remainingSeconds, duration) {
    const index = duration - remainingSeconds;
    const value = sequence[index];
    return value != null ? String(value) : '';
}
