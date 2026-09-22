-- Research data schema for the cognitive-speech pipeline:
--   Participant -> Session -> Phase -> Recording (audio) -> Transcription
--   (versioned) -> Processing run -> Responses (versioned)
--
-- In normal operation, nothing here is ever UPDATEd or DELETEd - a
-- reprocessed recording gets a brand-new transcriptions/processing_runs/
-- responses row set (see app/backend/services/speechProcessingService.js),
-- never an overwrite of the previous one. recordings.storage_path always
-- points at the original, untouched audio file. participants.deleted_at
-- (see database/researchDatabase.js's applySchema) is the one routine
-- exception - a reversible soft delete.
--
-- The one IRREVERSIBLE exception to all of the above is the explicit,
-- authenticated, confirmation-gated admin hard-delete action (routes/admin.js's
-- /participants/:id/hard-delete, backed by
-- repositories/participantDeletionRepository.js - see that file's header for
-- the full reasoning) - it genuinely DELETEs every row descended from one
-- named participant. tests/backend/researchDatabase.test.mjs's TEST 14
-- enforces that no other file in the codebase deletes rows this way.
--
-- This is the SQLite reference implementation (see app/backend/database/db.js).
-- Swapping to a UF-approved persistent database means providing a
-- same-shaped implementation of app/backend/repositories/*.js against that
-- database - nothing else in the app needs to change.

CREATE TABLE IF NOT EXISTS participants (
    id TEXT PRIMARY KEY,
    participant_code TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    participant_id TEXT NOT NULL REFERENCES participants(id),
    experiment_id TEXT,
    session_date TEXT,
    start_time TEXT,
    end_time TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_participant ON sessions(participant_id);

-- phase_id is the semantic condition id (SUBTRACTION_3, DUAL_TASK_7, ...);
-- id is this row's own generated identifier.
CREATE TABLE IF NOT EXISTS phases (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    phase_id TEXT NOT NULL,
    phase_type TEXT,
    subtraction_value INTEGER,
    starting_number INTEGER,
    duration REAL,
    started_at TEXT,
    ended_at TEXT,
    -- Stored on the phase (not just passed per-request) so an admin
    -- reprocess (routes/admin.js) can re-run scoring with the exact
    -- settings the phase actually ran under, without depending on the
    -- original upload request still being available.
    scoring_mode TEXT,
    expected_response_digits INTEGER,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_phases_session ON phases(session_id);

-- One row per phase's complete audio recording. Immutable: storage_path is
-- written once and never changed, so the original audio always remains
-- available for reprocessing (see docs/data-flow.md).
CREATE TABLE IF NOT EXISTS recordings (
    id TEXT PRIMARY KEY,
    phase_id TEXT NOT NULL REFERENCES phases(id),
    storage_path TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    duration_seconds REAL,
    file_size_bytes INTEGER,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recordings_phase ON recordings(phase_id);

-- Versioned per recording (version 1, 2, ...). raw_text is exactly what the
-- transcription provider returned - never normalized into digits, never
-- overwritten by a later reprocessing attempt (that creates a new row with
-- version + 1 instead).
CREATE TABLE IF NOT EXISTS transcriptions (
    id TEXT PRIMARY KEY,
    recording_id TEXT NOT NULL REFERENCES recordings(id),
    version INTEGER NOT NULL,
    provider TEXT NOT NULL,
    model TEXT,
    raw_text TEXT,
    status TEXT NOT NULL,
    error_message TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transcriptions_recording ON transcriptions(recording_id);
-- Backstop against a version collision under concurrent reprocessing
-- requests (see repositories/transcriptionRepository.js#insert, which
-- computes the version atomically to avoid this in the first place - this
-- index turns any collision that somehow still happens into a loud
-- constraint violation instead of two rows silently claiming the same
-- version).
CREATE UNIQUE INDEX IF NOT EXISTS idx_transcriptions_recording_version ON transcriptions(recording_id, version);

-- One processing_runs row per (re)run of numberParser.js/speechScoring.js
-- against a given transcription. parser_version is a free-text tag (bumped
-- manually if the parsing logic itself ever changes) so the admin dashboard
-- can distinguish which run produced which responses.
CREATE TABLE IF NOT EXISTS processing_runs (
    id TEXT PRIMARY KEY,
    transcription_id TEXT NOT NULL REFERENCES transcriptions(id),
    parser_version TEXT NOT NULL,
    scoring_mode TEXT NOT NULL,
    expected_response_digits INTEGER NOT NULL,
    subtraction_value INTEGER,
    starting_number INTEGER,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_processing_runs_transcription ON processing_runs(transcription_id);

-- The section-9 research data model, one row per parsed response, scoped to
-- one processing_runs row. correctness is 'correct' | 'incorrect' |
-- 'unresolved' (mirrors speechScoring.js's own vocabulary, unchanged).
CREATE TABLE IF NOT EXISTS responses (
    id TEXT PRIMARY KEY,
    processing_run_id TEXT NOT NULL REFERENCES processing_runs(id),
    response_index INTEGER NOT NULL,
    expected_number INTEGER,
    actual_number INTEGER,
    correctness TEXT NOT NULL,
    reference_number_after_response INTEGER,
    next_expected_number INTEGER,
    raw_transcript_segment TEXT,
    timestamp_ms INTEGER,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_responses_run ON responses(processing_run_id);
