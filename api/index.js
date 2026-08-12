// Vercel serverless entry point. Reuses the exact same Express app that
// `npm start` runs locally (app/backend/server.js) - no route, middleware,
// or static-serving logic is duplicated here. Vercel's Node runtime calls
// the exported Express app as a request handler on every invocation.
module.exports = require('../app/backend/server.js');
