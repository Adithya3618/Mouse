import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    parseSpokenNumber,
    parseNumbersFromTranscript,
    parseDigitSequence,
    extractDigitTokens,
    collapseStutteredDigits,
    looksLikeNumberFragment
} from '../../app/frontend/js/cognitive/numberParser.js';

test('parseSpokenNumber parses a clean digit string', () => {
    const result = parseSpokenNumber('947');
    assert.equal(result.value, 947);
    assert.equal(result.resolved, true);
    assert.equal(result.raw, '947');
});

test('parseSpokenNumber parses spoken number words', () => {
    assert.deepEqual(parseSpokenNumber('nine hundred forty four'), { raw: 'nine hundred forty four', value: 944, resolved: true });
    assert.deepEqual(parseSpokenNumber('eight hundred seventeen'), { raw: 'eight hundred seventeen', value: 817, resolved: true });
    assert.equal(parseSpokenNumber('eight hundred and seventeen').value, 817, '"and" is treated as filler');
});

test('parseSpokenNumber marks unrelated/unresolved speech as unresolved without guessing', () => {
    const result = parseSpokenNumber('um I think maybe');
    assert.equal(result.value, null);
    assert.equal(result.resolved, false);
    assert.equal(result.raw, 'um I think maybe', 'raw text is preserved even when unresolved');
});

test('parseSpokenNumber marks empty/whitespace input as unresolved', () => {
    assert.deepEqual(parseSpokenNumber(''), { raw: '', value: null, resolved: false });
    assert.deepEqual(parseSpokenNumber('   '), { raw: '', value: null, resolved: false });
});

test('parseSpokenNumber does not guess at a bare ones-word fragment with no "hundred" anchor', () => {
    const result = parseSpokenNumber('four');
    assert.equal(result.resolved, false);
    assert.equal(result.value, null);
});

test('parseNumbersFromTranscript splits a comma-separated run of digit numbers', () => {
    const results = parseNumbersFromTranscript('944, 941, 938, 935');
    assert.deepEqual(results.map((r) => r.value), [944, 941, 938, 935]);
    assert.ok(results.every((r) => r.resolved));
});

test('parseNumbersFromTranscript splits consecutive word-form numbers', () => {
    const results = parseNumbersFromTranscript('nine hundred forty four nine hundred forty one');
    assert.deepEqual(results.map((r) => r.value), [944, 941]);
});

test('parseNumbersFromTranscript preserves the raw transcript as unresolved when nothing number-like is found', () => {
    const results = parseNumbersFromTranscript('I lost count sorry');
    assert.equal(results.length, 1);
    assert.equal(results[0].resolved, false);
    assert.equal(results[0].value, null);
    assert.equal(results[0].raw, 'I lost count sorry');
});

test('parseNumbersFromTranscript returns an empty array for empty transcripts', () => {
    assert.deepEqual(parseNumbersFromTranscript(''), []);
    assert.deepEqual(parseNumbersFromTranscript(null), []);
});

// --- Robustness pass (researcher request, 2026): reliably segmenting a
// spoken sequence of numbers, including continuous word-form speech with
// no pause-driven punctuation. See the module-level comment on
// NUMBER_SEGMENT_PATTERN above for the specific bug this fixes. ---

test('"960" parses to 960', () => {
    assert.deepEqual(parseNumbersFromTranscript('960').map((r) => r.value), [960]);
});

test('"nine hundred sixty" parses to 960', () => {
    assert.deepEqual(parseNumbersFromTranscript('nine hundred sixty').map((r) => r.value), [960]);
});

test('"nine hundred and sixty" parses to 960', () => {
    assert.deepEqual(parseNumbersFromTranscript('nine hundred and sixty').map((r) => r.value), [960]);
});

test('"960 957 954" (space-separated digits) parses to [960, 957, 954]', () => {
    assert.deepEqual(parseNumbersFromTranscript('960 957 954').map((r) => r.value), [960, 957, 954]);
});

test('"960, 957, 954" (comma-separated digits) parses to [960, 957, 954]', () => {
    assert.deepEqual(parseNumbersFromTranscript('960, 957, 954').map((r) => r.value), [960, 957, 954]);
});

