// The ONLY place in the application that decides which concrete
// ResearchDatabase/AudioStorage implementation to construct, and the ONLY
// place allowed to know about deployment/environment configuration - see
// docs/storage-architecture.md. Everything else (repositories, services,
// routes, the whole experiment) depends only on the interfaces those
// implementations satisfy (researchDatabaseContract.js /
// audioStorageContract.js).
//
// This file has NO knowledge of any specific hosting provider (Vercel,
// UF, or otherwise) - storage is selected purely through explicit
// configuration:
//   DATABASE_PROVIDER=sqlite (default) | postgres
//   AUDIO_STORAGE_PROVIDER=local (default) | object
//   DATA_DIR=<path>              single persistent-storage root (optional
//                                convenience - see resolveDataDirRoot()
//                                below); DB_PATH/AUDIO_STORAGE_DIR, if set,
//                                take precedence over it individually.
//
// With nothing set at all, both providers default to sqlite/local against
// the project-relative data/db, data/audio - zero-config local
// development, unchanged from before this file existed.
//
// PRODUCTION SAFETY: when NODE_ENV=production (the standard, host-agnostic
// Node.js convention for "this is a real deployment" - set explicitly by
// whoever configures the server, never inferred from a specific hosting
// provider), storage MUST be explicitly configured for durability - either
// DATABASE_PROVIDER=postgres+DATABASE_URL, or DATABASE_PROVIDER=sqlite (the
// default) with an explicit DATA_DIR/DB_PATH pointed at a real persistent
// filesystem path (never the bare project-relative default, which could
// silently sit on ephemeral/rebuilt storage on some hosts). Same rule for
// audio. This is what makes it impossible to silently repeat the earlier
// incident (a production deployment quietly running on ephemeral storage
// and looking healthy) - see docs/storage-architecture.md's incident
// writeup - without hard-coding any particular platform's name into this
// check.

const path = require('node:path');
const { getDb } = require('../database/db');
const { LocalFilesystemAudioStorage } = require('../storage/audioStorage');

const DEFAULT_DB_DIR = path.join(__dirname, '../../../data/db');
const DEFAULT_AUDIO_DIR = path.join(__dirname, '../../../data/audio');

function databaseProvider() {
    return (process.env.DATABASE_PROVIDER || 'sqlite').trim().toLowerCase();
}

function audioStorageProvider() {
    return (process.env.AUDIO_STORAGE_PROVIDER || 'local').trim().toLowerCase();
}

function isProductionEnv() {
    return process.env.NODE_ENV === 'production';
}

// DB_PATH/AUDIO_STORAGE_DIR (if set) are the most specific override and
// always win. Otherwise, DATA_DIR (if set) is a single convenience root -
// DATA_DIR/db and DATA_DIR/audio - matching the on-disk layout documented
// in docs/storage-architecture.md. With neither set, the project-relative
// local defaults apply (local dev only).
function resolveDbDir() {
    if (process.env.DB_PATH) return process.env.DB_PATH;
    if (process.env.DATA_DIR) return path.join(process.env.DATA_DIR, 'db');
    return DEFAULT_DB_DIR;
}

function resolveAudioDir() {
    if (process.env.AUDIO_STORAGE_DIR) return process.env.AUDIO_STORAGE_DIR;
    if (process.env.DATA_DIR) return path.join(process.env.DATA_DIR, 'audio');
    return DEFAULT_AUDIO_DIR;
}

function wasDbPathExplicitlyConfigured() {
    return Boolean(process.env.DB_PATH || process.env.DATA_DIR);
}

function wasAudioPathExplicitlyConfigured() {
    return Boolean(process.env.AUDIO_STORAGE_DIR || process.env.DATA_DIR);
}

// Returns a ResearchDatabase-conformant object (see
// database/researchDatabaseContract.js). 'sqlite' delegates straight to the
// existing, unmodified local primary/secondary system (db.js/
// researchDatabase.js) - identical behavior to before this module existed.
function createResearchDatabase({ logger = console.log } = {}) {
    const provider = databaseProvider();

    if (provider === 'sqlite') {
        if (isProductionEnv() && !wasDbPathExplicitlyConfigured()) {
            throw new Error(
                'Persistent research storage is not configured. Refusing to start because research data must not be ' +
                'stored on an unconfirmed, possibly non-persistent path in production. Set DATA_DIR (or the more ' +
                'specific DB_PATH) to a real, persistent filesystem directory on this server, or set ' +
                'DATABASE_PROVIDER=postgres with DATABASE_URL instead.'
            );
        }
        return getDb(resolveDbDir());
    }

    if (provider === 'postgres') {
        const { PostgresResearchDatabase } = require('../database/postgresResearchDatabase');
        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) {
            throw new Error(
                'DATABASE_PROVIDER=postgres requires DATABASE_URL to be set (a standard Postgres ' +
                'connection string - works with Neon, UF Postgres, RDS, or any Postgres-compatible host).'
            );
        }
        return new PostgresResearchDatabase({ connectionString, logger });
    }

    throw new Error(`Unknown DATABASE_PROVIDER: "${provider}". Expected "sqlite" or "postgres".`);
}

// Returns an AudioStorage-conformant object (see
// storage/audioStorageContract.js). Same production-configuration
// requirement as createResearchDatabase() above.
function createAudioStorage({ logger = console.log } = {}) {
    const provider = audioStorageProvider();

    if (provider === 'local') {
        if (isProductionEnv() && !wasAudioPathExplicitlyConfigured()) {
            throw new Error(
                'Persistent research audio storage is not configured. Refusing to start because research audio must ' +
                'not be stored on an unconfirmed, possibly non-persistent path in production. Set DATA_DIR (or the ' +
                'more specific AUDIO_STORAGE_DIR) to a real, persistent filesystem directory on this server.'
            );
        }
        return new LocalFilesystemAudioStorage({ baseDir: resolveAudioDir(), logger });
    }

    if (provider === 'object') {
        const { ObjectStorageAudioStorage } = require('../storage/objectStorageAudioStorage');
        const client = createObjectStorageClient({ logger });
        return new ObjectStorageAudioStorage({ client, logger });
    }

    throw new Error(`Unknown AUDIO_STORAGE_PROVIDER: "${provider}". Expected "local" or "object".`);
}

// Which concrete object-storage CLIENT backs ObjectStorageAudioStorage is
// itself env-var selected, so ObjectStorageAudioStorage stays fully
// provider-blind - it only ever depends on the small put/get/head/delete
// client shape (see objectStorageAudioStorage.js), never a vendor SDK.
// No client is implemented yet, and none is planned while the persistent-
// filesystem architecture (AUDIO_STORAGE_PROVIDER=local + DATA_DIR) is in
// use - see docs/storage-architecture.md. This throws a clear, actionable
// error rather than silently doing something unsafe.
function createObjectStorageClient({ logger }) {
    const clientType = (process.env.OBJECT_STORAGE_CLIENT || '').trim().toLowerCase();
    throw new Error(
        `AUDIO_STORAGE_PROVIDER=object requires OBJECT_STORAGE_CLIENT to name a configured client adapter. ` +
        `None is implemented yet (see docs/storage-architecture.md) - this is deliberate: no object-storage ` +
        `credentials have been provisioned, and none should be added without an explicit decision. Got: "${clientType || '(not set)'}".`
    );
}

module.exports = {
    createResearchDatabase,
    createAudioStorage,
    databaseProvider,
    audioStorageProvider,
    resolveDbDir,
    resolveAudioDir
};
