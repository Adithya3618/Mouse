// The mouse-accuracy task engine: spawns targets for a fixed duration,
// tracks raw clicks/hits/targets, and reports them back when time is up.
// This module only knows about the mouse task itself - session bookkeeping
// and scoring live in mouseSession.js/scoring.js.

import { spawnTarget } from './target.js';
import { formatTime } from '../timer/timer.js';

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
    difficultyLevel,
    durationMs,
    onComplete
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
    document.addEventListener('click', onDocumentClick);

    let timeLeft = Math.round(durationMs / 1000);
    const gameTimer = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 5) {
            endingElement.style.display = 'block';
            endingElement.textContent = timeLeft;
        }
        timerElement.textContent = formatTime(timeLeft);
        if (timeLeft <= 0) {
            clearInterval(gameTimer);
            endingElement.style.display = 'none';
        }
    }, 1000);

    const gameInterval = setInterval(() => {
        if (!isGameActive) {
            clearInterval(gameInterval);
            return;
        }
        numberOfTargets += 1;
        spawnTarget({
            container: gameContainer,
            color: targetColor,
            size: targetSize,
            cursorType,
            onHit: () => {
                hitCount++;
            }
        });
    }, difficultyLevel * 1000);

    setTimeout(() => {
        isGameActive = false;
        clearInterval(gameInterval);
        document.removeEventListener('click', onDocumentClick);

        gameScreenContainer.style.display = 'none';
        gameContainer.style.display = 'none';
        timerElement.style.display = 'none';
        document.body.style.cursor = 'auto';

        onComplete({ clickCount, hitCount, numberOfTargets });
    }, durationMs);
}
