// Sends one mouse-active phase's complete click history (every click event,
// every spawned target, plus task settings) to the research backend
// (POST /api/mouse-performance - see app/backend/routes/mousePerformance.js)
// as soon as that phase's mouse task finishes. The server is the
// authoritative store; nothing is sent anywhere else.
//
// Reliability: a failed upload is retried with backoff. Until the server
// confirms it, the payload is also kept in sessionStorage - a TEMPORARY,
// tab-scoped buffer only, cleared on success and flushed again on the next
// page load (flushBufferedMouseUploads). The server is idempotent per
// (session, phase), so a resend can never duplicate rows.

import { buildApiUrl } from '../config/apiBaseUrl.js';

const BUFFER_PREFIX = 'mouseUploadBuffer:';
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BASE_DELAY_MS = 1000;
const BACKGROUND_RETRY_MS = 30000;

// Builds the request body from the session record, the phase record, and
// the mouse task's raw result (see mouse/mouseTask.js#runMouseSession).
export function buildMousePerformancePayload(session, phaseRecord, result) {
    return {
        participantCode: session.participantCode,
        sessionId: session.sessionId,
        experimentId: session.experimentId,
        sessionDate: session.sessionDate,
        sessionStartTime: session.startTime,
        phaseId: phaseRecord.phaseId,
        phaseType: phaseRecord.phaseType,
        phaseStartedAt: phaseRecord.startedAt,
        taskInfo: result.taskInfo || null,
        reportedTotals: {
            totalTargets: result.numberOfTargets,
            totalClicks: result.clickCount,
            totalHits: result.hitCount
        },
        targets: result.targets || [],
        clickEvents: result.clickEvents || []
    };
}

function bufferKey(payload) {
    return `${BUFFER_PREFIX}${payload.sessionId}:${payload.phaseId}`;
}

function defaultStorage() {
    try {
        return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
    } catch {
        return null;
    }
}

function safeStorageCall(fn) {
    try {
        return fn();
    } catch {
        return null; // storage full/blocked - retries still run in memory
    }
}

async function postOnce(payload, fetchImpl) {
    const response = await fetchImpl(buildApiUrl('/api/mouse-performance'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    let body = null;
    try {
        body = await response.json();
    } catch {
        body = null;
    }
    return { ok: response.ok, status: response.status, body };
}

// 4xx (other than timeout/rate-limit) means the server rejected the data
// itself - resending the same payload can't succeed.
function isPermanentFailure(status) {
    return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

// Resolves once the upload has either succeeded or exhausted its initial
// attempts: { status: 'saved' | 'rejected' | 'failed', ... }. On 'failed'
// the payload stays buffered and keeps retrying in the background while
// the page is open.
export async function uploadMousePerformance(payload, {
    fetchImpl = (...args) => fetch(...args),
    storage = defaultStorage(),
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    backgroundRetryMs = BACKGROUND_RETRY_MS,
    logger = (message) => console.warn(`[MOUSE UPLOAD] ${message}`)
} = {}) {
    const key = bufferKey(payload);
    if (storage) {
        safeStorageCall(() => storage.setItem(key, JSON.stringify(payload)));
    }

    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            const result = await postOnce(payload, fetchImpl);
            if (result.ok) {
                if (storage) {
                    safeStorageCall(() => storage.removeItem(key));
                }
                return { status: 'saved', response: result.body };
            }
            lastError = (result.body && result.body.error) || `HTTP ${result.status}`;
            if (isPermanentFailure(result.status)) {
                logger(`${payload.phaseId}: server rejected mouse data - ${lastError}`);
                if (storage) {
                    safeStorageCall(() => storage.removeItem(key));
                }
                return { status: 'rejected', error: lastError };
            }
        } catch (error) {
            lastError = error.message;
        }
        if (attempt < maxAttempts) {
            await sleep(baseDelayMs * 2 ** (attempt - 1));
        }
    }

    logger(`${payload.phaseId}: mouse data upload failed after ${maxAttempts} attempts (${lastError}) - kept buffered, retrying in the background.`);
    if (backgroundRetryMs > 0) {
        scheduleBackgroundRetry(payload, { fetchImpl, storage, backgroundRetryMs, logger });
    }
    return { status: 'failed', error: lastError };
}

function scheduleBackgroundRetry(payload, { fetchImpl, storage, backgroundRetryMs, logger }) {
    const key = bufferKey(payload);
    const retry = async () => {
        try {
            const result = await postOnce(payload, fetchImpl);
            if (result.ok || isPermanentFailure(result.status)) {
                if (storage) {
                    safeStorageCall(() => storage.removeItem(key));
                }
                if (result.ok) {
                    logger(`${payload.phaseId}: buffered mouse data saved on background retry.`);
                }
                return;
            }
        } catch {
            // still offline - try again later
        }
        setTimeout(retry, backgroundRetryMs);
    };
    setTimeout(retry, backgroundRetryMs);
}

// Re-sends anything left in the temporary buffer from an earlier page load
// (e.g. the tab was reloaded while offline). Safe to call on every load.
export async function flushBufferedMouseUploads({ storage = defaultStorage(), ...options } = {}) {
    if (!storage) {
        return [];
    }
    const keys = [];
    for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (key && key.startsWith(BUFFER_PREFIX)) {
            keys.push(key);
        }
    }
    const results = [];
    for (const key of keys) {
        const raw = safeStorageCall(() => storage.getItem(key));
        let payload = null;
        try {
            payload = raw ? JSON.parse(raw) : null;
        } catch {
            payload = null;
        }
        if (!payload) {
            safeStorageCall(() => storage.removeItem(key));
            continue;
        }
        results.push(await uploadMousePerformance(payload, { storage, ...options }));
    }
    return results;
}
