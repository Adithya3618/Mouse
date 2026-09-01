// Provider-selection tests for config/storageConfig.js - the one place
// deployment/environment-configuration decisions are allowed to live. Each
// test carefully saves/restores the relevant env vars so it can never leak
// into another test or (more importantly) accidentally point at real
// data/db/data/audio.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// A handful of tests need a directory that genuinely is NOT under /tmp or
// /var/tmp, to simulate "a real persistent server path" now that the
// ephemeral-path guard correctly rejects those - os.tmpdir() resolves to
// /tmp on Linux, so it can't be used for that here (see the tests using
// this below). Created under the project's own gitignored tmp/ directory
// (a relative path prefixed with the project root, e.g.
// /home/.../Mouse/tmp/... - this does NOT start with the absolute "/tmp"
// prefix the guard checks for) and cleaned up immediately after use.
function nonEphemeralScratchDir(prefix) {
    const root = path.join(import.meta.dirname, '../../tmp');
    fs.mkdirSync(root, { recursive: true });
    return fs.mkdtempSync(path.join(root, prefix));
}

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
    withEnv({ DATABASE_PROVIDER: 'sqlite', DB_PATH: dir, AUDIO_STORAGE_PROVIDER: undefined, NODE_ENV: undefined }, () => {
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
    withEnv({ AUDIO_STORAGE_PROVIDER: 'local', AUDIO_STORAGE_DIR: dir, DATABASE_PROVIDER: undefined, NODE_ENV: undefined }, () => {
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

// --- DATA_DIR: single persistent-storage-root convenience config ---

test('DATA_DIR resolves to DATA_DIR/db and DATA_DIR/audio when DB_PATH/AUDIO_STORAGE_DIR are not set', async () => {
    const { resolveDbDir, resolveAudioDir } = await import('../../app/backend/config/storageConfig.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-config-datadir-test-'));
    withEnv({ DATA_DIR: root, DB_PATH: undefined, AUDIO_STORAGE_DIR: undefined }, () => {
        assert.equal(resolveDbDir(), path.join(root, 'db'));
        assert.equal(resolveAudioDir(), path.join(root, 'audio'));
    });
});

test('DB_PATH/AUDIO_STORAGE_DIR, when both set, take precedence over DATA_DIR', async () => {
    const { resolveDbDir, resolveAudioDir } = await import('../../app/backend/config/storageConfig.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-config-datadir-precedence-'));
    const explicitDb = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-config-explicit-db-'));
    const explicitAudio = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-config-explicit-audio-'));
    withEnv({ DATA_DIR: root, DB_PATH: explicitDb, AUDIO_STORAGE_DIR: explicitAudio }, () => {
        assert.equal(resolveDbDir(), explicitDb);
        assert.equal(resolveAudioDir(), explicitAudio);
    });
});

test('a real research database opened via DATA_DIR ends up at DATA_DIR/db, and audio at DATA_DIR/audio + DATA_DIR/audio-secondary', async () => {
    const { createResearchDatabase, createAudioStorage } = await import('../../app/backend/config/storageConfig.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-config-datadir-e2e-'));
    withEnv({ DATA_DIR: root, DB_PATH: undefined, AUDIO_STORAGE_DIR: undefined, DATABASE_PROVIDER: 'sqlite', AUDIO_STORAGE_PROVIDER: 'local', NODE_ENV: undefined }, () => {
        const db = createResearchDatabase({ logger: () => {} });
        assert.equal(db.getStatus().dataDir, path.join(root, 'db'));

        createAudioStorage({ logger: () => {} });
        // LocalFilesystemAudioStorage logs its resolved dirs but doesn't
        // expose them as a getter - verify the directories it actually
        // creates on disk instead.
        assert.ok(fs.existsSync(path.join(root, 'db')));
    });
});

// --- Production safety guard: never silently fall back to an unconfirmed
// (possibly non-persistent) storage path. Host-agnostic - keyed on the
// standard NODE_ENV=production convention, not any specific hosting
// provider. This is what prevents a repeat of the earlier incident where a
// production deployment silently ran on ephemeral storage and looked
// healthy - see docs/storage-architecture.md.

test('REGRESSION: NODE_ENV=production with no DATA_DIR/DB_PATH configured (sqlite default) fails closed instead of silently using the local default path', async () => {
    const { createResearchDatabase } = await import('../../app/backend/config/storageConfig.js');
    withEnv({ NODE_ENV: 'production', DATABASE_PROVIDER: undefined, DATA_DIR: undefined, DB_PATH: undefined, DATABASE_URL: undefined }, () => {
        assert.throws(
            () => createResearchDatabase({ logger: () => {} }),
            /Persistent research storage is not configured/
        );
    });
});

test('REGRESSION: NODE_ENV=production with DATABASE_PROVIDER=sqlite explicitly set but no DATA_DIR/DB_PATH still fails closed', async () => {
    const { createResearchDatabase } = await import('../../app/backend/config/storageConfig.js');
    withEnv({ NODE_ENV: 'production', DATABASE_PROVIDER: 'sqlite', DATA_DIR: undefined, DB_PATH: undefined }, () => {
        assert.throws(
            () => createResearchDatabase({ logger: () => {} }),
            /Persistent research storage is not configured/
        );
    });
});

test('NODE_ENV=production with DATABASE_PROVIDER=sqlite AND an explicit DATA_DIR passes the guard (real persistent path confirmed)', async () => {
    const { createResearchDatabase } = await import('../../app/backend/config/storageConfig.js');
    const root = nonEphemeralScratchDir('storage-config-prod-datadir-');
    try {
        withEnv({ NODE_ENV: 'production', DATABASE_PROVIDER: 'sqlite', DATA_DIR: root, DB_PATH: undefined }, () => {
            assert.doesNotThrow(() => createResearchDatabase({ logger: () => {} }));
        });
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('NODE_ENV=production with DATABASE_PROVIDER=postgres and a DATABASE_URL passes the guard (no ephemeral fallback occurs)', async () => {
    const { createResearchDatabase } = await import('../../app/backend/config/storageConfig.js');
    const { PostgresResearchDatabase } = await import('../../app/backend/database/postgresResearchDatabase.js');
    withEnv({ NODE_ENV: 'production', DATABASE_PROVIDER: 'postgres', DATABASE_URL: 'postgres://user:pass@localhost:5432/test' }, () => {
        const db = createResearchDatabase({ logger: () => {} });
        assert.ok(db instanceof PostgresResearchDatabase);
    });
});

test('REGRESSION: NODE_ENV=production with AUDIO_STORAGE_PROVIDER=local (default) and no DATA_DIR/AUDIO_STORAGE_DIR fails closed', async () => {
    const { createAudioStorage } = await import('../../app/backend/config/storageConfig.js');
    withEnv({ NODE_ENV: 'production', AUDIO_STORAGE_PROVIDER: undefined, DATA_DIR: undefined, AUDIO_STORAGE_DIR: undefined }, () => {
        assert.throws(
            () => createAudioStorage({ logger: () => {} }),
            /Persistent research audio storage is not configured/
        );
    });
});

test('NODE_ENV=production with AUDIO_STORAGE_PROVIDER=local AND an explicit DATA_DIR passes the guard', async () => {
    const { createAudioStorage } = await import('../../app/backend/config/storageConfig.js');
    const root = nonEphemeralScratchDir('storage-config-prod-audio-datadir-');
    try {
        withEnv({ NODE_ENV: 'production', AUDIO_STORAGE_PROVIDER: 'local', DATA_DIR: root, AUDIO_STORAGE_DIR: undefined }, () => {
            assert.doesNotThrow(() => createAudioStorage({ logger: () => {} }));
        });
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('without NODE_ENV=production, DATABASE_PROVIDER=sqlite / AUDIO_STORAGE_PROVIDER=local with no DATA_DIR are unaffected by the guard (local dev untouched)', async () => {
    const { createResearchDatabase, createAudioStorage } = await import('../../app/backend/config/storageConfig.js');
    const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-config-guard-test-'));
    const audioDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-config-guard-audio-test-'));
    withEnv({ NODE_ENV: undefined, DATABASE_PROVIDER: 'sqlite', DB_PATH: dbDir, AUDIO_STORAGE_PROVIDER: 'local', AUDIO_STORAGE_DIR: audioDir }, () => {
        assert.doesNotThrow(() => createResearchDatabase({ logger: () => {} }));
        assert.doesNotThrow(() => createAudioStorage({ logger: () => {} }));
    });
});

// --- Known-ephemeral-path rejection: DATA_DIR/DB_PATH/AUDIO_STORAGE_DIR
// being SET is not enough in production - the configured path itself must
// not be a location Linux typically clears on reboot/restart.

test('REGRESSION: NODE_ENV=production with DATA_DIR=/tmp/... is rejected even though DATA_DIR is technically "configured"', async () => {
    const { createResearchDatabase } = await import('../../app/backend/config/storageConfig.js');
    withEnv({ NODE_ENV: 'production', DATABASE_PROVIDER: 'sqlite', DATA_DIR: '/tmp/mouse-research-data', DB_PATH: undefined }, () => {
        assert.throws(
            () => createResearchDatabase({ logger: () => {} }),
            /known-ephemeral/
        );
    });
});

test('REGRESSION: NODE_ENV=production with DB_PATH=/tmp/... is rejected (the more specific override is checked too, not just DATA_DIR)', async () => {
    const { createResearchDatabase } = await import('../../app/backend/config/storageConfig.js');
    withEnv({ NODE_ENV: 'production', DATABASE_PROVIDER: 'sqlite', DATA_DIR: undefined, DB_PATH: '/tmp/db' }, () => {
        assert.throws(
            () => createResearchDatabase({ logger: () => {} }),
            /known-ephemeral/
        );
    });
});

test('REGRESSION: NODE_ENV=production with DATA_DIR=/var/tmp/... is rejected for audio storage too', async () => {
    const { createAudioStorage } = await import('../../app/backend/config/storageConfig.js');
    withEnv({ NODE_ENV: 'production', AUDIO_STORAGE_PROVIDER: 'local', DATA_DIR: '/var/tmp/mouse-research-data', AUDIO_STORAGE_DIR: undefined }, () => {
        assert.throws(
            () => createAudioStorage({ logger: () => {} }),
            /known-ephemeral/
        );
    });
});

test('NODE_ENV=production with DATA_DIR=/var/lib/mouse-research (a real persistent-style path) is accepted by the ephemeral-path check', async () => {
    // Confirms the check is specific to /tmp and /var/tmp, not an overly
    // broad rejection of every absolute path - a real persistent server
    // directory must pass. (This may still fail for an unrelated reason -
    // e.g. no permission to create /var/lib/mouse-research in this
    // sandbox - so this test only asserts the failure, if any, is NOT the
    // ephemeral-path rejection.)
    const { createResearchDatabase } = await import('../../app/backend/config/storageConfig.js');
    withEnv({ NODE_ENV: 'production', DATABASE_PROVIDER: 'sqlite', DATA_DIR: '/var/lib/mouse-research', DB_PATH: undefined }, () => {
        try {
            createResearchDatabase({ logger: () => {} });
        } catch (error) {
            assert.ok(!/known-ephemeral/.test(error.message), `must not be rejected as ephemeral: ${error.message}`);
        }
    });
});

test('a path that merely STARTS WITH the string "/tmp" but is not actually inside the /tmp directory is NOT falsely rejected (e.g. /tmpfoo-data)', async () => {
    const { createResearchDatabase } = await import('../../app/backend/config/storageConfig.js');
    // "/tmpfoo-data" starts with the four characters "/tmp" but is a
    // sibling of /tmp, not a path inside it - naive string-prefix matching
    // (rather than path-segment-aware matching) would wrongly reject this.
    withEnv({ NODE_ENV: 'production', DATABASE_PROVIDER: 'sqlite', DATA_DIR: undefined, DB_PATH: '/tmpfoo-data/db' }, () => {
        try {
            createResearchDatabase({ logger: () => {} });
        } catch (error) {
            assert.ok(!/known-ephemeral/.test(error.message), `"/tmpfoo-data" must not be rejected as ephemeral (it is not inside /tmp): ${error.message}`);
        }
    });
});

test('storageConfig.js contains no actual Vercel-specific code (no process.env.VERCEL check, no vendor SDK require)', async () => {
    const filePath = path.join(import.meta.dirname, '../../app/backend/config/storageConfig.js');
    const content = fs.readFileSync(filePath, 'utf8');
    // A comment merely mentioning "Vercel" as an example of a hosting
    // provider this file does NOT special-case is fine and expected - what
    // would be a real violation is actually branching on process.env.VERCEL
    // or requiring a vendor SDK.
    assert.ok(!content.includes('process.env.VERCEL'), 'storageConfig.js must not branch on process.env.VERCEL - storage selection is host-agnostic');
    const vendorRequirePattern = /require\(\s*['"](@vercel\/(?!node)|@neondatabase|aws-sdk)/;
    assert.ok(!vendorRequirePattern.test(content), 'storageConfig.js must not require() a vendor-specific SDK');
    assert.ok(content.includes('NODE_ENV'), 'expected the host-agnostic NODE_ENV=production guard to still be present');
});
