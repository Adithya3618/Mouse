// Experiment controller for the Motor-Cognitive Dual-Task experiment.
//
// This is the new file at this path - the original 3-session motor-only
// controller that used to live here now lives in
// legacyMotorOnlyController.js (still wired up in app.js, still driving
// the existing live application unchanged).
//
// This controller does NOT touch the DOM and is not wired into index.html
// yet (that is the next phase). It is exercised directly by the test suite
// under tests/experiment/, using dependency injection (a fast Timer, a
// fake mouse-task adapter) instead of real waits - see
// tests/experiment/experimentController.test.mjs.
//
// State machine: WELCOME (idle, before start()) -> the sequence produced
// by phases.js#buildPhaseSequence (INSTRUCTIONS ... COMPLETE). No nested
// if/else chains drive the sequence itself - PhaseStateMachine just walks
// the ordered list; this class's job is wiring each phase to a timer, a
// subtraction task, the mouse task, and the session data record.

import { PhaseStateMachine } from './phaseStateMachine.js';
import { buildPhaseSequence, PhaseId } from './phases.js';
import { Timer } from '../timer/timer.js';
import { generateStartingNumber } from '../cognitive/randomNumber.js';
import { SubtractionTask } from '../cognitive/subtractionTask.js';
import { CognitiveSpeechSession } from '../cognitive/cognitiveSpeechSession.js';
import {
    createSession,
    startPhaseRecord,
    endPhaseRecord,
    recordMousePerformance,
    recordCognitivePerformance,
    endSession
} from '../data/sessionData.js';

const defaultLogger = (message) => console.log(`[EXPERIMENT] ${message}`);

// The DOM containers mouse/mouseTask.js#runMouseSession requires. Whatever
// screen renders a mouse-active phase (Motor Baseline, Dual Task 3/7/17)
// needs to provide elements with these ids before that phase starts.
const MOUSE_TASK_ELEMENT_IDS = {
    gameScreenContainer: 'gameScreen',
    gameContainer: 'game',
    timerElement: 'timeLeft',
    endingElement: 'ending',
    startButtonElement: 'start'
};

function getMouseTaskElements() {
    if (typeof document === 'undefined') {
        return null; // no DOM at all (e.g. running under Node)
    }
    const elements = {};
    for (const [key, id] of Object.entries(MOUSE_TASK_ELEMENT_IDS)) {
        const el = document.getElementById(id);
        if (!el) {
            return null; // this phase's screen hasn't been built yet
        }
        elements[key] = el;
    }
    return elements;
}

// The existing mouse task (app/frontend/js/mouse/*) is DOM-driven and is
// not wired to every screen yet. This default adapter is the "clean
// integration interface": it checks whether the current phase's screen has
// actually mounted the mouse task's containers before touching them. If
// not (e.g. the Motor Baseline/Dual Task screens haven't been built yet),
// it logs one clear line and does nothing further - it does NOT throw and
// does NOT call onComplete early. The phase's own Timer (set up in
// _enterPhase, independently of this adapter) is what advances the
// experiment; this adapter has no ability to do that itself.
const defaultMouseTaskAdapter = {
    async start(phaseDescriptor, onComplete, { logger = defaultLogger } = {}) {
        const elements = getMouseTaskElements();
        if (!elements) {
            logger(`${phaseDescriptor.phaseId}: mouse task screen not built yet - skipping mouse task for this phase.`);
            return;
        }

        const { playMouseSession } = await import('../mouse/mouseSession.js');
        const { mouseTaskConfig } = await import('/config/mouseTaskConfig.js');

        playMouseSession(
            {
                ...elements,
                cursorType: mouseTaskConfig.cursorType,
                bgColor: mouseTaskConfig.backgroundColor,
                targetColor: mouseTaskConfig.targetColor,
                targetSize: mouseTaskConfig.targetSizePx,
                difficultyLevel: mouseTaskConfig.defaultDifficulty,
                durationMs: phaseDescriptor.duration * 1000
            },
            onComplete
        );
    },
    stop() {
        // The existing mouse task always runs for its full configured
        // duration and reports back via its own completion callback (see
        // mouse/mouseTask.js) - it has no "stop early" hook to preserve.
        // This method exists so the controller has a consistent interface
        // to call once that capability exists; it is intentionally a
        // no-op for now.
    }
};

export class ExperimentController {
    constructor({
        config,
        timerFactory = (callbacks) => new Timer(callbacks),
        mouseTaskAdapter = defaultMouseTaskAdapter,
        randomNumberGenerator = generateStartingNumber,
        cognitiveSpeechSessionFactory = (options) => new CognitiveSpeechSession(options),
        logger = defaultLogger,
        participantId = null
    } = {}) {
        if (!config) {
            throw new Error('ExperimentController requires a config (see config/experimentConfig.js).');
        }

        this._config = config;
        this._timerFactory = timerFactory;
        this._mouseTaskAdapter = mouseTaskAdapter;
        this._randomNumberGenerator = randomNumberGenerator;
        this._cognitiveSpeechSessionFactory = cognitiveSpeechSessionFactory;
        this._logger = logger;
        this._participantId = participantId;

        this._phaseSequence = buildPhaseSequence(config);
        this._fsm = new PhaseStateMachine(this._phaseSequence);

        this._session = null;
        this._currentPhaseRecord = null;
        this._currentTimer = null;
        this._currentSubtractionTask = null;
        this._currentCognitiveSpeechSession = null;
        this._lastStartingNumber = null;
        this._conditionStartingNumbers = {};

        this._phaseChangeListeners = new Set();
        this._phaseTickListeners = new Set();
    }

