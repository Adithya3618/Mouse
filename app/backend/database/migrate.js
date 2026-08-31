// Generic, provider-independent migration between any two ResearchDatabase
// implementations, and separately between any two AudioStorage
// implementations. Works purely through the interfaces (see
// researchDatabaseContract.js/storage/audioStorageContract.js) - never a
// provider SDK directly - so the exact same code migrates
// SQLite -> Postgres today and Postgres -> Postgres (Vercel -> UF) later;
// see docs/storage-architecture.md.
//
// COPY-ONLY, ALWAYS: nothing here ever writes to, deletes from, or
// otherwise modifies `source`/`sourceStorage`. Every row is inserted into
// the destination with its EXACT original id/timestamps/version - nothing
// is regenerated. Run migrateDatabase()/migrateAudio() only after
// separately backing up the source; this module makes no changes to it
// regardless.
//
// NOT run against real data by this codebase automatically, ever - this is
// a callable utility (and a documented CLI-style function pair), not a
// startup/deployment step. See tests/backend/migrate.test.mjs for what it
// is actually exercised against (temp SQLite<->SQLite pairs - no live
// Postgres is available in this sandbox; the same code path is what would
// run against a real Postgres destination, since it only ever calls
// db.prepare(sql).run/get/all(), identically for either backend).

const path = require('node:path');

// Parent tables before children, so foreign key references are always
// satisfied on insert.
const DATABASE_TABLES = [
    'participants', 'sessions', 'phases', 'recordings',
    'transcriptions', 'processing_runs', 'responses', 'admin_audit_log'
];

// Copies every row of every research table from `source` to `destination`,
// preserving exact ids/timestamps/versions. Returns a report; never throws
// on a per-row failure (collected in report.errors instead) so one bad row
// can't abort the whole migration silently - the caller decides what
// counts as success via verifyMigration()/report.errors.length.
async function migrateDatabase({ source, destination, logger = console.log }) {
    const report = { tables: {}, errors: [], startedAt: new Date().toISOString() };

    for (const table of DATABASE_TABLES) {
        let rows;
        try {
            rows = await source.prepare(`SELECT * FROM ${table}`).all();
        } catch (error) {
            // admin_audit_log may not exist yet on an older source - not
            // fatal to the whole migration, just nothing to copy for it.
            logger(`[migrate] Could not read source table ${table} (${error.message}) - skipping.`);
            report.tables[table] = { sourceCount: 0, copied: 0, skipped: true };
            continue;
        }

        report.tables[table] = { sourceCount: rows.length, copied: 0 };
        for (const row of rows) {
            const columns = Object.keys(row);
            const placeholders = columns.map(() => '?').join(', ');
            const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
            try {
                await destination.prepare(sql).run(...columns.map((c) => row[c]));
                report.tables[table].copied += 1;
            } catch (error) {
                report.errors.push({ table, id: row.id, error: error.message });
            }
        }
        logger(`[migrate] ${table}: copied ${report.tables[table].copied}/${rows.length}`);
    }

    report.finishedAt = new Date().toISOString();
    return report;
}

// Compares row counts per table between source and destination - the
// minimum bar for "the migration didn't silently drop anything". Does NOT
// modify either database.
async function verifyDatabaseMigration({ source, destination, logger = console.log }) {
    const mismatches = [];
    for (const table of DATABASE_TABLES) {
        let sourceCount = 0;
        let destCount = 0;
        try {
            sourceCount = (await source.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get()).c;
        } catch { /* table may not exist on an older source - treated as 0 */ }
        try {
            destCount = (await destination.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get()).c;
        } catch { /* table may not exist yet - treated as 0 */ }
        if (Number(sourceCount) !== Number(destCount)) {
            mismatches.push({ table, sourceCount: Number(sourceCount), destCount: Number(destCount) });
        }
    }
    if (mismatches.length > 0) {
        logger(`[migrate] VERIFICATION FAILED - row count mismatches: ${JSON.stringify(mismatches)}`);
    } else {
        logger('[migrate] Verification passed - row counts match for every table.');
    }
    return { ok: mismatches.length === 0, mismatches };
}

// Copies every recording's audio bytes from sourceStorage to
// destinationStorage, reconstructing the EXACT same sessionId/phaseRecordId
// (and therefore the same storage key) the original save() used - no id
// regeneration, so a recording row's storage_path/key means the same thing
// against either backend. Requires the already-migrated `destinationDb` so
// it can look up each recording's phase -> session chain.
async function migrateAudio({ sourceStorage, destinationStorage, destinationDb, logger = console.log }) {
    const recordings = await destinationDb.prepare('SELECT * FROM recordings').all();
    const report = { total: recordings.length, copied: 0, verified: 0, errors: [] };

    for (const recording of recordings) {
        try {
            const phase = await destinationDb.prepare('SELECT * FROM phases WHERE id = ?').get(recording.phase_id);
            if (!phase) {
                throw new Error(`no phase row found for recording ${recording.id} (phase_id ${recording.phase_id})`);
            }
            const buffer = await sourceStorage.read(recording.storage_path);
            const extension = path.extname(recording.storage_path).replace(/^\./, '') || 'webm';

            const newKey = await destinationStorage.save({
                sessionId: phase.session_id,
                phaseRecordId: recording.phase_id,
                buffer,
                extension
            });

            if (newKey !== recording.storage_path) {
                // Should not normally happen (both implementations use the
                // same sessionId/phaseRecordId/extension -> key scheme),
                // but if a destination AudioStorage ever changes the
                // convention, surface it loudly rather than silently
                // leaving the DB row's storage_path stale/wrong.
                throw new Error(`destination key "${newKey}" does not match expected storage_path "${recording.storage_path}" - the recordings row would need updating, which this tool does not do automatically.`);
            }

            const destSize = (await destinationStorage.stat(newKey)).size;
            if (destSize !== buffer.length) {
                throw new Error(`size mismatch after copy for ${newKey}: source ${buffer.length} bytes, destination ${destSize} bytes`);
            }

            report.copied += 1;
            report.verified += 1;
        } catch (error) {
            report.errors.push({ recordingId: recording.id, storagePath: recording.storage_path, error: error.message });
        }
    }

    logger(`[migrate] audio: copied+verified ${report.verified}/${report.total}`);
    return report;
}

module.exports = { migrateDatabase, verifyDatabaseMigration, migrateAudio, DATABASE_TABLES };
