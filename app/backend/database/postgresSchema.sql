-- Postgres schema for PostgresResearchDatabase (database/postgresResearchDatabase.js).
-- Deliberately identical in shape/columns/relationships to
-- database/schema.sql (the SQLite reference schema) - every column type
-- used there (TEXT, INTEGER, REAL) is valid, portable Postgres too, so
-- there is no dialect drift to reconcile between the two backends. See
-- schema.sql's own header for the participant -> session -> phase ->
-- recording -> transcription -> processing_run -> responses shape and the
-- "nothing is ever UPDATEd/DELETEd" append-only design.
--
-- CREATE TABLE/INDEX IF NOT EXISTS throughout - applied on every
-- PostgresResearchDatabase startup, always idempotent, never destructive
-- (see this file's own header note in postgresResearchDatabase.js).
--
-- admin_audit_log and participants.deleted_at are included directly here
-- (rather than as a separate additive migration step, the way SQLite's
-- researchDatabase.js retrofits an existing pre-soft-delete database) since
-- this schema is only ever applied fresh against a Postgres database that
-- starts from nothing.

CREATE TABLE IF NOT EXISTS participants (
    id TEXT PRIMARY KEY,
    participant_code TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    deleted_at TEXT
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
    scoring_mode TEXT,
    expected_response_digits INTEGER,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_phases_session ON phases(session_id);

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
CREATE UNIQUE INDEX IF NOT EXISTS idx_transcriptions_recording_version ON transcriptions(recording_id, version);

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

-- Mouse task data - see schema.sql for the full description.
CREATE TABLE IF NOT EXISTS mouse_phase_performance (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    participant_id TEXT NOT NULL REFERENCES participants(id),
    phase_id TEXT NOT NULL,
    phase_type TEXT,
    phase_started_at TEXT,
    task_started_at TEXT,
    task_ended_at TEXT,
    duration_ms REAL,
    actual_duration_ms REAL,
    target_size_px REAL,
    target_spawn_interval_ms REAL,
    target_lifetime_ms REAL,
    container_width REAL,
    container_height REAL,
    total_targets INTEGER NOT NULL,
    total_clicks INTEGER NOT NULL,
    total_hits INTEGER NOT NULL,
    total_misses INTEGER NOT NULL,
    accuracy REAL NOT NULL,
    target_efficiency REAL,
    avg_reaction_time_ms REAL,
    min_reaction_time_ms REAL,
    max_reaction_time_ms REAL,
    median_reaction_time_ms REAL,
    created_at TEXT NOT NULL,
    UNIQUE (session_id, phase_id)
);
CREATE INDEX IF NOT EXISTS idx_mouse_phase_performance_session ON mouse_phase_performance(session_id);

CREATE TABLE IF NOT EXISTS mouse_click_events (
    id TEXT PRIMARY KEY,
    mouse_phase_performance_id TEXT NOT NULL REFERENCES mouse_phase_performance(id),
    session_id TEXT NOT NULL,
    participant_id TEXT NOT NULL,
    phase_id TEXT NOT NULL,
    click_sequence INTEGER NOT NULL,
    clicked_at TEXT,
    elapsed_ms REAL NOT NULL,
    x REAL,
    y REAL,
    viewport_x REAL,
    viewport_y REAL,
    target_active INTEGER NOT NULL,
    active_target_count INTEGER,
    is_hit INTEGER NOT NULL,
    is_miss INTEGER NOT NULL,
    target_id INTEGER,
    target_x REAL,
    target_y REAL,
    target_appeared_elapsed_ms REAL,
    target_appeared_at TEXT,
    reaction_time_ms REAL,
    created_at TEXT NOT NULL,
    UNIQUE (mouse_phase_performance_id, click_sequence)
);
CREATE INDEX IF NOT EXISTS idx_mouse_click_events_session ON mouse_click_events(session_id);

CREATE TABLE IF NOT EXISTS mouse_targets (
    id TEXT PRIMARY KEY,
    mouse_phase_performance_id TEXT NOT NULL REFERENCES mouse_phase_performance(id),
    session_id TEXT NOT NULL,
    phase_id TEXT NOT NULL,
    target_id INTEGER NOT NULL,
    x REAL,
    y REAL,
    size_px REAL,
    appeared_elapsed_ms REAL NOT NULL,
    appeared_at TEXT,
    hit_elapsed_ms REAL,
    disappeared_elapsed_ms REAL,
    outcome TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (mouse_phase_performance_id, target_id)
);
CREATE INDEX IF NOT EXISTS idx_mouse_targets_session ON mouse_targets(session_id);

CREATE TABLE IF NOT EXISTS admin_audit_log (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    details_json TEXT,
    performed_at TEXT NOT NULL
);
