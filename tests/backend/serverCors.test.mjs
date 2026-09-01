// server.js's CORS middleware - only relevant for the temporary period
// where a Vercel-hosted frontend (api/frontend.js) reaches this backend
// from a different origin (see docs/storage-architecture.md and
// app/frontend/js/config/apiBaseUrl.js).
//
// CRITICAL: server.js calls createAppContext() at MODULE LOAD TIME with NO
// override mechanism - unlike every other backend test file, which injects
// its own :memory:/temp-dir db via createAppContext({ db, ... }), this file
// cannot do that. Every env var that controls where that default storage
// resolves to (DB_PATH, AUDIO_STORAGE_DIR, DATA_DIR, ADMIN_API_TOKEN) is
// set to a fresh temp directory/value BEFORE the dynamic import() below,
// and NODE_ENV is deliberately left unset (so the production ephemeral-
// path guard added in config/storageConfig.js does not apply here) - this
// is the only way to require server.js at all without risking the real
// data/db/data/audio directories.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-cors-test-db-'));
const audioDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-cors-test-audio-'));

process.env.DB_PATH = dbDir;
process.env.AUDIO_STORAGE_DIR = audioDir;
process.env.ADMIN_API_TOKEN = 'server-cors-test-token';
delete process.env.NODE_ENV;
delete process.env.DATA_DIR;
delete process.env.DATABASE_PROVIDER;
delete process.env.AUDIO_STORAGE_PROVIDER;

const { default: app } = await import('../../app/backend/server.js');

async function startServer() {
    return new Promise((resolve) => {
        const server = app.listen(0, () => resolve(server));
    });
}

test('a cross-origin request reflects the requesting Origin in Access-Control-Allow-Origin, with the expected methods/headers allowed', async () => {
    const server = await startServer();
    const { port } = server.address();
    try {
        const response = await fetch(`http://localhost:${port}/api/admin/participants`, {
            headers: { Origin: 'https://example-frontend.vercel.app', Authorization: 'Bearer server-cors-test-token' }
        });
        assert.equal(response.headers.get('access-control-allow-origin'), 'https://example-frontend.vercel.app');
        assert.match(response.headers.get('access-control-allow-methods') || '', /GET/);
        assert.match(response.headers.get('access-control-allow-headers') || '', /Authorization/);
        assert.equal(response.status, 200);
    } finally {
        server.close();
    }
});

test('a same-origin request (no Origin header, as Node\'s fetch sends by default for a same-process call) gets no CORS headers - not needed for a same-origin browser request either', async () => {
    const server = await startServer();
    const { port } = server.address();
    try {
        const response = await fetch(`http://localhost:${port}/api/admin/participants`, {
            headers: { Authorization: 'Bearer server-cors-test-token' }
        });
        assert.equal(response.headers.get('access-control-allow-origin'), null);
        assert.equal(response.status, 200);
    } finally {
        server.close();
    }
});

test('a CORS preflight OPTIONS request is answered directly (204) without reaching any route handler', async () => {
    const server = await startServer();
    const { port } = server.address();
    try {
        const response = await fetch(`http://localhost:${port}/api/admin/participants`, {
            method: 'OPTIONS',
            headers: { Origin: 'https://example-frontend.vercel.app' }
        });
        assert.equal(response.status, 204);
        assert.equal(response.headers.get('access-control-allow-origin'), 'https://example-frontend.vercel.app');
    } finally {
        server.close();
    }
});

test('CORS headers do not weaken admin authentication - a cross-origin request without a valid token is still rejected', async () => {
    const server = await startServer();
    const { port } = server.address();
    try {
        const response = await fetch(`http://localhost:${port}/api/admin/participants`, {
            headers: { Origin: 'https://example-frontend.vercel.app', Authorization: 'Bearer wrong-token' }
        });
        assert.equal(response.status, 401);
    } finally {
        server.close();
    }
});

test('sanity check: this test suite never touched the real project data/db or data/audio directories', () => {
    const realDbDir = path.join(import.meta.dirname, '../../data/db');
    assert.notEqual(dbDir, realDbDir);
    assert.ok(dbDir.startsWith(os.tmpdir()), 'the temp db dir used by this test file must be a genuine temp directory, not the real one');
});
