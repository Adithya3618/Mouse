# Cognitive speech data flow (audio recording + backend transcription)

This documents the actual data flow for the cognitive-speech phases
(`SUBTRACTION_<n>` / `DUAL_TASK_<n>`) after the 2026 removal of live,
participant-facing speech transcription. It replaces any prior assumption
that the browser recognizes/displays numbers live - it no longer does.

## Entity chain

```
Participant (participant code, no real name collected)
  -> Session (one experiment run)
    -> Phase (one SUBTRACTION_<n>/DUAL_TASK_<n> condition)
      -> Recording (the complete, original audio file - immutable)
        -> Transcription (versioned; raw provider text, never overwritten)
          -> Processing run (one parse+score pass over one transcription version)
            -> Responses (the section-9 research record, one row per parsed number)
```

Implemented in `app/backend/database/schema.sql`, with one repository per
table under `app/backend/repositories/`.

## Participant experience

1. On entering a cognitive-active phase, `experiment/experimentController.js`
   creates a `cognitive/cognitiveAudioSession.js`, which requests microphone
   permission and starts a `cognitive/audioRecorder.js` (a `MediaRecorder`
   wrapper).
2. The participant sees only `ui/recordingPanel.js`'s indicator: a mic icon,
   a recording status line, and an elapsed/duration timer. **No transcript,
   no recognized numbers, are ever rendered.**
3. Recording continues for the entire phase regardless of pauses - there is
   no per-utterance segmentation on the client at all.
4. When the phase timer ends, `cognitiveAudioSession.stop()` finalizes one
   complete `Blob` for the whole phase and uploads it via
   `data/recordingUploadService.js` to `POST /api/recordings`. This is
   **not awaited** by the experiment controller - phase advancement and all
   experiment timing are completely unaffected by upload/transcription
   latency (see the "Timing" section below).
5. Only the final results screen (`ui/resultsScreen.js`) waits (with a
   simple "Processing your recording(s)…" message) for every phase's
   pipeline to finish, before showing the cognitive results table and
   enabling Excel export.

**Audio format**: `audio/webm;codecs=opus` (falling back to plain
`audio/webm`, then `audio/mp4` for Safari) - see `audioRecorder.js`'s module
comment for the full rationale (broad support, small file size, accepted by
the transcription endpoint).

## Backend pipeline (`app/backend/routes/recordings.js` -> `app/backend/services/speechProcessingService.js`)

1. The participant/session/phase rows are created or looked up
   (`participantRepository`/`sessionRepository`/`phaseRepository`).
2. The audio buffer is written, unmodified, via the storage abstraction
   (`app/backend/storage/audioStorage.js` - local filesystem by default,
   under `data/audio/`, gitignored, never web-servable directly).
3. The audio is sent to the configured `TranscriptionProvider`
   (`app/backend/transcription/`) - UF NaviGator's Whisper Large v3 endpoint
   in production, or a deterministic stub when `UF_NAVIGATOR_API_KEY` is
   unset (local dev/tests only - never used when a real key is configured).
4. The raw returned text is stored, verbatim, as a new `transcriptions` row
   (versioned - see "Reprocessing" below).
5. `numberParser.js` and `speechScoring.js` - the exact same,
   **unmodified** deterministic modules the participant-facing app always
   used - are loaded via a dynamic `import()` of their real source files and
   run against the raw transcript. Nothing here duplicates or forks that
   logic.
6. The scored output is mapped into the section-9 research shape
   (`responseIndex`, `expectedNumber`, `actualNumber`, `correctness`,
   `referenceNumberAfterResponse`, `nextExpectedNumber`,
   `rawTranscriptSegment`, `timestamp`) and stored as a new `processing_runs`
   + `responses` row set.
7. The same result shape the old in-browser session used to produce is
   returned to the frontend, so `data/sessionData.js`,
   `data/dataFormatter.js`, and `services/exportService.js` needed no shape
   changes at all.

## Timing guarantee

`experiment/experimentController.js#_exitPhase` calls
`cognitiveAudioSession.stop()` but does **not** `await` it before advancing
the phase state machine - the returned promise is only tracked (in
`_pendingCognitiveProcessing`) for `ui/resultsScreen.js` to wait on later.
Every existing phase-duration/timer/subtraction-rule/scoring behavior is
therefore completely untouched by however long transcription takes.

## Reprocessing / versioning

`POST /api/admin/recordings/:id/reprocess` re-runs the exact same pipeline
against the **same, untouched original audio file**, inserting a brand new
`transcriptions` row (version N+1) and a brand new `processing_runs` +
`responses` row set. Nothing is ever updated or deleted - every past
transcription/scoring attempt remains queryable. The original audio file on
disk is never rewritten by any code path in this system.

## Admin/research dashboard

`app/frontend/admin/` (participant list, participant profile, session
detail) is a separate, non-participant-facing static app. Every data
request it makes goes through `/api/admin/*`
(`app/backend/routes/admin.js`), gated by a shared-secret bearer token
(`ADMIN_API_TOKEN` - see `app/backend/routes/adminAuth.js`). Audio is only
ever served through the authenticated, range-supporting
`GET /api/admin/recordings/:id/audio` route - never as a static file.

## Privacy / security notes

- Audio is written only to the server's local filesystem
  (`data/audio/`, gitignored) or, in production, to whatever storage the
  `AudioStorage` implementation is swapped to (see below) - never into
  frontend source, git, or `localStorage`.
- The UF NaviGator API key and the admin token are read from server-side
  environment variables only (see `.env.example`) and are never sent to the
  browser.
- No participant audio content or transcript text is ever written to a log
  line anywhere in this pipeline - only status/error metadata (see
  `speechProcessingService.js` and `ufNaviGatorProvider.js`'s comments).
- No LLM correction layer exists anywhere in this pipeline. The number
  parser (`numberParser.js`) is a deterministic, auditable regex/arithmetic
  module; the scoring engine (`speechScoring.js`) is likewise deterministic.
  Neither ever "corrects" a participant's answer toward what was expected.

## Known production gap: storage

This implementation's default database (`app/backend/database/db.js`, using
Node's built-in `node:sqlite`) and audio storage
(`LocalFilesystemAudioStorage`) are appropriate for local development and a
single long-running Node process (`npm start`). They are **not** appropriate
for Vercel's serverless deployment target (`vercel.json`), whose filesystem
is ephemeral outside `/tmp` - a SQLite file or locally-stored audio file
written there will not persist across invocations. Before any production
deployment on that target (or any multi-instance deployment), swap in:

- A `db` implementation with the same repository method signatures
  (`app/backend/repositories/*.js`) backed by a real, UF-approved persistent
  database (e.g. Postgres).
- An `AudioStorage` implementation with the same `save()`/`read()`/
  `exists()`/`stat()` shape (`app/backend/storage/audioStorage.js`) backed by
  UF-approved object storage.

Nothing else in the application needs to change to make that swap - both
seams already exist and are the only place these concerns are touched.
