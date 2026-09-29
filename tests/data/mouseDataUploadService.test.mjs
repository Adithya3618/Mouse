// Browser-side upload of a phase's click history: retries, the temporary
// tab-scoped buffer, and re-sending leftovers on the next page load.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    uploadMousePerformance,
    flushBufferedMouseUploads,
    buildMousePerformancePayload
} from '../../app/frontend/js/data/mouseDataUploadService.js';

function createStorage() {
    const map = new Map();
    return {
        get length() { return map.size; },
        key: (i) => [...map.keys()][i] ?? null,
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k),
        map
    };
}

function response(status, body = {}) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const payload = { participantCode: 'P1', sessionId: 'session-1-1', phaseId: 'DUAL_TASK_17', clickEvents: [], targets: [] };
const noWait = { sleep: async () => {}, backgroundRetryMs: 0, logger: () => {} };

test('saves on the first attempt and clears the temporary buffer', async () => {
    const storage = createStorage();
    const calls = [];
    const result = await uploadMousePerformance(payload, {
        ...noWait,
        storage,
        fetchImpl: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return response(200, { status: 'stored' }); }
    });
    assert.equal(result.status, 'saved');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/mouse-performance');
    assert.equal(calls[0].body.phaseId, 'DUAL_TASK_17');
    assert.equal(storage.length, 0);
});

test('retries network failures and server errors, then succeeds', async () => {
    const storage = createStorage();
    let attempt = 0;
    const result = await uploadMousePerformance(payload, {
        ...noWait,
        storage,
        fetchImpl: async () => {
            attempt += 1;
            if (attempt === 1) throw new Error('offline');
            if (attempt === 2) return response(503);
            return response(200, { status: 'stored' });
        }
    });
    assert.equal(result.status, 'saved');
    assert.equal(attempt, 3);
    assert.equal(storage.length, 0);
});

test('keeps the payload buffered when every attempt fails, and a later page load re-sends it', async () => {
    const storage = createStorage();
    const failed = await uploadMousePerformance(payload, {
        ...noWait,
        storage,
        maxAttempts: 3,
        fetchImpl: async () => { throw new Error('offline'); }
    });
    assert.equal(failed.status, 'failed');
    assert.equal(storage.length, 1, 'still buffered');

    const sent = [];
    const results = await flushBufferedMouseUploads({
        ...noWait,
        storage,
        fetchImpl: async (url, init) => { sent.push(JSON.parse(init.body)); return response(200, { status: 'already_stored' }); }
    });
    assert.deepEqual(results.map((r) => r.status), ['saved']);
    assert.equal(sent[0].sessionId, 'session-1-1');
    assert.equal(storage.length, 0);
});

test('does not retry a payload the server rejected as invalid (4xx)', async () => {
    const storage = createStorage();
    let attempts = 0;
    const result = await uploadMousePerformance(payload, {
        ...noWait,
        storage,
        fetchImpl: async () => { attempts += 1; return response(400, { error: 'bad data' }); }
    });
    assert.equal(result.status, 'rejected');
    assert.equal(result.error, 'bad data');
    assert.equal(attempts, 1);
    assert.equal(storage.length, 0);
});

test('buildMousePerformancePayload carries the session, phase, task counters and full click history', () => {
    const session = { participantCode: 'P7', sessionId: 'session-9-1', experimentId: 'x', sessionDate: '2026-09-29', startTime: 'T0' };
    const phase = { phaseId: 'MOTOR_BASELINE', phaseType: 'motor', startedAt: 'T1' };
    const result = { clickCount: 2, hitCount: 1, numberOfTargets: 3, clickEvents: [{ clickSequence: 1 }], targets: [{ targetId: 1 }], taskInfo: { durationMs: 10000 } };
    const built = buildMousePerformancePayload(session, phase, result);
    assert.equal(built.participantCode, 'P7');
    assert.equal(built.phaseId, 'MOTOR_BASELINE');
    assert.equal(built.phaseStartedAt, 'T1');
    assert.deepEqual(built.reportedTotals, { totalTargets: 3, totalClicks: 2, totalHits: 1 });
    assert.equal(built.clickEvents.length, 1);
    assert.equal(built.taskInfo.durationMs, 10000);
});
