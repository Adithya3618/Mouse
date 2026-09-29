import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPhaseDisplay, MOTOR_COUNTDOWN_SEQUENCE } from '../../app/frontend/js/ui/phaseCopy.js';

test('returns null for no current phase', () => {
    assert.equal(getPhaseDisplay(null, null), null);
});

test('MOTOR_COUNTDOWN_SEQUENCE counts all the way down to 0', () => {
    assert.deepEqual(MOTOR_COUNTDOWN_SEQUENCE, [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
});

test('clicking-only (motor): renamed title, no starting number, timer shown, no internal phase id in copy', () => {
    const display = getPhaseDisplay({ phaseType: 'motor', subtractionValue: null }, null);
    assert.equal(display.title, 'Clicking Only');
    assert.equal(display.showStartingNumber, false);
    assert.equal(display.showTimer, true);
    assert.ok(!display.title.includes('MOTOR_BASELINE'));
    assert.ok(!display.instruction.includes('MOTOR_BASELINE'));
});

test('cognitive (count-back-only): renamed title spells out the subtraction value as a word, one plain instruction line, starting number shown only via its own dedicated field (never restated in prose)', () => {
    const display = getPhaseDisplay(
        { phaseType: 'cognitive', subtractionValue: 7 },
        { startingNumber: 892 }
    );
    assert.equal(display.title, 'Count Backward by Multiples of Seven');
    assert.equal(display.instruction, '');
    assert.ok(!display.instruction.includes('892'), 'the starting number is shown in its own box, not restated in the instruction text');
    assert.equal(display.showStartingNumber, true);
    assert.equal(display.startingNumber, 892);
});

test('cognitive: the instruction line never depends on whether a phase record is available yet (the starting number box handles that fallback on its own)', () => {
    const display = getPhaseDisplay({ phaseType: 'cognitive', subtractionValue: 3 }, null);
    assert.equal(display.instruction, '');
    assert.equal(display.startingNumber, null);
});

test('cognitive title/instruction spell out all three configured subtraction values correctly (3/7/17 -> three/seven/seventeen)', () => {
    const cases = [[3, 'Three'], [7, 'Seven'], [17, 'Seventeen']];
    for (const [value, word] of cases) {
        const display = getPhaseDisplay({ phaseType: 'cognitive', subtractionValue: value }, null);
        assert.equal(display.title, `Count Backward by Multiples of ${word}`);
        assert.equal(display.instruction, '');
    }
});

test('dual-task: renamed title mentions "and Clicking", instruction mentions both counting and clicking, shows the same starting number', () => {
    const display = getPhaseDisplay(
        { phaseType: 'dual-task', subtractionValue: 17 },
        { startingNumber: 931 }
    );
    assert.match(display.title, /17/);
    assert.match(display.title, /and Clicking/);
    assert.ok(display.instruction.toLowerCase().includes('count'));
    assert.ok(display.instruction.toLowerCase().includes('click'));
    assert.equal(display.startingNumber, 931);
});

test('recovery (REST): title is plain "REST", no starting number, timer shown', () => {
    const display = getPhaseDisplay({ phaseType: 'recovery', subtractionValue: null, phaseId: 'RECOVERY_AFTER_MOTOR' }, null);
    assert.equal(display.title, 'REST');
    assert.equal(display.showStartingNumber, false);
    assert.equal(display.showTimer, true);
});

test('REST after clicking-only (RECOVERY_AFTER_MOTOR) gets the long combined explanation - no "Next Task" eyebrow', () => {
    const display = getPhaseDisplay({ phaseType: 'recovery', subtractionValue: null, phaseId: 'RECOVERY_AFTER_MOTOR' }, null);
    assert.equal(display.eyebrow, null);
    assert.ok(Array.isArray(display.paragraphs));
    assert.ok(display.paragraphs.length >= 3, 'combined REST explanation should have several paragraphs');
    const joined = display.paragraphs.join(' ').toLowerCase();
    assert.ok(joined.includes('3'));
    assert.ok(joined.includes('7'));
    assert.ok(joined.includes('17'));
});

test('REST before series 2 (RECOVERY_AFTER_DUAL_3) is short, with a "Next Task" eyebrow naming 7', () => {
    const display = getPhaseDisplay({ phaseType: 'recovery', subtractionValue: null, phaseId: 'RECOVERY_AFTER_DUAL_3' }, null);
    assert.equal(display.eyebrow, 'Next Task');
    assert.ok(display.paragraphs.join(' ').includes('7'));
    assert.equal(display.paragraphs.length, 2);
});

test('REST before series 3 (RECOVERY_AFTER_DUAL_7) is short, with a "Next Task" eyebrow naming 17', () => {
    const display = getPhaseDisplay({ phaseType: 'recovery', subtractionValue: null, phaseId: 'RECOVERY_AFTER_DUAL_7' }, null);
    assert.equal(display.eyebrow, 'Next Task');
    assert.ok(display.paragraphs.join(' ').includes('17'));
    assert.equal(display.paragraphs.length, 2);
});

// Cognitive's own "multiples of <word>" consistency across all three
// values is covered by the dedicated test above - dual-task keeps the
// digit form (unaffected by that change).
test('dual-task wording is consistent across all three subtraction values ("multiples of <digit>")', () => {
    for (const value of [3, 7, 17]) {
        const dual = getPhaseDisplay({ phaseType: 'dual-task', subtractionValue: value }, { startingNumber: 900 });
        assert.ok(dual.title.includes(`Multiples of ${value}`));
        assert.ok(dual.instruction.includes(`multiples of ${value}`));
        assert.ok(dual.instruction.toLowerCase().includes('click'));
    }
});

test('no phase copy ever contains a raw phase id', () => {
    const cases = [
        getPhaseDisplay({ phaseType: 'motor', subtractionValue: null }, null),
        getPhaseDisplay({ phaseType: 'cognitive', subtractionValue: 3 }, { startingNumber: 900 }),
        getPhaseDisplay({ phaseType: 'dual-task', subtractionValue: 7 }, { startingNumber: 800 }),
        getPhaseDisplay({ phaseType: 'recovery', subtractionValue: null, phaseId: 'RECOVERY_AFTER_MOTOR' }, null),
        getPhaseDisplay({ phaseType: 'recovery', subtractionValue: null, phaseId: 'RECOVERY_AFTER_DUAL_3' }, null)
    ];
    const rawIdPattern = /(SUBTRACTION_|DUAL_TASK_|TRANSITION_|RECOVERY_|MOTOR_BASELINE)/;
    for (const display of cases) {
        assert.ok(!rawIdPattern.test(display.title), `title leaked a phase id: ${display.title}`);
        assert.ok(!rawIdPattern.test(display.instruction), `instruction leaked a phase id: ${display.instruction}`);
    }
});

// --- Preparation lead-in screens: getPreparationDisplay(), exercised
// across all three precedesPhaseType variants (motor, cognitive,
// dual-task). Only 'motor' still uses the digit-countdown treatment
// (showPrepCountdown); 'cognitive'/'dual-task' instead get a
// transitionLines screen with a normal running timer - two lines for
// 'cognitive', one (plus a popping 3/2/1 - see
// ui/experimentScreen.js#updatePopCountdown, exercised in
// experimentScreen tests, not here) for 'dual-task'. ---

test('preparation before clicking-only: no starting number, no running timer, shows the digit countdown', () => {
    const display = getPhaseDisplay(
        { phaseType: 'preparation', subtractionValue: null, precedesPhaseType: 'motor' },
        null
    );
    assert.equal(display.title, 'Clicking Only');
    assert.equal(display.showTimer, false);
    assert.equal(display.showStartingNumber, false);
    assert.equal(display.showPrepCountdown, true);
    assert.equal(display.transitionLines, undefined);
    assert.equal(display.startingNumber, null);
});

test('preparation before count-back-only: digit countdown shown (like clicking-only), no running timer, starting number shown alongside it, no transition lines', () => {
    const display = getPhaseDisplay(
        { phaseType: 'preparation', subtractionValue: 3, precedesPhaseType: 'cognitive' },
        { startingNumber: 947 }
    );
    assert.equal(display.title, 'Count Backward by Multiples of Three');
    assert.equal(display.instruction, '');
    assert.equal(display.showTimer, false);
    assert.equal(display.showStartingNumber, true);
    assert.equal(display.startingNumber, 947);
    assert.equal(display.showPrepCountdown, true);
    assert.equal(display.transitionLines, undefined);
});

test('preparation before dual-task: one static transition line (keep counting), running timer shown, no starting number box, no digit countdown', () => {
    const display = getPhaseDisplay(
        { phaseType: 'preparation', subtractionValue: 17, precedesPhaseType: 'dual-task' },
        { startingNumber: 812 }
    );
    assert.match(display.title, /17/);
    assert.match(display.title, /and Clicking/);
    assert.equal(display.showTimer, true);
    // The starting number shows on the DUAL_TASK_<n> screen itself now,
    // not on this transition screen (see ui/experimentScreen.js).
    assert.equal(display.showStartingNumber, false);
    assert.equal(display.showPrepCountdown, false);
    // Just one line now - the old static "Dots will appear in 3… 2… 1…"
    // second line was replaced by an actual popping 3/2/1 (see
    // ui/experimentScreen.js#updatePopCountdown), not phaseCopy.js content.
    assert.equal(display.transitionLines.length, 1);
    assert.ok(display.transitionLines[0].toLowerCase().includes('counting backward by 17'));
});

test('preparation copy never contains a raw phase id', () => {
    const cases = [
        getPhaseDisplay({ phaseType: 'preparation', subtractionValue: null, precedesPhaseType: 'motor' }, null),
        getPhaseDisplay({ phaseType: 'preparation', subtractionValue: 3, precedesPhaseType: 'cognitive' }, { startingNumber: 900 }),
        getPhaseDisplay({ phaseType: 'preparation', subtractionValue: 7, precedesPhaseType: 'dual-task' }, { startingNumber: 800 })
    ];
    const rawIdPattern = /(SUBTRACTION_|DUAL_TASK_|PREPARE_|MOTOR_BASELINE)/;
    for (const display of cases) {
        assert.ok(!rawIdPattern.test(display.title), `title leaked a phase id: ${display.title}`);
        const lines = [display.instruction, ...(display.transitionLines || [])].join(' ');
        assert.ok(!rawIdPattern.test(lines), `copy leaked a phase id: ${lines}`);
    }
});

test('every other phaseType explicitly reports showPrepCountdown: false', () => {
    const cases = [
        getPhaseDisplay({ phaseType: 'motor', subtractionValue: null }, null),
        getPhaseDisplay({ phaseType: 'cognitive', subtractionValue: 3 }, null),
        getPhaseDisplay({ phaseType: 'dual-task', subtractionValue: 7 }, null),
        getPhaseDisplay({ phaseType: 'recovery', subtractionValue: null, phaseId: 'RECOVERY_AFTER_MOTOR' }, null),
        getPhaseDisplay({ phaseType: 'preparation', subtractionValue: 3, precedesPhaseType: 'dual-task' }, null),
        getPhaseDisplay({ phaseType: 'nonsense-unknown-type', subtractionValue: null }, null)
    ];
    for (const display of cases) {
        assert.equal(display.showPrepCountdown, false);
    }
});

test('preparation before clicking-only AND before count-back-only both report showPrepCountdown: true', () => {
    const motorPrep = getPhaseDisplay({ phaseType: 'preparation', subtractionValue: null, precedesPhaseType: 'motor' }, null);
    const cognitivePrep = getPhaseDisplay({ phaseType: 'preparation', subtractionValue: 3, precedesPhaseType: 'cognitive' }, null);
    assert.equal(motorPrep.showPrepCountdown, true);
    assert.equal(cognitivePrep.showPrepCountdown, true);
});
