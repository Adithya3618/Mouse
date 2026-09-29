// Validates and persists one mouse-active phase's complete click history
// (POST /api/mouse-performance - see routes/mousePerformance.js), and reads
// it back for Admin Session Review / the Excel export.
//
// The browser sends raw events only; every stored summary number (totals,
// accuracy, target efficiency, reaction-time stats) is derived here from
// those events via frontend/js/mouse/mousePerformanceSummary.js, which
// reuses mouse/scoring.js - the same formulas the participant's own results
// screen uses. Reaction times are recomputed from the stored target list
// rather than trusted from the client.

const path = require('node:path');
const { pathToFileURL } = require('node:url');

const FRONTEND = path.join(__dirname, '../../frontend/js');
const SUMMARY_URL = pathToFileURL(path.join(FRONTEND, 'mouse/mousePerformanceSummary.js')).href;
const PHASES_URL = pathToFileURL(path.join(FRONTEND, 'experiment/phases.js')).href;
const CONFIG_URL = pathToFileURL(path.join(__dirname, '../../../config/experimentConfig.js')).href;

const MAX_CLICKS = 20000;
const MAX_TARGETS = 10000;
// Clicks are recorded until the task's own timeout fires, which can land a
// little after the configured duration; anything far beyond it is invalid.
const ELAPSED_SLACK_MS = 60000;
const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const TARGET_OUTCOMES = new Set(['hit', 'expired', 'active_at_end']);

class MouseDataValidationError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

let mousePhasesPromise = null;

