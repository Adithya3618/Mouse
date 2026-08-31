// SQLite connection factory (Node's built-in node:sqlite - no native
// dependency to install/compile). This is the reference/local-dev database
// implementation named in schema.sql's header comment; the repositories in
// app/backend/repositories/*.js are the only things that talk to it, so a
// UF-approved persistent database (e.g. Postgres) can be substituted later
// by giving repositories a same-shaped implementation against that database
// instead - nothing else in the app touches this file directly.
//
// Real (non-':memory:') databases are opened through researchDatabase.js's
// primary/secondary layer - see that file for the full data-safety design
// (durable manifest, integrity-checked secondary mirror, fail-closed
// startup recovery). This file is just the thin entry point tests and
// server.js actually call.
//
// NOT DURABLE on Vercel as deployed today: that platform's filesystem is
// ephemeral outside /tmp, wiped on every cold start and not shared between
// concurrent function instances. The primary/secondary machinery still runs
// there (so a single instance's own writes stay internally consistent), but
// it cannot survive a redeploy or a different instance handling the next
// request - see DURABILITY_MODE below and the startup log it produces. Real
// production durability needs a hosted database, not local/`/tmp` SQLite.

const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { openResearchDatabase, applySchema } = require('./researchDatabase');

const DEFAULT_DATA_DIR = path.join(__dirname, '../../../data/db');

// process.env.VERCEL is set to '1' by the platform on every deployment
// (build and runtime) - used only to pick /tmp and to label the
// non-durable status honestly, never to change any query/write behavior.
const VERCEL_FALLBACK_DATA_DIR = '/tmp/mouse-research-db';

function resolveDataDir(override) {
    if (override) {
        return override;
    }
    if (process.env.DB_PATH) {
        return process.env.DB_PATH;
    }
    return process.env.VERCEL ? VERCEL_FALLBACK_DATA_DIR : DEFAULT_DATA_DIR;
}

function durabilityMode(dataDir) {
    if (process.env.VERCEL && !process.env.DB_PATH) {
        return 'EPHEMERAL_TMP - NOT durable across deploys/restarts/instances. See app/backend/database/db.js header.';
    }
    return `PERSISTENT_LOCAL - ${dataDir}`;
}

// dbPath ':memory:' -> isolated, disposable single-connection database (no
// primary/secondary machinery - there is nothing to protect, the whole
// point is that it disappears when the process exits). Used only by the
// test suite so each test file gets its own connection with no shared
// state. Any other value is treated as the DATA DIRECTORY for the
// primary/secondary layer (this is a deliberate, documented change from the
// old single-file-path meaning - nothing currently sets DB_PATH, so nothing
// depended on the old meaning; see .env.example).
function createDatabase(dbPathOrDataDir) {
    if (dbPathOrDataDir === ':memory:') {
        const db = new DatabaseSync(':memory:');
        applySchema(db);
        return db;
    }

    const dataDir = resolveDataDir(dbPathOrDataDir);
    const { db, getStatus } = openResearchDatabase({ dataDir, logger: console.log });
    console.log(`[database] Durability mode: ${durabilityMode(dataDir)}`);
    // `db` already has its own waitForPendingSync() (see
    // researchDatabase.js's wrapWithSecondarySync) - only getStatus() needs
    // attaching here, since it's returned alongside `db` rather than on it.
    db.getStatus = getStatus;
    return db;
}

// Lazily-created singleton for the running server process (app/backend/server.js).
// Route/service code should receive a db instance via constructor injection
// (see repositories) rather than importing this singleton directly, so tests
// can supply their own isolated ':memory:' database instead.
let singleton = null;

function getDb() {
    if (!singleton) {
        singleton = createDatabase();
    }
    return singleton;
}

module.exports = { createDatabase, getDb };
