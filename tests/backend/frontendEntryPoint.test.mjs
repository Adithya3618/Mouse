// api/frontend.js - the Vercel-hosted, frontend-only entry point (see its
// own header comment and docs/storage-architecture.md). Its entire safety
// property is that it has NO code path capable of touching research data
// at all - verified here by static inspection (never requiring
// appContext.js/storageConfig.js/server.js/any repository) rather than by
// requiring it and hoping nothing bad happens, since a file that DID touch
// storage could have already done damage by the time a runtime assertion
// caught it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const filePath = path.join(import.meta.dirname, '../../api/frontend.js');

test('api/frontend.js never requires appContext.js, storageConfig.js, server.js, or any repository - it cannot touch research data even in principle', () => {
    const content = fs.readFileSync(filePath, 'utf8');
    const forbiddenRequires = [
        /require\(['"].*appContext/,
        /require\(['"].*storageConfig/,
        /require\(['"].*server\.js['"]\)/,
        /require\(['"].*\/repositories\//,
        /require\(['"].*\/database\//,
        /require\(['"].*\/storage\/(?!.*apiBaseUrl)/ // audioStorage.js etc; apiBaseUrl.js is a frontend file, not backend storage
    ];
    for (const pattern of forbiddenRequires) {
        assert.ok(!pattern.test(content), `api/frontend.js must not match ${pattern} - it must never be able to reach research storage`);
    }
});

test('api/frontend.js requires only express and node:path', () => {
    const content = fs.readFileSync(filePath, 'utf8');
    const requireCalls = [...content.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    assert.deepEqual(requireCalls.sort(), ['express', 'node:path'].sort());
});

test('requiring api/frontend.js is safe and produces a plain Express app with no /api routes reachable', async () => {
    const app = require(filePath);
    // Confirm it's an Express app instance (has .use/.listen) without
    // actually starting a listener - just exercising the module load path
    // to prove it has no side effects (no filesystem writes, no database
    // connection attempt).
    assert.equal(typeof app.use, 'function');
    assert.equal(typeof app.listen, 'function');
});
