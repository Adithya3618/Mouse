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
// config/storageConfig.js actually call.
//
// This file has NO knowledge of Vercel, `/tmp`, DATA_DIR, or any other
// hosting-provider or environment-variable concept - see
// config/storageConfig.js, the one place that resolves a directory and
// passes it in here explicitly. That is a deliberate separation: this file
// only knows how to open a database at a path it's given.

const { DatabaseSync } = require('node:sqlite');
const { openResearchDatabase, applySchema } = require('./researchDatabase');

// dataDir ':memory:' -> isolated, disposable single-connection database (no
// primary/secondary machinery - there is nothing to protect, the whole
// point is that it disappears when the process exits). Used only by the
// test suite so each test file gets its own connection with no shared
// state. Any other value is the DATA DIRECTORY for the primary/secondary
// layer, and is REQUIRED - there is no default location here (see
// config/storageConfig.js for where the actual default/DATA_DIR resolution
// happens).
function createDatabase(dataDir) {
    if (dataDir === ':memory:') {
        const db = new DatabaseSync(':memory:');
        applySchema(db);
        return db;
    }
    if (!dataDir) {
        throw new Error('createDatabase() requires an explicit data directory (or \':memory:\') - see config/storageConfig.js for path resolution.');
    }

    const { db, getStatus } = openResearchDatabase({ dataDir, logger: console.log });
    console.log(`[database] Persistent storage: ${dataDir}`);
    // `db` already has its own waitForPendingSync() (see
    // researchDatabase.js's wrapWithSecondarySync) - only getStatus() needs
    // attaching here, since it's returned alongside `db` rather than on it.
    db.getStatus = getStatus;
    return db;
}

// Lazily-created, per-directory singleton cache - a defensive safety net
// against ever accidentally opening the SAME on-disk database twice within
// one process (which would mean two independent primary/secondary
// machinery instances fighting over the same files), while still allowing
// legitimately different directories to each get their own independent
// connection within one process - the normal case in tests (many temp
// directories in one test file/process) and harmless in a real server
// (which only ever resolves one directory for its whole lifetime anyway).
// Route/service code should receive a db instance via constructor injection
// (see repositories) rather than importing this cache directly, so tests
// can supply their own isolated ':memory:' database instead.
const instances = new Map();

function getDb(dataDir) {
    if (!dataDir) {
        throw new Error('getDb() requires an explicit data directory - see config/storageConfig.js.');
    }
    if (!instances.has(dataDir)) {
        instances.set(dataDir, createDatabase(dataDir));
    }
    return instances.get(dataDir);
}

module.exports = { createDatabase, getDb };
