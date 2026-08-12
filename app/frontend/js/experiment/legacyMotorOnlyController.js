// This is the original 3-session motor-only experiment controller from the
// Phase 0 reorganization, preserved byte-for-byte under a new filename.
//
// It moved here (unchanged) so that app/frontend/js/experiment/experimentController.js
// could become the new Motor-Cognitive Dual-Task experiment controller, as
// explicitly requested for that file path. app.js was updated to import
// this file under its new name; nothing about its behavior changed.

import { runCountdown } from '../timer/timer.js';
import { playMouseSession } from '../mouse/mouseSession.js';
import { show, hide } from '../ui/transition.js';
import { advanceFromMenu } from '../ui/instructions.js';
import { startRecovery, endRecovery } from '../ui/recovery.js';
import { renderSessionResult, renderFinalResults, showResults, resetFinalAccuracyDisplay } from '../ui/results.js';
import { buildScorePayload, saveScoreToServer } from '../data/sessionData.js';
import { getState, setCode, recordSession, computeTotals } from './experimentState.js';

// The target-size selector in the settings panel is present in the markup
// but was never wired up in the original game.js (the line that applied it
// was commented out there too) - preserved as-is here.
const TARGET_SIZE = 75;

export function initExperiment() {
    const startButton = document.getElementById('start');
    const next1Button = document.getElementById('next1');
    const restartButton = document.getElementById('restart');
    const codeElement = document.getElementById('code');
    const saveButton = document.getElementById('save');
    const menuContainer = document.getElementById('menu');
    const gameScreenContainer = document.getElementById('gameScreen');
    const gameContainer = document.getElementById('game');
    const breakContainer1 = document.getElementById('break1');
    const breakContainer2 = document.getElementById('break2');
    const instructionsContainer0 = document.getElementById('instructions0');
    const instructionsContainer1 = document.getElementById('instructions1');
    const instructionsContainer2 = document.getElementById('instructions2');
    const instructionsContainer3 = document.getElementById('instructions3');
    const resultsContainer = document.getElementById('resultContainer');
    const countdownElement = document.getElementById('countdown');
    const endingElement = document.getElementById('ending');
    const timerElement = document.getElementById('timeLeft');
    const targetColorInput = document.getElementsByName('tgtcolor');
    const bgColorInput = document.getElementsByName('bgcolor');
    const difficultyLevelInput = document.getElementById('diff');
    const durationElement = document.getElementById('duration');
    const cursorTypeInput = document.getElementsByName('cursorType');

    let series = 0;
    let navCount = 0; // corresponds to the original "first" counter

    next1Button.addEventListener('click', function () {
        setCode(codeElement.value);
        advanceFromMenu(navCount, {
            menuContainer,
            instructionsContainer0,
            instructionsContainer1,
            next1Button,
            startButton
        });
        navCount += 1;
    });

    startButton.addEventListener('click', function () {
        hide(startButton);
        hide(instructionsContainer0);
        hide(instructionsContainer1);
        hide(instructionsContainer2);
        hide(instructionsContainer3);
        series += 1;
        beginSequence(series);
    });

    restartButton.addEventListener('click', function () {
        location.reload();
    });

    saveButton.addEventListener('click', function () {
        const payload = buildScorePayload(getState());
        saveScoreToServer(payload).then((data) => {
            alert(data);
            show(saveButton);
        });
    });

    function beginSequence(iteration) {
        hide(menuContainer);
        runCountdown(3, {
            displayEl: countdownElement,
            onComplete: () => {
                hide(endingElement);
                runSession(iteration);
            }
        });
    }

    function runSession(iteration) {
        resetFinalAccuracyDisplay();
        const cursorTypeValue = getSelectedValue(cursorTypeInput);
        const bgColor = getSelectedValue(bgColorInput);
        const targetColor = getSelectedValue(targetColorInput);
        const difficultyLevel = parseFloat(difficultyLevelInput.value);
        const durationMs = parseFloat(durationElement.value) * 60000;

        playMouseSession(
            {
                gameScreenContainer,
                gameContainer,
                timerElement,
                endingElement,
                startButtonElement: startButton,
                cursorType: cursorTypeValue,
                bgColor,
                targetColor,
                targetSize: TARGET_SIZE,
                difficultyLevel,
                durationMs
            },
            (result) => finishSession(iteration, result)
        );
    }

    function finishSession(iteration, result) {
        recordSession(result);
        renderSessionResult(iteration, result);

        if (iteration < 3) {
            startRecovery(iteration, { breakContainer1, breakContainer2 });
            runCountdown(90, {
                displayEl: countdownElement,
                onComplete: () => {
                    hide(endingElement);
                    endRecovery(iteration, {
                        breakContainer1,
                        breakContainer2,
                        instructionsContainer2,
                        instructionsContainer3,
                        startButton
                    });
                }
            });
        } else {
            const totals = computeTotals();
            renderFinalResults(totals);
            showResults(resultsContainer, restartButton, saveButton);
        }
    }

    function getSelectedValue(elements) {
        for (let i = 0; i < elements.length; i++) {
            if (elements[i].checked) {
                return elements[i].value;
            }
        }
    }
}
