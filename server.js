const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
require('dotenv').config();

const app = express();

// --- THE CORS FIX (Fixes Access Blocks) ---
app.use(cors({
    origin: '*', // Allows VSC Live Server or any frontend to connect
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- DATABASE CONNECTION (TiDB) ---
const db = mysql.createPool({
    host: 'gateway01.ap-southeast-1.prod.aws.tidbcloud.com', // Your TiDB Host
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'kaulela_db',
    port: 4000,
    ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }
});

// --- PAYFAST CONFIGURATION ---
const PF_DATA = {
    merchant_id: "32880521",
    merchant_key: "wfx9nr9j9cvlm",
    passphrase: "YOUR_PASSPHRASE", // Set this in your PayFast dashboard
    test_mode: true
};

// 1. REGISTRATION & SUBSCRIPTION INITIATION
app.post('/api/auth/register', (req, res) => {
    const { firmName, email, password } = req.body;
    
    // Logic: Save firm as 'pending', then generate PayFast URL
    const payfastData = {
        merchant_id: PF_DATA.merchant_id,
        merchant_key: PF_DATA.merchant_key,
        return_url: "http://localhost:5500/success.html",
        cancel_url: "http://localhost:5500/cancel.html",
        notify_url: "https://your-api.com/api/payfast/notify",
        name_first: firmName,
        email_address: email,
        m_payment_id: Date.now().toString(),
        amount: "450.00",
        item_name: "Kaulela System Monthly Subscription",
        subscription_type: "1", // Recurring
        frequency: "3" // Monthly
    };

    // Signature Generation (Crucial for PayFast)
    const signature = generateSignature(payfastData, PF_DATA.passphrase);
    payfastData.signature = signature;

    res.json({ 
        msg: "Registration successful. Redirect to PayFast.",
        payfast_url: PF_DATA.test_mode ? "https://sandbox.payfast.co.za/eng/process" : "https://www.payfast.co.za/eng/process",
        payload: payfastData 
    });
});

// 2. INTEGRATED API MODULES (eKhonector Logic)
app.post('/api/matters/create', async (req, res) => {
    // 1. Create Matter in TiDB
    // 2. Trigger QuickBooks API to open a Ledger
    // 3. Trigger Docusign API to send Mandate
    // 4. Trigger Twilio to notify Lawyer
    res.json({ status: "Success", message: "Matter initialized across all APIs." });
});

// 3. SEARCHWORKS INTEGRATION
app.get('/api/search/cipc/:regNum', async (req, res) => {
    // Use your SearchWorks keys to pull company data
    res.json({ company: "Kaulela Legal (Pty) Ltd", directors: ["Director A", "Director B"] });
});

// --- HELPER: PAYFAST SIGNATURE GENERATOR ---
function generateSignature(data, passPhrase) {
    let payload = "";
    for (let key in data) {
        if (data[key] !== "") payload += `${key}=${encodeURIComponent(data[key]).replace(/%20/g, "+")}&`;
    }
    payload = payload.slice(0, -1);
    if (passPhrase) payload += `&passphrase=${encodeURIComponent(passPhrase).replace(/%20/g, "+")}`;
    return crypto.createHash('md5').update(payload).digest('hex');
}

app.listen(5000, () => console.log('Kaulela Backend Server live on port 5000'));