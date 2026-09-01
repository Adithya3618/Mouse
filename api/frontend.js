// Vercel entry point for serving ONLY the participant-facing frontend and
// its static config files - deliberately does NOT require server.js/
// appContext.js, so it never touches storageConfig.js, never opens a
// database, and never needs DATA_DIR/NODE_ENV storage configuration at
// all. This is what "Vercel may serve the frontend, but the research
// API/backend must use the persistent filesystem backend" (see
// docs/storage-architecture.md) means concretely: Vercel runs this file,
// which can only ever serve static files - it has no code path capable of
// reading or writing research data, so there is nothing here that could
// ever accidentally touch /tmp or any other ephemeral storage.
//
// The frontend's own API calls (see app/frontend/js/config/apiBaseUrl.js)
// are configured, at runtime, to point at wherever the real backend
// actually runs (a persistent server, or a securely tunneled local
// machine during the period before that server is available) - this file
// has no involvement in that at all, it just serves the HTML/CSS/JS and
// the plain-data /config/*.js files (experiment timing, mouse-task
// tuning - not participant data, not secrets, safe to serve from any
// origin).
//
// api/index.js (the full backend, unchanged) remains available separately
// for a deployment target that CAN provide persistent storage to a Vercel-
// style function - this file is specifically for the frontend-only,
// temporary-tunnel period.

const path = require('node:path');
const express = require('express');

const app = express();

app.use(express.static(path.join(__dirname, '../app/frontend')));
app.use('/config', express.static(path.join(__dirname, '../config')));

module.exports = app;
