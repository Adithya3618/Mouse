// app/frontend/js/config/apiBaseUrl.js - tested with manual stubs for the
// browser globals it uses (window.location, localStorage), matching this
// project's existing no-jsdom-dependency testing style. Each test
// installs/removes its own stubs so nothing leaks between tests.
// getApiBaseUrl()/buildApiUrl() read window/localStorage fresh on every
// call (not cached at module-load time), so a single shared import is
// fine - no need to re-import per test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getApiBaseUrl, buildApiUrl, clearApiBaseUrl } from '../../app/frontend/js/config/apiBaseUrl.js';

function stubBrowserGlobals({ search = '', store = {} } = {}) {
    const backing = { ...store };
    globalThis.window = { location: { search } };
    globalThis.localStorage = {
        getItem: (key) => (key in backing ? backing[key] : null),
        setItem: (key, value) => { backing[key] = String(value); },
        removeItem: (key) => { delete backing[key]; }
    };
    return backing;
}

function removeBrowserGlobals() {
    delete globalThis.window;
    delete globalThis.localStorage;
}

test('with no window/localStorage available (e.g. imported outside a browser), returns the same-origin default rather than throwing', () => {
    removeBrowserGlobals();
    assert.equal(getApiBaseUrl(), '');
    assert.equal(buildApiUrl('/api/admin/participants'), '/api/admin/participants');
});

test('with no ?apiBase= query param and nothing stored, defaults to same-origin (empty base)', () => {
    stubBrowserGlobals({ search: '' });
    assert.equal(getApiBaseUrl(), '');
    assert.equal(buildApiUrl('/api/recordings'), '/api/recordings');
    removeBrowserGlobals();
});

test('?apiBase=<url> in the query string is captured, persisted, and used to prefix subsequent paths', () => {
    const store = stubBrowserGlobals({ search: '?apiBase=https://my-tunnel.example.com' });
    assert.equal(getApiBaseUrl(), 'https://my-tunnel.example.com');
    assert.equal(store.mouseApiBaseUrl, 'https://my-tunnel.example.com');
    assert.equal(buildApiUrl('/api/admin/participants'), 'https://my-tunnel.example.com/api/admin/participants');
    assert.equal(buildApiUrl('api/without/leading/slash'), 'https://my-tunnel.example.com/api/without/leading/slash');
    removeBrowserGlobals();
});

test('a trailing slash on the configured base URL is normalized away (no double slash in the built URL)', () => {
    stubBrowserGlobals({ search: '?apiBase=https://my-tunnel.example.com/' });
    assert.equal(buildApiUrl('/api/recordings'), 'https://my-tunnel.example.com/api/recordings');
    removeBrowserGlobals();
});

test('once stored, the base URL persists across calls even without the query param present (a later page load)', () => {
    const store = stubBrowserGlobals({ search: '', store: { mouseApiBaseUrl: 'https://already-configured.example.com' } });
    assert.equal(getApiBaseUrl(), 'https://already-configured.example.com');
    assert.equal(store.mouseApiBaseUrl, 'https://already-configured.example.com');
    removeBrowserGlobals();
});

test('clearApiBaseUrl() removes the stored value, reverting to same-origin', () => {
    const store = stubBrowserGlobals({ search: '', store: { mouseApiBaseUrl: 'https://old.example.com' } });
    assert.equal(getApiBaseUrl(), 'https://old.example.com');
    clearApiBaseUrl();
    assert.equal(store.mouseApiBaseUrl, undefined);
    assert.equal(getApiBaseUrl(), '');
    removeBrowserGlobals();
});

test('the default (no base configured) behavior is unchanged from before this feature existed - every path is returned verbatim', () => {
    stubBrowserGlobals({ search: '' });
    for (const p of ['/api/recordings', '/api/admin/participants', '/saveScore', '/exportSessionResults', '/config/experimentConfig.js']) {
        assert.equal(buildApiUrl(p), p);
    }
    removeBrowserGlobals();
});
