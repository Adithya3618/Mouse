# Changelog

## Unreleased

### Changed

- Reorganized the project from a flat `UF_OPS/` layout into a scalable
  `app/frontend` + `app/backend` architecture intended to support future
  research experiments (see `README.md`).
- Split the original monolithic `game.js` into focused modules under
  `app/frontend/js/` (`timer/`, `mouse/`, `experiment/`, `ui/`, `data/`),
  and the original `styles.css` into `styles.css`, `experiment.css`, and
  `mouse-task.css`.
- Split the original monolithic `server.js` into `app/backend/server.js`
  (app setup), `routes/exports.js` (the `/saveScore` endpoint), and
  `services/exportService.js` (the Excel read/write logic).
- Relocated `scores.xlsx` to `data/exports/excel/scores.xlsx`.
- Added `config/experimentConfig.js` and `config/mouseTaskConfig.js` as
  placeholders for future configuration (not yet wired in).
- Added placeholder modules/routes/services for future participant,
  session, cognitive-task, and database functionality. None of these are
  wired into the running application yet.

### Preserved

- All existing behavior: the 3-session mouse-accuracy task, scoring,
  timers, and Excel export work exactly as before.

## Original

The original, unmodified project is kept at `original/UF_OPS/` as a
permanent reference.
