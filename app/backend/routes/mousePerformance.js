// POST /api/mouse-performance - the participant app sends one mouse-active
// phase's complete click history here the moment that phase's mouse task
// finishes (see app/frontend/js/data/mouseDataUploadService.js). Validation,
// summary derivation, and storage live in services/mousePerformanceService.js.
//
// Idempotent per (session, phase): a retried or duplicated upload returns
// 200 with status "already_stored" and writes nothing.

const express = require('express');
const { MouseDataValidationError } = require('../services/mousePerformanceService');

// A 2-minute phase of fast clicking is still well under 1MB of JSON; this
// is a ceiling against abuse, not a tuned limit. Mounted ahead of the
// app-wide express.json() (100kb default) in server.js.
const MAX_BODY = '5mb';

function createMousePerformanceRouter({ mousePerformanceService, logger = console.error }) {
    const router = express.Router();

    router.post('/api/mouse-performance', express.json({ limit: MAX_BODY }), async (req, res) => {
        try {
            const result = await mousePerformanceService.persist(req.body);
            res.json(result);
        } catch (error) {
            if (error instanceof MouseDataValidationError) {
                res.status(error.status).json({ error: error.message });
                return;
            }
            logger(`[mouse-performance] failed to store mouse data: ${error.message}`);
            res.status(500).json({ error: 'Failed to store mouse data.' });
        }
    });

    return router;
}

module.exports = { createMousePerformanceRouter };