// { [phaseId]: phaseType } for every mouseActive phase in the configured
// protocol (MOTOR_BASELINE, DUAL_TASK_3/7/17, ...), from the same
// buildPhaseSequence() the participant app runs.
function loadMousePhases() {
    if (!mousePhasesPromise) {
        mousePhasesPromise = Promise.all([import(PHASES_URL), import(CONFIG_URL)]).then(([phases, config]) => {
            const map = {};
            for (const phase of phases.buildPhaseSequence(config.experimentConfig)) {
                if (phase.mouseActive) {
                    map[phase.phaseId] = phase.phaseType;
                }
            }
            return map;
        });
    }
    return mousePhasesPromise;
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function optionalNumber(value, label) {
    if (value == null) {
        return null;
    }
    if (!isFiniteNumber(value)) {
        throw new MouseDataValidationError(`${label} must be a finite number or null.`);
    }
    return value;
}

function optionalString(value, label, max = 64) {
    if (value == null || value === '') {
        return null;
    }
    if (typeof value !== 'string' || value.length > max) {
        throw new MouseDataValidationError(`${label} must be a string of at most ${max} characters.`);
    }
    return value;
}

function round1(value) {
    return Math.round(value * 10) / 10;
}

function normalizeTargets(rawTargets) {
    if (!Array.isArray(rawTargets) || rawTargets.length > MAX_TARGETS) {
        throw new MouseDataValidationError(`targets must be an array of at most ${MAX_TARGETS} items.`);
    }
    const seen = new Set();
    return rawTargets.map((t, index) => {
        const label = `targets[${index}]`;
        if (!t || typeof t !== 'object') {
            throw new MouseDataValidationError(`${label} must be an object.`);
        }
        if (!Number.isInteger(t.targetId) || t.targetId < 1 || seen.has(t.targetId)) {
            throw new MouseDataValidationError(`${label}.targetId must be a unique positive integer.`);
        }
        seen.add(t.targetId);
        if (!isFiniteNumber(t.appearedElapsedMs) || t.appearedElapsedMs < 0) {
            throw new MouseDataValidationError(`${label}.appearedElapsedMs must be a non-negative number.`);
        }
        if (!TARGET_OUTCOMES.has(t.outcome)) {
            throw new MouseDataValidationError(`${label}.outcome must be one of ${[...TARGET_OUTCOMES].join(', ')}.`);
        }
        return {
            targetId: t.targetId,
            x: optionalNumber(t.x, `${label}.x`),
            y: optionalNumber(t.y, `${label}.y`),
            sizePx: optionalNumber(t.sizePx, `${label}.sizePx`),
            appearedElapsedMs: t.appearedElapsedMs,
            appearedAt: optionalString(t.appearedAt, `${label}.appearedAt`),
            hitElapsedMs: optionalNumber(t.hitElapsedMs, `${label}.hitElapsedMs`),
            disappearedElapsedMs: optionalNumber(t.disappearedElapsedMs, `${label}.disappearedElapsedMs`),
            outcome: t.outcome
        };
    });
}

function normalizeClicks(rawClicks, targetsById, maxElapsedMs) {
    if (!Array.isArray(rawClicks) || rawClicks.length > MAX_CLICKS) {
        throw new MouseDataValidationError(`clickEvents must be an array of at most ${MAX_CLICKS} items.`);
    }
    let previousElapsed = 0;
    return rawClicks.map((c, index) => {
        const label = `clickEvents[${index}]`;
        if (!c || typeof c !== 'object') {
            throw new MouseDataValidationError(`${label} must be an object.`);
        }
        if (c.clickSequence !== index + 1) {
            throw new MouseDataValidationError(`${label}.clickSequence must be ${index + 1} (clicks are numbered consecutively from 1).`);
        }
        if (!isFiniteNumber(c.elapsedMs) || c.elapsedMs < previousElapsed || c.elapsedMs > maxElapsedMs) {
            throw new MouseDataValidationError(`${label}.elapsedMs must be a number between the previous click's time and the task duration.`);
        }
        previousElapsed = c.elapsedMs;
        if (typeof c.isHit !== 'boolean') {
            throw new MouseDataValidationError(`${label}.isHit must be a boolean.`);
        }
        if (c.isMiss !== undefined && c.isMiss !== !c.isHit) {
            throw new MouseDataValidationError(`${label}.isMiss must be the opposite of isHit.`);
        }

        let target = null;
        if (c.isHit) {
            target = targetsById.get(c.targetId);
            if (!target) {
                throw new MouseDataValidationError(`${label} is a hit but targetId ${c.targetId} is not in targets.`);
            }
            if (c.elapsedMs < target.appearedElapsedMs) {
                throw new MouseDataValidationError(`${label} hits target ${target.targetId} before it appeared.`);
            }
        }

        return {
            clickSequence: c.clickSequence,
            timestamp: optionalString(c.timestamp, `${label}.timestamp`),
            elapsedMs: c.elapsedMs,
            x: optionalNumber(c.x, `${label}.x`),
            y: optionalNumber(c.y, `${label}.y`),
            viewportX: optionalNumber(c.viewportX, `${label}.viewportX`),
            viewportY: optionalNumber(c.viewportY, `${label}.viewportY`),
            targetActive: Boolean(c.targetActive),
            activeTargetCount: Number.isInteger(c.activeTargetCount) && c.activeTargetCount >= 0 ? c.activeTargetCount : null,
            isHit: c.isHit,
            isMiss: !c.isHit,
            targetId: target ? target.targetId : null,
            targetX: target ? target.x : null,
            targetY: target ? target.y : null,
            targetAppearedElapsedMs: target ? target.appearedElapsedMs : null,
            targetAppearedAt: target ? target.appearedAt : null,
            reactionTimeMs: target ? round1(c.elapsedMs - target.appearedElapsedMs) : null
        };
    });
}

class MousePerformanceService {
    constructor({ participantRepository, sessionRepository, mousePerformanceRepository, logger = console.error }) {
        this._participants = participantRepository;
        this._sessions = sessionRepository;
        this._mouse = mousePerformanceRepository;
        this._logger = logger;
    }

    // Returns { status: 'stored' | 'already_stored', mousePhasePerformanceId, summary }.
    // Throws MouseDataValidationError (with .status) for anything invalid.
    async persist(body) {
        if (!body || typeof body !== 'object') {
            throw new MouseDataValidationError('Request body must be a JSON object.');
        }
        const { participantCode, sessionId, phaseId } = body;
        if (typeof participantCode !== 'string' || participantCode.trim() === '' || participantCode.length > 200) {
            throw new MouseDataValidationError('participantCode is required.');
        }
        if (typeof sessionId !== 'string' || !ID_PATTERN.test(sessionId)) {
            throw new MouseDataValidationError('sessionId is missing or malformed.');
        }

        const mousePhases = await loadMousePhases();
        if (typeof phaseId !== 'string' || !Object.hasOwn(mousePhases, phaseId)) {
            throw new MouseDataValidationError(`phaseId "${phaseId}" is not a mouse-enabled phase.`);
        }
        const expectedPhaseType = mousePhases[phaseId];
        if (body.phaseType != null && body.phaseType !== expectedPhaseType) {
            throw new MouseDataValidationError(`phaseType "${body.phaseType}" does not match ${phaseId} (expected "${expectedPhaseType}").`);
        }

        const taskInfo = body.taskInfo && typeof body.taskInfo === 'object' ? body.taskInfo : {};
        const durationMs = optionalNumber(taskInfo.durationMs, 'taskInfo.durationMs');
        if (durationMs == null || durationMs <= 0 || durationMs > 3600000) {
            throw new MouseDataValidationError('taskInfo.durationMs must be a positive number of milliseconds.');
        }

        const targets = normalizeTargets(body.targets);
        const targetsById = new Map(targets.map((t) => [t.targetId, t]));
        const clickEvents = normalizeClicks(body.clickEvents, targetsById, durationMs + ELAPSED_SLACK_MS);

        // Participant/session relationship: the first upload for a session
        // creates it (exactly like POST /api/recordings - the clicking-only
        // baseline normally runs before any recording exists). Once a
        // session exists, it can only receive data for its own participant.
        const existingSession = await this._sessions.getById(sessionId);
        const existingParticipant = await this._participants.getByCode(participantCode);
        if (existingSession && (!existingParticipant || existingSession.participant_id !== existingParticipant.id)) {
            throw new MouseDataValidationError('This session belongs to a different participant.', 409);
        }
        const participant = existingParticipant || await this._participants.upsertByCode(participantCode);
        const session = existingSession || await this._sessions.upsertById({
            sessionId,
            participantId: participant.id,
            experimentId: optionalString(body.experimentId, 'experimentId', 128),
            sessionDate: optionalString(body.sessionDate, 'sessionDate'),
            startTime: optionalString(body.sessionStartTime, 'sessionStartTime')
        });

        const { summarizeMouseClickData } = await import(SUMMARY_URL);
        const summary = summarizeMouseClickData({ clickEvents, targets });

        const reported = body.reportedTotals || {};
        if ((reported.totalClicks != null && reported.totalClicks !== summary.totalClicks)
            || (reported.totalHits != null && reported.totalHits !== summary.totalHits)
            || (reported.totalTargets != null && reported.totalTargets !== summary.totalTargets)) {
            // Stored anyway (the events are the raw data); flagged for review.
            this._logger(`[mouse-performance] ${sessionId}/${phaseId}: browser counters ${JSON.stringify(reported)} differ from stored events (clicks ${summary.totalClicks}, hits ${summary.totalHits}, targets ${summary.totalTargets}).`);
        }

        const result = await this._mouse.insertPhaseWithEvents({
            performance: {
                sessionId: session.id,
                participantId: participant.id,
                phaseId,
                phaseType: expectedPhaseType,
                phaseStartedAt: optionalString(body.phaseStartedAt, 'phaseStartedAt'),
                taskStartedAt: optionalString(taskInfo.startedAt, 'taskInfo.startedAt'),
                taskEndedAt: optionalString(taskInfo.endedAt, 'taskInfo.endedAt'),
                durationMs,
                actualDurationMs: optionalNumber(taskInfo.actualDurationMs, 'taskInfo.actualDurationMs'),
                targetSizePx: optionalNumber(taskInfo.targetSizePx, 'taskInfo.targetSizePx'),
                targetSpawnIntervalMs: optionalNumber(taskInfo.targetSpawnIntervalMs, 'taskInfo.targetSpawnIntervalMs'),
                targetLifetimeMs: optionalNumber(taskInfo.targetLifetimeMs, 'taskInfo.targetLifetimeMs'),
                containerWidth: optionalNumber(taskInfo.containerWidth, 'taskInfo.containerWidth'),
                containerHeight: optionalNumber(taskInfo.containerHeight, 'taskInfo.containerHeight'),
                ...summary
            },
            targets,
            clickEvents
        });

        if (!result.inserted
            && (result.row.total_clicks !== summary.totalClicks || result.row.total_targets !== summary.totalTargets)) {
            throw new MouseDataValidationError(`Mouse data for ${phaseId} in this session is already stored and differs from this upload.`, 409);
        }

        return {
            status: result.inserted ? 'stored' : 'already_stored',
            mousePhasePerformanceId: result.row.id,
            summary: toSummary(result.row)
        };
    }

    async listSummariesForSession(sessionId) {
        return (await this._mouse.listForSession(sessionId)).map(toSummary);
    }

    // Complete stored history for one phase, or null if never persisted.
    async getPhaseDetail(sessionId, phaseId) {
        const row = await this._mouse.getForSessionPhase(sessionId, phaseId);
        if (!row) {
            return null;
        }
        const [clicks, targets] = await Promise.all([this._mouse.listClickEvents(row.id), this._mouse.listTargets(row.id)]);
        return {
            ...toSummary(row),
            clickEvents: clicks.map(toClickEvent),
            targets: targets.map(toTarget)
        };
    }
}

function toSummary(row) {
    return {
        mousePhasePerformanceId: row.id,
        phaseId: row.phase_id,
        phaseType: row.phase_type,
        phaseStartedAt: row.phase_started_at,
        taskStartedAt: row.task_started_at,
        taskEndedAt: row.task_ended_at,
        durationMs: row.duration_ms,
        actualDurationMs: row.actual_duration_ms,
        targetSizePx: row.target_size_px,
        targetSpawnIntervalMs: row.target_spawn_interval_ms,
        targetLifetimeMs: row.target_lifetime_ms,
        containerWidth: row.container_width,
        containerHeight: row.container_height,
        totalTargets: Number(row.total_targets),
        totalClicks: Number(row.total_clicks),
        totalHits: Number(row.total_hits),
        totalMisses: Number(row.total_misses),
        totalAccuracy: Number(row.accuracy),
        targetEfficiency: row.target_efficiency == null ? null : Number(row.target_efficiency),
        avgReactionTimeMs: row.avg_reaction_time_ms,
        minReactionTimeMs: row.min_reaction_time_ms,
        maxReactionTimeMs: row.max_reaction_time_ms,
        medianReactionTimeMs: row.median_reaction_time_ms,
        storedAt: row.created_at
    };
}

function toClickEvent(row) {
    return {
        clickSequence: Number(row.click_sequence),
        timestamp: row.clicked_at,
        elapsedMs: row.elapsed_ms,
        x: row.x,
        y: row.y,
        viewportX: row.viewport_x,
        viewportY: row.viewport_y,
        targetActive: Boolean(Number(row.target_active)),
        activeTargetCount: row.active_target_count,
        isHit: Boolean(Number(row.is_hit)),
        isMiss: Boolean(Number(row.is_miss)),
        targetId: row.target_id,
        targetX: row.target_x,
        targetY: row.target_y,
        targetAppearedElapsedMs: row.target_appeared_elapsed_ms,
        targetAppearedAt: row.target_appeared_at,
        reactionTimeMs: row.reaction_time_ms
    };
}

function toTarget(row) {
    return {
        targetId: Number(row.target_id),
        x: row.x,
        y: row.y,
        sizePx: row.size_px,
        appearedElapsedMs: row.appeared_elapsed_ms,
        appearedAt: row.appeared_at,
        hitElapsedMs: row.hit_elapsed_ms,
        disappearedElapsedMs: row.disappeared_elapsed_ms,
        outcome: row.outcome
    };
}

module.exports = { MousePerformanceService, MouseDataValidationError, loadMousePhases };
