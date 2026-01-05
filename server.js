require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const twilio = require('twilio');
const axios = require('axios');
const OAuthClient = require('intuit-oauth');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// --- 1. DATABASE CONNECTION (TiDB - Schema: test) ---
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'test',
    port: process.env.DB_PORT,
    ssl: { rejectUnauthorized: true }
});

// --- 2. API CLIENTS (Twilio & QuickBooks) ---
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const qboClient = new OAuthClient({
    clientId: process.env.QB_CLIENT_ID,
    clientSecret: process.env.QB_CLIENT_SECRET,
    environment: 'production',
    redirectUri: 'https://tdjakes.onrender.com/api/qb/callback'
});

// --- 3. AUTH MIDDLEWARE ---
const authenticate = (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: "Unauthorized: No token provided" });

    jwt.verify(token, 'KAULELA_SECRET_2026', (err, decoded) => {
        if (err) return res.status(403).json({ error: "Session expired" });
        req.userId = decoded.id;
        next();
    });
};

// ==========================================
// 4. USER REGISTRATION & R200 PAYMENT
// ==========================================
app.post('/api/auth/register', async (req, res) => {
    const { name, email, password } = req.body;
    try {
        const hash = await bcrypt.hash(password, 10);
        db.query("INSERT INTO users (full_name, email, password_hash) VALUES (?, ?, ?)", 
        [name, email, hash], (err, result) => {
            if (err) return res.status(500).json({ error: "Email already exists" });
            
            // PayFast R200 Setup
            const userId = result.insertId;
            const returnUrl = "https://zingy-bavarois-9517aa.netlify.app/";
            const payfastUrl = `https://www.payfast.co.za/eng/process?merchant_id=${process.env.PAYFAST_MERCHANT_ID}&merchant_key=${process.env.PAYFAST_MERCHANT_KEY}&amount=200.00&item_name=Kaulela_Law_Firm_Subscription&m_payment_id=${userId}&return_url=${returnUrl}&cancel_url=${returnUrl}`;
            
            res.json({ success: true, paymentUrl: payfastUrl });
        });
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    db.query("SELECT * FROM users WHERE email = ?", [email], async (err, results) => {
        if (results.length === 0) return res.status(404).json({ error: "User not found" });
        
        const valid = await bcrypt.compare(password, results[0].password_hash);
        if (!valid) return res.status(401).json({ error: "Invalid password" });

        const token = jwt.sign({ id: results[0].id }, 'KAULELA_SECRET_2026', { expiresIn: '24h' });
        res.json({ token, name: results[0].full_name, status: results[0].subscription_status });
    });
});

// ==========================================
// 5. LEGAL OPERATIONS (PROTECTED)
// ==========================================

// CONFLICT CHECKING
app.post('/api/legal/conflict-check', authenticate, (req, res) => {
    const { name } = req.body;
    const sql = "SELECT * FROM conflict_index WHERE user_id = ? AND entity_name LIKE ?";
    db.query(sql, [req.userId, `%${name}%`], (err, results) => {
        res.json({ conflict: results.length > 0, matches: results });
    });
});

// TRUST ACCOUNTING (LPC COMPLIANT)
app.post('/api/trust/transaction', authenticate, (req, res) => {
    const { matterId, amount, type, ref } = req.body;
    const sql = "INSERT INTO trust_accounting (user_id, matter_id, amount, transaction_type, client_ref) VALUES (?, ?, ?, ?, ?)";
    db.query(sql, [req.userId, matterId, amount, type, ref], (err, result) => {
        res.json({ success: true, auditId: result.insertId });
    });
});

// TWILIO SMS CLIENT MESSAGING
app.post('/api/sms/send', authenticate, async (req, res) => {
    const { to, message } = req.body;
    try {
        const sms = await twilioClient.messages.create({
            body: message,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: to
        });
        db.query("INSERT INTO sms_logs (user_id, client_phone, message) VALUES (?, ?, ?)", [req.userId, to, message]);
        res.json({ success: true, sid: sms.sid });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// QUICKBOOKS FINANCIAL REPORTS
app.get('/api/finance/reports/:type', authenticate, async (req, res) => {
    try {
        const url = `https://quickbooks.api.intuit.com/v3/company/${process.env.QB_REALM_ID}/reports/${req.params.type}`;
        const report = await axios.get(url, {
            headers: { 'Authorization': `Bearer ${process.env.QB_ACCESS_TOKEN}` }
        });
        res.json(report.data);
    } catch (err) { res.status(500).json({ error: "QuickBooks Sync Error" }); }
});

// ==========================================
// 6. PAYFAST WEBHOOK (ACTIVATE SUBSCRIPTION)
// ==========================================
app.post('/api/payments/notify', (req, res) => {
    const { m_payment_id, payment_status } = req.body;
    if (payment_status === 'COMPLETE') {
        db.query("UPDATE users SET subscription_status = 'active' WHERE id = ?", [m_payment_id]);
    }
    res.sendStatus(200);
});

// --- SERVER START ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Kaulela Enterprise running on ${PORT}`));