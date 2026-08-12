// Pure scoring math for a single mouse-accuracy session.
// Display formatting (e.g. the "0%" special case) lives in ui/results.js,
// not here - this module only computes numbers.

export function calculateAccuracy(hitCount, clickCount) {
    if (clickCount === 0) {
        return 0;
    }
    return (hitCount / clickCount) * 100;
}

export function calculateTargetEfficiency(hitCount, numberOfTargets) {
    return (hitCount / numberOfTargets) * 100;
}
