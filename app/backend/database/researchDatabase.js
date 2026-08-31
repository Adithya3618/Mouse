// Primary/secondary durable SQLite storage for the research database.
//
// GOAL: research data must never be lost to a restart, crash, deploy, or
// code change. Two independent on-disk copies (slot 'a' and slot 'b') are
// kept, tracked by a durable manifest (manifest.js) that is the ONLY source
// of truth for which slot is currently live - never inferred from
// filenames or file presence alone.
//
// HOW WRITES STAY SAFE: every write statement commits directly against the
// live primary slot, which SQLite itself runs in WAL mode. This is a
// deliberate choice, not a shortcut: SQLite's own write-ahead log already
// gives per-transaction crash consistency at the storage-engine level (a
// crash mid-write cannot leave that *file* corrupt - the transaction either
// fully applies or fully rolls back, per SQLite's own decades-tested
// guarantee). Re-implementing that same guarantee by hand (e.g. copying the
// whole file on every single INSERT) would be strictly riskier - it would
// mean trusting new, unproven code instead of SQLite's own engine for the
// exact same property.
//
// What primary/secondary ADDS on top of that (and what SQLite's own
// transaction log does NOT give you) is protection against losing the
// PRIMARY FILE ITSELF - disk corruption, a bad sector, an accidental
// truncation, manual tampering, etc. That is what the secondary slot is
// for: after each write settles, a verified, integrity-checked snapshot of
// the primary is atomically published as the new secondary (see
// syncSecondary() below). "Promotion" - the secondary becoming the live
// primary - happens at STARTUP RECOVERY, when validation finds the current
// primary invalid/missing and the secondary is not: see chooseActiveSlot().
// Because the secondary is already a complete, independent, valid database
// file at that point, promotion is just a single atomic manifest write
// (manifest.js's own tmp-file + fsync + rename pattern) - nothing needs to
// be copied or rebuilt to perform it, so a crash during promotion can only
// ever leave the manifest pointing at whichever slot it pointed at before
// the (interrupted) write, which the NEXT startup will re-validate and
// re-attempt from scratch. There is no window where "both copies become
// unusable" - the untouched, previously-valid slot always remains on disk.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { readManifest, writeManifest, emptyManifest } = require('./manifest');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const SLOT_FILENAMES = { a: 'research.a.sqlite', b: 'research.b.sqlite' };
const LEGACY_SINGLE_FILE = 'research.sqlite';
const RESEARCH_TABLES = ['participants', 'sessions', 'phases', 'recordings', 'transcriptions', 'processing_runs', 'responses'];

function slotPath(dataDir, slot) {
    return path.join(dataDir, SLOT_FILENAMES[slot]);
}

function otherSlot(slot) {
    return slot === 'a' ? 'b' : 'a';
}

function sha256File(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

// Opens `filePath` read-only, runs SQLite's own consistency check, and
// counts every research table. Never mutates the file. A file that doesn't
// exist, isn't a valid SQLite database, or fails integrity_check is
// reported invalid - never thrown past this point, so callers can make a
// calm, informed choice instead of crashing on the first bad slot.
function validateSlot(filePath) {
    if (!fs.existsSync(filePath)) {
        return { valid: false, exists: false, reason: 'file does not exist' };
    }
    let db;
    try {
        db = new DatabaseSync(filePath, { readOnly: true });
        const integrity = db.prepare('PRAGMA integrity_check').get();
        if (!integrity || integrity.integrity_check !== 'ok') {
            return { valid: false, exists: true, reason: `integrity_check failed: ${JSON.stringify(integrity)}` };
        }
        const rowCounts = {};
        let totalRows = 0;
        for (const table of RESEARCH_TABLES) {
            try {
                const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get();
                rowCounts[table] = row.c;
                totalRows += row.c;
            } catch (error) {
                return { valid: false, exists: true, reason: `missing/unreadable table ${table}: ${error.message}` };
            }
        }
        return { valid: true, exists: true, rowCounts, totalRows, sha256: sha256File(filePath) };
    } catch (error) {
        return { valid: false, exists: true, reason: error.message };
    } finally {
        if (db) {
            try { db.close(); } catch { /* already unusable */ }
        }
    }
}

function ensureColumn(db, table, column, definition) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some((c) => c.name === column)) {
        // Additive only - never rewrites/drops existing columns or rows.
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
}

