// Runs one timed mouse-accuracy session and composes the raw task stats
// with scoring into a single result object for the experiment layer.

import { runMouseSession } from './mouseTask.js';
import { calculateAccuracy, calculateTargetEfficiency } from './scoring.js';

export function playMouseSession(config, onComplete) {
    runMouseSession({
        ...config,
        onComplete: (rawStats) => {
            const accuracy = calculateAccuracy(rawStats.hitCount, rawStats.clickCount);
            const targetEfficiency = calculateTargetEfficiency(rawStats.hitCount, rawStats.numberOfTargets);
            onComplete({ ...rawStats, accuracy, targetEfficiency });
        }
    });
}
