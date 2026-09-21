// Instructions screen: a two-column, step-by-step walkthrough of the 10
// named phases, entirely self-contained on this ONE page (see index.html's
// #screen-instructions) - a preview shown before the real experiment
// starts, not tied to any real phase/timer. Nothing about the actual
// timed experiment (durations, phase sequence, scoring, data persistence)
// is touched by anything in this file. Continue after step 10 (and "Skip
// Instructions") call controller.advance() directly - see
// finishInstructionsWalkthrough() below for why: "Before You Begin"
// (#screen-experiment-entry), whose own body text and audio player this
// file still owns (index.html's #entryPageBody / #entryAudioWrap), is
// temporarily out of the flow, kept but unshown. #entryPageBody's
// paragraph is the exact text given directly by the user, verbatim - not
// paraphrased.
//
// Wording source: the "Clicking only" bullets, and its intro sentence, are
// the exact text given directly by the user (matching their own reference
// image). Every other step's bullets/intro are adapted as minimally as
// possible from this app's own existing, already-reviewed copy
// (ui/phaseCopy.js's active-phase instruction text - the cognitive intro
// drops phaseCopy's "Starting with <n>," clause since no real starting
// number exists yet on this static preview page; the dual-task intro is
// reused verbatim). REST's line is a short, deliberately generic
// placeholder (not sourced from any document) - replace it with the real
// wording once available; REST has no separate intro sentence for the same
// reason. The dual-task steps' "and clicking" bullets reuse the exact same
// clicking bullets as step 1.

import { show, hide } from './transition.js';
import { getExperimentController } from '../experiment/experimentRuntime.js';
import { loadAudioSrc, initAudioPlayerControls } from './audioPlayer.js';

const TOTAL_STEPS = 10;

const CLICKING_BULLETS = [
    'Dots will appear one at a time in random locations on the screen.',
    'Click each dot as quickly and accurately as possible.',
    'The dots will automatically appear and disappear.',
    'Continue clicking until the time runs out.'
];

const REST_BULLET = ['Rest for the full duration before continuing to the next task.'];

function countBackBullets(value) {
    return [
        `Count backward by multiples of ${value}, as many times as possible.`,
        'Continue until the timer reaches zero.'
    ];
}

function countBackAndClickingBullets(value) {
    return [
        `Count backward by multiples of ${value}, starting from a new number.`,
        ...CLICKING_BULLETS
    ];
}

const CLICKING_INTRO = 'Click the randomly appearing and disappearing dots on the screen as quickly and accurately as possible.';

function countBackIntro(value) {
    return `Count backward by multiples of ${value} as many times as possible until the timer reaches zero.`;
}

function countBackAndClickingIntro(value) {
    return `Count backward by multiples of ${value} while clicking on the targets, until the timer reaches zero.`;
}

const STEPS = [
    { title: 'Clicking only', duration: '80 seconds', intro: CLICKING_INTRO, bullets: CLICKING_BULLETS, illustration: true, audioFile: 'clicking-only.mp3' },
    { title: 'REST', duration: '90 seconds', intro: null, bullets: REST_BULLET, illustration: false, audioFile: 'rest.mp3' },
    { title: 'Count back by 3', duration: '90 seconds', intro: countBackIntro(3), bullets: countBackBullets(3), illustration: false, audioFile: 'count-back-3.mp3' },
    { title: 'Count back by 3 and clicking', duration: '2 minutes', intro: countBackAndClickingIntro(3), bullets: countBackAndClickingBullets(3), illustration: true, audioFile: 'count-back-3-clicking.mp3' },
    { title: 'REST', duration: '90 seconds', intro: null, bullets: REST_BULLET, illustration: false, audioFile: 'rest.mp3' },
    { title: 'Count back by 7', duration: '90 seconds', intro: countBackIntro(7), bullets: countBackBullets(7), illustration: false, audioFile: 'count-back-7.mp3' },
    { title: 'Count back by 7 and clicking', duration: '2 minutes', intro: countBackAndClickingIntro(7), bullets: countBackAndClickingBullets(7), illustration: true, audioFile: 'count-back-7-clicking.mp3' },
    { title: 'REST', duration: '90 seconds', intro: null, bullets: REST_BULLET, illustration: false, audioFile: 'rest.mp3' },
    { title: 'Count back by 17', duration: '90 seconds', intro: countBackIntro(17), bullets: countBackBullets(17), illustration: false, audioFile: 'count-back-17.mp3' },
    { title: 'Count back by 17 and clicking', duration: '2 minutes', intro: countBackAndClickingIntro(17), bullets: countBackAndClickingBullets(17), illustration: true, audioFile: 'count-back-17-clicking.mp3' }
];

