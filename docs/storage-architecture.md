# Storage architecture: host-agnostic by design

This document explains how the application's database and audio storage are
built so the app can move between hosts - local development and a
persistent server (the UF server is the target) - **without rewriting any
experiment, scoring, transcription, or admin-dashboard code.** Only
configuration changes.

## Chosen production architecture: persistent filesystem, not a cloud database

Research data is stored as **files on the server's own persistent
filesystem** - the existing SQLite primary/secondary system for
participant/session/cognitive data, and the existing local-filesystem
mirror system for audio. There is no cloud database, no object-storage
service, and no dependency on any specific hosting provider anywhere in the
application. (An earlier phase of this project explored Vercel serverless +
managed Postgres/object storage; that path is not the one in use. The
`PostgresResearchDatabase`/`ObjectStorageAudioStorage` code remains in the
repository, tested, in case a database-backed target is ever needed again,
but it is **not** required and nothing depends on it.)

## The principle

```
                 APPLICATION
                      |
        experimentController, mouseTask, cognitive tasks,
        speech processing, scoring, admin dashboard, routes
                      |
                 REPOSITORIES
        (app/backend/repositories/*.js - unchanged regardless of host)
                      |
        ┌─────────────┴─────────────┐
        |                           |
   ResearchDatabase              AudioStorage
   (database/researchDatabaseContract.js)   (storage/audioStorageContract.js)
        |                           |
   SQLiteResearchDatabase      LocalAudioStorage
   (data/db/ primary/secondary) (data/audio/ + audio-secondary/)
```

No file in `app/backend/` (outside `config/storageConfig.js` itself)
references any specific hosting provider. `storageConfig.js` is the *only*
place environment variables are read to decide where storage lives.

## Environment variables

| Variable | Values | Default | Effect |
|---|---|---|---|
| `DATA_DIR` | a filesystem path | - | Single convenience root: `DATA_DIR/db` for the database, `DATA_DIR/audio` + `DATA_DIR/audio-secondary` for audio |
| `DB_PATH` | a filesystem path | `data/db` (project-relative) | More specific override - wins over `DATA_DIR` if both are set |
| `AUDIO_STORAGE_DIR` | a filesystem path | `data/audio` (project-relative) | More specific override - wins over `DATA_DIR` if both are set |
| `NODE_ENV` | `production`, unset | unset | When `production`, storage MUST be explicitly configured (see below) - the standard Node.js convention, not tied to any hosting provider |
| `DATABASE_PROVIDER` | `sqlite`, `postgres` | `sqlite` | `sqlite` is the production path in use; `postgres` remains available but unused |
| `AUDIO_STORAGE_PROVIDER` | `local`, `object` | `local` | `local` is the production path in use; `object` remains available but has no client implemented |

With **nothing set at all**, `npm start` uses SQLite + local filesystem
storage at the project-relative `data/db`/`data/audio` - zero
configuration needed for local development, unchanged from before this
file existed.

## On-disk layout (identical shape locally and in production)

```
DATA_DIR/                      (e.g. /var/lib/mouse-research on a real server)
├── db/
│   ├── research.a.sqlite
│   ├── research.b.sqlite
│   └── manifest.json
├── audio/
│   └── <session-id>/<phase-id>.webm
└── audio-secondary/
    └── <session-id>/<phase-id>.webm
```

Locally (no `DATA_DIR` set), this is simply the project's own `data/`
directory - the exact layout the local primary/secondary system has always
used.

## Local development and production use the SAME code path

`DATABASE_PROVIDER=sqlite` (default) always uses the existing
primary/secondary SQLite system (`database/researchDatabase.js`,
`database/db.js`) completely unmodified: two on-disk copies, a durable
manifest, integrity-checked recovery, quarantine-on-corruption, atomic
schema initialization, `busy_timeout`, bounded startup retry for the one
safe-to-retry concurrent-initialization signature. See that file's own
extensive comments for the full design.

`AUDIO_STORAGE_PROVIDER=local` (default) always uses
`LocalFilesystemAudioStorage` (`storage/audioStorage.js`): every write is
verified before it's considered committed, and a second on-disk copy is
kept in a sibling `audio-secondary/` directory.

The only thing that differs between running this locally and running it on
a real server is **which directory** these implementations are pointed
at - decided entirely by `DATA_DIR`/`DB_PATH`/`AUDIO_STORAGE_DIR`, resolved
once in `config/storageConfig.js`.

## Production safety guard: fail closed, never silently ephemeral

When `NODE_ENV=production` is set, `storageConfig.js` refuses to start
unless persistent storage has been **explicitly** confirmed:

- Database: either `DATA_DIR`/`DB_PATH` is set (sqlite path), or
  `DATABASE_PROVIDER=postgres` with `DATABASE_URL` is set.
- Audio: either `DATA_DIR`/`AUDIO_STORAGE_DIR` is set (local path), or
  `AUDIO_STORAGE_PROVIDER=object` with a configured client (none exists
  today).

