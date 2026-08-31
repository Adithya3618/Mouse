// Durable metadata for the primary/secondary research database (see
// researchDatabase.js). The manifest is the SINGLE source of truth for
// which on-disk slot ('a' or 'b') is currently the live/active database and
// whether each slot's last-known state was verified - startup NEVER infers
// this from filenames or file presence alone (per the data-safety
// requirement that drove this design).
//
// Written atomically: every update is written to a temp file in the same
// directory, fsync'd, then renamed over the real manifest.json. A rename
// within one directory is atomic on POSIX filesystems - a crash mid-write
// can only ever leave the OLD manifest.json in place (still fully valid) or
// the NEW one fully in place, never a half-written file.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MANIFEST_FILENAME = 'manifest.json';
const SCHEMA_VERSION = 1;

function manifestPath(dataDir) {
    return path.join(dataDir, MANIFEST_FILENAME);
}

function readManifest(dataDir) {
    const file = manifestPath(dataDir);
    if (!fs.existsSync(file)) {
        return null;
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || !parsed.slots || !parsed.active) {
            return { corrupt: true, raw: parsed };
        }
        return parsed;
    } catch (error) {
        // A manifest that fails to parse is itself a fail-closed signal,
        // never treated as "no manifest" (which would fall through to
        // fresh-install logic) - see researchDatabase.js's startup flow.
        return { corrupt: true, error: error.message };
    }
}

// Atomic write: temp file in the same directory (so the rename is on one
// filesystem) + fsync of the temp file's contents + fsync of the directory
// entry itself (best-effort - not all platforms/filesystems support
// directory fsync via Node, so that step is wrapped and never fatal).
function writeManifest(dataDir, manifest) {
    const file = manifestPath(dataDir);
    const tmpFile = path.join(dataDir, `.manifest.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
    const serialized = JSON.stringify({ ...manifest, schemaVersion: SCHEMA_VERSION }, null, 2);

    const fd = fs.openSync(tmpFile, 'w');
    try {
        fs.writeSync(fd, serialized);
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }

    fs.renameSync(tmpFile, file);

    try {
        const dirFd = fs.openSync(dataDir, 'r');
        try {
            fs.fsyncSync(dirFd);
        } finally {
            fs.closeSync(dirFd);
        }
    } catch {
        // Directory fsync isn't supported everywhere (e.g. some Windows
        // filesystems) - the file-level fsync + atomic rename above already
        // gives us the real safety guarantee, so this is best-effort only.
    }
}

function emptyManifest() {
    return {
        schemaVersion: SCHEMA_VERSION,
        active: null,
        slots: {
            a: { generation: 0, status: 'MISSING', sha256: null, rowCounts: null, updatedAt: null },
            b: { generation: 0, status: 'MISSING', sha256: null, rowCounts: null, updatedAt: null }
        },
        lastPromotionAt: null,
        lastRecoveryEvent: null
    };
}

module.exports = { readManifest, writeManifest, emptyManifest, manifestPath, SCHEMA_VERSION };
