import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIntakeWizardState, TOTAL_INTAKE_STEPS } from '../../app/frontend/js/ui/intakeWizardState.js';

test('starts on step 1, with only step 1 reached', () => {
    const wizard = createIntakeWizardState();
    assert.equal(wizard.getCurrentStep(), 1);
    assert.equal(wizard.getMaxStepReached(), 1);
});

test('next() advances one step at a time and tracks the furthest step reached', () => {
    const wizard = createIntakeWizardState();
    wizard.next();
    assert.equal(wizard.getCurrentStep(), 2);
    assert.equal(wizard.getMaxStepReached(), 2);

    wizard.next();
    assert.equal(wizard.getCurrentStep(), 3);
    assert.equal(wizard.getMaxStepReached(), 3);
});

test('next() never advances past the last step', () => {
    const wizard = createIntakeWizardState();
    wizard.next();
    wizard.next();
    wizard.next(); // already at step 3 (the last of TOTAL_INTAKE_STEPS)
    assert.equal(wizard.getCurrentStep(), TOTAL_INTAKE_STEPS);
});

test('back() steps backward but never past step 1, and does not lower maxStepReached', () => {
    const wizard = createIntakeWizardState();
    wizard.next();
    wizard.next();
    wizard.back();
    assert.equal(wizard.getCurrentStep(), 2);
    assert.equal(wizard.getMaxStepReached(), 3, 'going back does not un-complete a later step');

    wizard.back();
    wizard.back(); // already at step 1
    assert.equal(wizard.getCurrentStep(), 1);
});

test('canNavigateTo() is only true for steps already reached, never a step ahead', () => {
    const wizard = createIntakeWizardState();
    assert.equal(wizard.canNavigateTo(1), true);
    assert.equal(wizard.canNavigateTo(2), false, 'step 2 has not been reached yet');
    assert.equal(wizard.canNavigateTo(3), false);

    wizard.next(); // now on step 2, maxStepReached = 2
    assert.equal(wizard.canNavigateTo(1), true);
    assert.equal(wizard.canNavigateTo(2), true);
    assert.equal(wizard.canNavigateTo(3), false, 'step 3 still has not been reached');
});

test('goTo() jumps directly to any already-reached step (the step-rail "go back" behavior)', () => {
    const wizard = createIntakeWizardState();
    wizard.next();
    wizard.next(); // reached step 3; currently on step 3

    wizard.goTo(1);
    assert.equal(wizard.getCurrentStep(), 1);
    assert.equal(wizard.getMaxStepReached(), 3, 'jumping back does not lose progress');
});

test('goTo() silently refuses to jump ahead to a step never reached', () => {
    const wizard = createIntakeWizardState();
    const result = wizard.goTo(3);
    assert.equal(result, 1, 'stays on step 1 - step 3 was never reached');
    assert.equal(wizard.getCurrentStep(), 1);
});

test('goTo() refuses an out-of-range or non-integer step', () => {
    const wizard = createIntakeWizardState();
    assert.equal(wizard.goTo(0), 1);
    assert.equal(wizard.goTo(99), 1);
    assert.equal(wizard.goTo(1.5), 1);
});

test('totalSteps is configurable, defaulting to TOTAL_INTAKE_STEPS', () => {
    const wizard = createIntakeWizardState({ totalSteps: 2 });
    wizard.next();
    wizard.next(); // would be step 3 with the default, but only 2 steps configured here
    assert.equal(wizard.getCurrentStep(), 2);
});
