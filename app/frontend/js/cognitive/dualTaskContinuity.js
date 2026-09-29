// Implements the research protocol's counting-sequence continuity rule for
// dual-task (count-back-and-clicking) phases:
//
//   There is exactly ONE random starting number per subtraction series
//   (3/7/17), shared by that series' count-back-only and
//   count-back-and-clicking phases (see
//   experiment/experimentController.js#_getOrCreateStartingNumber - the
//   OTHER half of this rule, already enforced there). The dual-task
//   phase's COUNTING SEQUENCE does NOT restart from that shared number -
//   it continues from wherever the participant's actual last valid
//   count-only response left off.
//
// WHY THIS LIVES HERE, APPLIED AT READ TIME, RATHER THAN CHANGING WHAT
// GETS SCORED/STORED WHEN A RECORDING IS FIRST PROCESSED:
// app/backend/services/speechProcessingService.js scores each phase's
// recording independently, the moment THAT phase's own audio finishes
// uploading - this is deliberately asynchronous and NEVER gates phase
// advancement (see experimentController.js's own "phase advancement is
// never delayed by recording upload/transcription/scoring" guarantee,
// which this must not compromise). Because of that, DUAL_TASK_<n>'s own
// recording can finish processing before SUBTRACTION_<n>'s does (a real
// race, not a theoretical one, against a live transcription API) - there
// is no reliable moment during the live experiment where "the count-only
// phase's last valid count" is guaranteed to already be known. So this
// module is applied at READ time instead - Admin Session Review, the
// participant-facing Excel export, and an explicit admin reprocess - by
// which point the whole session (and therefore both phases' transcription)
// has virtually always already settled. It re-runs the exact same,
// unmodified scoring engine (scoreResponses/mapToResearchRecords in
// speechScoring.js) against the dual-task phase's own already-transcribed
// raw responses, just anchored to the correct continuation point instead
// of the phase's own stored starting_number. Nothing is written back to
// the database by this module - see its call sites for why that's not a
// duplicate source of truth (there is exactly one place this
// computation happens; the raw stored responses are just reinterpreted
// through it, the same way mapToResearchRecords already reinterprets
// scoreResponses()'s raw output without being "a second source of truth"
// for it).
//
// Deliberately pure and framework-agnostic (no DOM, no database access) -
// the same reason speechScoring.js/numberParser.js are - so this exact
// function is reusable unmodified from both the browser (results screen /
// Excel export) and the backend (Admin Session Review), the latter via a
// dynamic import() of this same frontend source file, exactly like
// speechProcessingService.js already does for speechScoring.js/
// numberParser.js.

// countOnlyResponses: ordered array of the PAIRED count-only phase's own
// responses, in the one canonical PRE-SCORING shape this whole module
// standardizes on - { rawTranscript, parsedNumber, resolved } (exactly
// scoreResponses()'s own input contract, and exactly what
// cognitive/numberParser.js's segments / scoreResponses()'s own output
// already carry unchanged - see toCanonicalResponses() below for why every
// caller can reach this shape with a one-line map). Returns the
// participant's last actually RESOLVED spoken number, or
// `fallbackStartingNumber` (the series' own shared starting number) if the
// count-only phase produced no valid response at all, or hasn't been
// transcribed/scored yet. Falling back to the shared starting number
// reproduces exactly the scoring this codebase already had before this
// continuity feature existed, rather than leaving the dual-task phase
// unscoreable.
export function resolveContinuationAnchor(countOnlyResponses, fallbackStartingNumber) {
    if (Array.isArray(countOnlyResponses)) {
        for (let i = countOnlyResponses.length - 1; i >= 0; i -= 1) {
            const response = countOnlyResponses[i];
            if (response && response.resolved && response.parsedNumber != null) {
                return response.parsedNumber;
            }
        }
    }
    return fallbackStartingNumber;
}

// Adapts a responseRepository DB row (snake_case: raw_transcript_segment,
// actual_number, correctness) into this module's canonical pre-scoring
// shape. Exact and lossless: 'unresolved' is the only correctness value
// scoreResponses() itself ever derives from resolved:false, so
// correctness !== 'unresolved' round-trips back to resolved:true exactly.
// The browser call sites need no such adapter - a phase's
// cognitivePerformance.responses are already scoreResponses() output,
// which - being `{ ...rawResponse, expectedNumber, correctness }` - already
// carries rawTranscript/parsedNumber/resolved forward unchanged (see
// speechScoring.js#scoreResponses) and can be passed straight through.
export function fromResponseRow(row) {
    return {
        rawTranscript: row.raw_transcript_segment,
        parsedNumber: row.actual_number,
        resolved: row.correctness !== 'unresolved'
    };
}

// Maps a dual-task phaseId to the count-only phaseId it's paired with
// within the same series - e.g. "DUAL_TASK_3" -> "SUBTRACTION_3". Returns
// null for any phaseId that isn't a dual-task phase (nothing to pair, and
// nothing for callers to treat specially).
export function countOnlyPhaseIdFor(phaseId) {
    const match = /^DUAL_TASK_(\d+)$/.exec(phaseId || '');
    return match ? `SUBTRACTION_${match[1]}` : null;
}

// Whether a phaseId is the count-back-and-clicking half of a series (the
// half this continuity rule actually changes anything for - count-only
// phases, REST, motor baseline, etc. are always scored/displayed against
// their own plain starting number, unaffected).
export function isDualTaskPhaseId(phaseId) {
    return countOnlyPhaseIdFor(phaseId) != null;
}

// The one function every call site (adminQueryService.js, the participant
// Excel export) actually uses. Re-scores a dual-task phase's OWN
// already-transcribed responses against the correct continuation anchor,
// running them back through the exact same, unmodified scoring engine
// (scoreResponses/mapToResearchRecords, imported from speechScoring.js -
// see that file's own header for why it's shared this way) - just anchored
// to resolveContinuationAnchor()'s result instead of the phase's own stored
// starting_number. Never touches the database - purely a read-time
// recomputation.
//
// dualTaskResponses / countOnlyResponses: each phase's own responses in
// this module's canonical pre-scoring shape (see resolveContinuationAnchor
// above / fromResponseRow) - the backend adapts its DB rows via
// fromResponseRow first; the browser can pass cognitivePerformance.responses
// straight through.
//
// Returns { continuationAnchor, scored, mapped }: continuationAnchor is the
// resolved anchor number itself (for callers displaying e.g. "Dual-task
// continued from: 756"); scored is scoreResponses()'s own output shape
// (rawTranscript/parsedNumber/resolved/expectedNumber/correctness - what the
// browser's cognitivePerformance.responses already looks like, for the
// Excel export path); mapped is mapToResearchRecords()'s section-9 shape
// (responseIndex/expectedNumber/actualNumber/correctness/
// referenceNumberAfterResponse/nextExpectedNumber/rawTranscriptSegment -
// what the DB/admin dashboard already looks like, for the Admin Session
// Review path).
export async function continueDualTaskScoring({
    dualTaskResponses,
    countOnlyResponses,
    startingNumber,
    subtractionValue,
    mode
}) {
    const { scoreResponses, mapToResearchRecords } = await import('./speechScoring.js');

    const continuationAnchor = resolveContinuationAnchor(countOnlyResponses, startingNumber);

    const scored = scoreResponses(dualTaskResponses || [], { startingNumber: continuationAnchor, subtractionValue, mode });
    const mapped = mapToResearchRecords(scored, { startingNumber: continuationAnchor, subtractionValue, mode });

    return { continuationAnchor, scored, mapped };
}
