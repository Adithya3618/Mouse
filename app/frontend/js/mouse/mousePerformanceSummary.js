// Derives a phase's mouse-performance summary from its individual click
// events and targets. Shared by the backend (services/mousePerformanceService.js,
// which stores the result) and anything else that needs the same numbers, so
// the Admin dashboard and the Excel export can never disagree.
//
// Totals/accuracy/target efficiency reuse mouse/scoring.js unchanged - the
// same formulas data/sessionData.js#recordMousePerformance applies to the
// task's live counters. Reaction time is per hit: the click's elapsed time
// minus the clicked target's appearance time (misses have none).

import { calculateAccuracy, calculateTargetEfficiency } from './scoring.js';

export function summarizeReactionTimes(reactionTimes) {
    const values = reactionTimes.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
    if (values.length === 0) {
        return { count: 0, avgReactionTimeMs: null, minReactionTimeMs: null, maxReactionTimeMs: null, medianReactionTimeMs: null };
    }
    const mid = Math.floor(values.length / 2);
    const median = values.length % 2 === 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid];
    const sum = values.reduce((acc, v) => acc + v, 0);
    return {
        count: values.length,
        avgReactionTimeMs: round1(sum / values.length),
        minReactionTimeMs: values[0],
        maxReactionTimeMs: values[values.length - 1],
        medianReactionTimeMs: round1(median)
    };
}

export function summarizeMouseClickData({ clickEvents, targets }) {
    const totalClicks = clickEvents.length;
    const totalHits = clickEvents.filter((c) => c.isHit).length;
    const totalTargets = targets.length;
    const reaction = summarizeReactionTimes(clickEvents.filter((c) => c.isHit).map((c) => c.reactionTimeMs));
    return {
        totalTargets,
        totalClicks,
        totalHits,
        totalMisses: totalClicks - totalHits,
        totalAccuracy: calculateAccuracy(totalHits, totalClicks),
        // scoring.js divides by zero when no target ever spawned; store
        // "not applicable" rather than NaN.
        targetEfficiency: totalTargets > 0 ? calculateTargetEfficiency(totalHits, totalTargets) : null,
        avgReactionTimeMs: reaction.avgReactionTimeMs,
        minReactionTimeMs: reaction.minReactionTimeMs,
        maxReactionTimeMs: reaction.maxReactionTimeMs,
        medianReactionTimeMs: reaction.medianReactionTimeMs
    };
}

function round1(value) {
    return Math.round(value * 10) / 10;
}
