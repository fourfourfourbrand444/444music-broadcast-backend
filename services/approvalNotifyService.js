/**
 * services/approvalNotifyService.js
 *
 * Sends the "release approved" email through SendPulse.
 *
 * The admin page only sends a submission ID. Everything in the email (name,
 * song, UPC, catalog number, address) is read from Firestore here, so the
 * endpoint can only email the real owner of a submission that is Approved.
 * Cost: one Firestore read per email.
 *
 * sendApprovalEmail(submissionId) -> { success, email? , status?, message? }
 */
const admin = require('firebase-admin');
const { sendEmail } = require('./sendpulseProvider');
const { renderApprovalEmail } = require('./approvalEmailTemplate');
const logger = require('../utils/logger');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function sendApprovalEmail(submissionId) {
  if (!admin.apps.length) {
    return { success: false, status: 500, message: 'Firebase Admin is not ready.' };
  }

  const snap = await admin.firestore().collection('submissions').doc(submissionId).get();
  if (!snap.exists) return { success: false, status: 404, message: 'Submission not found.' };

  const s = snap.data();
  if (String(s.status || '').toLowerCase() !== 'approved') {
    return { success: false, status: 409, message: 'This submission is not approved.' };
  }

  const email = String(s.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return { success: false, status: 422, message: 'No valid email on this submission.' };
  }

  const { subject, html, text } = renderApprovalEmail({
    name: s.artistName,
    releaseTitle: s.releaseTitle || s.songTitle || s.title,
    upc: s.upc,
    catalogNumber: s.catalogNumber,
  });

  try {
    const out = await sendEmail({ to: email, subject, html, text });
    if (out && out.success) return { success: true, email };
    const why = out && out.error ? (out.error.message || String(out.error)) : 'Send failed';
    logger.warn(`Approval email to ${email} failed: ${why}`);
    return { success: false, status: 502, message: why };
  } catch (err) {
    logger.error(`Approval email to ${email} crashed: ${err.message}`);
    return { success: false, status: 502, message: err.message };
  }
}

module.exports = { sendApprovalEmail };