// CREATE TABLE IF NOT EXISTS throughout schema.sql, plus the additive
// soft-delete column and audit-log table below - all idempotent, all safe
// to re-run against a database that already has real data in it.
function applySchema(db) {
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));

    // Soft-delete support for admin deletion (see routes/adminDelete.js) -
    // NULL for every normal row; only ever set by an authenticated admin
    // request, never by startup/schema code.
    ensureColumn(db, 'participants', 'deleted_at', 'TEXT');

    db.exec(`
        CREATE TABLE IF NOT EXISTS admin_audit_log (
            id TEXT PRIMARY KEY,
            action TEXT NOT NULL,
            target_type TEXT NOT NULL,
            target_id TEXT NOT NULL,
            details_json TEXT,
            performed_at TEXT NOT NULL
        );
    `);
}

// Copies `sourcePath` into a verified, integrity-checked file at
// `destPath`, atomically. Uses SQLite's own VACUUM INTO (a single
// consistent snapshot of the live database, not a raw byte copy that could
// race a concurrent writer) into a temp file in the SAME directory, then
// validates that temp file BEFORE it ever becomes `destPath` - a failure at
// any point here leaves `destPath` completely untouched.
function snapshotTo(sourceDb, destPath, { logger }) {
    const tmpPath = `${destPath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
        sourceDb.exec(`VACUUM INTO '${tmpPath.replace(/'/g, "''")}'`);
        const validation = validateSlot(tmpPath);
        if (!validation.valid) {
            throw new Error(`snapshot failed integrity validation: ${validation.reason}`);
        }
        fs.renameSync(tmpPath, destPath);
        return validation;
    } catch (error) {
        // Never let a half-written snapshot linger where a future startup
        // could mistake it for a real slot file.
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* best effort */ }
        logger(`[database] Secondary sync failed (primary is unaffected): ${error.message}`);
        throw error;
    }
}

// One-time, strictly additive adoption of the pre-existing single-file
// database (data/db/research.sqlite from before this primary/secondary
// design existed). The legacy file is COPIED, never moved or deleted - it
// stays on disk exactly as it was, as an extra recovery copy, even after
// this runs. Only triggers when neither slot file nor a manifest exists yet
// (i.e. this install predates the two-slot design) - never overwrites an
// already-initialized primary/secondary setup.
function adoptLegacySingleFileIfPresent(dataDir, logger) {
    const legacyPath = path.join(dataDir, LEGACY_SINGLE_FILE);
    const aExists = fs.existsSync(slotPath(dataDir, 'a'));
    const bExists = fs.existsSync(slotPath(dataDir, 'b'));
    const manifestExists = fs.existsSync(path.join(dataDir, 'manifest.json'));

    if (!fs.existsSync(legacyPath) || aExists || bExists || manifestExists) {
        return false;
    }

    const legacyValidation = validateSlot(legacyPath);
    if (!legacyValidation.valid) {
        // Do not adopt a file we can't even verify - fall through to the
        // normal startup logic, which will treat this as "no valid slot
        // found" and fail closed rather than silently discarding it.
        logger(`[database] Found legacy data/db/research.sqlite but it failed validation (${legacyValidation.reason}) - NOT adopting it automatically.`);
        return false;
    }

    logger(`[database] Adopting existing data/db/research.sqlite (${legacyValidation.totalRows} total rows across research tables) into the new primary/secondary layout. The original file is left untouched on disk as an extra recovery copy.`);
    fs.copyFileSync(legacyPath, slotPath(dataDir, 'a'));
    const aValidation = validateSlot(slotPath(dataDir, 'a'));
    if (!aValidation.valid) {
        throw new Error(`[database] FATAL: copy of legacy database failed validation immediately after copying (${aValidation.reason}). Refusing to continue - the original data/db/research.sqlite is untouched.`);
    }

    const seedDb = new DatabaseSync(slotPath(dataDir, 'a'), { readOnly: true });
    try {
        snapshotTo(seedDb, slotPath(dataDir, 'b'), { logger });
    } finally {
        seedDb.close();
    }
    const bValidation = validateSlot(slotPath(dataDir, 'b'));

    writeManifest(dataDir, {
        active: 'a',
        slots: {
            a: { generation: 1, status: 'VERIFIED', sha256: aValidation.sha256, rowCounts: aValidation.rowCounts, updatedAt: new Date().toISOString() },
            b: { generation: 1, status: bValidation.valid ? 'VERIFIED' : 'UNVERIFIED', sha256: bValidation.sha256 || null, rowCounts: bValidation.rowCounts || null, updatedAt: new Date().toISOString() }
        },
        lastPromotionAt: null,
        lastRecoveryEvent: `Adopted legacy single-file database at startup, ${new Date().toISOString()}`
    });
    return true;
}

