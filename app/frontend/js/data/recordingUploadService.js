// Uploads one phase's complete audio recording to the backend
// (POST /api/recordings - see app/backend/routes/recordings.js) and returns
// the finished transcription/parsing/scoring result. This is the ONLY
// place audio ever leaves the browser - never to any third-party service,
// never through localStorage, never logged.
//
// Deliberately a thin, swappable function (mirrors
// data/sessionData.js#saveScoreToServer's existing style) so
// cognitiveAudioSession.js never talks to `fetch`/FormData directly.

import { buildApiUrl } from '../config/apiBaseUrl.js';

export async function uploadRecording({
    blob,
    mimeType,
    participantCode,
    sessionId,
    experimentId,
    sessionDate,
    phaseId,
    phaseType,
    subtractionValue,
    startingNumber,
    duration,
    startedAt,
    endedAt,
    expectedResponseDigits,
    scoringMode,
    fetchImpl = fetch
}) {
    const formData = new FormData();
    formData.append('audio', blob, `recording.${extensionForMime(mimeType)}`);
    formData.append('participantCode', participantCode ?? '');
    formData.append('sessionId', sessionId ?? '');
    formData.append('experimentId', experimentId ?? '');
    formData.append('sessionDate', sessionDate ?? '');
    formData.append('phaseId', phaseId ?? '');
    formData.append('phaseType', phaseType ?? '');
    if (subtractionValue != null) formData.append('subtractionValue', String(subtractionValue));
    if (startingNumber != null) formData.append('startingNumber', String(startingNumber));
    if (duration != null) formData.append('duration', String(duration));
    if (startedAt) formData.append('startedAt', startedAt);
    if (endedAt) formData.append('endedAt', endedAt);
    if (expectedResponseDigits != null) formData.append('expectedResponseDigits', String(expectedResponseDigits));
    if (scoringMode) formData.append('scoringMode', scoringMode);

    const response = await fetchImpl(buildApiUrl('/api/recordings'), { method: 'POST', body: formData });
    if (!response.ok) {
        throw new Error(`Recording upload failed with status ${response.status}`);
    }
    return response.json();
}

function extensionForMime(mimeType) {
    if (!mimeType) {
        return 'webm';
    }
    if (mimeType.includes('mp4')) {
        return 'mp4';
    }
    if (mimeType.includes('ogg')) {
        return 'ogg';
    }
    return 'webm';
}
