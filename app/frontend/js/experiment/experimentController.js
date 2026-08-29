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
import { CognitiveAudioSession } from '../cognitive/cognitiveAudioSession.js';
import {
    createSession,
    startPhaseRecord,
    endPhaseRecord,
    recordMousePerformance,
    recordCognitiveProcessingPending,
    recordCognitivePerformance,
    recordCognitiveProcessingFailed,
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
                // No targetSpawnIntervalMs override here - the task always
                // uses mouse/mouseTask.js's TARGET_SPAWN_INTERVAL_MS
                // default. (difficultyLevel used to be threaded through
                // here for the same purpose; mouseTaskConfig.defaultDifficulty
                // is no longer read by the live spawn timer.)
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
        cognitiveAudioSessionFactory = (options) => new CognitiveAudioSession(options),
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
        this._cognitiveAudioSessionFactory = cognitiveAudioSessionFactory;
        this._logger = logger;
        this._participantId = participantId;

        this._phaseSequence = buildPhaseSequence(config);
        this._fsm = new PhaseStateMachine(this._phaseSequence);

        this._session = null;
        this._currentPhaseRecord = null;
        this._currentTimer = null;
        this._currentSubtractionTask = null;
        this._currentCognitiveAudioSession = null;
        this._lastStartingNumber = null;
        this._conditionStartingNumbers = {};

        // Every in-flight recording upload/transcription/scoring promise
        // for this session, in phase order - NEVER awaited here (that would
        // block phase timing). ui/resultsScreen.js awaits all of these
        // before showing final cognitive results/enabling export - see
        // getPendingCognitiveProcessing().
        this._pendingCognitiveProcessing = [];

        // True only while the CURRENT phase is a recovery phase whose timer
        // has already reached zero, but the participant has not yet clicked
        // Proceed (see advance()'s docstring on why recovery is the one
        // phaseType that no longer auto-advances on its own timer). Reset
        // to false on every _enterPhase() - including the recovery phase's
        // own entry, before its timer even starts - so it can only ever be
        // true after that specific phase's timer has genuinely finished.
        this._recoveryReadyToProceed = false;

        this._phaseChangeListeners = new Set();
        this._phaseTickListeners = new Set();
        this._recoveryReadyListeners = new Set();
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

    // Fires exactly once per recovery phase, the moment its timer reaches
    // zero (never for any other phaseType). This is deliberately a
    // separate notification from onPhaseChange - the phase itself has NOT
    // changed at this point (the participant is still looking at the same
    // recovery screen, just now with a Proceed button available), so
    // re-firing onPhaseChange here would cause every phase-change listener
    // (timer badge, prep countdown, etc.) to needlessly re-render as if a
    // new phase had started, resetting the visible countdown display back
    // to its starting value instead of showing 00:00.
    onRecoveryReady(listener) {
        this._recoveryReadyListeners.add(listener);
        return () => this._recoveryReadyListeners.delete(listener);
    }

    _notifyRecoveryReady() {
        for (const listener of this._recoveryReadyListeners) {
            listener(this.getCurrentPhase(), this);
        }
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
        this._pendingCognitiveProcessing = [];
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
    // the participant is ready to proceed. Recovery phases (phaseType
    // 'recovery') are a third case: they DO have a real countdown timer
    // (unchanged - see _enterPhase below) that runs for its full
    // configured duration, but reaching zero does not call advance()
    // automatically - see proceedFromRecovery(), which is the only thing
    // that does, and only once the timer has actually finished.
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
        this._recoveryReadyToProceed = false;

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
            // timing) - full-phase audio recording (see
            // cognitive/cognitiveAudioSession.js). Started and stopped on
            // exactly the same cognitiveActive gate, so the microphone is
            // active only during SUBTRACTION_<n>/DUAL_TASK_<n> and never
            // during preparation, recovery, instructions, the motor-only
            // baseline, or COMPLETE.
            this._currentCognitiveAudioSession = this._cognitiveAudioSessionFactory({
                subtractionValue: phaseDescriptor.subtractionValue,
                startingNumber: extra.startingNumber,
                scoringMode: this._config.cognitiveScoringMode,
                expectedResponseDigits: this._config.expectedResponseDigits,
                participantCode: this._session.participantCode,
                sessionId: this._session.sessionId,
                experimentId: this._session.experimentId,
                sessionDate: this._session.sessionDate,
                phaseId: phaseDescriptor.phaseId,
                phaseType: phaseDescriptor.phaseType,
                duration: phaseDescriptor.duration,
                logger: this._logger
            });
            this._currentCognitiveAudioSession.start();
        } else {
            this._currentSubtractionTask = null;
            this._currentCognitiveAudioSession = null;
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
            const isRecovery = phaseDescriptor.phaseType === 'recovery';
            this._currentTimer = this._timerFactory({
                // Recovery: the countdown itself is completely unchanged
                // (same duration, same per-second ticks via onTick below) -
                // only what happens the instant it reaches zero differs.
                // Every other timed phase keeps the original
                // "timer ends -> advance immediately" behavior.
                onComplete: () => {
                    if (isRecovery) {
                        this._recoveryReadyToProceed = true;
                        this._currentTimer = null;
                        this._notifyRecoveryReady();
                    } else {
                        this.advance();
                    }
                },
                onTick: (remainingSeconds) => this._notifyPhaseTick(remainingSeconds)
            });
            this._currentTimer.start(phaseDescriptor.duration);
            this._notifyPhaseTick(phaseDescriptor.duration);
        } else {
            this._currentTimer = null;
        }
    }

    // The only thing that may advance past a recovery phase - called by the
    // UI when the participant clicks "Proceed", and ONLY takes effect if
    // this recovery phase's timer has genuinely already reached zero
    // (isRecoveryReadyToProceed() below is what the UI gates the button's
    // very existence on, so this guard is a second, independent line of
    // defense, not the only one). Clears the ready flag BEFORE calling
    // advance(), so a duplicate/double-click (or two rapid calls for any
    // other reason) can only ever advance once - the second call sees the
    // flag already false and is a no-op.
    proceedFromRecovery() {
        if (!this._recoveryReadyToProceed) {
            return false;
        }
        this._recoveryReadyToProceed = false;
        this.advance();
        return true;
    }

    // Whether the current phase is a recovery phase whose timer has already
    // finished - i.e. whether the UI should be showing an enabled Proceed
    // button right now. Always false for every other phaseType, and false
    // for a recovery phase whose timer is still counting down.
    isRecoveryReadyToProceed() {
        return this._recoveryReadyToProceed;
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
        if (this._currentCognitiveAudioSession) {
            const session = this._currentCognitiveAudioSession;
            const phaseRecordForResults = this._currentPhaseRecord;
            if (phaseRecordForResults) {
                recordCognitiveProcessingPending(phaseRecordForResults);
            }

            // session.stop() finalizes the recording and uploads it, but is
            // DELIBERATELY NOT awaited here - transcription/scoring latency
            // must never delay advancing to the next phase (experiment
            // timing is unchanged - see phaseStateMachine.js/Timer above,
            // both of which have already moved on by the time this
            // resolves). The promise is tracked so
            // getPendingCognitiveProcessing() (used by ui/resultsScreen.js)
            // can wait for every phase's results before the participant
            // sees final scores/exports them.
            const processingPromise = session.stop().then((result) => {
                if (!phaseRecordForResults) {
                    return;
                }
                if (result && result.status === 'succeeded') {
                    recordCognitivePerformance(phaseRecordForResults, result.results);
                } else {
                    recordCognitiveProcessingFailed(phaseRecordForResults, result && result.error);
                }
            }).catch((error) => {
                this._logger(`${phaseDescriptor.phaseId}: cognitive audio processing failed - ${error.message}`);
                if (phaseRecordForResults) {
                    recordCognitiveProcessingFailed(phaseRecordForResults, error.message);
                }
            });
            this._pendingCognitiveProcessing.push(processingPromise);
            this._currentCognitiveAudioSession = null;
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

    // The current phase's live CognitiveAudioSession, if the microphone is
    // actually supposed to be recording right now - null under the exact
    // same conditions as getCurrentSubtractionTask() above (i.e. whenever
    // cognitiveActive is false for the current phase).
    getCurrentCognitiveAudioSession() {
        return this._currentCognitiveAudioSession;
    }

    // Every recording upload/transcription/scoring promise still in flight
    // across the whole session so far - see _exitPhase() above.
    // ui/resultsScreen.js awaits all of these (Promise.allSettled) before
    // showing final cognitive results or enabling Excel export, without
    // ever having delayed the experiment itself to get here.
    getPendingCognitiveProcessing() {
        return [...this._pendingCognitiveProcessing];
    }

    getSession() {
        return this._session;
    }

    isComplete() {
        return this._fsm.isComplete();
    }
}