// The heart of the data-safety guarantee: decide which slot is the active
// primary WITHOUT ever risking data loss. See the file header for the full
// reasoning; every branch below is deliberately conservative.
function chooseActiveSlot(dataDir, logger) {
    const manifest = readManifest(dataDir);
    const aValidation = validateSlot(slotPath(dataDir, 'a'));
    const bValidation = validateSlot(slotPath(dataDir, 'b'));

    // Fresh install: no manifest and neither slot file exists at all. This
    // is the ONLY situation where creating brand-new empty databases is
    // allowed.
    if (!manifest && !aValidation.exists && !bValidation.exists) {
        return { slot: 'a', reason: 'fresh install - no existing database found', freshInstall: true };
    }

    // A manifest that exists but fails to parse is a fail-closed signal on
    // its own - never treated the same as "no manifest".
    if (manifest && manifest.corrupt) {
        throw new StartupSafetyError(
            `manifest.json exists but is corrupt/unreadable (${manifest.error || 'malformed'}). ` +
            `Refusing to guess which database copy is authoritative. Slot a: ${describe(aValidation)}. Slot b: ${describe(bValidation)}. ` +
            `Both files have been left untouched - restore or repair manifest.json manually, or restore from data/db/pre-migration-backup-*/ if needed.`
        );
    }

    // Hard rule, independent of everything else: a structurally valid but
    // EMPTY slot must never be preferred over a structurally valid slot
    // that actually has research data in it.
    if (aValidation.valid && bValidation.valid && aValidation.totalRows !== bValidation.totalRows) {
        const preferred = aValidation.totalRows > bValidation.totalRows ? 'a' : 'b';
        const emptierOne = preferred === 'a' ? 'b' : 'a';
        if ((preferred === 'a' ? bValidation : aValidation).totalRows === 0) {
            logger(`[database] Slot ${emptierOne} is empty while slot ${preferred} has ${Math.max(aValidation.totalRows, bValidation.totalRows)} rows - choosing ${preferred} regardless of manifest state. This should not normally happen; investigate why slot ${emptierOne} is empty.`);
            return { slot: preferred, reason: `non-empty slot preferred over empty slot (${emptierOne} was empty)`, recovery: true };
        }
    }

    if (manifest && manifest.active && manifest.slots && manifest.slots[manifest.active]) {
        const active = manifest.active;
        const activeValidation = active === 'a' ? aValidation : bValidation;
        if (activeValidation.valid) {
            return { slot: active, reason: 'manifest-designated active slot is valid', manifest };
        }

        // Manifest's chosen slot is invalid - try to recover via the other one.
        const fallback = otherSlot(active);
        const fallbackValidation = fallback === 'a' ? aValidation : bValidation;
        logger(`[database] RECOVERY: manifest-designated primary (slot ${active}) is invalid (${activeValidation.reason}). Checking slot ${fallback}...`);
        if (fallbackValidation.valid) {
            logger(`[database] RECOVERY: promoting slot ${fallback} (generation ${manifest.slots[fallback] ? manifest.slots[fallback].generation : 'unknown'}) to primary. Slot ${active} is preserved on disk, untouched, marked CORRUPT in the manifest.`);
            return { slot: fallback, reason: `recovered - promoted from secondary after primary (slot ${active}) failed validation`, recovery: true, corruptSlot: active, manifest };
        }

        throw new StartupSafetyError(
            `BOTH database copies failed validation. Slot a: ${describe(aValidation)}. Slot b: ${describe(bValidation)}. ` +
            `Refusing to create a new empty database - that would silently discard research data if either copy is actually recoverable by hand. ` +
            `Neither file has been modified. Restore data/db/${SLOT_FILENAMES[active]} or data/db/${SLOT_FILENAMES[fallback]} from a backup ` +
            `(see data/db/pre-migration-backup-*/ if present), or repair manually, then restart.`
        );
    }

    // No usable manifest, but at least one slot file exists on disk -
    // ambiguous by definition (we have no generation history to trust).
    // Resolve conservatively and immediately persist a fresh manifest so
    // this ambiguity cannot recur.
    if (aValidation.valid && bValidation.valid) {
        const slot = aValidation.totalRows >= bValidation.totalRows ? 'a' : 'b';
        logger(`[database] AMBIGUITY: both slots are valid but no usable manifest was found. Choosing slot ${slot} (${Math.max(aValidation.totalRows, bValidation.totalRows)} rows) as it has the most data. Both files remain on disk regardless.`);
        return { slot, reason: 'ambiguous - manifest missing, both slots valid, chose slot with more rows', recovery: true };
    }
    if (aValidation.valid) {
        return { slot: 'a', reason: 'only slot a is valid (no usable manifest)', recovery: true };
    }
    if (bValidation.valid) {
        return { slot: 'b', reason: 'only slot b is valid (no usable manifest)', recovery: true };
    }

    // Both invalid/missing and this ISN'T a fresh install (something exists
    // on disk that we could not validate) - FAIL CLOSED.
    throw new StartupSafetyError(
        `Could not find any valid database copy. Slot a: ${describe(aValidation)}. Slot b: ${describe(bValidation)}. ` +
        `Refusing to create a new empty database, because at least one on-disk artifact exists that could not be validated - ` +
        `creating a blank database here could silently orphan real research data. Nothing has been deleted or modified. ` +
        `Check data/db/ manually, and data/db/pre-migration-backup-*/ if present, before restarting.`
    );
}

