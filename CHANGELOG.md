# Changelog

## Unreleased

### Changed

- **Removed live, participant-facing speech transcription.** The cognitive
  speech phases (`SUBTRACTION_<n>`/`DUAL_TASK_<n>`) no longer show a live
  transcript at all - participants see only a microphone/recording
  indicator (icon, status, elapsed/duration timer). The Web Speech API
  (`SpeechRecognition`/`webkitSpeechRecognition`) is no longer used anywhere
  in the production app.
- Replaced the live recognition pipeline
  (`cognitive/speechRecognition.js`, `cognitive/cognitiveSpeechSession.js`,
  `ui/speechTranscriptPanel.js` - all deleted) with full-phase audio
  recording (`cognitive/audioRecorder.js`, `cognitive/cognitiveAudioSession.js`,
  `ui/recordingPanel.js`) uploaded once per phase and transcribed/parsed/
  scored on the backend after the phase ends. `cognitive/numberParser.js`
  and `cognitive/speechScoring.js` (the deterministic parser and adaptive
  scoring engine) are unchanged in principle and reused as-is, called from
  the backend; `numberParser.js` gained two narrow, backward-compatible
  additions - merging adjacent short digit runs ("8 49" -> 849) and a
  "hundred"-less spoken word form ("eight forty nine" -> 849) - that used to
  be handled by the now-deleted live-event fragment-merging logic.
- Built a research database (participant -> session -> phase -> recording ->
  versioned transcription -> versioned scored responses), audio storage,
  and a modular/replaceable transcription provider (UF NaviGator Whisper
  Large v3, with a stub fallback for local dev/tests) from scratch - see
  `docs/data-flow.md` and `app/backend/{database,repositories,storage,
  transcription,services}/`.
- Added a research/admin dashboard (`app/frontend/admin/`,
  `app/backend/routes/admin.js`) for reviewing participants/sessions,
  listening to original recordings, reading raw transcripts, and inspecting
  the expected-vs-actual response table - gated by a shared-secret admin
  token, not participant-facing.

- Reorganized the project from a flat `UF_OPS/` layout into a scalable
  `app/frontend` + `app/backend` architecture intended to support future
  research experiments (see `README.md`).
- Split the original monolithic `game.js` into focused modules under
  `app/frontend/js/` (`timer/`, `mouse/`, `experiment/`, `ui/`, `data/`),
  and the original `styles.css` into `styles.css`, `experiment.css`, and
  `mouse-task.css`.
- Split the original monolithic `server.js` into `app/backend/server.js`
  (app setup), `routes/exports.js` (the `/saveScore` endpoint), and
  `services/exportService.js` (the Excel read/write logic).
- Relocated `scores.xlsx` to `data/exports/excel/scores.xlsx`.
- Added `config/experimentConfig.js` and `config/mouseTaskConfig.js` as
  placeholders for future configuration (not yet wired in).
- Added placeholder modules/routes/services for future participant,
  session, cognitive-task, and database functionality. None of these are
  wired into the running application yet.

### Preserved

- All existing behavior: the 3-session mouse-accuracy task, scoring,
  timers, and Excel export work exactly as before.

## Original

The original, unmodified project is kept at `original/UF_OPS/` as a
permanent reference.
