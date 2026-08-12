// Holds the experiment's data state (as opposed to transient UI-navigation
// state, which lives in experimentController.js): the participant code,
// each session's result, and the totals across all sessions.

const state = {
    code: null,
    sessions: [],
    totals: null
};

export function getState() {
    return state;
}

export function setCode(code) {
    state.code = code;
}

export function recordSession(result) {
    state.sessions.push(result);
}

export function computeTotals() {
    const clickCount = state.sessions.reduce((sum, s) => sum + s.clickCount, 0);
    const hitCount = state.sessions.reduce((sum, s) => sum + s.hitCount, 0);
    const numberOfTargets = state.sessions.reduce((sum, s) => sum + s.numberOfTargets, 0);
    const accuracy = (hitCount / clickCount) * 100;
    const targetEfficiency = (hitCount / numberOfTargets) * 100;

    state.totals = { clickCount, hitCount, numberOfTargets, accuracy, targetEfficiency };
    return state.totals;
}
