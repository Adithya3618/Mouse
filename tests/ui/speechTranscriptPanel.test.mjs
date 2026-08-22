import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatFinalSegmentsForDisplay } from '../../app/frontend/js/ui/speechTranscriptPanel.js';

// Only the pure, DOM-free formatting logic is tested here -
// initSpeechTranscriptPanel() itself manipulates document.* directly and
// has no fake-DOM test harness in this project (no jsdom dependency);
// this function was specifically extracted/exported so the presentation
// rule (commas for display only) can still be verified without one.

test('joins multiple number segments with ", " for display', () => {
    assert.equal(formatFinalSegmentsForDisplay(['960', '967', '964', '961']), '960, 967, 964, 961');
});

test('a single segment has no trailing/leading comma', () => {
    assert.equal(formatFinalSegmentsForDisplay(['960']), '960');
});

test('an empty list of segments formats to an empty string', () => {
    assert.equal(formatFinalSegmentsForDisplay([]), '');
});

test('filters out empty/falsy segments without leaving stray commas', () => {
    assert.equal(formatFinalSegmentsForDisplay(['960', '', '957']), '960, 957');
});

test('the exact requested display format: [960, 957, 954, 951] -> "960, 957, 954, 951"', () => {
    assert.equal(formatFinalSegmentsForDisplay(['960', '957', '954', '951']), '960, 957, 954, 951');
});

test('does not mutate the input array', () => {
    const segments = ['960', '957'];
    formatFinalSegmentsForDisplay(segments);
    assert.deepEqual(segments, ['960', '957']);
});
