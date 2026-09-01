// Thin fetch wrapper for the admin/research dashboard. NOT participant-
// facing - every page under app/frontend/admin/ imports this. Holds the
// shared-secret admin token (see app/backend/routes/adminAuth.js) in
// sessionStorage only (never localStorage, never a URL/query string, never
// written to disk) - it is cleared automatically when the browser tab
// closes, and cleared explicitly here the moment the server rejects it.

import { buildApiUrl, getApiBaseUrl } from '../config/apiBaseUrl.js';

const TOKEN_STORAGE_KEY = 'mouseAdminApiToken';

function getStoredToken() {
    try {
        return sessionStorage.getItem(TOKEN_STORAGE_KEY);
    } catch {
        return null;
    }
}

function storeToken(token) {
    try {
        sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    } catch {
        // sessionStorage unavailable (e.g. private browsing) - the token is
        // simply re-prompted for on the next call instead of persisting.
    }
}

function clearStoredToken() {
    try {
        sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
        // no-op
    }
}

function getToken({ forcePrompt = false } = {}) {
    let token = forcePrompt ? null : getStoredToken();
    if (!token) {
        token = window.prompt('Enter the admin API token (see ADMIN_API_TOKEN in .env):');
        if (token) {
            storeToken(token);
        }
    }
    return token;
}

// GET/POST JSON against /api/admin/*. Retries once with a re-prompted token
// if the server rejects the first one (401) - never silently proceeds
// without a valid token.
export async function adminFetch(path, options = {}) {
    let token = getToken();
    let response = await doFetch(path, options, token);

    if (response.status === 401) {
        clearStoredToken();
        token = getToken({ forcePrompt: true });
        response = await doFetch(path, options, token);
    }

    if (response.status === 503) {
        throw new Error('The admin API is not configured on this server (ADMIN_API_TOKEN is unset). See .env.example.');
    }
    if (response.status === 404 && !getApiBaseUrl() && !isJsonResponse(response)) {
        // A same-origin 404 that ISN'T JSON is not our backend answering
        // "not found" (see routes/admin.js, which always responds
        // res.status(404).json({...}) - that case is deliberately left to
        // fall through to the generic handling below, unchanged, so
        // "participant not found" still shows correctly). This is instead
        // Express's own default "Cannot GET ..." HTML page, meaning there
        // is no backend at all at this page's own origin - e.g. this page
        // is served by api/frontend.js on Vercel (frontend-only by design -
        // see docs/storage-architecture.md), and no ?apiBase=<url> has been
        // configured yet to point it at the real one.
        throw new Error(
            `No backend reachable at this page's own origin for ${path}. If the backend runs elsewhere ` +
            `(a local/tunneled server, or a separate UF deployment), reload this page with ` +
            `?apiBase=<your-backend-url> added to the URL once - it will be remembered for future visits.`
        );
    }
    if (!response.ok) {
        const body = await safeReadText(response);
        throw new Error(`Request to ${path} failed (${response.status}): ${body || response.statusText}`);
    }
    return response.json();
}

// Audio elements cannot attach an Authorization header to their own
// request, so the recording is fetched here (with the header) as a Blob and
// handed back as a short-lived object URL for an <audio> element's src.
export async function fetchAudioObjectUrl(recordingId) {
    const token = getToken();
    const response = await doFetch(`/api/admin/recordings/${recordingId}/audio`, {}, token);
    if (!response.ok) {
        throw new Error(`Failed to load audio (${response.status})`);
    }
    const blob = await response.blob();
    return URL.createObjectURL(blob);
}

async function doFetch(path, options, token) {
    return fetch(buildApiUrl(path), {
        ...options,
        headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` }
    });
}

function isJsonResponse(response) {
    return (response.headers.get('content-type') || '').includes('application/json');
}

async function safeReadText(response) {
    try {
        return await response.text();
    } catch {
        return '';
    }
}
