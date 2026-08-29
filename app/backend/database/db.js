// SQLite connection factory (Node's built-in node:sqlite - no native
// dependency to install/compile). This is the reference/local-dev database
// implementation named in schema.sql's header comment; the repositories in
// app/backend/repositories/*.js are the only things that talk to it, so a
// UF-approved persistent database (e.g. Postgres) can be substituted later
// by giving repositories a same-shaped implementation against that database
// instead - nothing else in the app touches this file directly.
//
// NOT SUITABLE for Vercel's serverless target as-is: that platform's
// filesystem is ephemeral outside /tmp, so a SQLite file written there does
// not persist across invocations. Fine for local development/testing and
// for a single long-running Node process (`npm start`), which is this
// project's only currently-configured way to actually run the backend.

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const DEFAULT_DB_PATH = path.join(__dirname, '../../../data/db/research.sqlite');

// Vercel's filesystem is read-only outside /tmp - opening DEFAULT_DB_PATH
// there throws and crashes the whole serverless function on every request,
// even ones that never touch the database. VERCEL is set to '1' by the
// platform on every deployment (build and runtime), so this only changes
// behavior there; local dev (`npm start`) and tests are unaffected and keep
// using the real persistent data/db/research.sqlite unless DB_PATH is set
// explicitly. Data written to /tmp on Vercel does NOT persist across cold
// starts - this stops the crash, it does not make Vercel a real deployment
// target for the recording/transcription pipeline (see this file's header).
const VERCEL_FALLBACK_DB_PATH = '/tmp/research.sqlite';

function resolveDbPath(dbPath) {
    if (dbPath) {
        return dbPath;
    }
    if (process.env.DB_PATH) {
        return process.env.DB_PATH;
    }
    return process.env.VERCEL ? VERCEL_FALLBACK_DB_PATH : DEFAULT_DB_PATH;
}

// Opens (creating if necessary) a database at `dbPath` and applies the
// schema (idempotent - CREATE TABLE IF NOT EXISTS throughout). Pass
// ':memory:' for an isolated, disposable database (used by tests so each
// test file gets its own connection with no shared state).
function createDatabase(dbPath) {
    const resolvedPath = resolveDbPath(dbPath);
    if (resolvedPath !== ':memory:') {
        fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
        // Non-sensitive (just a filesystem path, never credentials/audio/
        // transcript content) - lets anyone starting the server confirm at a
        // glance that it's pointed at a real, persistent file rather than
        // ':memory:' or some other transient location. Skipped for ':memory:'
        // itself (used only by the test suite, which creates many
        // short-lived databases per run) to avoid log spam there.
        console.log(`[database] Using persistent database: ${resolvedPath}`);
    }

    const db = new DatabaseSync(resolvedPath);
    db.exec('PRAGMA foreign_keys = ON;');
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(schema);
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
