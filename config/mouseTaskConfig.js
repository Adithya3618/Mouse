// Mouse-accuracy task configuration, used by
// app/frontend/js/experiment/experimentController.js's default mouse-task
// adapter once a phase screen provides the real DOM containers. Mirrors
// the values the original UF_OPS app used.

export const mouseTaskConfig = {
    targetSizePx: 75,
    targetLifetimeMs: 4000,
    targetPositionRangePercent: { min: 20, max: 80 },
    cursorType: 'default',
    backgroundColor: 'white',
    targetColor: 'black',
    difficultyLevels: {
        easy: 1,
        medium: 0.5,
        hard: 0.25
    },
    defaultDifficulty: 1,
    defaultDurationMinutes: 2
};

export default mouseTaskConfig;