    // --- subscriptions -------------------------------------------------
    //
    // The UI must not just read the phase once and cache it - every screen
    // needs to re-render whenever the controller actually changes phase
    // (including automatic, timer-driven transitions the UI didn't
    // initiate itself). These are the hooks for that. Both return an
    // unsubscribe function.

    onPhaseChange(listener) {
        this._phaseChangeListeners.add(listener);
        return () => this._phaseChangeListeners.delete(listener);
    }

    onPhaseTick(listener) {
        this._phaseTickListeners.add(listener);
        return () => this._phaseTickListeners.delete(listener);
    }

    _notifyPhaseChange() {
        const phase = this.getCurrentPhase();
        for (const listener of this._phaseChangeListeners) {
            listener(phase, this);
        }
    }

    _notifyPhaseTick(remainingSeconds) {
        const phase = this.getCurrentPhase();
        for (const listener of this._phaseTickListeners) {
            listener(remainingSeconds, phase, this);
        }
    }

    // --- lifecycle ---------------------------------------------------

    initialize({ participantCode = null, sessionDate = null } = {}) {
        this._session = createSession({
            participantId: this._participantId,
            participantCode,
            sessionDate
        });
        this._fsm.reset();
        this._lastStartingNumber = null;
        this._conditionStartingNumbers = {};
        this._logger(`Experiment initialized (session ${this._session.sessionId})`);
        return this._session;
    }

    start() {
        if (!this._session) {
            this.initialize();
        }
        const firstPhase = this._fsm.start();
        this._enterPhase(firstPhase);
        return firstPhase;
    }

    // Moves from the current phase to the next one. Timed phases call this
    // automatically when their Timer completes; untimed phases
    // (INSTRUCTIONS) must have this called explicitly once the UI decides
    // the participant is ready to proceed.
    advance() {
        const finishedPhase = this._fsm.current();
        if (!finishedPhase) {
            return null; // start() was never called
        }

        this._exitPhase(finishedPhase);

        const nextPhase = this._fsm.next();
        if (!nextPhase) {
            return null; // already past the last phase
        }

        this._enterPhase(nextPhase);

        if (nextPhase.phaseId === PhaseId.COMPLETE) {
            // COMPLETE is a terminal marker with no duration/timer - close
            // it out immediately instead of waiting for a timer that will
            // never fire.
            this._exitPhase(nextPhase);
            endSession(this._session);
            this._logger('Experiment complete');
        }

        return nextPhase;
    }

    // --- phase enter/exit ---------------------------------------------------

    _enterPhase(phaseDescriptor) {
        const extra = {};

        // The starting number is generated as soon as the subtraction
        // value is known - including during PREPARE_SUBTRACTION_<n>/
        // PREPARE_DUAL_TASK_<n>, so the "get ready" screen can display it
        // (see phaseCopy.js). Starting the SubtractionTask itself (real
        // cognitive-task timing) is gated separately on cognitiveActive,
        // so it does NOT start during preparation - only once the actual
        // SUBTRACTION_<n>/DUAL_TASK_<n> phase begins.
        if (phaseDescriptor.subtractionValue != null) {
            extra.startingNumber = this._getOrCreateStartingNumber(phaseDescriptor.subtractionValue);
        }

        if (phaseDescriptor.cognitiveActive && extra.startingNumber != null) {
            this._currentSubtractionTask = new SubtractionTask({
                subtractionValue: phaseDescriptor.subtractionValue,
                startingNumber: extra.startingNumber,
                duration: phaseDescriptor.duration
            });
            this._currentSubtractionTask.start();

            // Independent of SubtractionTask above (which only tracks
            // timing) - the microphone/live-transcript system. Started and
            // stopped on exactly the same cognitiveActive gate, so speech
            // recognition is active only during SUBTRACTION_<n>/
            // DUAL_TASK_<n> and never during preparation, recovery,
            // instructions, the motor-only baseline, or COMPLETE.
            this._currentCognitiveSpeechSession = this._cognitiveSpeechSessionFactory({
                subtractionValue: phaseDescriptor.subtractionValue,
                startingNumber: extra.startingNumber,
                scoringMode: this._config.cognitiveScoringMode,
                logger: this._logger
            });
            this._currentCognitiveSpeechSession.start();
        } else {
            this._currentSubtractionTask = null;
            this._currentCognitiveSpeechSession = null;
        }

        this._currentPhaseRecord = startPhaseRecord(this._session, phaseDescriptor, extra);
        this._logger(`${phaseDescriptor.phaseId} started`);
        this._notifyPhaseChange();

        if (phaseDescriptor.mouseActive) {
            // Captured now rather than read as this._currentPhaseRecord
            // inside the callback below: by the time the mouse task
            // finishes (its own real-time duration, started independently
            // of this phase's Timer), _exitPhase() may already have
            // cleared this._currentPhaseRecord. Closing over the actual
            // record object sidesteps that race entirely.
            const phaseRecordForMouseResults = this._currentPhaseRecord;

            // Intentionally not awaited: the mouse task's own lifecycle
            // must never gate phase advancement - only this phase's Timer
            // (below) is allowed to call advance(). Any failure here is
            // caught and logged, never left as an unhandled rejection and
            // never able to affect timing.
            Promise.resolve(
                this._mouseTaskAdapter.start(
                    phaseDescriptor,
                    (result) => {
                        recordMousePerformance(phaseRecordForMouseResults, {
                            totalTargets: result.numberOfTargets,
                            totalClicks: result.clickCount,
                            totalHits: result.hitCount
                        });
                    },
                    { logger: this._logger }
                )
            ).catch((error) => this._logger(`${phaseDescriptor.phaseId}: mouse task adapter failed - ${error.message}`));
        }

        if (phaseDescriptor.duration != null) {
            this._currentTimer = this._timerFactory({
                onComplete: () => this.advance(),
                onTick: (remainingSeconds) => this._notifyPhaseTick(remainingSeconds)
            });
            this._currentTimer.start(phaseDescriptor.duration);
            this._notifyPhaseTick(phaseDescriptor.duration);
        } else {
            this._currentTimer = null;
        }
    }

