const express = require('express');
const path = require('path');
const exportsRouter = require('./routes/exports');

const app = express();
const PORT = 3000;

// Serve the frontend as static files.
app.use(express.static(path.join(__dirname, '../frontend')));

// Serve experiment/task configuration so the browser can fetch the same
// source-of-truth values used elsewhere (e.g. by tests). Not consumed by
// any page yet - added now so it's in place when the UI phase wires it up.
app.use('/config', express.static(path.join(__dirname, '../../config')));

app.use(express.json());

app.use(exportsRouter);

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
