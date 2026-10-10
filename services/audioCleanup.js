/**
 * services/audioCleanup.js
 *
 * Deletes the R2 WAV files of an APPROVED submission and marks it audioDeleted.
 * Never touches releases that are not Approved (Review, Pending, Rejected keep their files).
 * Used by: the admin page (manual and bulk approve) and, later, the AVVO webhook.
 */
const admin = require('firebase-admin');
const { isAudioKey, deleteKeys } = require('./r2Audio');
const logger = require('../utils/logger');

async function deleteApprovedAudio(submissionId) {
  const ref = admin.firestore().collection('submissions').doc(submissionId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, reason: 'not_found' };
  const d = snap.data() || {};
  if (String(d.status || '').trim().toLowerCase() !== 'approved') return { ok: false, reason: 'not_approved' };
  if (d.avvoSendState === 'sending') return { ok: false, reason: 'sending' };

  const keys = [];
  (Array.isArray(d.audioFiles) ? d.audioFiles : []).forEach((f) => {
    const u = f && typeof f.url === 'string' ? f.url : '';
    if (u.startsWith('r2:') && isAudioKey(u.slice(3))) keys.push(u.slice(3));
  });
  if (!keys.length) return { ok: true, deleted: 0 };

  const result = await deleteKeys(keys);
  if (result.failed.length) {
    logger.error(`[audio-cleanup] ${submissionId}: could not delete ${result.failed.length} file(s).`);
    return { ok: false, reason: 'delete_failed' };
  }
  await ref.update({ audioDeleted: true, audioDeletedAt: Date.now() });
  logger.info(`[audio-cleanup] ${submissionId}: deleted ${result.deleted.length} WAV file(s) after approval.`);
  return { ok: true, deleted: result.deleted.length };
}

module.exports = { deleteApprovedAudio };
