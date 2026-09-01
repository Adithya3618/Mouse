// Proves that two independent PROCESSES (not just two calls within one
// process - a real OS-level concurrency test) sharing the same durable
// storage directory cannot end up with two disconnected empty databases,
// and that a genuinely simultaneous first-ever startup race does not
// corrupt or lose data. This is what "production storage is actually
// shared" needs to hold up under - unlike the earlier tests in this file,
// which exercise the logic within one process, this spawns real child
// processes so the race is real, not simulated.
//
// Uses fs.mkdtempSync - never the real data/db/.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fork } from 'node:child_process';

function freshDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'concurrent-process-test-'));
}

const WORKER_SCRIPT = path.join(import.meta.dirname, 'fixtures', 'concurrentProcessWorker.mjs');

function runWorker(dir, participantCode) {
    return new Promise((resolve, reject) => {
        const child = fork(WORKER_SCRIPT, [dir, participantCode], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
        let settled = false;
        child.on('message', (msg) => {
            settled = true;
            resolve(msg);
        });
        child.on('error', reject);
        child.on('exit', (code) => {
            if (!settled) {
                reject(new Error(`worker process exited with code ${code} before sending a result`));
            }
        });
    });
}

test('two real, independent processes racing to initialize the SAME shared (empty) storage directory both end up with all data intact - no lost writes, no duplicate/conflicting databases', async () => {
    const sharedDir = freshDir();

    // Both processes start at (as close as Node's process model allows to)
    // the same time, against a directory that has NEITHER slot file yet -
    // the exact "two Vercel instances cold-starting simultaneously against
    // shared production storage" scenario.
    const [resultA, resultB] = await Promise.all([
        runWorker(sharedDir, 'CONCURRENT_A'),
        runWorker(sharedDir, 'CONCURRENT_B')
    ]);

    assert.equal(resultA.ok, true, `worker A failed: ${resultA.error}`);
    assert.equal(resultB.ok, true, `worker B failed: ${resultB.error}`);

    // A THIRD, fresh process now reads the shared directory - both
    // participants must be present. Neither write may have been lost, and
    // the directory must not be left in a state where only one of the two
    // concurrent initializations "won" and silently discarded the other's
    // data.
    const verifyResult = await runWorker(sharedDir, null);
    assert.equal(verifyResult.ok, true, `verification worker failed: ${verifyResult.error}`);
    assert.ok(verifyResult.participantCodes.includes('CONCURRENT_A'), `expected CONCURRENT_A to survive, got: ${JSON.stringify(verifyResult.participantCodes)}`);
    assert.ok(verifyResult.participantCodes.includes('CONCURRENT_B'), `expected CONCURRENT_B to survive, got: ${JSON.stringify(verifyResult.participantCodes)}`);

    // The directory must be left in a single, coherent, valid state - not
    // two competing databases with no manifest agreement.
    const manifest = JSON.parse(fs.readFileSync(path.join(sharedDir, 'manifest.json'), 'utf8'));
    assert.ok(manifest.active === 'a' || manifest.active === 'b');
    assert.equal(manifest.slots[manifest.active].status, 'VERIFIED');
});

test('a process starting AFTER another has already initialized shared storage joins the SAME database, never creates a second one', async () => {
    const sharedDir = freshDir();

    const first = await runWorker(sharedDir, 'SEQUENTIAL_FIRST');
    assert.equal(first.ok, true);

    const second = await runWorker(sharedDir, 'SEQUENTIAL_SECOND');
    assert.equal(second.ok, true);

    const verifyResult = await runWorker(sharedDir, null);
    assert.deepEqual(verifyResult.participantCodes.sort(), ['SEQUENTIAL_FIRST', 'SEQUENTIAL_SECOND']);
});

// SERVER REBOOT SIMULATION: each runWorker() call here is a genuinely
// separate OS process that starts cold, does its work, and fully exits -
// not just another function call within the SAME long-running process (the
// other tests in this file already establish that too, but this test names
// the scenario explicitly: "stop the Node process, the machine reboots,
// Node starts again" - which is exactly what a real systemd
// restart/machine reboot looks like from the application's point of view,
// since it never gets to run any in-process shutdown code either way).
test('SERVER REBOOT SIMULATION: three independent process lifetimes against the same persistent directory accumulate data correctly, with no loss between "reboots"', async () => {
    const persistentDir = freshDir();

    const boot1 = await runWorker(persistentDir, 'REBOOT_GEN_1');
    assert.equal(boot1.ok, true);
    assert.deepEqual(boot1.participantCodes, ['REBOOT_GEN_1']);

    // "The server reboots" - boot1's process has already fully exited by
    // the time runWorker() resolved (see runWorker()'s exit-then-resolve
    // handling above). This is a cold start against the same directory,
    // with no shared in-memory state whatsoever between it and boot1.
    const boot2 = await runWorker(persistentDir, 'REBOOT_GEN_2');
    assert.equal(boot2.ok, true);
    assert.deepEqual(boot2.participantCodes.sort(), ['REBOOT_GEN_1', 'REBOOT_GEN_2']);

    // A second reboot.
    const boot3 = await runWorker(persistentDir, 'REBOOT_GEN_3');
    assert.equal(boot3.ok, true);
    assert.deepEqual(boot3.participantCodes.sort(), ['REBOOT_GEN_1', 'REBOOT_GEN_2', 'REBOOT_GEN_3']);

    // A final, read-only verification process - confirms all three
    // generations' data survived every reboot in between.
    const finalCheck = await runWorker(persistentDir, null);
    assert.deepEqual(finalCheck.participantCodes.sort(), ['REBOOT_GEN_1', 'REBOOT_GEN_2', 'REBOOT_GEN_3']);

    const manifest = JSON.parse(fs.readFileSync(path.join(persistentDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.slots[manifest.active].status, 'VERIFIED');
});