test('BUG FIX: three consecutive word-form numbers with no separating punctuation are segmented correctly, not merged/lost', () => {
    // Before the fix, the greedy tens+ones lookahead swallowed the
    // leading "nine" of the second number into the first ("sixty nine" =
    // 69), producing [969, 954] and silently dropping 957 entirely.
    const results = parseNumbersFromTranscript('nine hundred sixty nine hundred fifty seven nine hundred fifty four');
    assert.deepEqual(results.map((r) => r.value), [960, 957, 954]);
    assert.equal(results.every((r) => r.resolved), true);
});

test('a mix of digit-form and word-form numbers in the same transcript segments correctly', () => {
    const results = parseNumbersFromTranscript('960 nine hundred fifty seven 954');
    assert.deepEqual(results.map((r) => r.value), [960, 957, 954]);
});

test('regression: a legitimate compound tens+ones number is still parsed as ONE number, not split at the word boundary', () => {
    // "sixty four" here has nothing ambiguous following "four" - the fix
    // must not affect this case.
    assert.deepEqual(parseNumbersFromTranscript('nine hundred sixty four').map((r) => r.value), [964]);
});

test('regression: a standalone number ending in a tens+ones compound is still parsed whole when nothing follows it', () => {
    assert.deepEqual(parseNumbersFromTranscript('nine hundred sixty nine').map((r) => r.value), [969]);
});

test('normalization: trailing "." or "," on an otherwise-clean digit string still resolves to the same numeric value, without altering the raw text', () => {
    assert.deepEqual(parseSpokenNumber('960.'), { raw: '960.', value: 960, resolved: true });
    assert.deepEqual(parseSpokenNumber('960,'), { raw: '960,', value: 960, resolved: true });
});

// --- Digit-by-digit speech (upgrade, 2026): a participant reading a
// multi-digit target out one digit at a time ("eight four eight" for
// 848), including stuttering, filler words, pauses, and imperfect
// browser transcription. See numberParser.js' DIGIT-BY-DIGIT SPEECH
// section for the full pipeline this exercises:
//   extractDigitTokens (normalize + filler/pause handling)
//   -> collapseStutteredDigits (stutter/repetition handling)
//   -> parseDigitSequence (three-digit validation, orchestration)
//   -> parseNumbersFromTranscript (wired into the existing pipeline)
// ---

// extractDigitTokens: normalization stage in isolation.

test('extractDigitTokens converts digit words to digits', () => {
    assert.deepEqual(extractDigitTokens('eight four eight'), { digits: [8, 4, 8], ok: true });
});

test('extractDigitTokens converts digit characters (space- or hyphen-separated) to digits', () => {
    assert.deepEqual(extractDigitTokens('8 4 8'), { digits: [8, 4, 8], ok: true });
    assert.deepEqual(extractDigitTokens('8-4-8'), { digits: [8, 4, 8], ok: true });
});

test('extractDigitTokens applies only the targeted speech-recognition substitutions ("for"->four, "ate"->eight, "to"/"too"->two, "won"->one)', () => {
    assert.deepEqual(extractDigitTokens('for ate to won'), { digits: [4, 8, 2, 1], ok: true });
    assert.deepEqual(extractDigitTokens('eight too four'), { digits: [8, 2, 4], ok: true });
});

test('extractDigitTokens skips filler words (um, uh, hmm, er, ah) as pauses, not digits', () => {
    assert.deepEqual(extractDigitTokens('eight um uh hmm er ah four eight'), { digits: [8, 4, 8], ok: true });
});

test('extractDigitTokens does not silently guess at an unrecognized, non-filler word - marks the whole extraction unresolved', () => {
    assert.deepEqual(extractDigitTokens('eight four maybe eight'), { digits: [], ok: false });
});

// collapseStutteredDigits: stutter-collapse stage in isolation.

test('collapseStutteredDigits collapses consecutive repeated digits to one instance each', () => {
    assert.deepEqual(collapseStutteredDigits([8, 8, 8, 4, 4, 4, 8]), [8, 4, 8]);
});

