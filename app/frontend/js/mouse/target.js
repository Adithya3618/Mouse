// Target creation and positioning for the mouse accuracy task.

export function getRandomNumber(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Small inset from the container's edges. Not part of the visible design -
// it exists purely as a safety margin against sub-pixel rounding
// differences between `clientWidth`/`clientHeight` (used here) and
// `getBoundingClientRect()` (used to verify containment), so a target can
// never be computed to land exactly flush with, or a hair past, the edge.
const EDGE_MARGIN_PX = 1;

// Picks a random top-left position such that a `size`x`size` box is
// guaranteed to fit completely inside a `containerWidth`x`containerHeight`
// area - the position is still uniformly random, just bounded so the
// target can never extend past any edge of its container.
export function getContainedPosition(containerWidth, containerHeight, size) {
    const maxLeft = Math.max(containerWidth - size - EDGE_MARGIN_PX, EDGE_MARGIN_PX);
    const maxTop = Math.max(containerHeight - size - EDGE_MARGIN_PX, EDGE_MARGIN_PX);
    return {
        left: getRandomNumber(EDGE_MARGIN_PX, maxLeft),
        top: getRandomNumber(EDGE_MARGIN_PX, maxTop)
    };
}

// Spawns a single clickable target inside `container` and removes it after
// `lifetimeMs`. Calls `onHit` the moment it is clicked.
//
// `container` (mouse/mouseTask.js's `gameContainer`, id="game") must be
// the CSS positioning ancestor for this target's `position: absolute` to
// resolve against its box (see css/experiment-screen.css's `#game`
// rule) - otherwise the browser falls back to positioning relative to the
// viewport, which is what let targets appear outside the visible target
// field before this fix.
export function spawnTarget({ container, color, size, cursorType, onHit, lifetimeMs = 4000 }) {
    const target = document.createElement('div');
    target.classList.add('target');
    target.style.backgroundColor = color;
    container.style.cursor = cursorType;
    target.style.width = `${size}px`;
    target.style.height = `${size}px`;

    const { left, top } = getContainedPosition(container.clientWidth, container.clientHeight, size);
    target.style.left = `${left}px`;
    target.style.top = `${top}px`;

    target.addEventListener('click', function () {
        onHit();
        target.style.display = 'none';
    });

    container.appendChild(target);

    setTimeout(() => {
        target.remove();
    }, lifetimeMs);

    return target;
}
