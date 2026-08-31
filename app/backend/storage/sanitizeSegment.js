// Shared by every AudioStorage implementation (local filesystem, object
// storage) - defends against a malicious/malformed id ever escaping into a
// path/key it shouldn't (e.g. "../../etc"). ids in practice are always our
// own generated uuids/session ids, but this makes the guarantee structural
// rather than incidental, identically for every backend.

function sanitizeSegment(segment) {
    const value = String(segment ?? '');
    if (!value || value.includes('..') || value.includes('/') || value.includes('\\')) {
        throw new Error(`Invalid path segment for audio storage: ${JSON.stringify(segment)}`);
    }
    return value;
}

module.exports = { sanitizeSegment };