test('collapseStutteredDigits does not collapse a digit that reappears after a different digit', () => {
    assert.deepEqual(collapseStutteredDigits([8, 8, 4]), [8, 4]); // consecutive-only; length disambiguation lives in parseDigitSequence
    assert.deepEqual(collapseStutteredDigits([8, 4, 8]), [8, 4, 8]);
});

// parseDigitSequence: full pipeline, including the length-based
// stutter-vs-genuine-repeat disambiguation and the 3-digit minimum.

test('"eight four eight" parses to 848', () => {
    assert.equal(parseDigitSequence('eight four eight').value, 848);
    assert.equal(parseDigitSequence('eight four eight').resolved, true);
});

test('"8 4 8" parses to 848', () => {
    assert.equal(parseDigitSequence('8 4 8').value, 848);
});

test('stutter: "8-8-8-4-4-4-8" collapses to 848', () => {
    assert.equal(parseDigitSequence('8-8-8-4-4-4-8').value, 848);
    assert.equal(parseDigitSequence('8-8-8-4-4-4-8').collapsedForStutter, true);
});

test('stutter: "eight eight eight four four four eight" collapses to 848', () => {
    assert.equal(parseDigitSequence('eight eight eight four four four eight').value, 848);
});

test('stutter with pauses: "eight... eight... four... four... eight" collapses to 848', () => {
    assert.equal(parseDigitSequence('eight... eight... four... four... eight').value, 848);
});

test('fillers: "eight um um um four eight" resolves to 848', () => {
    assert.equal(parseDigitSequence('eight um um um four eight').value, 848);
});

test('fillers with pauses: "eight... um... four... eight" resolves to 848', () => {
    assert.equal(parseDigitSequence('eight... um... four... eight').value, 848);
});

test('single filler: "eight uh four eight" resolves to 848', () => {
    assert.equal(parseDigitSequence('eight uh four eight').value, 848);
});

test('digit/filler mix: "8 um um 4 8" resolves to 848', () => {
    assert.equal(parseDigitSequence('8 um um 4 8').value, 848);
});

test('long pauses do not discard digits spoken before and after the pause', () => {
    const result = parseDigitSequence('eight um um um um um um four eight');
    assert.equal(result.value, 848);
    assert.equal(result.resolved, true);
});

test('fewer than 3 digits is incomplete, not submitted, but the partial value is still exposed for live display', () => {
    assert.deepEqual(parseDigitSequence('eight four'), {
        raw: 'eight four',
        digits: [8, 4],
        value: 84,
        resolved: false,
        complete: false,
        rawDigitCount: 2,
        collapsedForStutter: false
    });
    assert.equal(parseDigitSequence('eight').resolved, false);
    assert.equal(parseDigitSequence('eight').complete, false);
});

test('critical: genuine repeated digits within a 3-digit answer are NOT collapsed away - "eight eight four" is 884, not 84', () => {
    const result = parseDigitSequence('eight eight four');
    assert.equal(result.value, 884);
    assert.equal(result.resolved, true);
    assert.equal(result.collapsedForStutter, false);
});

test('critical: "eight four four" is 844, not 84', () => {
    const result = parseDigitSequence('eight four four');
    assert.equal(result.value, 844);
    assert.equal(result.resolved, true);
    assert.equal(result.collapsedForStutter, false);
});

test('incremental recognition: a growing transcript resolves progressively, only completing at 3+ digits', () => {
    assert.equal(parseDigitSequence('eight').value, 8);
    assert.equal(parseDigitSequence('eight').resolved, false);

    assert.equal(parseDigitSequence('eight um').value, 8);
    assert.equal(parseDigitSequence('eight um').resolved, false);

    assert.equal(parseDigitSequence('eight um four').value, 84);
    assert.equal(parseDigitSequence('eight um four').resolved, false);

    assert.equal(parseDigitSequence('eight um four eight').value, 848);
    assert.equal(parseDigitSequence('eight um four eight').resolved, true);
});

test('empty/unintelligible input never guesses a digit sequence', () => {
    assert.deepEqual(parseDigitSequence(''), { raw: '', digits: [], value: null, resolved: false, complete: false });
    assert.deepEqual(parseDigitSequence('I lost count sorry'), { raw: 'I lost count sorry', digits: [], value: null, resolved: false, complete: false });
});

