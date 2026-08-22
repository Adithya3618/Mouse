// Compares a participant's parsed spoken numbers against the expected
// serial-subtraction sequence, and aggregates cognitive accuracy. Kept
// separate from numberParser.js (which only turns text into numbers) and
// from cognitiveSpeechSession.js (which owns the live recognition session) -
// this module is pure data in, data out, so the scoring rule itself can be
// reasoned about and tested in isolation.
//
// SCORING RULE - this was NOT previously defined anywhere in this codebase
// (cognitive/subtractionTask.js only tracks phase timing; it never
// validated answers). Two defensible research scoring methodologies exist
// and this module deliberately does not pick one silently:
//
//   STRICT   - every response is compared to the pure mathematical
//              sequence generated from the starting number
//              (startingNumber - rule, startingNumber - 2*rule, ...),
//              regardless of what the participant actually said. One early
//              slip makes every later, internally-consistent response
//              register as "incorrect".
//
//   ADAPTIVE - each response's expected value is the participant's own
//              previous SPOKEN number minus the rule. A single slip does
//              not cascade; correctness is judged per-step (did they
//              subtract correctly from what they just said), which is how
//              serial-subtraction tasks are commonly scored in the
//              cognitive-load literature.
//
// This was raised explicitly to the researcher, who selected ADAPTIVE as
// the default (see config/experimentConfig.js#cognitiveScoringMode). Both
// modes are implemented and the mode is a config value, not a hardcoded
// assumption, so it can be revisited without touching this module's logic.

export const ScoringMode = Object.freeze({
    ADAPTIVE: 'adaptive',
    STRICT: 'strict'
});

export const DEFAULT_SCORING_MODE = ScoringMode.ADAPTIVE;

// responses: ordered array of { timestamp, rawTranscript, parsedNumber, resolved }
// (see cognitive/cognitiveSpeechSession.js). Returns a new array of the same
// length, each entry augmented with { expectedNumber, correctness }, where
// correctness is one of 'correct' | 'incorrect' | 'unresolved'.
export function scoreResponses(responses, { startingNumber, subtractionValue, mode = DEFAULT_SCORING_MODE }) {
    if (mode !== ScoringMode.ADAPTIVE && mode !== ScoringMode.STRICT) {
        throw new Error(`Unknown cognitive scoring mode "${mode}" - expected "adaptive" or "strict".`);
    }

    let previousSpokenNumber = startingNumber; // adaptive mode's running chain
    let stepIndex = 0; // strict mode's fixed position in the pure sequence

    return responses.map((response) => {
        const expectedNumber = mode === ScoringMode.ADAPTIVE
            ? previousSpokenNumber - subtractionValue
            : startingNumber - subtractionValue * (stepIndex + 1);
        stepIndex += 1;

        if (!response.resolved || response.parsedNumber == null) {
            return { ...response, expectedNumber, correctness: 'unresolved' };
        }

        const correctness = response.parsedNumber === expectedNumber ? 'correct' : 'incorrect';

        if (mode === ScoringMode.ADAPTIVE) {
            // The chain continues from what the participant actually said,
            // whether or not it was correct - that is what makes this mode
            // "adaptive" rather than a repeat of the strict sequence.
            previousSpokenNumber = response.parsedNumber;
        }

        return { ...response, expectedNumber, correctness };
    });
}

// Unresolved responses are excluded from the accuracy denominator (they
// are neither a correct nor an incorrect arithmetic answer - the
// participant's intent simply couldn't be determined) but are still
// reported separately via unresolvedResponses/numberOfResponses, so no
// data is discarded, only excluded from this one percentage.
export function calculateCognitiveAccuracy(correctResponses, incorrectResponses) {
    const scored = correctResponses + incorrectResponses;
    if (scored === 0) {
        return 0;
    }
    return (correctResponses / scored) * 100;
}
