// Converts recognized speech text into integers, for the serial-subtraction
// tasks (participants speaking numbers like "944" or "nine hundred forty
// four" aloud, OR digit-by-digit as "nine four four" / "9 4 4" - see the
// DIGIT-BY-DIGIT SPEECH section below). Deliberately isolated from
// speechRecognition.js (which knows nothing about numbers) and from
// speechScoring.js (which knows nothing about parsing text) - this
// module's only job is text -> {value, resolved}.
//
// Speech recognition will not always return clean numeric strings (mumbled
// words, unrelated speech picked up by the mic, mid-word cutoffs, stuttered
// or filler-interrupted digit-by-digit responses). When a segment can't be
// confidently converted to a number, this preserves the raw text and marks
// it unresolved rather than guessing - callers (see speechScoring.js) must
// treat unresolved responses as their own outcome, never silently as "0" or
// "incorrect".

const ONES_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const TEENS_WORDS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS_WORDS = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

const ONES_VALUES = Object.fromEntries(ONES_WORDS.map((word, i) => [word, i]));
const TEENS_VALUES = Object.fromEntries(TEENS_WORDS.map((word, i) => [word, i + 10]));
const TENS_VALUES = Object.fromEntries(TENS_WORDS.map((word, i) => [word, (i + 2) * 10]));

// DIGIT-BY-DIGIT SPEECH - a second, independent way a number can be
// spoken/recognized in this protocol, alongside the "<ones> hundred ..."
// phrase and clean digit-run forms already handled above: reading a
// multi-digit number out one digit at a time ("eight four eight" for
// 848). See parseDigitSequence() below - deliberately kept as its own
// small pipeline (normalize -> extract digits -> collapse stutter ->
// validate length) rather than folded into parseSpokenNumber()'s
// "<ones> hundred" grammar, since the two forms have essentially nothing
// in common once you get past both starting from ONES_VALUES.

// Speech-recognition engines frequently mis-hear a spoken digit as a
// short, similar-sounding real word. This list is intentionally narrow
// and closed (only the substitutions explicitly expected) rather than a
// general typo-correction step, so it can never mangle an unrelated word
// into a false digit - see the module-level "never guess silently" rule
// applied throughout this file.
const DIGIT_WORD_SUBSTITUTIONS = {
    for: 'four',
    ate: 'eight',
    to: 'two',
    too: 'two',
    won: 'one'
};

// Hesitation sounds a recognizer sometimes captures during a pause -
// never digits themselves. Treating them as silently-skipped tokens
// (rather than "unrecognized word, abort") is what lets the digits
// spoken immediately before and after a pause still combine into one
// sequence - see extractDigitTokens() below.
const FILLER_WORDS = new Set(['um', 'uh', 'hmm', 'er', 'ah']);

// The shortest sequence this protocol will ever treat as a complete
// digit-by-digit response (see cognitive/cognitiveSpeechSession.js'
// expectedResponseDigits, which callers typically pass through as
// targetDigits/minDigits below instead of relying on this default).
const MIN_VALID_DIGIT_SEQUENCE_LENGTH = 3;

// Matches either a run of digits ("947") or a "<ones> hundred [<teens>|<tens>[-<ones>]]"
// phrase ("nine hundred forty four", "eight hundred seventeen"). This is
// intentionally scoped to the 3-digit range the current protocol's random
// starting numbers live in (see config/experimentConfig.js
// randomStartingNumberRange) - a reasonable, documented starting point that
// can be broadened later (see module comment above) without touching
// speechScoring.js or speechRecognition.js.
//
// The trailing (?![\s-]+hundred) after the optional ones-word suffix is a
// segmentation fix: when a participant counts backward continuously with
// no pause-driven punctuation ("nine hundred sixty nine hundred fifty
// seven"), a bare greedy match would read "sixty nine" as one compound
// number (69), swallowing the NEXT number's leading "nine" into the
// current match and losing the boundary between them entirely. A ones-word
// immediately followed by "hundred" is unambiguously the start of the
// next spoken number, not a compound suffix of this one - a single
// response never contains "hundred" twice - so it must never be
// consumed here. This does not affect any legitimate single number
// (e.g. "nine hundred sixty four" still matches whole, since "four" here
// is not followed by "hundred").
const NUMBER_SEGMENT_PATTERN = new RegExp(
    '(\\d+)' +
    '|' +
    `(?:${ONES_WORDS.join('|')})\\s+hundred(?:\\s+(?:and\\s+)?(?:${TEENS_WORDS.join('|')}|(?:${TENS_WORDS.join('|')})(?:[\\s-]+(?:${ONES_WORDS.join('|')})(?![\\s-]+hundred))?))?`,
    'gi'
);

