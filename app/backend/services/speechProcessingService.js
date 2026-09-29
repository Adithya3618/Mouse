// Orchestrates one full (re)processing pass for a single recording:
//   audio -> transcription (versioned) -> numberParser.js/speechScoring.js
//   (UNCHANGED) -> processing_runs + responses (versioned)
//
// This is the ONLY backend file that touches the participant-facing
// parsing/scoring modules, and it imports them completely unmodified via a
// dynamic import() of their actual frontend source files - there is no
// backend copy/fork of that logic to drift out of sync. Both modules are
// pure, zero-dependency ESM with no DOM dependency (verified before this
// refactor), so this works identically to how the browser used to call them.
//
// Called both for the very first processing of a freshly-uploaded recording
// and for an explicit admin reprocess (routes/admin.js) - both cases are
// exactly the same operation: transcribe the ORIGINAL, untouched audio file
// again and score the result as a new version. The audio itself is only
// ever read here, never rewritten.

const path = require('node:path');
const { pathToFileURL } = require('node:url');

const NUMBER_PARSER_URL = pathToFileURL(
    path.join(__dirname, '../../frontend/js/cognitive/numberParser.js')
).href;
const SPEECH_SCORING_URL = pathToFileURL(
    path.join(__dirname, '../../frontend/js/cognitive/speechScoring.js')
).href;
const SPEECH_SILENCE_FILTER_URL = pathToFileURL(
    path.join(__dirname, '../../frontend/js/cognitive/speechSilenceFilter.js')
).href;

// Bumped only if this mapping step (NOT numberParser.js/speechScoring.js
// themselves) ever changes - recorded on processing_runs so the admin
// dashboard can tell which run used which mapping logic.
const PARSER_VERSION = '1.0.0';

class SpeechProcessingService {
    constructor({
        audioStorage,
        transcriptionProvider,
        recordingRepository,
        transcriptionRepository,
        responseRepository,
        logger = () => {}
    }) {
        this._audioStorage = audioStorage;
        this._transcriptionProvider = transcriptionProvider;
        this._recordingRepository = recordingRepository;
        this._transcriptionRepository = transcriptionRepository;
        this._responseRepository = responseRepository;
        this._logger = logger;
    }

    // phase: the phases repository row (subtraction_value, starting_number).
    // scoringOptions: { scoringMode, expectedResponseDigits } from
    // config/experimentConfig.js, threaded through by the caller (routes/recordings.js/admin.js)
    // exactly as experimentController.js already does on the frontend.
    async process({ recordingId, phase, scoringOptions }) {
        const recording = await this._recordingRepository.getById(recordingId);
        if (!recording) {
            throw new Error(`No recording found with id ${recordingId}`);
        }

        const audioBuffer = await this._audioStorage.read(recording.storage_path);

        let text = null;
        let model = null;
        let raw = null;
        let status = 'succeeded';
        let errorMessage = null;
        try {
            const result = await this._transcriptionProvider.transcribe(audioBuffer, recording.mime_type);
            text = result.text;
            model = result.model;
            raw = result.raw;
        } catch (error) {
            // Never logs the audio itself or (on success) the transcript
            // text - only the failure reason, which is service/network
            // metadata, not participant content.
            this._logger(`speechProcessingService: transcription failed for recording ${recordingId} - ${error.message}`);
            status = 'failed';
            errorMessage = error.message;
        }

        const transcription = await this._transcriptionRepository.insert({
            recordingId,
            provider: this._transcriptionProvider.name,
            model,
            rawText: text,
            status,
            errorMessage,
            metadata: raw
        });

        if (status === 'failed') {
            return { status: 'failed', error: errorMessage, transcription, processingRun: null, responses: [], results: null };
        }

        const { processingRun, responses, results } = await this._scoreTranscription({ transcription, phase, scoringOptions });
        return { status: 'succeeded', transcription, processingRun, responses, results };
    }

    async _scoreTranscription({ transcription, phase, scoringOptions }) {
        const { parseNumbersFromTranscript } = await import(NUMBER_PARSER_URL);
        const { scoreResponses, calculateCognitiveAccuracy, mapToResearchRecords } = await import(SPEECH_SCORING_URL);
        const { buildSpeechOnlyTranscript } = await import(SPEECH_SILENCE_FILTER_URL);

        const { scoringMode, expectedResponseDigits } = scoringOptions;
        const startingNumber = phase.starting_number;
        const subtractionValue = phase.subtraction_value;

        // Silence/non-speech audio can be hallucinated by the transcription
        // service into repeated, fabricated text (e.g. "759, 759, 759...")
        // - see speechSilenceFilter.js's own header for the full reasoning.
        // transcription.raw_text itself (the research record) is NEVER
        // altered - only this derived, speech-only string, used solely to
        // decide what gets parsed into a scoreable response, is filtered.
        const speechOnlyText = buildSpeechOnlyTranscript(transcription.raw_text, transcription.metadata);
        const segments = parseNumbersFromTranscript(speechOnlyText, { expectedDigits: expectedResponseDigits });
        const rawResponses = segments.map((segment) => ({
            rawTranscript: segment.raw,
            parsedNumber: segment.value,
            resolved: segment.resolved
        }));

        // UNCHANGED scoring engine - see module header. mode/startingNumber/
        // subtractionValue are the only inputs; this never sees or needs to
        // know about audio/transcription at all.
        const scored = scoreResponses(rawResponses, { startingNumber, subtractionValue, mode: scoringMode });

        const mapped = mapToResearchRecords(scored, { startingNumber, subtractionValue, mode: scoringMode });

        const processingRun = await this._responseRepository.insertProcessingRun({
            transcriptionId: transcription.id,
            parserVersion: PARSER_VERSION,
            scoringMode,
            expectedResponseDigits,
            subtractionValue,
            startingNumber
        });
        await this._responseRepository.insertResponses(processingRun.id, mapped);

        const correctResponses = scored.filter((r) => r.correctness === 'correct').length;
        const incorrectResponses = scored.filter((r) => r.correctness === 'incorrect').length;
        const unresolvedResponses = scored.filter((r) => r.correctness === 'unresolved').length;

        // Same result shape CognitiveSpeechSession.getResults() used to
        // return, so recordCognitivePerformance()/dataFormatter.js/
        // exportService.js need no changes.
        const results = {
            subtractionRule: subtractionValue,
            startingNumber,
            rawTranscript: transcription.raw_text,
            parsedNumbers: scored.map((r) => r.parsedNumber),
            expectedNumbers: scored.map((r) => r.expectedNumber),
            responses: scored,
            correctResponses,
            incorrectResponses,
            unresolvedResponses,
            numberOfResponses: scored.length,
            cognitiveAccuracy: calculateCognitiveAccuracy(correctResponses, incorrectResponses),
            scoringMode
        };

        return { processingRun, responses: mapped, results };
    }
}

// timestamp is left null: the UF NaviGator endpoint's plain transcript
// response has no reliable per-number offset to attach (see
// ufNaviGatorProvider.js's response_format:'verbose_json' request - whatever
// segment-level timing it does return is preserved unmodified in
// transcriptions.metadata_json, so a future pass can map it onto individual
// responses without needing to re-transcribe anything). Per the spec: "If
// precise audio clipping is too complex for the first implementation, at
// minimum preserve timestamps so this can be added later" - the timestamps
// are preserved, just not yet joined to individual responses. This mapping
// (mapToResearchRecords) itself now lives in cognitive/speechScoring.js,
// alongside scoreResponses() - see that file for why.

module.exports = { SpeechProcessingService, PARSER_VERSION };
