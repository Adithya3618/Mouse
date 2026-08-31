# Storage architecture: provider-agnostic by design

This document explains how the application's database and audio storage are
built so the app can move between hosting environments - local development,
Vercel, and eventually UF-approved infrastructure - **without rewriting any
experiment, scoring, transcription, or admin-dashboard code.**

## The principle

```
                 APPLICATION
                      |
        experimentController, mouseTask, cognitive tasks,
        speech processing, scoring, admin dashboard, routes
                      |
                 REPOSITORIES
        (app/backend/repositories/*.js - unchanged either way)
                      |
        ┌─────────────┴─────────────┐
        |                           |
   ResearchDatabase              AudioStorage
   (database/researchDatabaseContract.js)   (storage/audioStorageContract.js)
        |                           |
   ┌────┼────┐                 ┌────┼────┐
   │    │    │                 │    │    │
SQLite Postgres future      Local Object  future
```

Vercel is a **deployment target**, not part of the application's business
logic. The only code allowed to know a specific hosting provider exists is
`app/backend/config/storageConfig.js` (env-var-driven selection) and the
concrete provider implementations it selects between. Everything else -
routes, services, repositories, the entire participant-facing experiment -
depends only on the two interfaces above.

## Provider selection (environment variables)

| Variable | Values | Default | Effect |
|---|---|---|---|
| `DATABASE_PROVIDER` | `sqlite`, `postgres` | `sqlite` | Which `ResearchDatabase` implementation to construct |
| `AUDIO_STORAGE_PROVIDER` | `local`, `object` | `local` | Which `AudioStorage` implementation to construct |
| `DATABASE_URL` | a Postgres connection string | - | Required when `DATABASE_PROVIDER=postgres` |
| `OBJECT_STORAGE_CLIENT` | names a client adapter | - | Required when `AUDIO_STORAGE_PROVIDER=object` (**no client is implemented yet** - see below) |

With **no environment variables set at all**, `npm start` uses SQLite +
local filesystem storage - this is unchanged from before this architecture
existed, and needs no configuration.

## Local development: SQLite + local filesystem

`DATABASE_PROVIDER=sqlite` (default) uses the existing primary/secondary
SQLite system (`database/researchDatabase.js`, `database/db.js`) completely
unmodified: two on-disk copies, a durable manifest, integrity-checked
recovery, quarantine-on-corruption. See that code's own extensive comments
for the full design. This is the **authoritative, durable copy of your
research data** and this document does not change how it works.

`AUDIO_STORAGE_PROVIDER=local` (default) uses `LocalFilesystemAudioStorage`
(`storage/audioStorage.js`), also unchanged in its own safety behavior:
every write is verified, and a second on-disk copy is kept in a sibling
`data/audio-secondary/` directory.

## Vercel production: PostgreSQL + object storage

`DATABASE_PROVIDER=postgres` + `DATABASE_URL=<connection string>` uses
`PostgresResearchDatabase` (`database/postgresResearchDatabase.js`), built
on the plain `pg` npm package - **not** `@vercel/postgres` or
`@neondatabase/serverless`. This is deliberate: `pg` speaks the standard
Postgres wire protocol and works identically against Neon, a future
UF-hosted Postgres server, RDS, or any other Postgres-compatible endpoint.
Moving providers later is a `DATABASE_URL` change, not a code change.

Repositories write SQL using SQLite-style `?` placeholders; this class
translates them to `$1, $2, ...` internally, so repository code never
differs by backend.

`AUDIO_STORAGE_PROVIDER=object` uses `ObjectStorageAudioStorage`
(`storage/objectStorageAudioStorage.js`) - a generic implementation holding
all the actual logic (write-then-verify-before-committing, key
construction, path-traversal guarding) exactly once, parameterized by a
small `client` adapter (`put/get/head/delete`). **No concrete client is
implemented yet** - no object-storage account has been provisioned, and
none should be added without an explicit decision (see the
`OBJECT_STORAGE_CLIENT` error message in `config/storageConfig.js`). Adding
one later (Vercel Blob, S3, R2, a UF-approved store) means writing one
small client file and wiring it into `storageConfig.js` - nothing above
that layer changes.

Unlike the local SQLite system, `ObjectStorageAudioStorage` does **not**
reproduce a two-copy primary/secondary mirror at the application level -
real object-storage providers already replicate objects internally across
multiple physical devices/zones, so a hand-rolled second copy would be
redundant complexity pretending to add safety the provider already
provides. Likewise, `PostgresResearchDatabase` relies on the hosted
database's own backup/replication infrastructure rather than the
application faking database replication with two files, the way local
SQLite does. That local two-file design exists specifically to compensate
for a single machine's local disk having no other redundancy - a managed
Postgres/object-storage service already has that redundancy built in.

## Concurrency

Every repository method is `async` and talks to the database through the
`ResearchDatabase` interface only - there is no process-local mutable
state, in-memory cache, or filesystem lock anywhere in the data-access
layer that assumes a single running instance. Against `PostgresResearchDatabase`,
multiple concurrent Vercel function instances all read/write the same
durable database as their single source of truth. The one place a
read-then-write race was possible (`transcriptionRepository.insert()`
computing the next version number) was rewritten to compute it atomically
inside a single `INSERT` statement, backed by a unique `(recording_id,
version)` index as a hard backstop against any remaining collision.

## Admin deletion

Unchanged by this architecture: soft-delete only
(`participants.deleted_at`), authenticated, requires explicit confirmation,
audit-logged (`admin_audit_log`, via `repositories/auditLogRepository.js` -
routes never execute SQL directly). No code path deletes research data as a
side effect of startup, restart, deployment, migration, or a provider
switch.

## Migration between providers

`database/migrate.js` provides `migrateDatabase()`, `verifyDatabaseMigration()`,
and `migrateAudio()` - generic functions that only ever call
`ResearchDatabase`/`AudioStorage` interface methods on a source and a
destination, never a provider SDK directly. The same functions migrate:

- local SQLite -> Vercel Postgres (the near-term move)
- Vercel Postgres -> a future UF Postgres server (the eventual move)
- Postgres -> SQLite (for pulling production data into a local dev/debug copy)

Every row is copied with its **exact original id, timestamps, and version
number** - nothing is regenerated. The source is never modified, deleted,
or locked; a per-row destination failure is collected in a report rather
than aborting or rolling back the source. See `tests/backend/migrate.test.mjs`.

## Moving from Vercel to UF later

1. Provision UF's Postgres (and object storage, or a mounted filesystem -
   see below) instance; get its connection string/credentials.
2. Deploy the same application code to UF's server, with
   `DATABASE_PROVIDER=postgres`, `DATABASE_URL=<UF's connection string>`,
   and either `AUDIO_STORAGE_PROVIDER=object` (if UF gives object storage -
   write one small client adapter first) or `AUDIO_STORAGE_PROVIDER=local`
   with `AUDIO_STORAGE_DIR` pointed at a UF-provided mounted filesystem (no
   new code needed at all in that case - `LocalFilesystemAudioStorage`
   already works against any writable directory).
3. Run `migrateDatabase()`/`migrateAudio()` from the Vercel Postgres
   instance to the new UF instance.
4. Run `verifyDatabaseMigration()` (row counts) plus a manual spot-check.
5. Switch `DATABASE_URL`/env vars to point production traffic at UF.
6. Decommission the Vercel deployment once satisfied.

No step here touches `experimentController.js`, `mouseTask.js`, any
cognitive-task/scoring/transcription logic, the admin dashboard, the
frontend, or any repository's public method - the entire experiment is
unaware storage moved.
