const path = require('path');

// Loads .env (UF_NAVIGATOR_API_KEY, ADMIN_API_TOKEN, etc. - see
// .env.example) into process.env before anything below reads them. Must run
// before createAppContext() (which picks the transcription provider based
// on UF_NAVIGATOR_API_KEY) and before adminAuth.js reads ADMIN_API_TOKEN.
// Uses Node's own built-in loader (no `dotenv` dependency needed). Silently
// does nothing if .env doesn't exist - e.g. on a platform (Vercel) that
// injects environment variables directly rather than via a file.
try {
    process.loadEnvFile(path.join(__dirname, '../../.env'));
} catch (error) {
    if (error.code !== 'ENOENT') {
        throw error;
    }
}

const express = require('express');
const exportsRouter = require('./routes/exports');
const { createAppContext } = require('./appContext');
const { createRecordingsRouter } = require('./routes/recordings');
const { createAdminRouter } = require('./routes/admin');
const { adminAuth } = require('./routes/adminAuth');

const app = express();

// Serve the frontend as static files.
app.use(express.static(path.join(__dirname, '../frontend')));

// Serve experiment/task configuration so the browser can fetch the same
// source-of-truth values used elsewhere (e.g. by tests). Not consumed by
// any page yet - added now so it's in place when the UI phase wires it up.
app.use('/config', express.static(path.join(__dirname, '../../config')));

app.use(express.json());

app.use(exportsRouter);

// Cognitive-speech audio recording -> transcription -> scoring pipeline,
// and the research/admin dashboard API. See app/backend/appContext.js for
// how the database/storage/transcription-provider wiring is put together
// (SQLite for local dev/testing per that file's own documentation; swap the
// repository implementations there for a UF-approved persistent database
// before any real production deployment).
const appContext = createAppContext();
app.use(createRecordingsRouter(appContext));
app.use('/api/admin', adminAuth, createAdminRouter(appContext));

// The admin/research dashboard's static page shell (app/frontend/admin/) is
// already served at /admin/... by the app/frontend static mount above -
// it's just another subtree of the frontend. NOT participant-facing: it
// contains no data of its own, and every request it makes for actual
// participant/session data goes through the authenticated /api/admin/* API.

// Only bind a port when this file is run directly (`npm start` / `node
// app/backend/server.js`). When required by a serverless entry point
// (api/index.js, for Vercel) we just export the configured app and let the
// platform's Node runtime invoke it per-request instead.
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
}

module.exports = app;
