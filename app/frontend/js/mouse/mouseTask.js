// The mouse-accuracy task engine: spawns targets for a fixed duration,
// tracks raw clicks/hits/targets, and reports them back when time is up.
// This module only knows about the mouse task itself - session bookkeeping
// and scoring live in mouseSession.js/scoring.js.

import { spawnTarget } from './target.js';
import { formatTime } from '../timer/timer.js';

// How often a new target appears, in ms. THE single place to adjust this
// task's pace - everything below reads only this constant (or an explicit
// override passed to runMouseSession), never a separate hardcoded interval.
//
// Previously there was no dedicated spawn-rate constant at all: the
// interval was `difficultyLevel * 1000` (1000ms at the old default
// difficulty of 1), which meant "how fast targets spawn" was only
// reachable by tracing a value through config/mouseTaskConfig.js's
// `defaultDifficulty` and a multiplication buried in this file. 1750ms
// sits in the middle of the requested ~1.5-2s "noticeably slower, more
// consistent pace."
export const TARGET_SPAWN_INTERVAL_MS = 1750;

export function runMouseSession({
    gameScreenContainer,
    gameContainer,
    timerElement,
    endingElement,
    startButtonElement,
    cursorType,
    bgColor,
    targetColor,
    targetSize,
    targetSpawnIntervalMs = TARGET_SPAWN_INTERVAL_MS,
    durationMs,
    onComplete,
    // Test-only seams (all default to the real browser/task behavior, so
    // no caller in the running app needs to change) - see
    // tests/mouse/mouseTask.test.mjs, which overrides these to verify the
    // spawn cadence deterministically without real waiting or a DOM.
    documentRef = (typeof document !== 'undefined' ? document : undefined),
    spawnTargetFn = spawnTarget,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    setTimeoutFn = setTimeout
}) {
    gameScreenContainer.style.display = 'block';
    gameContainer.style.display = 'block';
    timerElement.style.display = 'block';
    gameScreenContainer.style.cursor = cursorType;
    gameScreenContainer.style.backgroundColor = bgColor;
    startButtonElement.style.display = 'none';

    let clickCount = 0;
    let hitCount = 0;
    let numberOfTargets = 0;
    let isGameActive = true;

    function onDocumentClick() {
        clickCount++;
    }
    documentRef.addEventListener('click', onDocumentClick);

    let timeLeft = Math.round(durationMs / 1000);
    const gameTimer = setIntervalFn(() => {
        timeLeft--;
        if (timeLeft <= 5) {
            endingElement.style.display = 'block';
            endingElement.textContent = timeLeft;
        }
        timerElement.textContent = formatTime(timeLeft);
        if (timeLeft <= 0) {
            clearIntervalFn(gameTimer);
            endingElement.style.display = 'none';
        }
    }, 1000);

    // The ONE source of new targets - a single setInterval, so the spawn
    // rate is always exactly targetSpawnIntervalMs regardless of how many
    // targets the participant clicks. Clicking a target (see target.js's
    // onHit) never spawns a replacement itself and never touches this
    // timer, so a fast clicker can never trigger rapid-fire spawning.
    const gameInterval = setIntervalFn(() => {
        if (!isGameActive) {
            clearIntervalFn(gameInterval);
            return;
        }
        numberOfTargets += 1;
        spawnTargetFn({
            container: gameContainer,
            color: targetColor,
            size: targetSize,
            cursorType,
            onHit: () => {
                hitCount++;
            }
        });
    }, targetSpawnIntervalMs);

    setTimeoutFn(() => {
        isGameActive = false;
        clearIntervalFn(gameInterval);
        documentRef.removeEventListener('click', onDocumentClick);

        gameScreenContainer.style.display = 'none';
        gameContainer.style.display = 'none';
        timerElement.style.display = 'none';
        documentRef.body.style.cursor = 'auto';

        onComplete({ clickCount, hitCount, numberOfTargets });
    }, durationMs);
}
