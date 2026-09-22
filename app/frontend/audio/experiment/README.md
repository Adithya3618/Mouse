# Real-experiment phase audio

Narration for screens shown *during* the real timed experiment (as opposed
to `app/frontend/audio/instructions/`, which is only for the pre-experiment
Instructions walkthrough and "Before You Begin"). Read by
`app/frontend/js/ui/experimentScreen.js`'s `RECOVERY_AUDIO_FILE_BY_PHASE_ID`
map, served automatically at `/audio/experiment/<filename>` since
`app/backend/server.js` already serves all of `app/frontend/` as static
files - no backend change needed.

Current expected filenames:

- `recovery-after-motor.mp3` - narrates the RECOVERY_AFTER_MOTOR REST
  screen's paragraphs (the first REST, before series 1). Must read this
  exact text aloud, in order:
  1. "As you rest, I will explain the three upcoming series of counting
     backward and counting backward while clicking."
  2. "You will count backward by 3, 7, and 17, starting from a random
     number that will be provided on the screen."
  3. "Please count out loud, clearly, and at an audible volume so that the
     recording can capture each number you say."
  4. "If you make a mistake, continue counting backward from the last
     number you stated. Do not go back and correct the mistake. If you
     forget which number you were on, choose a number in the same general
     range and continue counting backward."
  5. "If you reach negative numbers, that is completely fine. Continue
     counting backward using the same pattern."

- `recovery-after-dual-3.mp3` - narrates the RECOVERY_AFTER_DUAL_3 REST
  screen's paragraphs (the second REST, before series 2 - the short "Next
  Task" version). Must read this exact text aloud, in order:
  1. "After this rest, you will count backward by multiples of 7, starting
     from a random number that will appear on the next screen."
  2. "Once the count-back-only block ends, watch for the short countdown —
     you will then be given a new random number to count backward from
     while clicking the targets as soon as they appear."

- `recovery-after-dual-7.mp3` - narrates the RECOVERY_AFTER_DUAL_7 REST
  screen's paragraphs (the third REST, before series 3 - the short "Next
  Task" version). Must read this exact text aloud, in order:
  1. "After this rest, you will count backward by multiples of 17, starting
     from a random number that will appear on the next screen."
  2. "Once the count-back-only block ends, watch for the short countdown —
     you will then be given a new random number to count backward from
     while clicking the targets as soon as they appear."

If any of these files is missing, the player is replaced with a plain
"Audio not yet available" note - the screen never shows a broken control.
