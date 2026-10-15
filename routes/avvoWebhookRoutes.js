/**
 * routes/avvoWebhookRoutes.js
 *
 * Receives webhook calls from AVVO Music (POST /api/avvo/webhook).
 *
 * WHAT IT DOES
 *  - Stays OFF until AVVO_ENABLED=true is set on Render.
 *  - Verifies AVVO's signature exactly as their docs describe:
 *      HMAC-SHA256( secret, "<X-AVVO-Timestamp>.<raw body>" ) as hex,
 *      compared with the X-AVVO-Signature header.
 *    Calls older (or newer) than 5 minutes are rejected.
 *  - Saves each event as ONE Firestore write in "avvoWebhookEvents".
 *    The AVVO event id is the document id, so a retried delivery
 *    overwrites the same document instead of duplicating.
 *  - Answers 200 right after saving (AVVO retries anything that is not 2xx).
 *  - Then applies the event to the submission (approve / reject) through
 *    services/avvoApprovalService.js, passing AVVO's moderation comment
 *    (data.moderation.comment) so a rejection shows AVVO's real reason.
 *
 * ENVIRONMENT VARIABLES (Render)
 *  AVVO_ENABLED         true / anything else = off
 *  AVVO_WEBHOOK_SECRET  the secret you gave to AVVO
 *
 * Needs express.raw() mounted on this path in server.js (already done
 * there) so the signature is checked against the untouched body.
 */
const express = require('express');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { handleAvvoEvent } = require('../services/avvoApprovalService');

const router = express.Router();

const MAX_AGE_SECONDS = 300; // AVVO's recommended tolerance

function safeEqual(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

function verifySignature(headers, rawBody, secret) {
  const ts = headers['x-avvo-timestamp'];
  const signature = headers['x-avvo-signature'];
  if (!ts || !signature) return false;

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;
  if (Math.abs(Date.now() / 1000 - tsNum) > MAX_AGE_SECONDS) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${ts}.${rawBody.toString('utf8')}`)
    .digest('hex');

  const given = String(signature).trim().replace(/^sha256=/i, '').toLowerCase();
  return safeEqual(expected, given);
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

  if (!verifySignature(req.headers, rawBody, secret)) {
    logger.warn('AVVO webhook: rejected a call with a bad, missing or expired signature.');
    return res.status(401).json({ success: false, message: 'Unauthorized.' });
  }

  const text = rawBody.toString('utf8');
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { parsed = null; }

  const obj = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  const data = obj.data && typeof obj.data === 'object' ? obj.data : {};
  const eventType = String(obj.event || req.headers['x-avvo-event'] || 'unknown');
  const eventId = obj.id || null;

  // AVVO's reason for returning a release: data.moderation.comment
  const moderation = data.moderation && typeof data.moderation === 'object' ? data.moderation : {};
  const moderationComment = moderation.comment ? String(moderation.comment) : '';

  let eventRef = null;

  try {
    const admin = require('firebase-admin');
    const col = admin.firestore().collection('avvoWebhookEvents');
    const record = {
      eventType,
      eventId: eventId ? String(eventId) : null,
      deliveryId: String(req.headers['x-avvo-delivery'] || ''),
      releaseId: data.release_id ? String(data.release_id) : null,
      partnerReleaseId: data.partner_release_id ? String(data.partner_release_id) : null,
      status: data.status ? String(data.status) : null,
      upc: data.upc ? String(data.upc) : null,
      payloadJson: text.slice(0, 100000), // stored as text so any shape is accepted
      receivedAt: Date.now(),
      processed: false,
    };
    if (eventId) {
      eventRef = col.doc(String(eventId).replace(/[\/\s]/g, '_').slice(0, 200));
      await eventRef.set(record);
    } else {
      eventRef = await col.add(record);
    }
    logger.info(`AVVO webhook: saved event "${eventType}".`);
  } catch (err) {
    logger.error(`AVVO webhook: could not save event: ${err.message}`);
    // Non-2xx so AVVO retries the delivery.
    return res.status(500).json({ success: false, message: 'Could not save event.' });
  }

  res.status(200).json({ success: true });

  // AVVO has its 200 already. Now update the submission; problems are logged and saved on the event.
  try {
    const out = await handleAvvoEvent({
      partnerReleaseId: data.partner_release_id,
      status: data.status,
      upc: data.upc,
      moderationComment,
    });
    if (eventRef) await eventRef.update({ processed: true, processedAt: Date.now(), result: JSON.stringify(out).slice(0, 500) });
  } catch (err) {
    logger.error(`AVVO webhook: could not apply event: ${err.message}`);
    if (eventRef) await eventRef.update({ processError: String(err.message).slice(0, 300) }).catch(() => {});
  }
  return;
});

module.exports = router;