This check is **host-agnostic** - it is not keyed on any specific
platform's name or environment variable. It exists specifically so a
production deployment can never silently run against an unconfirmed
(possibly non-persistent, possibly wiped-on-restart) path and look healthy
while quietly losing data - see "Root cause of the earlier incident" below.

## Root cause of the earlier incident (for context)

Before this architecture existed, a prior deployment on Vercel serverless
defaulted to writing SQLite files under `/tmp`, which is private to each
serverless function instance and wiped on every cold start. A participant's
upload would succeed (durable *on that one instance*), but an admin
dashboard request landing on a *different* instance saw an empty,
disconnected `/tmp` - not deleted data, just storage that was never
actually shared. Moving to a real server with a genuinely persistent,
single filesystem (this document's chosen architecture) eliminates that
failure mode entirely: there is exactly one `DATA_DIR`, one process (or
several processes correctly sharing it - see the concurrency tests below),
and one set of files, for the lifetime of the deployment.

## Concurrency

Every repository method is `async`. Within the SQLite path, `busy_timeout`
and atomic (`BEGIN IMMEDIATE`/`COMMIT`) schema initialization protect
against transient multi-process contention (e.g. a brief overlap during a
rolling restart), and a narrow, bounded retry handles the one safe-to-retry
signature (another process mid-first-time-initialization) without ever
retrying a genuine corruption/missing-file failure. See
`tests/backend/concurrentProcesses.test.mjs`, which spawns real OS
subprocesses (not just function calls) to prove this against actual
concurrent process races, including a full reboot-simulation test (three
independent process lifetimes against the same directory).

The one place a read-then-write race was possible
(`transcriptionRepository.insert()` computing the next version number) was
rewritten to compute it atomically inside a single `INSERT` statement,
backed by a unique `(recording_id, version)` index as a hard backstop.

## Admin deletion

Soft-delete only (`participants.deleted_at`), authenticated, requires
explicit confirmation, audit-logged (`admin_audit_log`, via
`repositories/auditLogRepository.js` - routes never execute SQL directly).
No code path deletes research data as a side effect of startup, restart,
deployment, migration, reboot, or admin GET requests - see
`tests/backend/productionPersistence.test.mjs` and
`tests/backend/researchDatabase.test.mjs`'s TEST 13/14.

## Migration: localhost → UF server

`database/migrate.js` provides `migrateDatabase()`, `verifyDatabaseMigration()`,
and `migrateAudio()` - generic functions that only ever call
`ResearchDatabase`/`AudioStorage` interface methods on a source and a
destination, copy-only, never touching the source:

1. `migrateDatabase({ source, destination })` copies every row of every
   table with its exact original id/timestamps/version - nothing is
   regenerated.
2. `verifyDatabaseMigration({ source, destination })` compares row counts
   per table.
3. `migrateAudio({ sourceStorage, destinationStorage, destinationDb })`
   copies every recording's audio bytes to the destination under the same
   `<session-id>/<phase-id>.webm` key, verifying both size **and a full
   SHA-256 checksum** before counting it as copied - a same-size-but-
   corrupted copy is caught and reported, not silently accepted.

A per-row or per-file failure is collected into the returned report rather
than thrown - the source is never modified regardless, and "success" means
`report.errors.length === 0` after all three steps. See
`tests/backend/migrate.test.mjs`.

**No migration has been run against real data.** This is a callable
utility, not an automatic step - it only runs when explicitly invoked with
explicit approval.

## Backups

The primary/secondary system protects against a single corrupted/lost
*file*, but is not itself a substitute for a separate backup copy on
different physical storage. Recommended, conservative approach (see the
deployment checklist for exact commands):

- Periodically copy the whole `DATA_DIR` (or just `db/` + `audio/` +
  `audio-secondary/`) to a separate backup location (a different disk,
  volume, or off-host destination) - a straightforward file copy, since
  everything here is already just files.
- Keep multiple dated snapshots rather than one rolling backup, and never
  auto-delete the oldest one below some minimum retained count - an
  automatic rotation policy that could delete the *last* remaining valid
  backup is exactly the kind of automatic data-loss this whole project has
  been built to avoid.
- A backup copy should include an integrity check (open the copied
  `.sqlite` file read-only, run `PRAGMA integrity_check`) before being
  trusted, the same way `researchDatabase.js` validates its own slots.

## No code changes needed to move hosts

Moving from localhost to the UF server requires only:

1. Provision a persistent directory on the UF server (e.g.
   `/var/lib/mouse-research`).
2. Set `DATA_DIR=/var/lib/mouse-research` and `NODE_ENV=production` in that
   server's environment.
3. Deploy the same application code.
4. Run `migrateDatabase()`/`migrateAudio()` (with explicit approval) to
   copy the local research data across, then `verifyDatabaseMigration()`.

No changes to `experimentController.js`, `mouseTask.js`, any cognitive-
task/scoring/transcription logic, the admin dashboard, the frontend, or any
repository's public method - the entire experiment is unaware storage
moved.
