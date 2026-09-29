const express = require('express');
const { saveScore, buildSessionResultsWorkbook, buildSessionResultsFilename } = require('../services/exportService');

const router = express.Router();

// Each route parses its own JSON (server.js mounts this router ahead of the
// app-wide express.json()) so the session export can carry every phase's
// click history, which can exceed the 100kb default.
const SESSION_EXPORT_BODY_LIMIT = '10mb';

// Preserves the original endpoint path/contract used by
// app/frontend/js/data/sessionData.js.
router.post('/saveScore', express.json(), async (req, res) => {
    await saveScore(req.body);
    res.send('Score saved successfully!');
});

// Generates and streams a fresh .xlsx workbook for one completed dual-task
// session. The browser sends the session it already holds in memory (see
// data/dataFormatter.js#formatSessionForExport) - nothing is read from or
// written to disk here, so this can never collide with or overwrite
// data/exports/excel/scores.xlsx. This route is participant-facing and
// unauthenticated, so it deliberately never reads stored research data by
// session id; the click history it exports is the same data the browser
// uploaded to /api/mouse-performance, summarised by the same shared code.
router.post('/exportSessionResults', express.json({ limit: SESSION_EXPORT_BODY_LIMIT }), async (req, res) => {
    const formattedSession = req.body;

    if (!formattedSession || !Array.isArray(formattedSession.phases) || formattedSession.phases.length === 0) {
        res.status(400).send('No session data provided.');
        return;
    }

    const buffer = await buildSessionResultsWorkbook(formattedSession);
    const filename = buildSessionResultsFilename(formattedSession);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
});

module.exports = router;
