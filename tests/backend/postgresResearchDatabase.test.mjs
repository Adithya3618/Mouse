// PostgresResearchDatabase tests. This sandbox has no live Postgres server
// available, so live CRUD is only exercised when TEST_DATABASE_URL is set
// (e.g. in an environment that does have one) - every other test here
// verifies what's actually verifiable without one: instantiation/config
// requirements, the '?' -> '$n' placeholder translator (a pure function),
// and that the file depends on nothing but the standard `pg` package (no
// Neon/Vercel-specific SDK - see the file's own header for why that
// matters for portability to future UF infrastructure).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { PostgresResearchDatabase, translatePlaceholders } from '../../app/backend/database/postgresResearchDatabase.js';
import { assertImplementsResearchDatabase } from '../../app/backend/database/researchDatabaseContract.js';

test('requires a connectionString - throws a clear error without one, never connects to a default/guessed host', () => {
    assert.throws(() => new PostgresResearchDatabase({}), /connectionString/);
    assert.throws(() => new PostgresResearchDatabase(), /connectionString/);
});

test('can be instantiated with only a connectionString - no Neon/Vercel-specific configuration required', () => {
    const db = new PostgresResearchDatabase({ connectionString: 'postgres://user:pass@localhost:5432/test', logger: () => {} });
    assert.ok(db);
    // Constructing must not itself open a network connection (schema
    // application is lazy - see _ensureReady()) - a bogus host above must
    // not have thrown synchronously.
});

test('satisfies the formal ResearchDatabase contract shape (prepare/exec/close)', () => {
    const db = new PostgresResearchDatabase({ connectionString: 'postgres://user:pass@localhost:5432/test', logger: () => {} });
    assert.doesNotThrow(() => assertImplementsResearchDatabase(db));
});

test('placeholder translator: converts "?" to "$1", "$2", ... in order, left to right', () => {
    assert.equal(translatePlaceholders('SELECT * FROM t WHERE a = ?'), 'SELECT * FROM t WHERE a = $1');
    assert.equal(translatePlaceholders('INSERT INTO t (a, b, c) VALUES (?, ?, ?)'), 'INSERT INTO t (a, b, c) VALUES ($1, $2, $3)');
    assert.equal(
        translatePlaceholders('INSERT INTO t (a, b) VALUES (?, (SELECT COALESCE(MAX(v),0)+1 FROM t WHERE a = ?))'),
        'INSERT INTO t (a, b) VALUES ($1, (SELECT COALESCE(MAX(v),0)+1 FROM t WHERE a = $2))'
    );
    assert.equal(translatePlaceholders('SELECT 1'), 'SELECT 1');
});

test('depends only on the standard "pg" package - no @vercel/postgres or @neondatabase/serverless require() anywhere in the file (portability requirement)', () => {
    const filePath = path.join(import.meta.dirname, '../../app/backend/database/postgresResearchDatabase.js');
    const content = fs.readFileSync(filePath, 'utf8');
    assert.ok(content.includes("require('pg')"), 'must use the standard pg package');
    // Only flags an actual require(...)/import of a vendor SDK - not a
    // comment merely mentioning why it was deliberately avoided.
    const vendorRequirePattern = /require\(\s*['"](@vercel\/postgres|@neondatabase\/serverless)['"]\s*\)|from\s+['"](@vercel\/postgres|@neondatabase\/serverless)['"]/;
    assert.ok(!vendorRequirePattern.test(content), 'must not require()/import a vendor-specific Postgres SDK');
});

test('package.json depends on "pg" directly (not a vendor-specific driver)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../package.json'), 'utf8'));
    assert.ok(pkg.dependencies.pg, 'pg must be a declared dependency');
    assert.ok(!pkg.dependencies['@vercel/postgres'], 'must not depend on @vercel/postgres');
    assert.ok(!pkg.dependencies['@neondatabase/serverless'], 'must not depend on @neondatabase/serverless');
});

// Only runs with a real Postgres available - set TEST_DATABASE_URL to
// exercise this. Skipped (not failed) otherwise, with a clear message
// explaining why, rather than silently pretending full coverage exists.
const liveUrl = process.env.TEST_DATABASE_URL;
test('live CRUD round-trip against a real Postgres database', { skip: !liveUrl ? 'TEST_DATABASE_URL not set - no live Postgres available in this environment' : false }, async () => {
    const db = new PostgresResearchDatabase({ connectionString: liveUrl, logger: () => {} });
    try {
        await db.exec('CREATE TABLE IF NOT EXISTS _portability_test (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
        await db.prepare('INSERT INTO _portability_test (id, value) VALUES (?, ?)').run('a', 'hello');
        const row = await db.prepare('SELECT * FROM _portability_test WHERE id = ?').get('a');
        assert.equal(row.value, 'hello');
        const all = await db.prepare('SELECT * FROM _portability_test').all();
        assert.ok(all.length >= 1);
        await db.exec('DROP TABLE _portability_test');
    } finally {
        await db.close();
    }
});
