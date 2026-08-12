import { initIntakeScreen } from './ui/intakeScreen.js';
import { initInstructionsScreen } from './ui/instructionsScreen.js';
import { initExperimentScreen } from './ui/experimentScreen.js';
import { initResultsScreen } from './ui/resultsScreen.js';

document.addEventListener('DOMContentLoaded', () => {
    initIntakeScreen();
    initInstructionsScreen();
    initExperimentScreen();
    initResultsScreen();
});
