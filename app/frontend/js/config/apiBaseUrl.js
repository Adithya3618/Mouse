// Configurable API base URL - the ONE place the frontend decides where the
// backend lives. By default this is empty, meaning every API/config
// request is same-origin relative (e.g. "/api/recordings") - identical to
// the app's behavior before this file existed, with zero configuration
// needed for the normal case (frontend and backend served together, as
// `npm start`/a real server deployment both do).
//
// This exists for exactly one temporary situation: a Vercel-hosted
// frontend needs to reach a backend running somewhere else (e.g. this
// project's own machine, exposed through a secure tunnel) while the UF
// server isn't available yet - see docs/storage-architecture.md. Visiting
// the frontend once with ?apiBase=<url> in the query string remembers that
// URL (in localStorage - it's just a URL, not a secret, unlike the admin
// token which deliberately uses sessionStorage) for every future visit,
// with no code change and no rebuild. Moving to the UF server later means
// changing (or clearing) this one value - nothing else in the frontend
// needs to know a base URL was ever involved.

const STORAGE_KEY = 'mouseApiBaseUrl';
const QUERY_PARAM = 'apiBase';

function normalize(url) {
    return url.replace(/\/+$/, '');
}

// Reads (and, the first time a ?apiBase=... query param appears, persists)
// the configured base URL. Returns '' for the default same-origin case.
export function getApiBaseUrl() {
    try {
        const params = new URLSearchParams(window.location.search);
        const fromQuery = params.get(QUERY_PARAM);
        if (fromQuery) {
            const normalized = normalize(fromQuery);
            localStorage.setItem(STORAGE_KEY, normalized);
            return normalized;
        }
        return localStorage.getItem(STORAGE_KEY) || '';
    } catch {
        // localStorage/URLSearchParams unavailable (e.g. some private-
        // browsing modes, or this module loaded outside a browser) - fall
        // back to the same-origin default rather than throwing.
        return '';
    }
}

export function clearApiBaseUrl() {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        // no-op
    }
}

// Prefixes a same-origin-style path ("/api/...", "/config/...") with the
// configured base URL, if any. Every fetch()/dynamic import() call site
// that talks to the backend goes through this, so there is exactly one
// place that decides same-origin vs. cross-origin.
export function buildApiUrl(path) {
    const base = getApiBaseUrl();
    if (!base) {
        return path;
    }
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
