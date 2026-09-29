import { show, hide } from './transition.js';
import { getExperimentController } from '../experiment/experimentRuntime.js';
import { loadAudioSrc, initAudioPlayerControls, stopAudio, hideAudioPlayer } from './audioPlayer.js';

const TOTAL_STEPS = 10;

const CLICKING_BULLETS = [
    'Dots will appear one at a time in random locations on the screen.',
    'Click each dot as quickly and accurately as possible.',
    'The dots will automatically appear and disappear.',
    'Continue clicking until the time runs out.'
];

const REST_BULLET = ['Rest for the full duration before continuing to the next task.'];

function countBackAndClickingBullets(value) {
    return [
        `Continue counting backward by multiples of ${value} from where you left off.`,
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
    { title: 'Clicking only', duration: '2 Minutes', intro: CLICKING_INTRO, bullets: CLICKING_BULLETS, illustration: true, audioFile: 'clicking-only.mp3' },
    { title: 'REST', duration: '90 seconds', intro: null, bullets: REST_BULLET, illustration: false, audioFile: null },
    { title: 'Count Backward by 3', duration: '2 Minutes', intro: countBackIntro(3), bullets: null, illustration: false, audioFile: 'count-back-3.mp3' },
    { title: 'Count Backward by 3 and clicking', duration: '2 minutes', intro: countBackAndClickingIntro(3), bullets: countBackAndClickingBullets(3), illustration: true, audioFile: 'count-back-3-clicking.mp3' },
    { title: 'REST', duration: '90 seconds', intro: null, bullets: REST_BULLET, illustration: false, audioFile: null },
    { title: 'Count Backward by 7', duration: '2 Minutes', intro: countBackIntro(7), bullets: null, illustration: false, audioFile: 'count-back-7.mp3' },
    { title: 'Count Backward by 7 and clicking', duration: '2 minutes', intro: countBackAndClickingIntro(7), bullets: countBackAndClickingBullets(7), illustration: true, audioFile: 'count-back-7-clicking.mp3' },
    { title: 'REST', duration: '90 seconds', intro: null, bullets: REST_BULLET, illustration: false, audioFile: null },
    { title: 'Count Backward by 17', duration: '2 Minutes', intro: countBackIntro(17), bullets: null, illustration: false, audioFile: 'count-back-17.mp3' },
    { title: 'Count Backward by 17 and clicking', duration: '2 minutes', intro: countBackAndClickingIntro(17), bullets: countBackAndClickingBullets(17), illustration: true, audioFile: 'count-back-17-clicking.mp3' }
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

    // The intro sentence is hidden for steps that have bullets (1, 2, 4, 5,
    // 7, 8, 10) - researcher-requested removal there, since those steps
    // still have plenty of other content. The count-only steps (3, 6, 9 -
    // bullets: null) have no bullets/illustration at all, so with no intro
    // they'd show almost nothing - the intro is their only body text, and
    // stays shown for those.
    const introEl = document.getElementById('instructionsIntro');
    introEl.textContent = step.intro || '';
    introEl.hidden = Boolean(step.bullets) || !step.intro;

    const bulletsList = document.getElementById('instructionsBullets');
    bulletsList.innerHTML = '';
    for (const bullet of step.bullets || []) {
        const li = document.createElement('li');
        li.textContent = bullet;
        bulletsList.appendChild(li);
    }

    document.getElementById('instructionsIllustration').hidden = !step.illustration;

   
    document.getElementById('instructionsDetailBox').hidden = !step.bullets && !step.illustration;

    // Disabled (not hidden/removed) on step 1 - see index.html's own
    // comment on #instructionsBackBtn for why.
    document.getElementById('instructionsBackBtn').disabled = currentStep === 1;

    loadStepAudio(step.audioFile);
}

// REST steps have no narration - hide the player entirely rather than
// showing the "Audio not yet available." fallback.
function loadStepAudio(audioFile) {
    if (!audioFile) {
        hideAudioPlayer('instructions');
        return;
    }
    loadAudioSrc('instructions', AUDIO_BASE_PATH + audioFile, { autoplay: true });
}

export function initInstructionsScreen() {
    const continueBtn = document.getElementById('continueBtn');
    const backBtn = document.getElementById('instructionsBackBtn');
    const screenInstructions = document.getElementById('screen-instructions');
    const controller = getExperimentController();

 
    function finishInstructionsWalkthrough() {
        // Stop this walkthrough's auto-playing narration before leaving the
        // screen - otherwise it would keep playing in the background over
        // whatever comes next.
        stopAudio('instructions');
        controller.advance();
    }


    backBtn.addEventListener('click', () => {
        if (currentStep > 1) {
            currentStep -= 1;
            renderWalkthrough();
        }
    });

    continueBtn.addEventListener('click', () => {
        if (currentStep < TOTAL_STEPS) {
            currentStep += 1;
            renderWalkthrough();
            return;
        }
        continueBtn.disabled = true;
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
