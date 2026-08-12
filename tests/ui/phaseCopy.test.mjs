import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPhaseDisplay } from '../../app/frontend/js/ui/phaseCopy.js';

test('returns null for no current phase', () => {
    assert.equal(getPhaseDisplay(null, null), null);
});

test('motor baseline: no starting number, timer shown, no internal phase id in copy', () => {
    const display = getPhaseDisplay({ phaseType: 'motor', subtractionValue: null }, null);
    assert.equal(display.title, 'Mouse-Clicking Task');
    assert.equal(display.showStartingNumber, false);
    assert.equal(display.showTimer, true);
    assert.ok(!display.title.includes('MOTOR_BASELINE'));
    assert.ok(!display.instruction.includes('MOTOR_BASELINE'));
});

test('cognitive (subtraction-only): shows subtraction value and starting number from the phase record', () => {
    const display = getPhaseDisplay(
        { phaseType: 'cognitive', subtractionValue: 7 },
        { startingNumber: 892 }
    );
    assert.equal(display.title, 'Count Backward by 7');
    assert.ok(display.instruction.includes('892'));
    assert.ok(display.instruction.includes('by 7'));
    assert.equal(display.showStartingNumber, true);
    assert.equal(display.startingNumber, 892);
});

test('cognitive: falls back to an em dash when no phase record is available yet', () => {
    const display = getPhaseDisplay({ phaseType: 'cognitive', subtractionValue: 3 }, null);
    assert.ok(display.instruction.includes('—'));
});

test('dual-task: mentions both counting and clicking, shows the same starting number', () => {
    const display = getPhaseDisplay(
        { phaseType: 'dual-task', subtractionValue: 17 },
        { startingNumber: 931 }
    );
    assert.match(display.title, /17/);
    assert.match(display.title, /Click/i);
    assert.ok(display.instruction.toLowerCase().includes('count'));
    assert.ok(display.instruction.toLowerCase().includes('click'));
    assert.equal(display.startingNumber, 931);
});

test('transition: no timer badge (uses its own big countdown), no starting number block', () => {
    const display = getPhaseDisplay({ phaseType: 'transition', subtractionValue: 3 }, null);
    assert.equal(display.showTimer, false);
    assert.equal(display.showStartingNumber, false);
    assert.ok(display.instruction.toLowerCase().includes('click'));
});

test('recovery: tells the participant to stop, no starting number', () => {
    const display = getPhaseDisplay({ phaseType: 'recovery', subtractionValue: null }, null);
    assert.equal(display.title, 'Recovery Period');
    assert.ok(display.instruction.toLowerCase().includes('stop'));
    assert.equal(display.showStartingNumber, false);
    assert.equal(display.showTimer, true);
});

test('no phase copy ever contains a raw phase id', () => {
    const cases = [
        getPhaseDisplay({ phaseType: 'motor', subtractionValue: null }, null),
        getPhaseDisplay({ phaseType: 'cognitive', subtractionValue: 3 }, { startingNumber: 900 }),
        getPhaseDisplay({ phaseType: 'dual-task', subtractionValue: 7 }, { startingNumber: 800 }),
        getPhaseDisplay({ phaseType: 'transition', subtractionValue: 17 }, null),
        getPhaseDisplay({ phaseType: 'recovery', subtractionValue: null }, null)
    ];
    const rawIdPattern = /(SUBTRACTION_|DUAL_TASK_|TRANSITION_|RECOVERY_|MOTOR_BASELINE)/;
    for (const display of cases) {
        assert.ok(!rawIdPattern.test(display.title), `title leaked a phase id: ${display.title}`);
        assert.ok(!rawIdPattern.test(display.instruction), `instruction leaked a phase id: ${display.instruction}`);
    }
});

// --- Preparation ("get ready / 3 / 2 / 1 / BEGIN") screens: the ONE
// reusable getPreparationDisplay() helper, exercised across all three
// precedesPhaseType variants (motor, cognitive, dual-task). ---

test('preparation before motor baseline: no starting number, no timer badge, shows the countdown', () => {
    const display = getPhaseDisplay(
        { phaseType: 'preparation', subtractionValue: null, precedesPhaseType: 'motor' },
        null
    );
    assert.equal(display.title, 'Mouse-Clicking Task');
    assert.ok(display.instruction.toLowerCase().includes('get ready'));
    assert.equal(display.showTimer, false);
    assert.equal(display.showStartingNumber, false);
    assert.equal(display.showPrepCountdown, true);
    assert.equal(display.startingNumber, null);
});

test('preparation before subtraction-only: shows the subtraction rule and starting number, no timer badge', () => {
    const display = getPhaseDisplay(
        { phaseType: 'preparation', subtractionValue: 3, precedesPhaseType: 'cognitive' },
        { startingNumber: 947 }
    );
    assert.equal(display.title, 'Count Backward by 3');
    assert.ok(display.instruction.includes('947'));
    assert.ok(display.instruction.toLowerCase().includes('get ready'));
    assert.ok(display.instruction.toLowerCase().includes('counting aloud by 3'));
    assert.equal(display.showTimer, false);
    assert.equal(display.showStartingNumber, true);
    assert.equal(display.showPrepCountdown, true);
    assert.equal(display.startingNumber, 947);
});

test('preparation before subtraction-only: falls back to an em dash when no phase record is available yet', () => {
    const display = getPhaseDisplay(
        { phaseType: 'preparation', subtractionValue: 3, precedesPhaseType: 'cognitive' },
        null
    );
    assert.ok(display.instruction.includes('—'));
});

test('preparation before dual-task: mentions both counting and clicking, shows starting number, no timer badge', () => {
    const display = getPhaseDisplay(
        { phaseType: 'preparation', subtractionValue: 17, precedesPhaseType: 'dual-task' },
        { startingNumber: 812 }
    );
    assert.match(display.title, /17/);
    assert.match(display.title, /Click/i);
    assert.ok(display.instruction.toLowerCase().includes('count'));
    assert.ok(display.instruction.toLowerCase().includes('click'));
    assert.ok(display.instruction.toLowerCase().includes('get ready'));
    assert.equal(display.showTimer, false);
    assert.equal(display.showStartingNumber, true);
    assert.equal(display.showPrepCountdown, true);
    assert.equal(display.startingNumber, 812);
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
        assert.ok(!rawIdPattern.test(display.instruction), `instruction leaked a phase id: ${display.instruction}`);
    }
});

test('every other phaseType explicitly reports showPrepCountdown: false', () => {
    const cases = [
        getPhaseDisplay({ phaseType: 'motor', subtractionValue: null }, null),
        getPhaseDisplay({ phaseType: 'cognitive', subtractionValue: 3 }, null),
        getPhaseDisplay({ phaseType: 'dual-task', subtractionValue: 7 }, null),
        getPhaseDisplay({ phaseType: 'transition', subtractionValue: 17 }, null),
        getPhaseDisplay({ phaseType: 'recovery', subtractionValue: null }, null),
        getPhaseDisplay({ phaseType: 'nonsense-unknown-type', subtractionValue: null }, null)
    ];
    for (const display of cases) {
        assert.equal(display.showPrepCountdown, false);
    }
});
