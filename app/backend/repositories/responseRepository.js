// processing_runs + responses tables - the scored research output of one
// transcription. Both are append-only: reprocessing (see
// services/speechProcessingService.js) always inserts a brand-new
// processing_runs row plus its own full responses row set; a prior run's
// rows are never updated or deleted, so every past scoring result stays
// auditable.
//
// Async throughout - see participantRepository.js's header comment for why.

const crypto = require('node:crypto');

class ResponseRepository {
    constructor(db) {
        this._db = db;
    }

    async insertProcessingRun({ transcriptionId, parserVersion, scoringMode, expectedResponseDigits, subtractionValue, startingNumber }) {
        const id = crypto.randomUUID();
        await this._db.prepare(
            `INSERT INTO processing_runs (id, transcription_id, parser_version, scoring_mode, expected_response_digits, subtraction_value, starting_number, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
            id, transcriptionId, parserVersion, scoringMode, expectedResponseDigits,
            subtractionValue ?? null, startingNumber ?? null, new Date().toISOString()
        );
        return this.getProcessingRunById(id);
    }

    async getProcessingRunById(id) {
        return (await this._db.prepare('SELECT * FROM processing_runs WHERE id = ?').get(id)) || null;
    }

    async getLatestProcessingRunForTranscription(transcriptionId) {
        return (await this._db.prepare(
            'SELECT * FROM processing_runs WHERE transcription_id = ? ORDER BY created_at DESC LIMIT 1'
        ).get(transcriptionId)) || null;
    }

    async listProcessingRunsForTranscription(transcriptionId) {
        return this._db.prepare(
            'SELECT * FROM processing_runs WHERE transcription_id = ? ORDER BY created_at ASC'
        ).all(transcriptionId);
    }

    // responses: array of the section-9 shape (responseIndex, expectedNumber,
    // actualNumber, correctness, referenceNumberAfterResponse,
    // nextExpectedNumber, rawTranscriptSegment, timestamp). Inserted verbatim,
    // one row each, in one pass - never partially written.
    async insertResponses(processingRunId, responses) {
        const stmt = this._db.prepare(
            `INSERT INTO responses (id, processing_run_id, response_index, expected_number, actual_number, correctness, reference_number_after_response, next_expected_number, raw_transcript_segment, timestamp_ms, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        const createdAt = new Date().toISOString();
        for (const response of responses) {
            await stmt.run(
                crypto.randomUUID(), processingRunId, response.responseIndex,
                response.expectedNumber ?? null, response.actualNumber ?? null, response.correctness,
                response.referenceNumberAfterResponse ?? null, response.nextExpectedNumber ?? null,
                response.rawTranscriptSegment ?? null, response.timestamp ?? null, createdAt
            );
        }
    }

    async listResponsesForRun(processingRunId) {
        return this._db.prepare(
            'SELECT * FROM responses WHERE processing_run_id = ? ORDER BY response_index ASC'
        ).all(processingRunId);
    }
}

module.exports = { ResponseRepository };
