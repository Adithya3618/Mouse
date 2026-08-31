// The ONLY place in the application that decides which concrete
// ResearchDatabase/AudioStorage implementation to construct, and the ONLY
// place allowed to know about hosting-provider details (Vercel's /tmp
// fallback, env var names, etc.) - see docs/storage-architecture.md.
// Everything else (repositories, services, routes, the whole experiment)
// depends only on the interfaces those implementations satisfy
// (researchDatabaseContract.js / audioStorageContract.js).
//
// Selection is env-var driven and defaults to zero-config local
// development with no variables set at all:
//   DATABASE_PROVIDER=sqlite (default) | postgres
//   AUDIO_STORAGE_PROVIDER=local (default) | object

const path = require('node:path');
const { getDb } = require('../database/db');
const { LocalFilesystemAudioStorage } = require('../storage/audioStorage');

const DEFAULT_AUDIO_DIR = path.join(__dirname, '../../../data/audio');

// Vercel's filesystem is read-only outside /tmp - this is the one place
// that decision now lives (moved out of storage/audioStorage.js itself,
// which no longer knows what Vercel is). VERCEL is set to '1' by the
// platform on every deployment (build and runtime).
const VERCEL_FALLBACK_AUDIO_DIR = '/tmp/audio';

function databaseProvider() {
    return (process.env.DATABASE_PROVIDER || 'sqlite').trim().toLowerCase();
}

function audioStorageProvider() {
    return (process.env.AUDIO_STORAGE_PROVIDER || 'local').trim().toLowerCase();
}

// Returns a ResearchDatabase-conformant object (see
// database/researchDatabaseContract.js). 'sqlite' delegates straight to the
// existing, unmodified local primary/secondary system (db.js/
// researchDatabase.js) - identical behavior to before this module existed.
function createResearchDatabase({ logger = console.log } = {}) {
    const provider = databaseProvider();

    if (provider === 'sqlite') {
        return getDb();
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

function resolveLocalAudioDir() {
    if (process.env.AUDIO_STORAGE_DIR) {
        return process.env.AUDIO_STORAGE_DIR;
    }
    return process.env.VERCEL ? VERCEL_FALLBACK_AUDIO_DIR : DEFAULT_AUDIO_DIR;
}

// Returns an AudioStorage-conformant object (see
// storage/audioStorageContract.js).
function createAudioStorage({ logger = console.log } = {}) {
    const provider = audioStorageProvider();

    if (provider === 'local') {
        return new LocalFilesystemAudioStorage({ baseDir: resolveLocalAudioDir(), logger });
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
// No client is implemented yet (none has been provisioned - see
// docs/storage-architecture.md's "not yet implemented" note); this throws a
// clear, actionable error rather than silently doing something unsafe.
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
    audioStorageProvider
};
