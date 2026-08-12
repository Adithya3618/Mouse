const express = require('express');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const excelFilePath = path.join(__dirname, 'scores.xlsx');

// Serve static files
app.use(express.static(__dirname));

app.use(express.json()); // to parse JSON payloads

app.post('/saveScore', async (req, res) => {
    const code = req.body.code;
    const name = req.body.name;
    
    const accuracy_s1 = req.body.accuracy_s1;
    const accuracy_s2 = req.body.accuracy_s2;
    const accuracy_s3 = req.body.accuracy_s3;
    const accuracy_F = req.body.accuracy_F;

    const targetEfficiency_s1 = req.body.targetEfficiency_s1;
    const targetEfficiency_s2 = req.body.targetEfficiency_s2;
    const targetEfficiency_s3 = req.body.targetEfficiency_s3;
    const targetEfficiency_F = req.body.targetEfficiency_F;


    const workbook = new ExcelJS.Workbook();

    // Check if the Excel file exists
    if (fs.existsSync(excelFilePath)) {
        await workbook.xlsx.readFile(excelFilePath);
    } else {
        const worksheet = workbook.addWorksheet('Scores');
        worksheet.addRow([
            'Name','Code', 'Date', 
            'Session 1 Accuracy', 'Session 1 TargetEfficiency',
            'Session 2 Accuracy', 'Session 2 TargetEfficiency',
            'Session 3 Accuracy', 'Session 3 TargetEfficiency',
            'Total Game Accuracy', 'Total Game TargetEfficiency'
    ])
    }

    const worksheet = workbook.getWorksheet('Scores');
    worksheet.addRow([name, code, new Date(),
        accuracy_s1, targetEfficiency_s1,
        accuracy_s2, targetEfficiency_s2,
        accuracy_s3, targetEfficiency_s3,
        accuracy_F, targetEfficiency_F
     ]);

    await workbook.xlsx.writeFile(excelFilePath);
    res.send('Score saved successfully!');
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