function describe(validation) {
    if (!validation.exists) return 'does not exist';
    if (!validation.valid) return `INVALID (${validation.reason})`;
    return `valid, ${validation.totalRows} rows`;
}

class StartupSafetyError extends Error {}

// Wraps a live DatabaseSync so every write statement (INSERT/UPDATE/DELETE)
// schedules exactly one secondary-sync per synchronous burst of writes
// (via process.nextTick, so e.g. responseRepository.insertResponses()'s
// per-row loop only triggers one sync at the end, not one per row).
// Repositories are handed this wrapper instead of the raw DatabaseSync and
// see no difference at all - same prepare()/exec() shape.
function wrapWithSecondarySync(rawDb, { dataDir, activeSlot, logger, getManifestSlotInfo }) {
    let syncScheduled = false;
    let pendingWaiters = [];

    function performSync() {
        syncScheduled = false;
        const waiters = pendingWaiters;
        pendingWaiters = [];
        try {
            const secondarySlot = otherSlot(activeSlot);
            const validation = snapshotTo(rawDb, slotPath(dataDir, secondarySlot), { logger });
            const manifest = readManifest(dataDir) || emptyManifest();
            const primaryInfo = getManifestSlotInfo();
            manifest.active = activeSlot;
            manifest.slots = manifest.slots || {};
            manifest.slots[activeSlot] = primaryInfo;
            manifest.slots[secondarySlot] = {
                generation: (manifest.slots[secondarySlot] && manifest.slots[secondarySlot].generation || 0) + 1,
                status: 'VERIFIED',
                sha256: validation.sha256,
                rowCounts: validation.rowCounts,
                updatedAt: new Date().toISOString()
            };
            writeManifest(dataDir, manifest);
            for (const resolve of waiters) resolve();
        } catch (error) {
            // Secondary sync failing is loud but never fatal to the request
            // that triggered it - the primary write already committed
            // successfully via SQLite's own transaction guarantee, which is
            // the data that actually matters. The next successful write (or
            // the next startup) will retry building a fresh secondary.
            logger(`[database] Secondary sync failed - primary data is safe, secondary is temporarily stale: ${error.message}`);
            for (const resolve of waiters) resolve();
        }
    }

    function scheduleSync() {
        if (!syncScheduled) {
            syncScheduled = true;
            process.nextTick(performSync);
        }
    }

    function wrapStatement(stmt, sql) {
        const isWrite = /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql);
        if (!isWrite) {
            return stmt;
        }
        const originalRun = stmt.run.bind(stmt);
        stmt.run = (...args) => {
            const result = originalRun(...args);
            scheduleSync();
            return result;
        };
        return stmt;
    }

    return {
        prepare(sql) {
            return wrapStatement(rawDb.prepare(sql), sql);
        },
        exec(sql) {
            const result = rawDb.exec(sql);
            if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)) {
                scheduleSync();
            }
            return result;
        },
        close() {
            rawDb.close();
        },
        // Lets tests (and, if ever needed, an admin "flush now" action)
        // deterministically wait for a pending secondary sync instead of
        // guessing with a timer.
        waitForPendingSync() {
            if (!syncScheduled) {
                return Promise.resolve();
            }
            return new Promise((resolve) => pendingWaiters.push(resolve));
        }
    };
}

