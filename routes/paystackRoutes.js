// routes/paystackRoutes.js
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { db } = require('../config/firebase');
const { notifyPaidExistingSubmission, mapSubmissionForEmail } = require('../controllers/submissionController');

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

async function _resendPaidSubmissionEmail(submissionId) {
  try {
    const subSnap = await db.collection('submissions').doc(submissionId).get();
    if (!subSnap.exists) return;
    await notifyPaidExistingSubmission(mapSubmissionForEmail(subSnap.data()));
  } catch (err) {
    console.error(`Pay Now confirmation email failed for ${submissionId}:`, err);
  }
}

// ── FIX: shared helper — only updates the submissions doc if it
// actually exists yet. For the Pricing-screen flow, submissionId is
// a temp reference (uid_timestamp) and no submissions doc exists at
// payment time — it only gets created later when Release Info submits.
// The old code called .update() unconditionally, which throws on a
// missing doc; that throw was silently swallowed by the outer
// try/catch and made the endpoint incorrectly report { paid: false }
// even though the payment had genuinely succeeded.
async function _markSubmissionPaidIfExists(submissionId) {
  const subRef = db.collection('submissions').doc(submissionId);
  const subSnap = await subRef.get();
  if (!subSnap.exists) {
    console.log(`No submissions doc yet for ${submissionId} (Pricing flow) — skipping status update.`);
    return false;
  }
  await subRef.update({
    status: 'Review',
    paid: 'Paid',
    paidAt: new Date(),
  });
  return true;
}

// STEP A: App/web calls this when user taps "Pay"
router.post('/create-payment', async (req, res) => {
  const { email, amountGHS, submissionId, uid, isExistingSubmission } = req.body;

  if (!email || !amountGHS || !submissionId) {
    return res.status(400).json({ error: 'Missing required payment fields' });
  }

  try {
    const amountInPesewas = Math.round(amountGHS * 100);

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: email,
        amount: amountInPesewas,
        currency: 'GHS',
        metadata: {
          submissionId: submissionId,
          uid: uid || '',
        },
      }),
    });

    const data = await response.json();

    if (!data.status || !data.data || !data.data.authorization_url) {
      console.error('Paystack init failed:', data);
      return res.status(502).json({ error: 'Paystack did not return a payment link' });
    }

    await db.collection('pendingPayments').doc(submissionId).set({
      reference: data.data.reference,
      uid: uid || '',
      email: email,
      amountGHS: amountGHS,
      paid: false,
      claimed: false,
      isExistingSubmission: isExistingSubmission === true,
      createdAt: new Date(),
    });

    res.json({
      paymentUrl: data.data.authorization_url,
      reference: data.data.reference,
    });
  } catch (err) {
    console.error('Paystack init error:', err);
    res.status(500).json({ error: 'Could not create payment link' });
  }
});

// STEP B: App/web calls this directly to ask Paystack "did this succeed?"
router.get('/verify-payment/:reference', async (req, res) => {
  const { reference } = req.params;

  try {
    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${reference}`,
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } }
    );

    const data = await response.json();
    const isPaid = data.status && data.data && data.data.status === 'success';

    if (isPaid) {
      const submissionId = data.data.metadata?.submissionId;
      if (submissionId) {
        const pendingSnap = await db.collection('pendingPayments').doc(submissionId).get();
        const isExistingSubmission = pendingSnap.exists && pendingSnap.data().isExistingSubmission === true;

        await db.collection('pendingPayments').doc(submissionId).update({
          paid: true,
          claimed: isExistingSubmission,
        });

        // ── FIX: guarded update instead of an unconditional one that
        // could throw and get swallowed, silently reporting paid:false.
        const updated = await _markSubmissionPaidIfExists(submissionId);

        if (isExistingSubmission && updated) {
          await _resendPaidSubmissionEmail(submissionId);
        }
      }
    }

    res.json({ paid: isPaid });
  } catch (err) {
    console.error('Paystack verify error:', err);
    res.status(500).json({ paid: false, error: 'Could not verify payment' });
  }
});

// STEP C: Paystack calls this automatically as a backup confirmation
router.post('/webhooks/paystack', async (req, res) => {
  let hash;
  try {
    hash = crypto.createHmac('sha512', PAYSTACK_SECRET_KEY).update(req.body).digest('hex');
  } catch (err) {
    console.error('Webhook signature computation failed:', err);
    return res.status(400).send('Invalid request body');
  }

  if (hash !== req.headers['x-paystack-signature']) {
    return res.status(401).send('Invalid signature');
  }

  let event;
  try {
    event = JSON.parse(req.body);
  } catch (err) {
    console.error('Webhook JSON parse failed:', err);
    return res.status(400).send('Invalid JSON');
  }

  res.sendStatus(200);

  if (event.event !== 'charge.success') return;

  try {
    const submissionId = event.data.metadata?.submissionId;
    if (!submissionId) {
      console.error('Webhook received charge.success with no submissionId in metadata');
      return;
    }

    const pendingSnap = await db.collection('pendingPayments').doc(submissionId).get();
    const isExistingSubmission = pendingSnap.exists && pendingSnap.data().isExistingSubmission === true;

    await db.collection('pendingPayments').doc(submissionId).update({
      paid: true,
      claimed: isExistingSubmission,
    });

    // ── FIX: same guarded update as verify-payment above.
    const updated = await _markSubmissionPaidIfExists(submissionId);

    if (isExistingSubmission && updated) {
      await _resendPaidSubmissionEmail(submissionId);
    }

    console.log(`Submission ${submissionId} processed via webhook (updated submissions doc: ${updated})`);
  } catch (err) {
    console.error('Webhook processing error:', err);
  }
});

module.exports = router;