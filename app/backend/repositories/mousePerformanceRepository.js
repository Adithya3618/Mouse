// mouse_phase_performance / mouse_click_events / mouse_targets - the mouse
// task's per-phase summary plus its complete click and target history (see
// schema.sql). Written once per (session, phase); never updated afterwards.
//
// Async throughout - see participantRepository.js's header comment for why.

const crypto = require('node:crypto');

function isUniqueViolation(error) {
    return /UNIQUE constraint failed/i.test(error.message || '') || error.code === '23505';
}

class MousePerformanceRepository {
    constructor(db) {
        this._db = db;
    }

    async getForSessionPhase(sessionId, phaseId) {
        return (await this._db.prepare(
            'SELECT * FROM mouse_phase_performance WHERE session_id = ? AND phase_id = ?'
        ).get(sessionId, phaseId)) || null;
    }

    async listForSession(sessionId) {
        return this._db.prepare(
            'SELECT * FROM mouse_phase_performance WHERE session_id = ? ORDER BY phase_started_at ASC, created_at ASC'
        ).all(sessionId);
    }

    async listClickEvents(performanceId) {
        return this._db.prepare(
            'SELECT * FROM mouse_click_events WHERE mouse_phase_performance_id = ? ORDER BY click_sequence ASC'
        ).all(performanceId);
    }

    async listTargets(performanceId) {
        return this._db.prepare(
            'SELECT * FROM mouse_targets WHERE mouse_phase_performance_id = ? ORDER BY target_id ASC'
        ).all(performanceId);
    }

    // Inserts the summary row and every target/click in one transaction.
    // Returns { inserted: true, row } - or { inserted: false, row: existing }
    // when this (session, phase) is already stored, so a retried upload is
    // a no-op rather than a duplicate.
    async insertPhaseWithEvents({ performance, targets, clickEvents }) {
        const existing = await this.getForSessionPhase(performance.sessionId, performance.phaseId);
        if (existing) {
            return { inserted: false, row: existing };
        }

        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        await this._db.exec('BEGIN;');
        try {
            await this._db.prepare(
                `INSERT INTO mouse_phase_performance (
                    id, session_id, participant_id, phase_id, phase_type, phase_started_at,
                    task_started_at, task_ended_at, duration_ms, actual_duration_ms,
                    target_size_px, target_spawn_interval_ms, target_lifetime_ms,
                    container_width, container_height,
                    total_targets, total_clicks, total_hits, total_misses, accuracy, target_efficiency,
                    avg_reaction_time_ms, min_reaction_time_ms, max_reaction_time_ms, median_reaction_time_ms,
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(
                id, performance.sessionId, performance.participantId, performance.phaseId, performance.phaseType,
                performance.phaseStartedAt, performance.taskStartedAt, performance.taskEndedAt,
                performance.durationMs, performance.actualDurationMs,
                performance.targetSizePx, performance.targetSpawnIntervalMs, performance.targetLifetimeMs,
                performance.containerWidth, performance.containerHeight,
                performance.totalTargets, performance.totalClicks, performance.totalHits, performance.totalMisses,
                performance.totalAccuracy, performance.targetEfficiency,
                performance.avgReactionTimeMs, performance.minReactionTimeMs,
                performance.maxReactionTimeMs, performance.medianReactionTimeMs,
                now
            );

            const insertTarget = this._db.prepare(
                `INSERT INTO mouse_targets (
                    id, mouse_phase_performance_id, session_id, phase_id, target_id, x, y, size_px,
                    appeared_elapsed_ms, appeared_at, hit_elapsed_ms, disappeared_elapsed_ms, outcome, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            );
            for (const t of targets) {
                await insertTarget.run(
                    crypto.randomUUID(), id, performance.sessionId, performance.phaseId, t.targetId,
                    t.x, t.y, t.sizePx, t.appearedElapsedMs, t.appearedAt,
                    t.hitElapsedMs, t.disappearedElapsedMs, t.outcome, now
                );
            }

            const insertClick = this._db.prepare(
                `INSERT INTO mouse_click_events (
                    id, mouse_phase_performance_id, session_id, participant_id, phase_id, click_sequence,
                    clicked_at, elapsed_ms, x, y, viewport_x, viewport_y, target_active, active_target_count,
                    is_hit, is_miss, target_id, target_x, target_y, target_appeared_elapsed_ms,
                    target_appeared_at, reaction_time_ms, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            );
            for (const c of clickEvents) {
                await insertClick.run(
                    crypto.randomUUID(), id, performance.sessionId, performance.participantId, performance.phaseId,
                    c.clickSequence, c.timestamp, c.elapsedMs, c.x, c.y, c.viewportX, c.viewportY,
                    c.targetActive ? 1 : 0, c.activeTargetCount, c.isHit ? 1 : 0, c.isHit ? 0 : 1,
                    c.targetId, c.targetX, c.targetY, c.targetAppearedElapsedMs, c.targetAppearedAt,
                    c.reactionTimeMs, now
                );
            }

            await this._db.exec('COMMIT;');
        } catch (error) {
            await this._db.exec('ROLLBACK;');
            if (isUniqueViolation(error)) {
                // A concurrent duplicate won the race - report what it stored.
                const winner = await this.getForSessionPhase(performance.sessionId, performance.phaseId);
                if (winner) {
                    return { inserted: false, row: winner };
                }
            }
            throw error;
        }

        return { inserted: true, row: await this.getForSessionPhase(performance.sessionId, performance.phaseId) };
    }
}

module.exports = { MousePerformanceRepository };
