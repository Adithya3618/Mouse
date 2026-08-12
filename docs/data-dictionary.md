# Data Dictionary

This documents two separate data shapes that currently coexist:

1. The **legacy Excel score row** saved by the original 3-session task
   (unchanged from `original/UF_OPS/`).
2. The **dual-task session record**, produced by
   `app/frontend/js/data/sessionData.js` for the new experiment engine.
   This is currently an in-memory JavaScript object; it is not yet written
   anywhere (no export/save step exists for it yet).

## 1. Legacy Excel score row (live, unchanged)

One row per completed 3-session run in `data/exports/excel/scores.xlsx`:

| Column | Meaning |
|---|---|
| Name | Always blank - the frontend never collects a name (see `docs/experiment-protocol.md`'s original app) |
| Code | Participant code entered on the menu screen |
| Date | Server timestamp when saved |
| Session 1/2/3 Accuracy | `hits / clicks * 100` per session |
| Session 1/2/3 TargetEfficiency | `hits / targets * 100` per session |
| Total Game Accuracy | `hits / clicks * 100` across all 3 sessions |
| Total Game TargetEfficiency | `hits / targets * 100` across all 3 sessions |

## 2. Dual-task session record (new, in-memory only)

Conceptually: **Participant → Experiment Session → Phases → Performance
Data**. Produced by `data/sessionData.js#createSession` and built up one
phase at a time as `experimentController.js` runs.

### Session

| Field | Type | Meaning |
|---|---|---|
| `participantId` | string \| null | Not collected automatically yet - `null` unless explicitly passed to the controller |
| `sessionId` | string | Generated unique ID (`session-<timestamp>-<counter>`) |
| `experimentId` | string | `"motor-cognitive-dual-task"` |
| `startTime` | ISO string | Set when the session is created |
| `endTime` | ISO string \| null | Set once the `COMPLETE` phase is reached |
| `phases` | array of Phase records | One entry per phase actually run, in order |

### Phase record

| Field | Type | Meaning |
|---|---|---|
| `phaseId` | string | e.g. `"DUAL_TASK_3"` - see `experiment/phases.js` for the full list |
| `phaseType` | string | `instructions` \| `motor` \| `cognitive` \| `transition` \| `dual-task` \| `recovery` \| `complete` |
| `subtractionValue` | number \| null | `3`, `7`, `17`, or `null` |
| `startingNumber` | number \| null | The random number (799-999) this condition counts down from; `null` for phases with no subtraction |
| `duration` | number \| null | Configured phase length in seconds; `null` for manually-advanced phases |
| `mouseActive` | boolean | Whether the mouse task ran during this phase |
| `cognitiveActive` | boolean | Whether subtraction was active during this phase |
| `startedAt` / `endedAt` | ISO string \| null | When this phase actually started/ended |
| `mousePerformance` | object \| null | See below; `null` for phases with `mouseActive: false` |

### Mouse performance (per phase)

Stored independently for `MOTOR_BASELINE`, `DUAL_TASK_3`, `DUAL_TASK_7`,
and `DUAL_TASK_17` - never combined into one overall mouse score. Computed
using the existing, unchanged formulas in `mouse/scoring.js`.

| Field | Meaning |
|---|---|
| `totalTargets` | Targets spawned during this phase |
| `totalClicks` | Clicks recorded during this phase |
| `totalHits` | Targets successfully clicked during this phase |
| `totalMisses` | `totalClicks - totalHits` |
| `totalAccuracy` | `totalHits / totalClicks * 100` |
| `targetEfficiency` | `totalHits / totalTargets * 100` |

### Not implemented yet

- Writing this session record anywhere (Excel/CSV/JSON export). Only
  `data/dataFormatter.js#formatSessionForExport` exists so far, which
  reshapes a session into a flat, export-ready structure without deciding
  what consumes it.
- Cognitive (subtraction) performance/accuracy fields - the participant's
  spoken answers are not captured or scored at this stage.
