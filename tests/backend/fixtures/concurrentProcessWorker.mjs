// Child-process worker for tests/backend/concurrentProcesses.test.mjs.
// Args: [dataDir, participantCodeOrNull]. If a participant code is given,
// opens the shared research database at dataDir and inserts one
// participant with that code (simulating one Vercel-style process handling
// one request). If null, just opens and reports every participant code
// currently present (a read-only verification pass). Reports the result
// back to the parent via process.send() rather than exit code/stdout, so
// the parent test can assert on structured data.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createDatabase } = require('../../../app/backend/database/db.js');

const [, , dataDir, participantCode] = process.argv;

try {
    const db = createDatabase(dataDir);

    if (participantCode && participantCode !== 'null') {
        db.prepare('INSERT INTO participants (id, participant_code, created_at) VALUES (?, ?, ?)')
            .run(`id-${participantCode}`, participantCode, new Date().toISOString());
        await db.waitForPendingSync();
    }

    const rows = db.prepare('SELECT participant_code FROM participants').all();
    process.send({ ok: true, participantCodes: rows.map((r) => r.participant_code) });
} catch (error) {
    process.send({ ok: false, error: error.message });
}
