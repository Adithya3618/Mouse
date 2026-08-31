// Enforces the layering rule: only files under app/backend/repositories/
// (and database/researchDatabase.js's own internal machinery) may call
// db.prepare()/db.exec() - routes and services must go through a
// repository method instead. Static source scan, same style as
// researchDatabase.test.mjs's TEST 14.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';

test('no route or service file calls .prepare(/.exec( directly - only repositories may touch SQL', () => {
    const projectRoot = path.join(import.meta.dirname, '../..');
    const scanDirs = ['app/backend/routes', 'app/backend/services'];
    // These are method NAMES that also appear as English words/other
    // meanings elsewhere (e.g. Array.prototype.every doesn't have
    // .prepare/.exec, so false positives are unlikely) - matches a call
    // pattern like `db.prepare(` or `someDb.exec(`.
    const rawSqlCallPattern = /\b\w*[Dd]b\w*\.(prepare|exec)\s*\(/;

    function walk(dir) {
        const results = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                results.push(...walk(full));
            } else if (entry.isFile() && entry.name.endsWith('.js')) {
                results.push(full);
            }
        }
        return results;
    }

    const offenders = [];
    for (const scanDir of scanDirs) {
        const fullDir = path.join(projectRoot, scanDir);
        if (!fs.existsSync(fullDir)) continue;
        for (const file of walk(fullDir)) {
            const content = fs.readFileSync(file, 'utf8');
            if (rawSqlCallPattern.test(content)) {
                offenders.push(path.relative(projectRoot, file));
            }
        }
    }

    assert.deepEqual(offenders, [], `Routes/services must never call db.prepare()/db.exec() directly - go through a repository method instead. Offending files:\n${offenders.join('\n')}`);
});
