// The mouse-accuracy task engine: spawns targets for a fixed duration,
// tracks raw clicks/hits/targets, and reports them back when time is up.
// This module only knows about the mouse task itself - session bookkeeping
// and scoring live in mouseSession.js/scoring.js.
//
// Alongside the three running counters (unchanged), every individual click
// and every spawned target is recorded so the complete click history can be
// persisted to the research database (see data/mouseDataUploadService.js).
// Recording never changes timing, spawning, or what counts as a hit.

import { spawnTarget, TARGET_LIFETIME_MS } from './target.js';
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

function defaultNow() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

function roundMs(value) {
    return Math.round(value * 10) / 10;
}

function numberOrNull(value) {
    const num = typeof value === 'number' ? value : parseFloat(value);
    return Number.isFinite(num) ? num : null;
}

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
    targetLifetimeMs = TARGET_LIFETIME_MS,
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
    setTimeoutFn = setTimeout,
    // Monotonic clock for elapsed times/reaction times, and wall clock for
    // ISO timestamps.
    nowFn = defaultNow,
    wallClockFn = Date.now
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

    const startPerf = nowFn();
    const startWall = wallClockFn();
    const elapsed = () => nowFn() - startPerf;
    const isoAt = (elapsedMs) => new Date(startWall + elapsedMs).toISOString();

    const targets = [];
    const clickEvents = [];
    // Set by a target's onHit; consumed by the document-level listener when
    // the same DOM event bubbles up (target listeners always run first).
    let pendingHit = null;

    function isTargetVisibleAt(target, atMs) {
        return target.appearedElapsedMs <= atMs
            && atMs < target.appearedElapsedMs + targetLifetimeMs
            && (target.hitElapsedMs == null || target.hitElapsedMs >= atMs);
    }

    function containerRelative(event) {
        if (!event || typeof event.clientX !== 'number' || typeof gameContainer.getBoundingClientRect !== 'function') {
            return { x: null, y: null };
        }
        const rect = gameContainer.getBoundingClientRect();
        return { x: roundMs(event.clientX - rect.left), y: roundMs(event.clientY - rect.top) };
    }

    function onDocumentClick(event) {
        clickCount++;

        const hit = pendingHit && event != null && pendingHit.event === event ? pendingHit : null;
        pendingHit = null;

        const clickElapsed = hit ? hit.elapsedMs : elapsed();
        const activeTargetCount = targets.filter((t) => isTargetVisibleAt(t, clickElapsed)).length;
        const { x, y } = containerRelative(event);
        const target = hit ? hit.target : null;

        clickEvents.push({
            clickSequence: clickCount,
            timestamp: isoAt(clickElapsed),
            elapsedMs: roundMs(clickElapsed),
            x,
            y,
            viewportX: event && typeof event.clientX === 'number' ? event.clientX : null,
            viewportY: event && typeof event.clientY === 'number' ? event.clientY : null,
            targetActive: activeTargetCount > 0,
            activeTargetCount,
            isHit: Boolean(hit),
            isMiss: !hit,
            targetId: target ? target.targetId : null,
            targetX: target ? target.x : null,
            targetY: target ? target.y : null,
            targetAppearedElapsedMs: target ? target.appearedElapsedMs : null,
            targetAppearedAt: target ? target.appearedAt : null,
            reactionTimeMs: target ? roundMs(clickElapsed - target.appearedElapsedMs) : null
        });
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
        const appearedElapsedMs = roundMs(elapsed());
        const targetRecord = {
            targetId: numberOfTargets,
            x: null,
            y: null,
            sizePx: targetSize,
            appearedElapsedMs,
            appearedAt: isoAt(appearedElapsedMs),
            hitElapsedMs: null
        };
        targets.push(targetRecord);

        const element = spawnTargetFn({
            container: gameContainer,
            color: targetColor,
            size: targetSize,
            cursorType,
            lifetimeMs: targetLifetimeMs,
            onHit: (event) => {
                hitCount++;
                const hitElapsed = roundMs(elapsed());
                targetRecord.hitElapsedMs = hitElapsed;
                pendingHit = { event, target: targetRecord, elapsedMs: hitElapsed };
            }
        });
        if (element && element.style) {
            targetRecord.x = numberOrNull(element.style.left);
            targetRecord.y = numberOrNull(element.style.top);
        }
    }, targetSpawnIntervalMs);

    setTimeoutFn(() => {
        isGameActive = false;
        clearIntervalFn(gameInterval);
        documentRef.removeEventListener('click', onDocumentClick);

        const endElapsed = roundMs(elapsed());
        const containerWidth = numberOrNull(gameContainer.clientWidth);
        const containerHeight = numberOrNull(gameContainer.clientHeight);

        gameScreenContainer.style.display = 'none';
        gameContainer.style.display = 'none';
        timerElement.style.display = 'none';
        documentRef.body.style.cursor = 'auto';

        onComplete({
            clickCount,
            hitCount,
            numberOfTargets,
            clickEvents,
            targets: targets.map((t) => {
                let outcome = 'active_at_end';
                let disappearedElapsedMs = null;
                if (t.hitElapsedMs != null) {
                    outcome = 'hit';
                    disappearedElapsedMs = t.hitElapsedMs;
                } else if (t.appearedElapsedMs + targetLifetimeMs <= endElapsed) {
                    outcome = 'expired';
                    disappearedElapsedMs = roundMs(t.appearedElapsedMs + targetLifetimeMs);
                }
                return { ...t, outcome, disappearedElapsedMs };
            }),
            taskInfo: {
                startedAt: new Date(startWall).toISOString(),
                endedAt: isoAt(endElapsed),
                durationMs,
                actualDurationMs: endElapsed,
                targetSizePx: targetSize,
                targetSpawnIntervalMs,
                targetLifetimeMs,
                containerWidth,
                containerHeight
            }
        });
    }, durationMs);
}
