// Converts recognized speech text into integers, for the serial-subtraction
// tasks (participants speaking numbers like "944" or "nine hundred forty
// four" aloud). Deliberately isolated from speechRecognition.js (which
// knows nothing about numbers) and from speechScoring.js (which knows
// nothing about parsing text) - this module's only job is
// text -> {value, resolved}.
//
// Speech recognition will not always return clean numeric strings (mumbled
// words, unrelated speech picked up by the mic, mid-word cutoffs). When a
// segment can't be confidently converted to a number, this preserves the
// raw text and marks it unresolved rather than guessing - callers (see
// speechScoring.js) must treat unresolved responses as their own outcome,
// never silently as "0" or "incorrect".

const ONES_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const TEENS_WORDS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS_WORDS = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

const ONES_VALUES = Object.fromEntries(ONES_WORDS.map((word, i) => [word, i]));
const TEENS_VALUES = Object.fromEntries(TEENS_WORDS.map((word, i) => [word, i + 10]));
const TENS_VALUES = Object.fromEntries(TENS_WORDS.map((word, i) => [word, (i + 2) * 10]));

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
    return words.every((word) => word === 'and' || word === 'hundred' || word in ONES_VALUES || word in TEENS_VALUES || word in TENS_VALUES);
}

export function parseNumbersFromTranscript(transcript) {
    const text = (transcript ?? '').trim();
    if (!text) {
        return [];
    }

    const matches = [...text.matchAll(NUMBER_SEGMENT_PATTERN)].map((m) => m[0]);
    if (matches.length === 0) {
        return [{ raw: text, value: null, resolved: false }];
    }

    return matches.map((segment) => parseSpokenNumber(segment));
}
