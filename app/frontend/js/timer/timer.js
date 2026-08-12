// Generic countdown/formatting utilities used by the experiment flow.
// No knowledge of experiment phases lives here on purpose - see
// experiment/experimentController.js for what happens when a countdown ends.

export function formatTime(seconds) {
    let minutes = Math.floor(seconds / 60);
    let remainingSeconds = seconds % 60;

    minutes = (minutes < 10 ? '0' : '') + minutes;
    remainingSeconds = (remainingSeconds < 10 ? '0' : '') + remainingSeconds;

    return `${minutes}:${remainingSeconds}`;
}

// Ticks a countdown down to zero once per second, optionally reflecting the
// remaining time into `displayEl`. Calls `onComplete` when it hits zero.
export function runCountdown(seconds, { displayEl, onTick, onComplete } = {}) {
    let remaining = seconds;

    if (displayEl) {
        displayEl.style.display = 'block';
        displayEl.textContent = remaining;
    }

    const intervalId = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
            clearInterval(intervalId);
            if (displayEl) {
                displayEl.style.display = 'none';
            }
            if (onComplete) {
                onComplete();
            }
        } else {
            if (displayEl) {
                displayEl.textContent = remaining;
            }
            if (onTick) {
                onTick(remaining);
            }
        }
    }, 1000);

    return intervalId;
}

// A reusable, generic phase timer. Unlike runCountdown() above (which is
// tied to the legacy 3-session controller's countdown display), Timer has
// no DOM/display coupling and no idea what a "phase" is - it just counts
// seconds and calls back. This is what experimentController.js uses.
//
// `msPerSecond` lets tests run a 120-"second" phase in well under a second
// of real time by injecting a tiny value, without faking or skipping the
// timer's actual countdown logic.
export class Timer {
    constructor({ onTick, onComplete, msPerSecond = 1000 } = {}) {
        this._onTick = onTick;
        this._onComplete = onComplete;
        this._msPerSecond = msPerSecond;
        this._remainingSeconds = 0;
        this._intervalId = null;
        this._running = false;
    }

    start(durationSeconds) {
        this.stop();
        this._remainingSeconds = durationSeconds;
        this._running = true;
        this._scheduleTick();
    }

    pause() {
        if (this._running) {
            this._clearTimer();
            this._running = false;
        }
    }

    resume() {
        if (!this._running && this._remainingSeconds > 0) {
            this._running = true;
            this._scheduleTick();
        }
    }

    stop() {
        this._clearTimer();
        this._running = false;
        this._remainingSeconds = 0;
    }

    reset(durationSeconds) {
        this.stop();
        if (durationSeconds != null) {
            this._remainingSeconds = durationSeconds;
        }
    }

    getRemainingSeconds() {
        return this._remainingSeconds;
    }

    isRunning() {
        return this._running;
    }

    _scheduleTick() {
        this._intervalId = setInterval(() => {
            this._remainingSeconds -= 1;
            if (this._remainingSeconds <= 0) {
                this._remainingSeconds = 0;
                this._clearTimer();
                this._running = false;
                if (this._onTick) {
                    this._onTick(0);
                }
                if (this._onComplete) {
                    this._onComplete();
                }
            } else if (this._onTick) {
                this._onTick(this._remainingSeconds);
            }
        }, this._msPerSecond);
    }

    _clearTimer() {
        if (this._intervalId !== null) {
            clearInterval(this._intervalId);
            this._intervalId = null;
        }
    }
}
