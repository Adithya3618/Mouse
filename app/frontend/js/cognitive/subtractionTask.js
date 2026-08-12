// Data/state model for one serial-subtraction task instance (e.g. "count
// back by 7 from 892"). The participant performs the arithmetic aloud;
// this class does not check answers or listen for speech - it only tracks
// which subtraction task is active and when it started/stopped, so the
// experiment controller and future UI have something concrete to bind to.

export class SubtractionTask {
    constructor({ subtractionValue, startingNumber, duration }) {
        this.subtractionValue = subtractionValue;
        this.startingNumber = startingNumber;
        this.duration = duration;
        this.startedAt = null;
        this.endedAt = null;
        this._running = false;
    }

    start() {
        this.startedAt = new Date();
        this.endedAt = null;
        this._running = true;
    }

    stop() {
        this.endedAt = new Date();
        this._running = false;
    }

    reset() {
        this.startedAt = null;
        this.endedAt = null;
        this._running = false;
    }

    isRunning() {
        return this._running;
    }
}
