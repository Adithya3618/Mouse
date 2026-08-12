// Basic validation for dual-task session/phase data. Deliberately
// lightweight - enough to catch obviously malformed data before export,
// not a full schema-validation system.
//
// Like conditions.js/phases.js, these functions take `config`/
// `validPhaseIds` as explicit arguments rather than importing
// config/experimentConfig.js directly, so this module works unmodified in
// both the browser and Node tests.

export function isValidPhaseId(phaseId, validPhaseIds) {
    return typeof phaseId === 'string' && validPhaseIds.includes(phaseId);
}

export function isValidDuration(duration) {
    return duration === null || (typeof duration === 'number' && duration > 0);
}

export function isValidSubtractionValue(value, config) {
    return value === null || config.subtractionValues.includes(value);
}

export function isValidStartingNumber(value, config) {
    if (value === null) {
        return true;
    }
    const { min, max } = config.randomStartingNumberRange;
    return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

export function isValidMouseStatistics(stats) {
    if (stats == null) {
        return true; // absent mouse data is valid for non-mouse phases
    }
    const fields = ['totalTargets', 'totalClicks', 'totalHits', 'totalMisses', 'totalAccuracy', 'targetEfficiency'];
    return fields.every((field) => typeof stats[field] === 'number' && !Number.isNaN(stats[field]));
}

// Validates a full session record (see data/sessionData.js#createSession).
// `validPhaseIds` should be the phaseId list from the sequence that was
// actually run (see experiment/phases.js#buildPhaseSequence).
export function validateSession(session, validPhaseIds, config) {
    const errors = [];

    if (!session.sessionId) {
        errors.push('Session is missing a sessionId.');
    }
    if (session.participantId === undefined) {
        errors.push('Session is missing a participantId field (use null if not collected).');
    }
    if (!Array.isArray(session.phases) || session.phases.length === 0) {
        errors.push('Session has no recorded phases.');
        return { valid: false, errors };
    }

    session.phases.forEach((phase, index) => {
        const label = `Phase ${index} (${phase.phaseId})`;
        if (!isValidPhaseId(phase.phaseId, validPhaseIds)) {
            errors.push(`${label}: invalid phaseId.`);
        }
        if (!isValidDuration(phase.duration)) {
            errors.push(`${label}: invalid duration.`);
        }
        if (!isValidSubtractionValue(phase.subtractionValue, config)) {
            errors.push(`${label}: invalid subtractionValue.`);
        }
        if (!isValidStartingNumber(phase.startingNumber, config)) {
            errors.push(`${label}: startingNumber out of range.`);
        }
        if (!isValidMouseStatistics(phase.mousePerformance)) {
            errors.push(`${label}: mousePerformance contains non-numeric values.`);
        }
    });

    return { valid: errors.length === 0, errors };
}
