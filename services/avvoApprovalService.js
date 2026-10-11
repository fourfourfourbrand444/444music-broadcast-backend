/**
 * services/avvoApprovalService.js
 *
 * Applies one AVVO webhook event to a submission.
 *
 * Render setting:
 *   AVVO_APPROVED_STATUSES  comma list of AVVO status words that mean "approve it",
 *                           for example: awaiting_release
 *                           Spaces, dashes and capitals do not matter ("Awaiting release" = awaiting_release).
 *                           Empty or missing = no release is ever approved by the webhook.
 */
const admin = require('firebase-admin');
const logger = require('../utils/logger');
const { sendApprovalEmail } = require('./approvalNotifyService');
const { deleteApprovedAudio } = require('./audioCleanup');
const { submissionIdFromPartnerReleaseId } = require('./avvoService');

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/[\s-]+/g, '_');
const approvedList = () => String(process.env.AVVO_APPROVED_STATUSES || '').split(',').map(norm).filter(Boolean);

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function uniqueSlug(db, title, artist, excludeId) {
  const base = slugify(`${title} ${artist}`) || 'release';
  let slug = base;
  for (let n = 2; n < 50; n++) {
    const snap = await db.collection('submissions').where('smartLinkSlug', '==', slug).limit(1).get();
    if (snap.empty || snap.docs[0].id === excludeId) return slug;
    slug = `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
}

async function handleAvvoEvent({ partnerReleaseId, status, upc }) {
  if (!partnerReleaseId) return { handled: false, reason: 'no_partner_release_id' };

  const db = admin.firestore();
  const id = submissionIdFromPartnerReleaseId(partnerReleaseId);
  const ref = db.collection('submissions').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return { handled: false, reason: 'submission_not_found' };
  const d = snap.data() || {};

  const update = {};
  if (status) {
    update.avvoStatus = String(status);
    update.avvoStatusAt = Date.now();
  }

  const shouldApprove =
    !!status &&
    approvedList().includes(norm(status)) &&
    String(d.status || '').trim().toLowerCase() === 'review';

  if (!shouldApprove) {
    if (Object.keys(update).length) await ref.update(update);
    return { handled: true, approved: false };
  }

  const finalUpc = String(upc || d.upc || '').trim();
  Object.assign(update, {
    status: 'Approved',
    rejectionReason: '',
    rejectionCategory: '',
    licenseProofUrl: '',
    takedownReason: '',
    approvedBy: 'avvo-webhook',
    approvedAt: Date.now(),
  });
  if (finalUpc) update.upc = finalUpc;
  if (!d.smartLinkSlug) {
    update.smartLinkSlug = await uniqueSlug(db, d.releaseTitle || d.songTitle || d.title || '', d.artistName || '', id);
  }
  await ref.update(update);
  logger.info(`[avvo-approval] ${id} approved by AVVO status "${status}".`);

  const result = { handled: true, approved: true, emailSent: false, audioDeleted: 0 };

  if (finalUpc) {
    try {
      const out = await sendApprovalEmail(id);
      result.emailSent = !!(out && out.success);
      if (!result.emailSent) logger.error(`[avvo-approval] ${id}: approval email failed: ${out && out.message}`);
    } catch (err) {
      logger.error(`[avvo-approval] ${id}: approval email error: ${err.message}`);
    }
  } else {
    result.note = 'no_upc_so_no_email';
    logger.warn(`[avvo-approval] ${id}: no UPC yet, approval email not sent.`);
  }

  try {
    const out = await deleteApprovedAudio(id);
    result.audioDeleted = out.deleted || 0;
  } catch (err) {
    logger.error(`[avvo-approval] ${id}: audio cleanup error: ${err.message}`);
  }
  return result;
}

module.exports = { handleAvvoEvent };
