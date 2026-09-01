// Two static, deployment-focused safety checks that don't fit naturally
// into the other test files:
//   1. .gitignore genuinely protects every real research-data path (via
//      git check-ignore against the actual repo, not just reading the
//      .gitignore text) - research data must never end up on GitHub.
//   2. No file in the application ever hard-codes "/tmp" as a fallback
//      path - the whole point of this session's work is that production
//      storage must be explicitly configured, never silently defaulted to
//      an ephemeral location.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const projectRoot = path.join(import.meta.dirname, '../..');

function isGitIgnored(relativePath) {
    try {
        execFileSync('git', ['check-ignore', '-q', relativePath], { cwd: projectRoot });
        return true; // exit code 0 = ignored
    } catch (error) {
        // git check-ignore exits 1 for "not ignored" - only re-throw for a
        // genuine error (e.g. git itself missing), not the expected "not
        // ignored" case.
        if (error.status === 1) return false;
        throw error;
    }
}

test('git ignores every real research-data path required by the spec', () => {
    const mustBeIgnored = [
        'data/db/research.a.sqlite',
        'data/db/research.b.sqlite',
        'data/db/manifest.json',
        'data/db/research.sqlite', // legacy single-file name, also must never be tracked
        'data/audio/some-session/some-phase.webm',
        'data/audio-secondary/some-session/some-phase.webm',
        '.env'
    ];
    for (const relativePath of mustBeIgnored) {
        assert.equal(isGitIgnored(relativePath), true, `${relativePath} must be git-ignored`);
    }
});

test('git ignores an arbitrary path under data/db/ and data/audio/ generally (not just the specific filenames above)', () => {
    assert.equal(isGitIgnored('data/db/whatever-file-name.sqlite'), true);
    assert.equal(isGitIgnored('data/audio/whatever/nested/path.webm'), true);
    assert.equal(isGitIgnored('data/audio-secondary/whatever/nested/path.webm'), true);
});

test('.env.example is NOT git-ignored (it must be committed as a template) and contains no real credential values', () => {
    assert.equal(isGitIgnored('.env.example'), false, '.env.example is the committed template - it must not be ignored');
    const content = fs.readFileSync(path.join(projectRoot, '.env.example'), 'utf8');
    // Every KEY= line must have an empty or placeholder-only value - never
    // something that looks like a real UF NaviGator key or admin token.
    const suspiciousValue = /^(UF_NAVIGATOR_API_KEY|ADMIN_API_TOKEN|DATABASE_URL)=\S+/m;
    assert.ok(!suspiciousValue.test(content), '.env.example must contain no real credential values, only blank/placeholder lines');
});

test('no application source file hard-codes "/tmp" as a storage fallback path', () => {
    const scanDirs = ['app/backend', 'api'];
    const offenders = [];

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

    for (const scanDir of scanDirs) {
        const fullDir = path.join(projectRoot, scanDir);
        if (!fs.existsSync(fullDir)) continue;
        for (const file of walk(fullDir)) {
            const content = fs.readFileSync(file, 'utf8');
            if (/['"`]\/tmp\//.test(content)) {
                offenders.push(path.relative(projectRoot, file));
            }
        }
    }

    assert.deepEqual(offenders, [], `Found hard-coded "/tmp" paths (production must never silently fall back to ephemeral storage):\n${offenders.join('\n')}`);
});

test('no application source file references Vercel-specific configuration (process.env.VERCEL, @vercel/* SDKs, @neondatabase/serverless)', () => {
    const scanDirs = ['app/backend', 'api'];
    const offenders = [];

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

    for (const scanDir of scanDirs) {
        const fullDir = path.join(projectRoot, scanDir);
        if (!fs.existsSync(fullDir)) continue;
        for (const file of walk(fullDir)) {
            const content = fs.readFileSync(file, 'utf8');
            if (content.includes('process.env.VERCEL') || /require\(\s*['"](@vercel\/(?!node)|@neondatabase\/serverless)/.test(content)) {
                offenders.push(path.relative(projectRoot, file));
            }
        }
    }

    assert.deepEqual(offenders, [], `Found Vercel-specific application logic (storage must be hosting-agnostic):\n${offenders.join('\n')}`);
});
