require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const twilio = require('twilio');

const app = express();
app.use(cors());
app.use(express.json());

// Firebase Admin init
admin.initializeApp({
  // If running outside GCP, load a service account JSON:
  // credential: admin.credential.cert(require('./serviceAccount.json'))
});

// Twilio client
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const VERIFY_SID = process.env.TWILIO_VERIFY_SID;

// Health check route (for testing from Android or browser)
app.get('/', (req, res) => {
  res.send('✅ SIKAD OTP Server is running!');
});

// Start verification (send code via SMS or WhatsApp or Call)
app.post('/otp/start', async (req, res) => {
  try {
    const { phone, channel = 'sms' } = req.body;
    const v = await client.verify.v2.services(VERIFY_SID)
      .verifications.create({ to: phone, channel });
    res.json({ status: v.status }); // "pending"
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Check code + mark user verified (requires Firebase ID token)
app.post('/otp/check', async (req, res) => {
  try {
    const idToken = (req.headers.authorization || '').replace('Bearer ', '');
    const { phone, code } = req.body;

    // Verify Firebase session
    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;

    // Check Twilio code
    const check = await client.verify.v2.services(VERIFY_SID)
      .verificationChecks.create({ to: phone, code });

    if (check.status === 'approved') {
      // Mark user in Firestore
      const db = admin.firestore();
      await db.collection('users').doc(uid).set(
        {
          phoneNumber: phone,
          phoneVerified: true,
          phoneVerifiedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      // OPTIONAL: add a custom claim as well
      const user = await admin.auth().getUser(uid);
      const existing = user.customClaims || {};
      await admin.auth().setCustomUserClaims(uid, { ...existing, phoneVerified: true });

      return res.json({ ok: true });
    }
    res.status(400).json({ ok: false, status: check.status });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Use Render's dynamic PORT (fallback to 8080 locally)
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`✅ SIKAD OTP Server running on port ${PORT}`));