function normalizeWords(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/[\s-]+/)
        .filter(Boolean);
}

// Parses ONE number expression (already isolated from surrounding text) -
// either a literal digit string or a "<ones> hundred ..." word phrase.
// Returns { raw, value, resolved }. value is null and resolved is false
// when the text cannot be confidently converted.
export function parseSpokenNumber(text) {
    const raw = (text ?? '').trim();
    if (!raw) {
        return { raw, value: null, resolved: false };
    }

    // Normalizes harmless trailing punctuation ("960." / "960,") before
    // the digit check below - normalization only, for a value equal to
    // "960" either way. `raw` itself (returned in every branch) is always
    // the original, unstripped text - never altered. In practice
    // parseNumbersFromTranscript() below already extracts segments
    // without trailing punctuation, so this mainly guards a direct call
    // to this function with less-clean input.
    const digitCandidate = raw.replace(/[.,]+$/, '');
    if (/^\d+$/.test(digitCandidate)) {
        return { raw, value: Number.parseInt(digitCandidate, 10), resolved: true };
    }

    const words = normalizeWords(raw);
    if (words.length === 0) {
        return { raw, value: null, resolved: false };
    }

    let total = 0;
    let sawHundred = false;
    let recognizedAnyWord = false;

    for (const word of words) {
        if (word === 'and') {
            continue;
        }
        if (word === 'hundred') {
            // "hundred" with nothing accumulated yet (e.g. stray "hundred")
            // is not a confident number on its own.
            if (total === 0 && !recognizedAnyWord) {
                return { raw, value: null, resolved: false };
            }
            total *= 100;
            sawHundred = true;
            recognizedAnyWord = true;
        } else if (word in TEENS_VALUES) {
            total += TEENS_VALUES[word];
            recognizedAnyWord = true;
        } else if (word in TENS_VALUES) {
            total += TENS_VALUES[word];
            recognizedAnyWord = true;
        } else if (word in ONES_VALUES) {
            total += ONES_VALUES[word];
            recognizedAnyWord = true;
        } else {
            // An unrecognized word anywhere in the segment means we cannot
            // be confident about the resulting number - preserve the raw
            // text and mark unresolved rather than partially guessing.
            return { raw, value: null, resolved: false };
        }
    }

    if (!recognizedAnyWord) {
        return { raw, value: null, resolved: false };
    }

    // A single ones-word transcript ("four") with no "hundred" is too
    // ambiguous in this 3-digit protocol to confidently resolve on its own -
    // it's far more likely to be a fragment of a larger number the
    // recognizer cut off than a genuine 1-digit answer. Only accept it once
    // "hundred" has anchored the magnitude.
    if (!sawHundred) {
        return { raw, value: null, resolved: false };
    }

    return { raw, value: total, resolved: true };
}