// looksLikeNumberFragment: extended to recognize digit-by-digit fragment
// vocabulary (fillers, bare digit characters, homophones) so a
// still-in-progress digit-by-digit response is buffered rather than
// prematurely treated as a finished, unresolved response.

test('looksLikeNumberFragment recognizes a partial digit-by-digit response interrupted by a filler', () => {
    assert.equal(looksLikeNumberFragment('eight um'), true);
    assert.equal(looksLikeNumberFragment('8 4'), true);
});

test('looksLikeNumberFragment still rejects genuinely unrelated speech', () => {
    assert.equal(looksLikeNumberFragment('uh I lost it'), false);
});

// parseNumbersFromTranscript: the new digit-by-digit path wired into the
// existing entry point used by cognitive/cognitiveSpeechSession.js -
// exercises the exact edge cases from the upgrade spec end to end.

test('parseNumbersFromTranscript: "eight four eight" resolves to a single 848 response', () => {
    const results = parseNumbersFromTranscript('eight four eight');
    assert.equal(results.length, 1);
    assert.equal(results[0].value, 848);
    assert.equal(results[0].resolved, true);
});

test('parseNumbersFromTranscript: "8 4 8" (space-separated single digits) resolves to one 848 response, not three separate 1-digit responses', () => {
    const results = parseNumbersFromTranscript('8 4 8');
    assert.equal(results.length, 1);
    assert.equal(results[0].value, 848);
});

test('parseNumbersFromTranscript: stuttered digit run "8-8-8-4-4-4-8" resolves to 848', () => {
    const results = parseNumbersFromTranscript('8-8-8-4-4-4-8');
    assert.equal(results.length, 1);
    assert.equal(results[0].value, 848);
});

test('parseNumbersFromTranscript: "8 um um 4 8" resolves to 848', () => {
    assert.equal(parseNumbersFromTranscript('8 um um 4 8')[0].value, 848);
});

test('parseNumbersFromTranscript: "eight uh four eight" resolves to 848', () => {
    assert.equal(parseNumbersFromTranscript('eight uh four eight')[0].value, 848);
});

test('parseNumbersFromTranscript: "eight... four... eight" resolves to 848', () => {
    assert.equal(parseNumbersFromTranscript('eight... four... eight')[0].value, 848);
});

test('parseNumbersFromTranscript: "eight four" (only 2 digits) is incomplete/unresolved, not submitted - but its partial value (84) is preserved, mirroring how a short digit run like "98" is handled elsewhere in this pipeline', () => {
    const results = parseNumbersFromTranscript('eight four');
    assert.equal(results.length, 1);
    assert.equal(results[0].resolved, false);
    assert.equal(results[0].value, 84);
});

test('parseNumbersFromTranscript: "eight" alone is incomplete/unresolved', () => {
    assert.equal(parseNumbersFromTranscript('eight')[0].resolved, false);
});

test('parseNumbersFromTranscript: "eight eight four" resolves to 884, never forced down to 84', () => {
    const results = parseNumbersFromTranscript('eight eight four');
    assert.equal(results.length, 1);
    assert.equal(results[0].value, 884);
});

test('parseNumbersFromTranscript: "eight four four" resolves to 844, never forced down to 84', () => {
    assert.equal(parseNumbersFromTranscript('eight four four')[0].value, 844);
});

test('parseNumbersFromTranscript: an expectedDigits override changes the minimum/target length used for both validation and stutter disambiguation', () => {
    const results = parseNumbersFromTranscript('eight four', { expectedDigits: 2 });
    assert.equal(results[0].value, 84);
    assert.equal(results[0].resolved, true);
});

test('parseNumbersFromTranscript: legitimate multi-digit numbers ("960 957 954") are unaffected by the digit-by-digit fallback', () => {
    assert.deepEqual(parseNumbersFromTranscript('960 957 954').map((r) => r.value), [960, 957, 954]);
});

test('parseNumbersFromTranscript: genuinely unrelated speech remains unresolved, never guessed as a digit sequence', () => {
    const results = parseNumbersFromTranscript('I lost count sorry');
    assert.equal(results.length, 1);
    assert.equal(results[0].resolved, false);
    assert.equal(results[0].raw, 'I lost count sorry');
});

