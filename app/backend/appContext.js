// Single place that wires the database, repositories, storage,
// transcription provider, and the services built from them. server.js uses
// this with no overrides (real DB, real/stub transcription provider
// depending on env); tests override `db`/`audioStorage`/
// `transcriptionProvider` to get a fully isolated, in-memory context per
// test file - see tests/backend/*.test.mjs.

const { getDb, createDatabase } = require('./database/db');
const { ParticipantRepository } = require('./repositories/participantRepository');
const { SessionRepository } = require('./repositories/sessionRepository');
const { PhaseRepository } = require('./repositories/phaseRepository');
const { RecordingRepository } = require('./repositories/recordingRepository');
const { TranscriptionRepository } = require('./repositories/transcriptionRepository');
const { ResponseRepository } = require('./repositories/responseRepository');
const { LocalFilesystemAudioStorage } = require('./storage/audioStorage');
const { createDefaultTranscriptionProvider } = require('./transcription');
const { SpeechProcessingService } = require('./services/speechProcessingService');
const { AdminQueryService } = require('./services/adminQueryService');

function createAppContext({ db, audioStorage, transcriptionProvider, logger = console.log } = {}) {
    const database = db || getDb();

    const participantRepository = new ParticipantRepository(database);
    const sessionRepository = new SessionRepository(database);
    const phaseRepository = new PhaseRepository(database);
    const recordingRepository = new RecordingRepository(database);
    const transcriptionRepository = new TranscriptionRepository(database);
    const responseRepository = new ResponseRepository(database);

    const resolvedAudioStorage = audioStorage || new LocalFilesystemAudioStorage();
    const resolvedTranscriptionProvider = transcriptionProvider || createDefaultTranscriptionProvider(logger);

    const speechProcessingService = new SpeechProcessingService({
        audioStorage: resolvedAudioStorage,
        transcriptionProvider: resolvedTranscriptionProvider,
        recordingRepository,
        transcriptionRepository,
        responseRepository,
        logger
    });

    const adminQueryService = new AdminQueryService({
        participantRepository, sessionRepository, phaseRepository,
        recordingRepository, transcriptionRepository, responseRepository
    });

    return {
        db: database,
        participantRepository, sessionRepository, phaseRepository,
        recordingRepository, transcriptionRepository, responseRepository,
        audioStorage: resolvedAudioStorage,
        transcriptionProvider: resolvedTranscriptionProvider,
        speechProcessingService,
        adminQueryService
    };
}

module.exports = { createAppContext, createDatabase };
