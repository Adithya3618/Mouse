import { calculateAccuracy, calculateTargetEfficiency } from '../mouse/scoring.js';

// --- Motor-Cognitive Dual-Task research session data model -----------
//
// Conceptually: Participant -> Experiment Session -> Phases -> Performance
// Data. This is additive - it does not change buildScorePayload/
// saveScoreToServer below, which the legacy 3-session controller still
// uses unchanged.

let sessionCounter = 0;

export function createSession({
    participantId = null,
    experimentId = 'motor-cognitive-dual-task',
    participantCode = null,
    sessionDate = null
} = {}) {
    sessionCounter += 1;
    return {
        participantId,
        participantCode,
        sessionDate,
        sessionId: `session-${Date.now()}-${sessionCounter}`,
        experimentId,
        startTime: new Date().toISOString(),
        endTime: null,
        phases: []
    };
}

// Creates a phase record from a static phase descriptor (see
// experiment/phases.js) plus any runtime extras (currently just the
// generated starting number, for subtraction/dual-task phases) and adds it
// to the session's phase list.
export function startPhaseRecord(session, phaseDescriptor, extra = {}) {
    const record = {
        phaseId: phaseDescriptor.phaseId,
        phaseType: phaseDescriptor.phaseType,
        subtractionValue: phaseDescriptor.subtractionValue ?? null,
        duration: phaseDescriptor.duration,
        mouseActive: phaseDescriptor.mouseActive,
        cognitiveActive: phaseDescriptor.cognitiveActive,
        startingNumber: extra.startingNumber ?? null,
        startedAt: new Date().toISOString(),
        endedAt: null,
        mousePerformance: null
    };
    session.phases.push(record);
    return record;
}

export function endPhaseRecord(record) {
    record.endedAt = new Date().toISOString();
    return record;
}

// Stores mouse performance for a single phase, using the same
// accuracy/target-efficiency formulas as the existing (validated) mouse
// scoring implementation - see mouse/scoring.js. Each mouse-containing
// phase (MOTOR_BASELINE, DUAL_TASK_3/7/17) gets its own independent
// mousePerformance object; they are never combined into one score.
export function recordMousePerformance(record, { totalTargets, totalClicks, totalHits }) {
    record.mousePerformance = {
        totalTargets,
        totalClicks,
        totalHits,
        totalMisses: totalClicks - totalHits,
        totalAccuracy: calculateAccuracy(totalHits, totalClicks),
        targetEfficiency: calculateTargetEfficiency(totalHits, totalTargets)
    };
    return record.mousePerformance;
}

export function endSession(session) {
    session.endTime = new Date().toISOString();
    return session;
}

// --- Legacy 3-session controller's score payload (unchanged) ---------
//
// Builds the score payload and sends it to the backend. Field names match
// the original game.js payload exactly, so no backend changes were needed
// beyond relocating the /saveScore handler.

export function buildScorePayload(state) {
    const [session1, session2, session3] = state.sessions;
    return {
        code: state.code,
        accuracy_s1: session1 && session1.accuracy,
        targetEfficiency_s1: session1 && session1.targetEfficiency,
        accuracy_s2: session2 && session2.accuracy,
        targetEfficiency_s2: session2 && session2.targetEfficiency,
        accuracy_s3: session3 && session3.accuracy,
        targetEfficiency_s3: session3 && session3.targetEfficiency,
        accuracy_F: state.totals && state.totals.accuracy,
        targetEfficiency_F: state.totals && state.totals.targetEfficiency
    };
}

export async function saveScoreToServer(payload) {
    const response = await fetch('/saveScore', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });
    return response.text();
}
