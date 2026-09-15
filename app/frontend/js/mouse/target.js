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

// The floating "Time Remaining"/recording-indicator corner group (see
// css/experiment-screen.css's body.fullscreen-task rules - CORNER_WIDTH=220,
// CORNER_TOP=16, stacked box) always occupies this footprint in the
// fullscreen task screen's top-right corner. Every target spawn happens
// during one of those fullscreen phases (clicking-only or a dual-task
// block - see ui/experimentScreen.js#isFullscreenTaskPhase), so this is
// applied unconditionally rather than threaded through as a per-call
// option. Deliberately a bit larger than the CSS box's own ~220x186
// footprint - a fixed safety margin rather than a live
// getBoundingClientRect() measurement, so this has no dependency on
// layout having actually painted yet before the very first spawn.
export const RESERVED_CORNER_ZONE = { width: 240, height: 220 };

// The counting-number card (DUAL_TASK_<n> only - see
// css/experiment-screen.css's body.fullscreen-task .starting-number rule,
// CORNER_TOP=16, ~220x80 footprint) in the top-LEFT corner. Also applied
// unconditionally like RESERVED_CORNER_ZONE above - harmless on
// MOTOR_BASELINE, where the card never actually renders, in exchange for
// not needing to thread "which phase is this" through spawnTarget/
// mouseTask.js at all.
export const RESERVED_CORNER_ZONE_LEFT = { width: 240, height: 110 };

// Bounded, not infinite - a pathologically small container (well under the
// reserved zones' own size; never happens in the real fullscreen task
// screen, only possibly in a synthetic test) must still return a
// contained position rather than loop forever.
const MAX_RESERVED_ZONE_ATTEMPTS = 30;

function overlapsReservedCornerRight(left, top, size, containerWidth, reservedCorner) {
    if (!reservedCorner) {
        return false;
    }
    const reservedLeftEdge = containerWidth - reservedCorner.width;
    return left + size > reservedLeftEdge && top < reservedCorner.height;
}

function overlapsReservedCornerLeft(left, top, size, reservedCornerLeft) {
    if (!reservedCornerLeft) {
        return false;
    }
    return left < reservedCornerLeft.width && top < reservedCornerLeft.height;
}

// Picks a random top-left position such that a `size`x`size` box is
// guaranteed to fit completely inside a `containerWidth`x`containerHeight`
// area - the position is still uniformly random, just bounded so the
// target can never extend past any edge of its container, and never lands
// under either reserved corner group above (pass `reservedCorner`/
// `reservedCornerLeft: null` to disable one or both, e.g. in a test that
// wants the unrestricted distribution).
export function getContainedPosition(
    containerWidth,
    containerHeight,
    size,
    reservedCorner = RESERVED_CORNER_ZONE,
    reservedCornerLeft = RESERVED_CORNER_ZONE_LEFT
) {
    const maxLeft = Math.max(containerWidth - size - EDGE_MARGIN_PX, EDGE_MARGIN_PX);
    const maxTop = Math.max(containerHeight - size - EDGE_MARGIN_PX, EDGE_MARGIN_PX);

    let left = getRandomNumber(EDGE_MARGIN_PX, maxLeft);
    let top = getRandomNumber(EDGE_MARGIN_PX, maxTop);
    let attempts = 1;
    while (
        (overlapsReservedCornerRight(left, top, size, containerWidth, reservedCorner)
            || overlapsReservedCornerLeft(left, top, size, reservedCornerLeft))
        && attempts < MAX_RESERVED_ZONE_ATTEMPTS
    ) {
        left = getRandomNumber(EDGE_MARGIN_PX, maxLeft);
        top = getRandomNumber(EDGE_MARGIN_PX, maxTop);
        attempts += 1;
    }

    return { left, top };
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