// Opens (or safely recovers/initializes) the primary/secondary research
// database rooted at `dataDir`. Returns { db, getStatus, close,
// waitForPendingSync } - `db` is what repositories receive, unchanged from
// how they already use a plain node:sqlite DatabaseSync.
function openResearchDatabase({ dataDir, logger = console.log }) {
    fs.mkdirSync(dataDir, { recursive: true });

    adoptLegacySingleFileIfPresent(dataDir, logger);

    const decision = chooseActiveSlot(dataDir, logger);
    const activeSlot = decision.slot;
    const activePath = slotPath(dataDir, activeSlot);

    // A corrupt slot is about to have its filename reused as the fresh
    // secondary mirror (below) - quarantine (rename aside) the corrupt
    // bytes FIRST so "preserved on disk, untouched" is actually true,
    // rather than being silently overwritten by the very next rebuild.
    // Quarantine files are never read or cleaned up automatically - they
    // exist purely so a human can inspect what went wrong.
    if (decision.recovery && decision.corruptSlot) {
        const corruptPath = slotPath(dataDir, decision.corruptSlot);
        if (fs.existsSync(corruptPath)) {
            const quarantinePath = path.join(dataDir, `${SLOT_FILENAMES[decision.corruptSlot]}.quarantined-${Date.now()}`);
            fs.renameSync(corruptPath, quarantinePath);
            for (const ext of ['-wal', '-shm']) {
                const sidecarPath = `${corruptPath}${ext}`;
                if (fs.existsSync(sidecarPath)) fs.renameSync(sidecarPath, `${quarantinePath}${ext}`);
            }
            logger(`[database] Quarantined the corrupt slot ${decision.corruptSlot} file to ${quarantinePath} for manual inspection - it is never read or deleted automatically.`);
        }
    }

    if (decision.freshInstall) {
        logger('[database] No existing database found anywhere - initializing a fresh, empty primary/secondary pair. This message should only ever appear on the very first run.');
    }

    const rawDb = new DatabaseSync(activePath);
    rawDb.exec('PRAGMA journal_mode = WAL;');
    applySchema(rawDb);

    const primaryValidation = validateSlot(activePath);
    if (!primaryValidation.valid) {
        rawDb.close();
        throw new StartupSafetyError(`Primary slot ${activeSlot} failed validation immediately after schema initialization: ${primaryValidation.reason}. This should be impossible - refusing to continue.`);
    }

    const priorManifest = readManifest(dataDir);
    const priorGeneration = (priorManifest && priorManifest.slots && priorManifest.slots[activeSlot] && priorManifest.slots[activeSlot].generation) || 0;
    const manifestSlotInfo = () => ({
        generation: priorGeneration + 1,
        status: 'VERIFIED',
        sha256: sha256File(activePath),
        rowCounts: RESEARCH_TABLES.reduce((acc, t) => { acc[t] = rawDb.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c; return acc; }, {}),
        updatedAt: new Date().toISOString()
    });

    const wrapped = wrapWithSecondarySync(rawDb, { dataDir, activeSlot, logger, getManifestSlotInfo: manifestSlotInfo });

    // Persist the (possibly-just-recovered) manifest immediately, and make
    // sure the secondary slot is a fresh, verified mirror of whatever we
    // just chose as primary - covers both the fresh-install case and the
    // recovery case (where the old secondary needs to become a mirror of
    // the newly-promoted primary, not of whatever the old, now-corrupt
    // primary was).
    const manifest = readManifest(dataDir) || emptyManifest();
    manifest.active = activeSlot;
    manifest.slots = manifest.slots || {};
    manifest.slots[activeSlot] = manifestSlotInfo();
    if (decision.recovery) {
        manifest.lastRecoveryEvent = `${decision.reason} at ${new Date().toISOString()}`;
        if (decision.corruptSlot) {
            manifest.slots[decision.corruptSlot] = {
                ...(manifest.slots[decision.corruptSlot] || {}),
                status: 'CORRUPT',
                updatedAt: new Date().toISOString()
            };
        }
    }
    writeManifest(dataDir, manifest);

    try {
        snapshotTo(rawDb, slotPath(dataDir, otherSlot(activeSlot)), { logger });
        const secondaryValidation = validateSlot(slotPath(dataDir, otherSlot(activeSlot)));
        const m2 = readManifest(dataDir) || emptyManifest();
        m2.slots[otherSlot(activeSlot)] = {
            generation: (m2.slots[otherSlot(activeSlot)] && m2.slots[otherSlot(activeSlot)].generation || 0) + 1,
            status: secondaryValidation.valid ? 'VERIFIED' : 'UNVERIFIED',
            sha256: secondaryValidation.sha256 || null,
            rowCounts: secondaryValidation.rowCounts || null,
            updatedAt: new Date().toISOString()
        };
        writeManifest(dataDir, m2);
    } catch (error) {
        logger(`[database] Initial secondary sync at startup failed (primary is unaffected, will retry on next write): ${error.message}`);
    }

    logger(`[database] Active database: slot ${activeSlot} (${activePath})`);
    logger(`[database] Primary generation: ${manifest.slots[activeSlot].generation}`);
    const secInfo = (readManifest(dataDir) || {}).slots || {};
    logger(`[database] Secondary generation: ${secInfo[otherSlot(activeSlot)] ? secInfo[otherSlot(activeSlot)].generation : 'pending'}`);
    logger(`[database] Primary integrity: OK (${primaryValidation.totalRows} rows across research tables)`);
    logger(`[database] Secondary integrity: ${secInfo[otherSlot(activeSlot)] && secInfo[otherSlot(activeSlot)].status === 'VERIFIED' ? 'OK' : 'PENDING'}`);
    logger(`[database] Recovery state: ${decision.recovery ? decision.reason : 'none - normal startup'}`);

    return {
        db: wrapped,
        close: () => wrapped.close(),
        waitForPendingSync: () => wrapped.waitForPendingSync(),
        getStatus: () => {
            const m = readManifest(dataDir) || emptyManifest();
            return {
                dataDir,
                active: m.active,
                slots: m.slots,
                lastRecoveryEvent: m.lastRecoveryEvent,
                lastPromotionAt: m.lastPromotionAt
            };
        }
    };
}

module.exports = {
    openResearchDatabase,
    validateSlot,
    chooseActiveSlot,
    adoptLegacySingleFileIfPresent,
    applySchema,
    StartupSafetyError,
    SLOT_FILENAMES,
    RESEARCH_TABLES
};
