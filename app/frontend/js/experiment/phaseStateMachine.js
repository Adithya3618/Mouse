// A minimal, generic finite-state machine over an ordered list of phase
// descriptors. It only tracks "where are we in the sequence" - it knows
// nothing about timers, mouse tasks, or subtraction. This is what keeps
// experimentController.js from turning into nested if/else statements.

export class PhaseStateMachine {
    constructor(phaseSequence) {
        if (!Array.isArray(phaseSequence) || phaseSequence.length === 0) {
            throw new Error('PhaseStateMachine requires a non-empty phase sequence.');
        }
        this._sequence = phaseSequence;
        this._index = -1; // -1 = not started yet (the controller's WELCOME state)
    }

    hasStarted() {
        return this._index >= 0;
    }

    current() {
        return this.hasStarted() ? this._sequence[this._index] : null;
    }

    hasNext() {
        return this._index < this._sequence.length - 1;
    }

    start() {
        this._index = 0;
        return this.current();
    }

    next() {
        if (!this.hasNext()) {
            return null;
        }
        this._index += 1;
        return this.current();
    }

    isComplete() {
        return this.hasStarted() && !this.hasNext();
    }

    reset() {
        this._index = -1;
    }
}
