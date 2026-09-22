// Shared custom-controls-over-a-real-<audio>-element player, used by every
// "Play Instructions"-style player in the app: the Instructions walkthrough
// and "Before You Begin" (js/ui/instructionsScreen.js) and the real
// experiment's REST/recovery screens (js/ui/experimentScreen.js). Each
// player is addressed by an id prefix - e.g. prefix "entry" reads/writes
// #entryAudioWrap, #entryAudioPlayer, #entryAudioPlayBtn, ... in whichever
// HTML section it lives in.

import { show, hide } from './transition.js';

export function formatAudioTime(seconds) {
    if (!Number.isFinite(seconds)) {
        return '0:00';
    }
    const total = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(total / 60);
    const secs = String(total % 60).padStart(2, '0');
    return `${minutes}:${secs}`;
}

export function audioIds(prefix) {
    return {
        wrap: document.getElementById(`${prefix}AudioWrap`),
        fallback: document.getElementById(`${prefix}AudioFallback`),
        player: document.getElementById(`${prefix}AudioPlayer`),
        playBtn: document.getElementById(`${prefix}AudioPlayBtn`),
        playIcon: document.getElementById(`${prefix}AudioPlayIcon`),
        timeEl: document.getElementById(`${prefix}AudioTime`),
        volumeSlider: document.getElementById(`${prefix}AudioVolume`)
    };
}

// Sets/resets a player's source. If the file 404s (or otherwise fails to
// load), the whole player row is replaced by a plain "Audio not yet
// available" note instead of sitting there broken/silent.
//
// { autoplay: true } additionally starts playback immediately once the
// source is set - used by the Instructions walkthrough so each step's
// narration starts on its own, without disabling the manual controls
// (opt-in per call site; every other player - "Before You Begin", the real
// experiment's REST screen - keeps its existing manual-only behavior
// unchanged). player.pause() below (called on every invocation, before the
// new .src is assigned) is what stops the previous step's audio - since
// every step reuses this one <audio> element rather than creating a new
// one, there is never more than one instance to manage. If the browser
// blocks autoplay, play() rejects and is silently swallowed here - the
// existing Play button (wired once in initAudioPlayerControls, untouched
// by this) is completely unaffected and still works normally.
export function loadAudioSrc(prefix, src, { autoplay = false } = {}) {
    const { wrap, fallback, player, playIcon, timeEl } = audioIds(prefix);

    show(wrap);
    hide(fallback);
    player.pause();
    playIcon.textContent = '▶';
    timeEl.textContent = '0:00 / 0:00';
    player.onerror = () => {
        hide(wrap);
        show(fallback);
    };
    player.src = src;

    if (autoplay) {
        player.play().catch(() => {
            // Autoplay-restriction rejections (and the AbortError a browser
            // may raise when a later loadAudioSrc() call interrupts this
            // same play() before it resolves) are expected, not failures -
            // the Play button stays available either way.
        });
    }
}

// Pauses a player without touching its .src/current position - used when
// leaving a screen so its audio doesn't keep playing in the background.
export function stopAudio(prefix) {
    audioIds(prefix).player.pause();
}

// Hides a player entirely (no fallback note either) - for phases/screens
// that don't have an audio player mapped for them at all, as opposed to
// one that's mapped but its file is missing (loadAudioSrc's onerror case).
export function hideAudioPlayer(prefix) {
    const { wrap, fallback, player } = audioIds(prefix);
    player.pause();
    player.removeAttribute('src');
    hide(wrap);
    hide(fallback);
}

// Wires the custom play/pause button + volume slider to the real <audio>
// element exactly once per player - only .src (and the display reset in
// loadAudioSrc above) changes afterwards.
export function initAudioPlayerControls(prefix) {
    const { player, playBtn, playIcon, timeEl, volumeSlider } = audioIds(prefix);

    playBtn.addEventListener('click', () => {
        if (player.paused) {
            player.play().catch(() => {
                // Autoplay/user-gesture restrictions are not a failure of
                // the audio file itself - the participant just clicked
                // Play directly, so this should always be allowed, but
                // catching keeps a rejected promise from surfacing as an
                // unhandled error.
            });
        } else {
            player.pause();
        }
    });

    player.addEventListener('play', () => { playIcon.textContent = '⏸'; });
    player.addEventListener('pause', () => { playIcon.textContent = '▶'; });
    player.addEventListener('ended', () => { playIcon.textContent = '▶'; });

    player.addEventListener('loadedmetadata', () => {
        timeEl.textContent = `${formatAudioTime(player.currentTime)} / ${formatAudioTime(player.duration)}`;
    });
    player.addEventListener('timeupdate', () => {
        timeEl.textContent = `${formatAudioTime(player.currentTime)} / ${formatAudioTime(player.duration)}`;
    });

    volumeSlider.addEventListener('input', () => {
        player.volume = Number(volumeSlider.value);
    });
}
