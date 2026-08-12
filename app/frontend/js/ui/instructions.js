// Controls the menu -> instructions hand-off screens.
// This is a direct extraction of the original "next" button behavior:
// the first click reveals the general overview instructions, the second
// reveals the Session 1 instructions and the Start button.

import { show, hide } from './transition.js';

export function advanceFromMenu(navCount, { menuContainer, instructionsContainer0, instructionsContainer1, next1Button, startButton }) {
    hide(menuContainer);
    if (navCount === 0) {
        show(instructionsContainer0);
    } else if (navCount === 1) {
        hide(next1Button);
        hide(instructionsContainer0);
        show(instructionsContainer1);
        show(startButton);
    }
}
