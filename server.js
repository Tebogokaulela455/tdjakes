require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const twilio = require('twilio');
const axios = require('axios');
const OAuthClient = require('intuit-oauth');

const app = express();
app.use(cors({ origin: '*' })); 
app.use(express.json());

// --- DATABASE CONNECTION (TiDB) ---
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    ssl: { rejectUnauthorized: true }
});

// --- QUICKBOOKS CONFIG ---
const qboClient = new OAuthClient({
    clientId: process.env.QB_CLIENT_ID,
    clientSecret: process.env.QB_CLIENT_SECRET,
    environment: 'production',
    redirectUri: 'http://localhost:5000/api/qb/callback'
});

// --- TWILIO NOTIFICATIONS ---
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
app.post('/api/notify', (req, res) => {
    twilioClient.messages.create({
        body: req.body.text,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: req.body.to
    })
    .then(msg => res.json({ success: true, sid: msg.sid }))
    .catch(err => res.status(500).json({ error: err.message }));
});

// --- FINANCIAL & PAYROLL FEATURES ---

app.get('/api/finance/reports/:type', async (req, res) => {
    const { type } = req.params; 
    try {
        const url = `https://quickbooks.api.intuit.com/v3/company/${process.env.QB_REALM_ID}/reports/${type}`;
        const report = await axios.get(url, {
            headers: { 'Authorization': `Bearer ${process.env.QB_ACCESS_TOKEN}` }
        });
        res.json(report.data);
    } catch (err) { 
        res.status(500).json({ error: "QuickBooks Reporting Error" }); 
    }
});

app.post('/api/finance/payroll', async (req, res) => {
    try {
        const payrollData = req.body; 
        const response = await axios.post(`https://quickbooks.api.intuit.com/v3/company/${process.env.QB_REALM_ID}/employee`, payrollData, {
            headers: { 'Authorization': `Bearer ${process.env.QB_ACCESS_TOKEN}` }
        });
        res.json({ status: "Payroll Processed", data: response.data });
    } catch (err) { 
        res.status(500).json({ error: "Payroll Sync Failed" }); 
    }
});

// --- CORE LEGAL FEATURES ---

app.post('/api/legal/conflict-check', (req, res) => {
    const { name } = req.body;
    const sql = "SELECT * FROM conflict_index WHERE entity_name LIKE ?";
    db.query(sql, [`%${name}%`], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length > 0) {
            res.json({ conflict: true, matches: results, warning: "Potential Conflict of Interest Found!" });
        } else {
            res.json({ conflict: false, message: "Clear to proceed." });
        }
    });
});

app.post('/api/trust/deposit', (req, res) => {
    const { matterId, amount, clientRef } = req.body;
    const sql = "INSERT INTO trust_accounting (matter_id, amount, transaction_type, client_ref) VALUES (?, ?, 'deposit', ?)";
    db.query(sql, [matterId, amount, clientRef], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ status: "Trust Funds Secured", audit_id: result.insertId });
    });
});

app.post('/api/crm/leads', (req, res) => {
    const { leadName, contact, source } = req.body;
    db.query("INSERT INTO leads (name, contact, source) VALUES (?, ?, ?)", [leadName, contact, source], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ status: "New Lead Captured" });
    });
});

// --- START SERVER (CONSOLIDATED) ---
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
    console.log(`Kaulela Enterprise Hub running on port ${PORT}`);
});

// Handle EADDRINUSE errors
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Please check for zombie processes.`);
    } else {
        console.error(err);
    }
});