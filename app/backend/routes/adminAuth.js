// Gates every /api/admin/* route behind a shared-secret bearer token
// (ADMIN_API_TOKEN, see .env.example). This app has no authentication at
// all today - a shared secret is a deliberate, documented placeholder for
// real institutional auth (e.g. UF Shibboleth/SSO) before this dashboard is
// used in production, not a final security design. If ADMIN_API_TOKEN is
// unset, the admin API refuses every request rather than silently allowing
// access to participant research data.

function adminAuth(req, res, next) {
    const configuredToken = process.env.ADMIN_API_TOKEN;
    if (!configuredToken) {
        res.status(503).json({ error: 'Admin API is not configured on this server (ADMIN_API_TOKEN is unset).' });
        return;
    }

    const header = req.headers.authorization || '';
    const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
    if (!provided || provided !== configuredToken) {
        res.status(401).json({ error: 'Unauthorized.' });
        return;
    }

    next();
}

module.exports = { adminAuth };