    _exitPhase(phaseDescriptor) {
        if (this._currentTimer) {
            this._currentTimer.stop();
            this._currentTimer = null;
        }
        if (phaseDescriptor.mouseActive) {
            this._mouseTaskAdapter.stop();
        }
        if (this._currentSubtractionTask) {
            this._currentSubtractionTask.stop();
            this._currentSubtractionTask = null;
        }
        if (this._currentCognitiveSpeechSession) {
            // Stop first, then read results - stop() closes out
            // phaseEndTime and halts the microphone before we snapshot the
            // final transcript/scoring onto this phase's record.
            this._currentCognitiveSpeechSession.stop();
            if (this._currentPhaseRecord) {
                recordCognitivePerformance(this._currentPhaseRecord, this._currentCognitiveSpeechSession.getResults());
            }
            this._currentCognitiveSpeechSession = null;
        }
        if (this._currentPhaseRecord) {
            endPhaseRecord(this._currentPhaseRecord);
            this._currentPhaseRecord = null;
        }
        this._logger(`${phaseDescriptor.phaseId} completed`);
    }

    // A new random number is generated the first time a given subtraction
    // value is encountered (during SUBTRACTION_<n>) and reused for that
    // same condition's DUAL_TASK_<n> phase. It is guaranteed to differ
    // from the previous condition's number.
    _getOrCreateStartingNumber(subtractionValue) {
        if (this._conditionStartingNumbers[subtractionValue] == null) {
            const number = this._randomNumberGenerator(
                this._config.randomStartingNumberRange,
                this._lastStartingNumber
            );
            this._conditionStartingNumbers[subtractionValue] = number;
            this._lastStartingNumber = number;
        }
        return this._conditionStartingNumbers[subtractionValue];
    }

    // --- reporting hooks -------------------------------------------------

    // Lets the (future) mouse task report its results into whichever phase
    // is currently active and mouse-active. Throws if called at the wrong
    // time, since that would silently attribute performance to the wrong
    // condition.
    reportMousePerformance({ totalTargets, totalClicks, totalHits }) {
        if (!this._currentPhaseRecord || !this._currentPhaseRecord.mouseActive) {
            throw new Error('reportMousePerformance() called while no mouse-active phase is running.');
        }
        return recordMousePerformance(this._currentPhaseRecord, { totalTargets, totalClicks, totalHits });
    }

    // --- introspection -------------------------------------------------

    getCurrentPhaseId() {
        const phase = this._fsm.current();
        return phase ? phase.phaseId : PhaseId.WELCOME;
    }

    getCurrentPhase() {
        return this._fsm.current();
    }

    // The current phase's session record - this is where the UI reads the
    // starting number for the current condition (static phase descriptors
    // from phases.js never carry it; it's generated per-session).
    getCurrentPhaseRecord() {
        return this._currentPhaseRecord;
    }

    // The current phase's live SubtractionTask, if cognitive timing is
    // actually running right now - null during preparation, recovery, the
    // motor-only baseline, or any other phase where cognitiveActive is
    // false, even if a subtractionValue/startingNumber is already known.
    getCurrentSubtractionTask() {
        return this._currentSubtractionTask;
    }

    // The current phase's live CognitiveSpeechSession, if the microphone
    // is actually supposed to be listening right now - null under the
    // exact same conditions as getCurrentSubtractionTask() above (i.e.
    // whenever cognitiveActive is false for the current phase).
    getCurrentCognitiveSpeechSession() {
        return this._currentCognitiveSpeechSession;
    }

    getSession() {
        return this._session;
    }

    isComplete() {
        return this._fsm.isComplete();
    }
}
