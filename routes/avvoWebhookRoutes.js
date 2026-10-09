/**
 * routes/avvoWebhookRoutes.js
 *
 * Receives webhook calls from AVVO Music (POST /api/avvo/webhook).
 *
 * FIRST VERSION — what it does:
 *  - Stays OFF until AVVO_ENABLED=true is set on Render.
 *  - Checks the secret (AVVO_WEBHOOK_SECRET). It accepts either a plain
 *    secret header or an HMAC-SHA256 signature of the raw body, because
 *    we don't know AVVO's exact method yet. Tighten this once their
 *    docs arrive.
 *  - Saves each event as ONE Firestore write in "avvoWebhookEvents".
 *    No reads. If the event has an id, it is used as the document id,
 *    so a repeated delivery overwrites instead of duplicating.
 *  - Does NOT touch submissions, users or emails yet.
 *
 * Needs express.raw() mounted on this path in server.js (already done
 * there) so the signature can be checked against the untouched body.
 */
const express = require('express');
const crypto = require('crypto');
const logger = require('../utils/logger');

const router = express.Router();

function safeEqual(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

function isValid(req, rawBody, secret) {
  const h = req.headers;

  // Option A: the secret is sent as-is in a header.
  const plain = [
    h['x-webhook-secret'],
    h['x-avvo-secret'],
    (h.authorization || '').replace(/^Bearer\s+/i, ''),
  ].filter(Boolean);
  if (plain.some((v) => safeEqual(v, secret))) return true;

  // Option B: HMAC-SHA256 signature of the raw body (hex or base64).
  const sig = h['x-avvo-signature'] || h['x-webhook-signature'] || h['x-signature'];
  if (sig) {
    const given = String(sig).replace(/^sha256=/i, '').trim();
    const hex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const b64 = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
    if (safeEqual(given.toLowerCase(), hex) || safeEqual(given, b64)) return true;
  }

  return false;
}

// Simple check that the address is alive (some services ping it with GET).
router.get('/', (req, res) => {
  res.status(200).json({ ok: true });
});

router.post('/', async (req, res) => {
  if (process.env.AVVO_ENABLED !== 'true') {
    return res.status(503).json({ success: false, message: 'AVVO integration is switched off.' });
  }

  const secret = process.env.AVVO_WEBHOOK_SECRET;
  if (!secret) {
    logger.error('AVVO webhook: AVVO_WEBHOOK_SECRET is not set.');
    return res.status(500).json({ success: false, message: 'Webhook is not configured.' });
  }

  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

  if (!isValid(req, rawBody, secret)) {
    logger.warn('AVVO webhook: rejected a call with a missing or wrong secret/signature.');
    return res.status(401).json({ success: false, message: 'Unauthorized.' });
  }

  const text = rawBody.toString('utf8');
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { parsed = null; }

  const obj = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  const eventType = String(obj.event || obj.type || obj.eventType || 'unknown');
  const eventId = obj.id || obj.eventId || obj.event_id || null;

  try {
    const admin = require('firebase-admin');
    const col = admin.firestore().collection('avvoWebhookEvents');
    const record = {
      eventType,
      payloadJson: text.slice(0, 100000), // stored as text so any shape is accepted
      receivedAt: Date.now(),
      processed: false,
    };
    if (eventId) {
      await col.doc(String(eventId).replace(/[\/\s]/g, '_').slice(0, 200)).set(record);
    } else {
      await col.add(record);
    }
    logger.info(`AVVO webhook: saved event "${eventType}".`);
  } catch (err) {
    logger.error(`AVVO webhook: could not save event: ${err.message}`);
    // Non-200 so AVVO retries the delivery.
    return res.status(500).json({ success: false, message: 'Could not save event.' });
  }

  return res.status(200).json({ success: true });
});

module.exports = router;
