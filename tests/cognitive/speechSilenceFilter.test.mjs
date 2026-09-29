import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    isNonSpeechSegment,
    dedupeStructurallyIdenticalSegments,
    buildSpeechOnlyTranscript,
    SILENCE_DETECTION_DEFAULTS
} from '../../app/frontend/js/cognitive/speechSilenceFilter.js';

// A verbose_json segment shaped exactly like OpenAI/Whisper's own reference
// output (the fields ufNaviGatorProvider.js's response_format:'verbose_json'
// request asks UF's hosted Whisper Large v3 for) - see
// speechSilenceFilter.js's own header for why each field matters.
function segment({
    text,
    start = 0,
    end = 1,
    no_speech_prob = 0.05,
    avg_logprob = -0.2,
    compression_ratio = 1.0
}) {
    return { text, start, end, no_speech_prob, avg_logprob, compression_ratio };
}

test('a confident, genuine speech segment is never flagged as non-speech', () => {
    const s = segment({ text: ' 822', no_speech_prob: 0.02, avg_logprob: -0.15, compression_ratio: 1.1 });
    assert.equal(isNonSpeechSegment(s), false);
});

test('a segment with high no_speech_prob (genuine silence) is flagged, regardless of what text it contains', () => {
    const s = segment({ text: ' 759', no_speech_prob: 0.95, avg_logprob: -0.2, compression_ratio: 1.0 });
    assert.equal(isNonSpeechSegment(s), true);
});

test('a hallucinated repeating loop (low confidence + highly repetitive text) is flagged even with low no_speech_prob', () => {
    // Mirrors the exact bug report: "759, 759, 759, 759, 759..." - Whisper
    // is confident SOMETHING was said (low no_speech_prob is possible even
    // during hallucination), but the text is extremely repetitive and the
    // model's own confidence in it is low.
    const s = segment({
        text: ' 759, 759, 759, 759, 759, 759, 759, 759, 759, 759.',
        no_speech_prob: 0.3,
        avg_logprob: -1.4,
        compression_ratio: 3.1
    });
    assert.equal(isNonSpeechSegment(s), true);
});

test('high repetition ALONE (without low confidence) is not enough to flag a segment - both signals must agree', () => {
    // A participant legitimately saying the same number twice in a row is
    // not inherently "hallucinated" - compression_ratio alone must never
    // be the sole trigger (see speechScoring.js's own adaptive rule, which
    // depends on repeats being preserved when they are genuine).
    const s = segment({ text: ' 822 822', no_speech_prob: 0.05, avg_logprob: -0.1, compression_ratio: 2.6 });
    assert.equal(isNonSpeechSegment(s), false);
});

test('a missing/malformed segment is treated as non-speech (fail safe, never fabricate a response from nothing)', () => {
    assert.equal(isNonSpeechSegment(null), true);
    assert.equal(isNonSpeechSegment(undefined), true);
});

test('SILENCE_DETECTION_DEFAULTS match OpenAI Whisper\'s own documented reference thresholds', () => {
    assert.equal(SILENCE_DETECTION_DEFAULTS.noSpeechProbThreshold, 0.6);
    assert.equal(SILENCE_DETECTION_DEFAULTS.compressionRatioThreshold, 2.4);
    assert.equal(SILENCE_DETECTION_DEFAULTS.avgLogprobThreshold, -1.0);
});

test('dedupeStructurallyIdenticalSegments collapses an exact duplicate (same start/end/text) but leaves two genuinely separate utterances of the same number alone', () => {
    const exactDuplicate = [
        segment({ text: ' 822', start: 1.0, end: 1.5 }),
        segment({ text: ' 822', start: 1.0, end: 1.5 }) // identical time range - a provider artifact
    ];
    assert.equal(dedupeStructurallyIdenticalSegments(exactDuplicate).length, 1);

    const genuinelyTwice = [
        segment({ text: ' 822', start: 1.0, end: 1.5 }),
        segment({ text: ' 822', start: 8.0, end: 8.5 }) // same number, different time - a real repeat
    ];
    assert.equal(dedupeStructurallyIdenticalSegments(genuinelyTwice).length, 2);
});

// --- buildSpeechOnlyTranscript: the actual integration point speechProcessingService.js uses ---

test('no segment data at all (e.g. the stub transcription provider) falls back to the raw text completely unchanged', () => {
    assert.equal(buildSpeechOnlyTranscript('822 819 816', null), '822 819 816');
    assert.equal(buildSpeechOnlyTranscript('822 819 816', {}), '822 819 816');
    assert.equal(buildSpeechOnlyTranscript('822 819 816', { text: '822 819 816' }), '822 819 816');
});

test('test case 1: participant speaks "822" - a single confident segment is kept as-is', () => {
    const metadata = { segments: [segment({ text: ' 822' })] };
    assert.equal(buildSpeechOnlyTranscript('822', metadata), '822');
});

test('test case 2: participant is silent - a single high-no_speech_prob segment produces empty speech-only text (no response record)', () => {
    const metadata = { segments: [segment({ text: ' 759', no_speech_prob: 0.9 })] };
    assert.equal(buildSpeechOnlyTranscript('759', metadata), '');
});

test('test case 3: "822" then silence, silence - only 822 survives, no repeated-822 hallucination segments are kept', () => {
    const metadata = {
        segments: [
            segment({ text: ' 822', start: 0, end: 1, no_speech_prob: 0.02, avg_logprob: -0.1, compression_ratio: 1.0 }),
            segment({ text: ' 822, 822, 822, 822.', start: 1, end: 6, no_speech_prob: 0.4, avg_logprob: -1.6, compression_ratio: 2.9 }),
            segment({ text: ' 822, 822, 822.', start: 6, end: 10, no_speech_prob: 0.85, avg_logprob: -0.3, compression_ratio: 2.8 })
        ]
    };
    assert.equal(buildSpeechOnlyTranscript('822 822, 822, 822, 822. 822, 822, 822.', metadata), '822');
});

test('test case 4: "822", silence, then "819" - only the two genuine responses survive', () => {
    const metadata = {
        segments: [
            segment({ text: ' 822', start: 0, end: 1 }),
            segment({ text: ' 819, 819, 819.', start: 1, end: 5, no_speech_prob: 0.5, avg_logprob: -1.3, compression_ratio: 2.7 }), // hallucinated silence
            segment({ text: ' 819', start: 5, end: 6 }) // the participant's real, later "819"
        ]
    };
    assert.equal(buildSpeechOnlyTranscript('822 819, 819, 819. 819', metadata), '822 819');
});

test('test case 5: transcription service returns an empty result - no response', () => {
    assert.equal(buildSpeechOnlyTranscript('', { segments: [] }), '');
    assert.equal(buildSpeechOnlyTranscript('', null), '');
});

test('test case 7: the same number legitimately spoken twice (two separate, confident, differently-timed utterances) is preserved', () => {
    const metadata = {
        segments: [
            segment({ text: ' 822', start: 0, end: 1 }),
            segment({ text: ' 822', start: 12, end: 13 }) // spoken again later, genuinely, e.g. after a mistake
        ]
    };
    assert.equal(buildSpeechOnlyTranscript('822 822', metadata), '822 822');
});

test('test case 8: a structurally duplicated segment (same time range reported twice by the provider) does not create a duplicate response', () => {
    const metadata = {
        segments: [
            segment({ text: ' 822', start: 1.0, end: 1.5 }),
            segment({ text: ' 822', start: 1.0, end: 1.5 }) // exact duplicate record, not a second utterance
        ]
    };
    assert.equal(buildSpeechOnlyTranscript('822 822', metadata), '822');
});
