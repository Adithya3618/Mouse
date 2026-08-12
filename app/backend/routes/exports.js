const express = require('express');
const { saveScore, buildSessionResultsWorkbook, buildSessionResultsFilename } = require('../services/exportService');

const router = express.Router();

// Preserves the original endpoint path/contract used by
// app/frontend/js/data/sessionData.js.
router.post('/saveScore', async (req, res) => {
    await saveScore(req.body);
    res.send('Score saved successfully!');
});

// Generates and streams a fresh .xlsx workbook for one completed dual-task
// session. The browser sends the session it already holds in memory (see
// data/dataFormatter.js#formatSessionForExport) - nothing is read from or
// written to disk here, so this can never collide with or overwrite
// data/exports/excel/scores.xlsx.
router.post('/exportSessionResults', async (req, res) => {
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