const AUDIO_BASE_PATH = '/audio/instructions/';

let currentStep = 1;

function renderWalkthrough() {
    const step = STEPS[currentStep - 1];

    for (const phaseEl of document.querySelectorAll('#instructionsPhaseList .phase')) {
        phaseEl.classList.toggle('active', Number(phaseEl.dataset.step) === currentStep);
    }

    document.getElementById('instructionsStepLabel').textContent = `Step ${currentStep} of ${TOTAL_STEPS}`;
    document.getElementById('instructionsStepTitle').textContent = step.title;
    document.getElementById('instructionsStepDuration').textContent = `(${step.duration})`;

    const introEl = document.getElementById('instructionsIntro');
    introEl.textContent = step.intro || '';
    introEl.hidden = !step.intro;

    const bulletsList = document.getElementById('instructionsBullets');
    bulletsList.innerHTML = '';
    for (const bullet of step.bullets) {
        const li = document.createElement('li');
        li.textContent = bullet;
        bulletsList.appendChild(li);
    }

    document.getElementById('instructionsIllustration').hidden = !step.illustration;

    loadStepAudio(step.audioFile);
}

// Swaps in the current step's audio file and resets the custom player's
// display state. If the file fails to load (none exist yet), the whole
// player row is replaced by a plain text note instead of sitting there
// broken/silent - see AUDIO_BASE_PATH/this app's own
// app/frontend/audio/instructions/README.md for the expected filenames.
// loadAudioSrc/initAudioPlayerControls (see ./audioPlayer.js) are shared
// with every other "Play Instructions"-style player in the app, addressed
// by id prefix - e.g. prefix "entry" -> #entryAudioWrap, #entryAudioPlayer, ...
function loadStepAudio(audioFile) {
    loadAudioSrc('instructions', AUDIO_BASE_PATH + audioFile);
}

export function initInstructionsScreen() {
    const continueBtn = document.getElementById('continueBtn');
    const skipBtn = document.getElementById('skipInstructionsBtn');
    const screenInstructions = document.getElementById('screen-instructions');
    const controller = getExperimentController();

    // "Before You Begin" (#screen-experiment-entry) is temporarily taken
    // out of the participant-facing flow - see index.html's own comment on
    // that section. Its markup/CSS/audio player are left fully intact
    // (nothing deleted, including the before-you-begin.mp3 recording) so
    // it's a one-line revert to put back: swap this straight-to-advance()
    // call for hide(screenInstructions)+show(screenEntry) again.
    // controller.advance() itself already hides #screen-instructions (and
    // the still-untouched #screen-experiment-entry) via
    // experimentScreen.js's own onPhaseChange subscription - see that
    // file's preExperimentScreens list - so no manual hide() is needed here.
    function finishInstructionsWalkthrough() {
        controller.advance();
    }

    continueBtn.addEventListener('click', () => {
        if (currentStep < TOTAL_STEPS) {
            currentStep += 1;
            renderWalkthrough();
            return;
        }
        continueBtn.disabled = true;
        finishInstructionsWalkthrough();
    });

    // "Skip tutorial" only bypasses this 10-step preview - it still hands
    // off exactly where step 10's own Continue does, so nothing about
    // scoring/timing/data collection changes.
    skipBtn.addEventListener('click', () => {
        finishInstructionsWalkthrough();
    });

    const continueEntryBtn = document.getElementById('continueEntryBtn');
    continueEntryBtn.addEventListener('click', () => {
        continueEntryBtn.disabled = true;
        controller.advance();
    });

    initAudioPlayerControls('instructions');
    initAudioPlayerControls('entry');
    loadAudioSrc('entry', `${AUDIO_BASE_PATH}before-you-begin.mp3`);
}

export function showInstructionsScreen(session) {
    const participantSummary = document.getElementById('participantSummary');
    if (participantSummary) {
        participantSummary.textContent = `Participant ${session.participantCode} · ${session.sessionDate}`;
    }
    hide(document.getElementById('screen-intake'));
    show(document.getElementById('screen-instructions'));

    currentStep = 1;
    renderWalkthrough();
}
