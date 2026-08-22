// Small shared display-formatting helper for percentage values.

export function formatPercentage(value, decimals = 2) {
    return `${value.toFixed(decimals)}%`;
}

// Converts an internal dual-task session record (see
// data/sessionData.js#createSession) into a flat, export-friendly
// structure. This only reshapes/flattens existing fields - it does not
// invent new data, and it is not the final Excel/CSV/JSON export format
// (that comes later); it just establishes a clean internal shape for
// whatever export step consumes it next.
export function formatSessionForExport(session) {
    return {
        participantId: session.participantId,
        participantCode: session.participantCode,
        sessionId: session.sessionId,
        experimentId: session.experimentId,
        sessionDate: session.sessionDate,
        startTime: session.startTime,
        endTime: session.endTime,
        phases: session.phases.map((phase) => ({
            phaseId: phase.phaseId,
            phaseType: phase.phaseType,
            subtractionValue: phase.subtractionValue,
            startingNumber: phase.startingNumber,
            duration: phase.duration,
            startedAt: phase.startedAt,
            endedAt: phase.endedAt,
            ...(phase.mousePerformance ? { mousePerformance: { ...phase.mousePerformance } } : {}),
            ...(phase.cognitivePerformance
                ? { cognitivePerformance: { ...phase.cognitivePerformance, responses: phase.cognitivePerformance.responses.map((r) => ({ ...r })) } }
                : {})
        }))
    };
}
