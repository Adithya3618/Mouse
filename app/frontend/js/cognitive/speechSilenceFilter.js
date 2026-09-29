// Prevents silence (no participant speech at all) from being scored as a
// spoken response - see the bug report this fixes: the transcription
// service (UF NaviGator's Whisper Large v3 - see
// backend/transcription/ufNaviGatorProvider.js) can hallucinate a REPEATED
// PREVIOUS NUMBER during a period of genuine silence ("759, 759, 759, 759,
// 759..."), a well-documented Whisper failure mode during non-speech audio
// (background noise/silence gets mis-transcribed as looping, repetitive
// text). Without this, that hallucinated text flows straight into
// numberParser.js exactly like real speech, producing fabricated
// "responses" the participant never actually said.
//
// WHY THIS ISN'T "FILTER REPEATED NUMBERS" (explicitly ruled out - a
// participant legitimately repeating a number after a mistake, or two
// separate genuine utterances that happen to share a value, must be
// preserved unchanged - see cognitive/speechScoring.js's adaptive scoring,
// which already depends on exactly this). This instead filters at the
// SEGMENT level, using signals Whisper itself already emits about whether
// a segment actually contains speech at all - never by comparing a
// segment's recognized value to any other segment's:
//
//   no_speech_prob    - Whisper's own per-segment confidence that NO
//                        speech is present in that segment's audio at all
//                        (0-1). A silent/background-noise segment scores
//                        high here regardless of what text ends up in it.
//   avg_logprob       - Whisper's own per-segment confidence in the text
//                        it produced (more negative = less confident).
//   compression_ratio - how repetitive/compressible the segment's own text
//                        is (gzip-style ratio). A hallucinated loop
//                        ("759, 759, 759...") compresses extremely well;
//                        a genuine, varied spoken sequence does not.
//
// SILENCE_DETECTION_DEFAULTS below are not invented - they are OpenAI's
// own documented default thresholds for exactly this purpose in the
// reference Whisper implementation's own transcribe() function
// (no_speech_threshold=0.6, logprob_threshold=-1.0,
// compression_ratio_threshold=2.4), reused here since this is UF
// NaviGator's own hosted Whisper Large v3 and requests the same
// verbose_json segment data (see ufNaviGatorProvider.js).
//
// A segment must fail BOTH the confidence check (avg_logprob) AND the
// repetition check (compression_ratio) together to be dropped on that
// combination (matching Whisper's own logic) - a long but genuinely varied
// correct answer sequence, spoken confidently, fails neither.
//
// WHAT THIS DOES NOT DO: it never inspects or compares the numeric VALUE
// any segment resolves to - only Whisper's own per-segment audio-confidence
// metadata. numberParser.js/speechScoring.js are completely unchanged and
// know nothing about this filtering; this only decides what text is
// allowed to reach them in the first place. Deliberately pure and
// framework-agnostic (no DOM, no database access), reused unmodified from
// both the browser and the backend via the same dynamic import() pattern
// already used for numberParser.js/speechScoring.js - see
// speechProcessingService.js.
export const SILENCE_DETECTION_DEFAULTS = Object.freeze({
    noSpeechProbThreshold: 0.6,
    compressionRatioThreshold: 2.4,
    avgLogprobThreshold: -1.0
});

// True if this ONE segment's own audio-confidence metadata indicates it is
// silence/non-speech, or a hallucinated/looping artifact - never based on
// what number (if any) its text happens to contain.
export function isNonSpeechSegment(segment, thresholds = SILENCE_DETECTION_DEFAULTS) {
    if (!segment) {
        return true;
    }

    const noSpeechProb = typeof segment.no_speech_prob === 'number' ? segment.no_speech_prob : null;
    if (noSpeechProb != null && noSpeechProb >= thresholds.noSpeechProbThreshold) {
        return true;
    }

    const avgLogprob = typeof segment.avg_logprob === 'number' ? segment.avg_logprob : null;
    const compressionRatio = typeof segment.compression_ratio === 'number' ? segment.compression_ratio : null;
    if (avgLogprob != null && compressionRatio != null
        && avgLogprob <= thresholds.avgLogprobThreshold
        && compressionRatio >= thresholds.compressionRatioThreshold) {
        return true;
    }

    return false;
}

// Collapses consecutive segments that are STRUCTURALLY identical (same
// start, end, AND text) into one - a transcription-service artifact
// (the same audio time range reported twice), never two genuinely separate
// utterances. Two separate utterances of the same number always have
// different start/end times and are left completely untouched, preserving
// test case 7 (a legitimately repeated number).
export function dedupeStructurallyIdenticalSegments(segments) {
    const deduped = [];
    for (const segment of segments) {
        const previous = deduped[deduped.length - 1];
        const isExactDuplicate = previous
            && previous.start === segment.start
            && previous.end === segment.end
            && previous.text === segment.text;
        if (!isExactDuplicate) {
            deduped.push(segment);
        }
    }
    return deduped;
}

// Builds the text that numberParser.js should actually parse: `rawText`
// (transcription.raw_text) is NEVER modified anywhere - it stays exactly
// what the transcription service returned, preserved verbatim as the
// research record (see speechProcessingService.js). This instead derives a
// SEPARATE, speech-only string, used only to decide what becomes a scored
// response.
//
// `metadata` is transcription.metadata (the full deserialized verbose_json
// response - see repositories/transcriptionRepository.js). When it carries
// no `segments` array at all (the stub provider used throughout testing,
// or a real provider response that for any reason omits segment data),
// there is nothing to filter by - this returns `rawText` completely
// unchanged, exactly matching this module's own pre-existing behavior
// before this filter existed.
export function buildSpeechOnlyTranscript(rawText, metadata, thresholds = SILENCE_DETECTION_DEFAULTS) {
    const segments = metadata && Array.isArray(metadata.segments) ? metadata.segments : null;
    if (segments === null) {
        return rawText ?? '';
    }

    const deduped = dedupeStructurallyIdenticalSegments(segments);
    const speechSegments = deduped.filter((segment) => !isNonSpeechSegment(segment, thresholds));

    return speechSegments
        .map((segment) => (segment.text || '').trim())
        .filter(Boolean)
        .join(' ');
}
