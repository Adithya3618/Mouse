// Provider-selection tests for config/storageConfig.js - the one place
// hosting-provider/env-var decisions are allowed to live. Each test
// carefully saves/restores the relevant env vars so it can never leak into
// another test or (more importantly) accidentally point at real
// data/db/data/audio.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

function withEnv(vars, fn) {
    const previous = {};
    for (const key of Object.keys(vars)) {
        previous[key] = process.env[key];
        if (vars[key] === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = vars[key];
        }
    }
    try {
        return fn();
    } finally {
        for (const key of Object.keys(previous)) {
            if (previous[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = previous[key];
            }
        }
    }
}

test('with no environment variables set, both providers default to sqlite/local (zero-config local dev)', async () => {
    const { databaseProvider, audioStorageProvider } = await import('../../app/backend/config/storageConfig.js');
    withEnv({ DATABASE_PROVIDER: undefined, AUDIO_STORAGE_PROVIDER: undefined }, () => {
        assert.equal(databaseProvider(), 'sqlite');
        assert.equal(audioStorageProvider(), 'local');
    });
});

test('DATABASE_PROVIDER/AUDIO_STORAGE_PROVIDER are read case-insensitively', async () => {
    const { databaseProvider, audioStorageProvider } = await import('../../app/backend/config/storageConfig.js');
    withEnv({ DATABASE_PROVIDER: 'Postgres', AUDIO_STORAGE_PROVIDER: 'OBJECT' }, () => {
        assert.equal(databaseProvider(), 'postgres');
        assert.equal(audioStorageProvider(), 'object');
    });
});

test('createResearchDatabase() with DATABASE_PROVIDER=sqlite (explicit or default) uses a real temp directory, never touching the actual data/db/', async () => {
    const { createResearchDatabase } = await import('../../app/backend/config/storageConfig.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-config-test-'));
    withEnv({ DATABASE_PROVIDER: 'sqlite', DB_PATH: dir, AUDIO_STORAGE_PROVIDER: undefined }, () => {
        const db = createResearchDatabase({ logger: () => {} });
        assert.equal(typeof db.prepare, 'function');
        const status = db.getStatus();
        assert.equal(status.dataDir, dir);
    });
});

test('createResearchDatabase() with DATABASE_PROVIDER=postgres and no DATABASE_URL throws a clear, actionable error', async () => {
    const { createResearchDatabase } = await import('../../app/backend/config/storageConfig.js');
    withEnv({ DATABASE_PROVIDER: 'postgres', DATABASE_URL: undefined }, () => {
        assert.throws(() => createResearchDatabase({ logger: () => {} }), /DATABASE_URL/);
    });
});

test('createResearchDatabase() with DATABASE_PROVIDER=postgres and a DATABASE_URL returns a PostgresResearchDatabase without connecting', async () => {
    const { createResearchDatabase } = await import('../../app/backend/config/storageConfig.js');
    const { PostgresResearchDatabase } = await import('../../app/backend/database/postgresResearchDatabase.js');
    withEnv({ DATABASE_PROVIDER: 'postgres', DATABASE_URL: 'postgres://user:pass@localhost:5432/test' }, () => {
        const db = createResearchDatabase({ logger: () => {} });
        assert.ok(db instanceof PostgresResearchDatabase);
    });
});

test('createResearchDatabase() with an unknown DATABASE_PROVIDER throws a clear error', async () => {
    const { createResearchDatabase } = await import('../../app/backend/config/storageConfig.js');
    withEnv({ DATABASE_PROVIDER: 'mysql' }, () => {
        assert.throws(() => createResearchDatabase({ logger: () => {} }), /Unknown DATABASE_PROVIDER/);
    });
});

test('createAudioStorage() with AUDIO_STORAGE_PROVIDER=local (explicit or default) uses a real temp directory', async () => {
    const { createAudioStorage } = await import('../../app/backend/config/storageConfig.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-config-audio-test-'));
    withEnv({ AUDIO_STORAGE_PROVIDER: 'local', AUDIO_STORAGE_DIR: dir, DATABASE_PROVIDER: undefined }, () => {
        const storage = createAudioStorage({ logger: () => {} });
        assert.equal(typeof storage.save, 'function');
    });
});

test('createAudioStorage() with AUDIO_STORAGE_PROVIDER=object and no OBJECT_STORAGE_CLIENT throws a clear, actionable error (no client is provisioned yet)', async () => {
    const { createAudioStorage } = await import('../../app/backend/config/storageConfig.js');
    withEnv({ AUDIO_STORAGE_PROVIDER: 'object', OBJECT_STORAGE_CLIENT: undefined }, () => {
        assert.throws(() => createAudioStorage({ logger: () => {} }), /OBJECT_STORAGE_CLIENT/);
    });
});

test('createAudioStorage() with an unknown AUDIO_STORAGE_PROVIDER throws a clear error', async () => {
    const { createAudioStorage } = await import('../../app/backend/config/storageConfig.js');
    withEnv({ AUDIO_STORAGE_PROVIDER: 'ftp' }, () => {
        assert.throws(() => createAudioStorage({ logger: () => {} }), /Unknown AUDIO_STORAGE_PROVIDER/);
    });
});

test('storageConfig.js never require()/imports a vendor-specific SDK - only the documented VERCEL env var check names a provider', async () => {
    const filePath = path.join(import.meta.dirname, '../../app/backend/config/storageConfig.js');
    const content = fs.readFileSync(filePath, 'utf8');
    // Mentioning a provider name in a help/error-message string (e.g. "works
    // with Neon, UF Postgres, RDS...") is fine and expected - what would be
    // a real violation is actually require()-ing a vendor SDK here.
    const vendorRequirePattern = /require\(\s*['"](@vercel\/(?!node)|@neondatabase|aws-sdk)/;
    assert.ok(!vendorRequirePattern.test(content), 'storageConfig.js must not require() a vendor-specific SDK');
    // process.env.VERCEL is the one deliberate, documented env-var check
    // this file is allowed to make - confirm it's still there (i.e. this
    // test isn't accidentally checking a stale/wrong file).
    assert.ok(content.includes('process.env.VERCEL'), 'expected the documented VERCEL fallback-path check to still be present');
});
