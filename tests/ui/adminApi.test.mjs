// app/frontend/js/admin/adminApi.js - specifically the "no backend at this
// origin" vs. "backend legitimately said 404" distinction added to fix the
// confusing raw-HTML error the admin dashboard showed when apiBase isn't
// configured yet and this page has no backend of its own (e.g. served by
// api/frontend.js on Vercel - see docs/storage-architecture.md). Manual
// stubs for browser globals, matching apiBaseUrl.test.mjs's style.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminFetch } from '../../app/frontend/js/admin/adminApi.js';

function stubBrowserGlobals({ apiBase = '', token = 'stub-token' } = {}) {
    const localStore = apiBase ? { mouseApiBaseUrl: apiBase } : {};
    globalThis.window = { location: { search: '' }, prompt: () => token };
    globalThis.localStorage = {
        getItem: (key) => (key in localStore ? localStore[key] : null),
        setItem: (key, value) => { localStore[key] = String(value); },
        removeItem: (key) => { delete localStore[key]; }
    };
    const sessionStore = { mouseAdminApiToken: token };
    globalThis.sessionStorage = {
        getItem: (key) => (key in sessionStore ? sessionStore[key] : null),
        setItem: (key, value) => { sessionStore[key] = String(value); },
        removeItem: (key) => { delete sessionStore[key]; }
    };
}

function removeBrowserGlobals() {
    delete globalThis.window;
    delete globalThis.localStorage;
    delete globalThis.sessionStorage;
    delete globalThis.fetch;
}

function stubFetch(responseFactory) {
    globalThis.fetch = async (...args) => responseFactory(...args);
}

function htmlNotFoundResponse() {
    return new Response('<!DOCTYPE html><html><body><pre>Cannot GET /api/admin/participants</pre></body></html>', {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
}

function jsonNotFoundResponse() {
    return new Response(JSON.stringify({ error: 'Participant not found.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
    });
}

test('a same-origin 404 with an HTML body (no backend at this origin, apiBase not configured) throws the helpful "configure ?apiBase=" message', async () => {
    stubBrowserGlobals({ apiBase: '' });
    stubFetch(() => htmlNotFoundResponse());

    await assert.rejects(
        () => adminFetch('/api/admin/participants'),
        /No backend reachable at this page's own origin.*\?apiBase=/s
    );
    removeBrowserGlobals();
});

test('REGRESSION: a same-origin 404 with a JSON body (a genuine "not found" from our own backend) is NOT mistaken for "no backend" - the real error message still comes through', async () => {
    stubBrowserGlobals({ apiBase: '' });
    stubFetch(() => jsonNotFoundResponse());

    await assert.rejects(
        () => adminFetch('/api/admin/participants/does-not-exist'),
        (error) => {
            assert.match(error.message, /Participant not found/);
            assert.ok(!/No backend reachable/.test(error.message), 'must not show the "no backend" message for a real backend 404');
            return true;
        }
    );
    removeBrowserGlobals();
});

test('with apiBase configured (cross-origin), a 404 - JSON or not - is never treated as "no backend at this origin" (that check only applies to the unconfigured same-origin default)', async () => {
    stubBrowserGlobals({ apiBase: 'https://my-tunnel.example.com' });
    stubFetch((url) => {
        assert.equal(url, 'https://my-tunnel.example.com/api/admin/participants');
        return htmlNotFoundResponse();
    });

    await assert.rejects(
        () => adminFetch('/api/admin/participants'),
        (error) => {
            assert.ok(!/No backend reachable at this page's own origin/.test(error.message));
            return true;
        }
    );
    removeBrowserGlobals();
});

test('a successful (200, JSON) response is returned normally, unaffected by the new check', async () => {
    stubBrowserGlobals({ apiBase: '' });
    stubFetch(() => new Response(JSON.stringify({ participants: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await adminFetch('/api/admin/participants');
    assert.deepEqual(result, { participants: [] });
    removeBrowserGlobals();
});
