// Renders per-session and final results into the results screen, and
// controls the results/restart/save button visibility at the end of the
// experiment. Mirrors the original updateStats() DOM-writing behavior,
// including the "0%" special case when a session had zero clicks.

import { formatPercentage } from '../data/dataFormatter.js';

// The original beginGame() reset the *final* accuracy display to "0%" at
// the start of every session (not just session 1), even though
// #resultContainer stays hidden until session 3 finishes. It has no
// visible effect (renderFinalResults always overwrites it before the
// container is shown), but is reproduced here for exact fidelity.
export function resetFinalAccuracyDisplay() {
    document.getElementById('accuracy').textContent = '0%';
}

export function renderSessionResult(sessionNumber, result) {
    document.getElementById(`clickCount${sessionNumber}`).textContent = result.clickCount;
    document.getElementById(`hitCount${sessionNumber}`).textContent = result.hitCount;
    document.getElementById(`accuracy${sessionNumber}`).textContent =
        result.clickCount === 0 ? '0%' : formatPercentage(result.accuracy);
    document.getElementById(`targetCount${sessionNumber}`).textContent = result.numberOfTargets;
    document.getElementById(`targetHitCount${sessionNumber}`).textContent = result.hitCount;
    document.getElementById(`targetEfficiency${sessionNumber}`).textContent = formatPercentage(result.targetEfficiency);
}

export function renderFinalResults(totals) {
    document.getElementById('clickCount').textContent = totals.clickCount;
    document.getElementById('hitCount').textContent = totals.hitCount;
    document.getElementById('accuracy').textContent = formatPercentage(totals.accuracy);
    document.getElementById('targetCount').textContent = totals.numberOfTargets;
    document.getElementById('targetEfficiency').textContent = formatPercentage(totals.targetEfficiency);
    document.getElementById('targetHitCount').textContent = totals.hitCount;
}

export function showResults(resultsContainer, restartButton, saveButton) {
    resultsContainer.style.display = 'block';
    setTimeout(() => {
        restartButton.style.display = 'block';
        saveButton.style.display = 'block';
    }, 1000);
}
