# Instructions page audio

Place instruction narration files here, using these exact filenames (read
by `app/frontend/js/ui/instructionsScreen.js`, served automatically at
`/audio/instructions/<filename>` since `app/backend/server.js` already
serves all of `app/frontend/` as static files - no backend change needed):

- `clicking-only.mp3`
- `rest.mp3` (shared by all 3 REST steps - see instructionsScreen.js if any
  REST occurrence needs its own distinct narration instead)
- `count-back-3.mp3`
- `count-back-3-clicking.mp3`
- `count-back-7.mp3`
- `count-back-7-clicking.mp3`
- `count-back-17.mp3`
- `count-back-17-clicking.mp3`
- `before-you-begin.mp3` - narrates the "Before You Begin" page
  (`#screen-experiment-entry`, shown right after step 10's Continue), not
  one of the 10 walkthrough steps above. Must read this exact text aloud:
  "Please count audibly and clearly. If you make a mistake, continue
  counting backward from the last number you stated. If you forget the
  number, choose a number in the same general range and continue counting
  backward as many times as you can until the time runs out."

Any format the browser's `<audio>` element supports works (mp3/wav/ogg/m4a);
just keep the base filename exactly as above, or update the `AUDIO_SRC` map
in `instructionsScreen.js` to match whatever you use instead.

If a file for a given step is missing, the player is replaced with a plain
"Audio not yet available" note - the page never shows a broken control.
