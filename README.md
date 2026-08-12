# Mouse Accuracy

A research platform for the Mouse Accuracy task, built as the foundation for
a future "Motor-Cognitive Dual-Task" experiment and other research
experiments beyond it.

## Running the app

```
npm install
npm start
```

Then open http://localhost:3000.

## Project layout

- `app/frontend/` - the browser-side experiment app (HTML/CSS/JS, ES modules).
- `app/backend/` - the Express server, routes, services, and data-export logic.
- `config/` - experiment/task configuration (not yet wired into the running
  app - see the comments in each file).
- `data/` - raw, processed, and exported research data (`data/exports/excel`
  holds `scores.xlsx`).
- `tests/` - test suites, organized by area (mouse, experiment, scoring,
  data, export). No test framework is set up yet.
- `docs/` - experiment protocol, data dictionary, developer guide, and
  export format documentation.
- `original/UF_OPS/` - an untouched copy of the original project, kept as a
  permanent reference.

## Current functionality

Three 2-minute mouse-accuracy sessions, each followed by a 90-second
recovery break, with results saved to an Excel workbook. This mirrors the
original application exactly; see `CHANGELOG.md` for what changed
structurally during the reorganization.

The dual-task (motor + serial-subtraction) experiment described in
`config/experimentConfig.js` has not been implemented yet.
