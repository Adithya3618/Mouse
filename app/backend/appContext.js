// Single place that wires the database, repositories, storage,
// transcription provider, and the services built from them. server.js uses
// this with no overrides - the default `db`/`audioStorage` come from
// config/storageConfig.js's provider-selection factory (sqlite/local by
// default, so `npm start` needs zero configuration - see that file for how
// DATABASE_PROVIDER/AUDIO_STORAGE_PROVIDER select something else). Tests
// override `db`/`audioStorage`/`transcriptionProvider` directly to get a
// fully isolated, in-memory/temp-dir context per test file - see
// tests/backend/*.test.mjs.

const { createResearchDatabase, createAudioStorage } = require('./config/storageConfig');
const { createDatabase } = require('./database/db');
const { ParticipantRepository } = require('./repositories/participantRepository');
const { SessionRepository } = require('./repositories/sessionRepository');
const { PhaseRepository } = require('./repositories/phaseRepository');
const { RecordingRepository } = require('./repositories/recordingRepository');
const { TranscriptionRepository } = require('./repositories/transcriptionRepository');
const { ResponseRepository } = require('./repositories/responseRepository');
const { AuditLogRepository } = require('./repositories/auditLogRepository');
const { createDefaultTranscriptionProvider } = require('./transcription');
const { SpeechProcessingService } = require('./services/speechProcessingService');
const { AdminQueryService } = require('./services/adminQueryService');

function createAppContext({ db, audioStorage, transcriptionProvider, logger = console.log } = {}) {
    const database = db || createResearchDatabase({ logger });

    const participantRepository = new ParticipantRepository(database);
    const sessionRepository = new SessionRepository(database);
    const phaseRepository = new PhaseRepository(database);
    const recordingRepository = new RecordingRepository(database);
    const transcriptionRepository = new TranscriptionRepository(database);
    const responseRepository = new ResponseRepository(database);
    const auditLogRepository = new AuditLogRepository(database);

    const resolvedAudioStorage = audioStorage || createAudioStorage({ logger });
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
        auditLogRepository,
        audioStorage: resolvedAudioStorage,
        transcriptionProvider: resolvedTranscriptionProvider,
        speechProcessingService,
        adminQueryService
    };
}

module.exports = { createAppContext, createDatabase };