// Extracts every number-like segment from a full (possibly multi-number)
// transcript, e.g. "944, 941, 938" or "nine hundred forty four nine
// hundred forty one". Returns an array of { raw, value, resolved }, one per
// segment found. If nothing number-like is found at all, returns a single
// unresolved entry preserving the whole raw transcript, per the
// "never guess silently" rule above.
// Returns true if `text` consists ENTIRELY of recognized number-vocabulary
// (digits, or ones/teens/tens/"hundred"/"and" words), even when it does
// NOT resolve into a complete number on its own - e.g. "nine" (missing
// its "hundred" anchor) or "hundred sixty" (missing its leading ones-word).
// Used by cognitive/cognitiveSpeechSession.js to distinguish a genuine
// speech-recognition FRAGMENT of a number - worth buffering briefly in
// case the rest of it arrives in the next recognition event - from
// unrelated/unintelligible speech, which must never be held pending a
// merge attempt. Reuses this file's own word lists; no vocabulary is
// duplicated anywhere else.
export function looksLikeNumberFragment(text) {
    const raw = (text ?? '').trim();
    if (!raw) {
        return false;
    }
    if (/^\d+$/.test(raw.replace(/[.,]+$/, ''))) {
        return true;
    }
    const words = normalizeWords(raw);
    if (words.length === 0) {
        return false;
    }
    // Also accepts filler words, bare digit characters, and known digit
    // homophones (see DIGIT_WORD_SUBSTITUTIONS/FILLER_WORDS above) as
    // fragment vocabulary - a still-in-progress digit-by-digit response
    // like "eight um" or "8 4" is just as much a genuine fragment worth
    // buffering (see cognitive/cognitiveSpeechSession.js) as "nine" is
    // for the "<ones> hundred ..." form already handled below.
    return words.every((word) =>
        word === 'and' ||
        word === 'hundred' ||
        FILLER_WORDS.has(word) ||
        /^\d+$/.test(word) ||
        word in ONES_VALUES ||
        word in TEENS_VALUES ||
        word in TENS_VALUES ||
        DIGIT_WORD_SUBSTITUTIONS[word] in ONES_VALUES
    );
}

// STAGE 1/3 of the digit-by-digit pipeline (see module comment above):
// normalizes `text` into a flat array of single digits (0-9), treating
// filler words as silently-skipped pauses rather than content. Returns
// `ok: false` the instant a word is seen that is neither a filler nor a
// recognizable digit - same "never guess silently" rule as the rest of
// this file: a transcript containing real, unrelated words (not just
// digits and pauses) is not confidently a digit sequence at all.
export function extractDigitTokens(text) {
    const words = normalizeWords(text ?? '');
    const digits = [];

    for (const word of words) {
        if (FILLER_WORDS.has(word)) {
            continue;
        }
        if (/^\d+$/.test(word)) {
            for (const ch of word) {
                digits.push(Number(ch));
            }
            continue;
        }
        const substituted = DIGIT_WORD_SUBSTITUTIONS[word] || word;
        if (substituted in ONES_VALUES) {
            digits.push(ONES_VALUES[substituted]);
            continue;
        }
        return { digits: [], ok: false };
    }

    return { digits, ok: true };
}

// STAGE 2 of the digit-by-digit pipeline: collapses a digit repeated
// several times IN A ROW into one instance - the stutter case ("8-8-8-
// 4-4-4-8" for an intended 848, see docs section 2). Keyed off
// consecutive repeats only, so a digit that legitimately reappears later
// after a different digit (the two 8s in "884") is never touched by this
// function on its own - see parseDigitSequence() below for the length
// check that decides whether this should even be called.
export function collapseStutteredDigits(digits) {
    const collapsed = [];
    for (const digit of digits) {
        if (collapsed.length === 0 || collapsed[collapsed.length - 1] !== digit) {
            collapsed.push(digit);
        }
    }
    return collapsed;
}

