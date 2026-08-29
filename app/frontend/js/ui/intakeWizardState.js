// Pure step-sequencing state for the session-intake wizard (1 Overview ->
// 2 Protocol -> 3 Details). Deliberately has no DOM in it at all - see
// ui/intakeScreen.js, the only thing that touches the actual screen
// elements. Mirrors experiment/phaseStateMachine.js's own separation of
// "what step are we on" from "how is that rendered."

export const TOTAL_INTAKE_STEPS = 3;

export function createIntakeWizardState({ totalSteps = TOTAL_INTAKE_STEPS } = {}) {
    let currentStep = 1;
    let maxStepReached = 1; // how far the participant has actually gotten via next()

    function isValidStep(step) {
        return Number.isInteger(step) && step >= 1 && step <= totalSteps;
    }

    // The step rail may only ever jump back to a step the participant has
    // already been past - never forward to one they haven't seen yet.
    function canNavigateTo(step) {
        return isValidStep(step) && step <= maxStepReached;
    }

    function goTo(step) {
        if (!canNavigateTo(step)) {
            return currentStep;
        }
        currentStep = step;
        return currentStep;
    }

    function next() {
        if (currentStep >= totalSteps) {
            return currentStep;
        }
        currentStep += 1;
        maxStepReached = Math.max(maxStepReached, currentStep);
        return currentStep;
    }

    function back() {
        if (currentStep <= 1) {
            return currentStep;
        }
        currentStep -= 1;
        return currentStep;
    }

    return {
        getCurrentStep: () => currentStep,
        getMaxStepReached: () => maxStepReached,
        canNavigateTo,
        goTo,
        next,
        back
    };
}