// ADJACENT SHORT-DIGIT-RUN MERGING + IMPLICIT-HUNDREDS WORD FORM (2026
// update for the full-phase-recording architecture - see numberParser.js's
// module comments on mergeShortDigitRunsAndParse and
// parseSpokenNumber's implicit-hundred branch for the full rationale).

test('parseNumbersFromTranscript reconstructs a 3-digit number from two adjacent short digit runs ("8 49" -> 849)', () => {
    assert.deepEqual(parseNumbersFromTranscript('8 49').map((r) => r.value), [849]);
});

test('parseNumbersFromTranscript treats a hyphen the same as a space between adjacent short digit runs ("8-49" -> 849)', () => {
    assert.deepEqual(parseNumbersFromTranscript('8-49').map((r) => r.value), [849]);
});

test('parseNumbersFromTranscript reconstructs "86 5" -> 865 and "8 65" -> 865', () => {
    assert.deepEqual(parseNumbersFromTranscript('86 5').map((r) => r.value), [865]);
    assert.deepEqual(parseNumbersFromTranscript('8 65').map((r) => r.value), [865]);
});

test('parseNumbersFromTranscript tolerates a paused ellipsis between short digit runs ("8 ... 47" -> 847, "86 ... 5" -> 865)', () => {
    assert.deepEqual(parseNumbersFromTranscript('8 ... 47').map((r) => r.value), [847]);
    assert.deepEqual(parseNumbersFromTranscript('86 ... 5').map((r) => r.value), [865]);
});

test('parseNumbersFromTranscript never merges two digit runs that are already complete on their own ("960 957 954" untouched)', () => {
    assert.deepEqual(parseNumbersFromTranscript('960 957 954').map((r) => r.value), [960, 957, 954]);
});

test('parseNumbersFromTranscript never overshoots expectedDigits when merging ("8 4 8" stays digit-by-digit, not concatenated past 3 digits)', () => {
    // Already-covered digit-by-digit path (all-single-digit matches) - a
    // regression guard that the new merge logic does not interfere with it.
    assert.deepEqual(parseNumbersFromTranscript('8 4 8').map((r) => r.value), [848]);
});

test('parseSpokenNumber resolves the "hundred"-less word form ("eight forty nine" -> 849, "eight nineteen" -> 819)', () => {
    assert.deepEqual(parseSpokenNumber('eight forty nine'), { raw: 'eight forty nine', value: 849, resolved: true });
    assert.deepEqual(parseSpokenNumber('eight nineteen'), { raw: 'eight nineteen', value: 819, resolved: true });
});

test('parseNumbersFromTranscript resolves "eight hundred forty nine" via the hundred-anchored branch, not the implicit-hundred one', () => {
    assert.deepEqual(parseNumbersFromTranscript('eight hundred forty nine').map((r) => r.value), [849]);
});

test('parseNumbersFromTranscript tolerates a pause/ellipsis inside the "hundred"-less word form ("uh eight ... forty nine" -> 849)', () => {
    const results = parseNumbersFromTranscript('uh eight ... forty nine');
    assert.deepEqual(results.map((r) => r.value), [849]);
});

test('parseNumbersFromTranscript segments two consecutive "hundred"-less word-form numbers correctly ("eight forty nine eight forty six" -> [849, 846])', () => {
    assert.deepEqual(parseNumbersFromTranscript('eight forty nine eight forty six').map((r) => r.value), [849, 846]);
});

test('parseSpokenNumber never resolves a lone ones-word through the implicit-hundred branch (still requires a real tail)', () => {
    const result = parseSpokenNumber('four');
    assert.equal(result.resolved, false);
    assert.equal(result.value, null);
});

test('parseNumbersFromTranscript never fabricates a number from unrelated speech containing an incidental digit-word substring ("hey darling")', () => {
    const results = parseNumbersFromTranscript('hey darling');
    assert.equal(results.length, 1);
    assert.equal(results[0].resolved, false);
    assert.equal(results[0].value, null);
    assert.equal(results[0].raw, 'hey darling');
});