// STAGE 4 (validation) + orchestration of the digit-by-digit pipeline.
// Recovers the intended digit sequence from a transcript that may
// contain digit words, digit characters, filler words, and
// stutter-repeated digits - e.g. "eight um um eight eight four four
// four eight" -> 848.
//
// STUTTER vs. GENUINE REPEAT: collapseStutteredDigits() is only ever
// applied when the raw digit count already EXCEEDS targetDigits. Without
// that guard, a short, legitimately repeated-digit answer like "eight
// eight four" (884) would be wrongly collapsed down to "eight four"
// (84) - there is nothing about "eight eight" in isolation that marks it
// as a stutter; only having MORE digits than the response should ever
// contain does. This is the same signal already documented as
// deliberately NOT forcing a result to match a known target (see
// cognitive/cognitiveSpeechSession.js' expectedResponseDigits) - here it
// is used purely to decide whether repeats look accidental, never to
// rewrite the transcript to equal a specific target number.
//
// `minDigits` is the hard floor from docs section 4 ("Minimum Number
// Length") - fewer digits than this and the result is `resolved: false`
// / `complete: false` so the caller knows to keep listening rather than
// submit. `value`/`digits` are still populated even when incomplete
// (docs section 7's incremental example: "eight um four" -> 84 while
// still incomplete) - callers that must never act on an unresolved value
// (see speechScoring.js) already gate on `resolved`, not on whether
// `value` is null.
export function parseDigitSequence(text, { minDigits = MIN_VALID_DIGIT_SEQUENCE_LENGTH, targetDigits = minDigits } = {}) {
    const raw = (text ?? '').trim();
    if (!raw) {
        return { raw, digits: [], value: null, resolved: false, complete: false };
    }

    const { digits: rawDigits, ok } = extractDigitTokens(raw);
    if (!ok || rawDigits.length === 0) {
        return { raw, digits: [], value: null, resolved: false, complete: false };
    }

    const digits = rawDigits.length > targetDigits ? collapseStutteredDigits(rawDigits) : rawDigits;
    const complete = digits.length >= minDigits;

    return {
        raw,
        digits,
        value: Number(digits.join('')),
        resolved: complete,
        complete,
        rawDigitCount: rawDigits.length,
        collapsedForStutter: digits.length !== rawDigits.length
    };
}

// `expectedDigits` is threaded through as parseDigitSequence()'s
// minDigits/targetDigits - defaults to this protocol's standard 3-digit
// response (MIN_VALID_DIGIT_SEQUENCE_LENGTH); cognitive/
// cognitiveSpeechSession.js passes its own configured
// expectedResponseDigits instead, so a study that changes that value
// gets consistent behavior here too.
export function parseNumbersFromTranscript(transcript, { expectedDigits = MIN_VALID_DIGIT_SEQUENCE_LENGTH } = {}) {
    const text = (transcript ?? '').trim();
    if (!text) {
        return [];
    }

    const matches = [...text.matchAll(NUMBER_SEGMENT_PATTERN)].map((m) => m[0]);

    // DIGIT-BY-DIGIT SPEECH, digit-CHARACTER form: NUMBER_SEGMENT_PATTERN
    // has no concept of "these separate \d+ matches are pieces of one
    // number" - each spoken digit ("8", "4", "8") matches on its own. A
    // run of genuinely separate multi-digit numbers ("960 957 954") is
    // never affected here, since none of those matches are single
    // characters; this only fires when EVERY match in the transcript is
    // exactly one digit AND there is more than one of them - the digit
    // form of the same ambiguity parseDigitSequence() resolves for the
    // word form below.
    if (matches.length > 1 && matches.every((match) => /^\d$/.test(match))) {
        return [parseDigitSequence(text, { minDigits: expectedDigits, targetDigits: expectedDigits })];
    }

    if (matches.length === 0) {
        // No digit run and no "<ones> hundred ..." phrase anywhere in
        // the text. Two possibilities: genuinely unrelated speech, or a
        // multi-digit number spoken digit-by-digit using number WORDS
        // rather than digit characters ("eight four eight") - the latter
        // never matches NUMBER_SEGMENT_PATTERN at all, since word-form
        // numbers there require a "hundred" anchor. parseDigitSequence()
        // independently re-confirms every word is recognizable
        // digit/filler vocabulary before returning anything - genuinely
        // unrelated speech ("I lost count sorry") comes back exactly as
        // { raw: text, value: null, resolved: false }, identical to the
        // previous behavior here. A recognized-but-still-short digit
        // sequence ("eight four") comes back with resolved: false (not
        // yet a complete answer - see docs section 4) but its partial
        // value (84) intentionally preserved rather than nulled out,
        // mirroring how a short digit RUN like "98" is already handled:
        // cognitive/cognitiveSpeechSession.js's own completeness check
        // decides whether/when to commit it, never this function.
        return [parseDigitSequence(text, { minDigits: expectedDigits, targetDigits: expectedDigits })];
    }

    return matches.map((segment) => parseSpokenNumber(segment));
}
