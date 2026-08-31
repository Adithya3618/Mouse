// Postgres implementation of the ResearchDatabase contract (see
// researchDatabaseContract.js). Built on the standard `pg` package only -
// deliberately NOT @vercel/postgres or @neondatabase/serverless, which
// would tie this file to one hosting provider. `pg` speaks the plain
// Postgres wire protocol, so this same file works unmodified against Neon
// (current production plan), a future UF-hosted Postgres server, RDS, or
// any other Postgres-compatible endpoint - only DATABASE_URL changes.
//
// Repositories (app/backend/repositories/*.js) write SQL using SQLite-style
// '?' positional placeholders, unaware of which backend they're talking to
// (see repositories/participantRepository.js's header comment). This class
// translates '?' -> '$1', '$2', ... internally so that SQL text never needs
// to differ between SQLiteResearchDatabase and this implementation.
//
// Schema application is lazy (see _ensureReady()) rather than done eagerly
// in the constructor: opening a Pool is synchronous/cheap, but actually
// running the schema requires a real network round trip, and this class's
// constructor - like SQLiteResearchDatabase's factory - is called
// synchronously from config/storageConfig.js, which appContext.js (in turn
// called synchronously from server.js's module-level code) also expects to
// be synchronous. The first real query transparently awaits schema
// readiness before running, so callers never need to know the difference.

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_PATH = path.join(__dirname, 'postgresSchema.sql');

function translatePlaceholders(sql) {
    let index = 0;
    return sql.replace(/\?/g, () => `$${++index}`);
}

class PostgresResearchDatabase {
    constructor({ connectionString, logger = console.log, poolOptions = {} } = {}) {
        if (!connectionString) {
            throw new Error('PostgresResearchDatabase requires a connectionString (see DATABASE_URL in .env.example).');
        }
        // Required lazily, not at module load, so requiring this file (e.g.
        // for tests that only check config/instantiation, never a live
        // connection) never fails just because `pg` isn't installed in some
        // minimal environment - though it is a normal dependency here (see
        // package.json).
        const { Pool } = require('pg');
        this._pool = new Pool({ connectionString, ...poolOptions });
        this._logger = logger;
        this._readyPromise = null;
        logger(`[database] PostgresResearchDatabase configured (connection details never logged).`);
    }

    _ensureReady() {
        if (!this._readyPromise) {
            this._readyPromise = this._applySchema();
        }
        return this._readyPromise;
    }

    // CREATE TABLE/INDEX IF NOT EXISTS only, identically to
    // SQLiteResearchDatabase's applySchema() - always idempotent, never
    // destructive, safe to run against a database that already has real
    // research data in every table.
    async _applySchema() {
        const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
        await this._pool.query(schema);
        this._logger('[database] Postgres schema applied (CREATE TABLE/INDEX IF NOT EXISTS - idempotent, non-destructive).');
    }

    prepare(sql) {
        const translatedSql = translatePlaceholders(sql);
        const pool = this._pool;
        const ensureReady = () => this._ensureReady();
        return {
            async run(...params) {
                await ensureReady();
                await pool.query(translatedSql, params);
            },
            async get(...params) {
                await ensureReady();
                const result = await pool.query(translatedSql, params);
                return result.rows[0];
            },
            async all(...params) {
                await ensureReady();
                const result = await pool.query(translatedSql, params);
                return result.rows;
            }
        };
    }

    async exec(sql) {
        await this._ensureReady();
        await this._pool.query(sql);
    }

    async close() {
        await this._pool.end();
    }
}

module.exports = { PostgresResearchDatabase, translatePlaceholders };
