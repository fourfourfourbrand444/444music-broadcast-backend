/**
 * routes/submissionDeleteRoutes.js
 *
 *   DELETE /api/submission-delete/:id        admin only
 *   DELETE /api/submission-delete/:id?force=1  also when already sent to AVVO
 *
 * Deletes the R2 audio files first, then the submission record.
 * If a file cannot be deleted, the record is kept so the links are not lost.
 */
const express = require('express');
const admin = require('firebase-admin');
const requireAdminFirebase = require('../middleware/requireAdminFirebase');
const { isAudioKey, deleteKeys } = require('../services/r2Audio');
const logger = require('../utils/logger');

const router = express.Router();
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function r2KeysOf(data) {
  const keys = [];
  (Array.isArray(data.audioFiles) ? data.audioFiles : []).forEach((f) => {
    const u = f && typeof f.url === 'string' ? f.url : '';
    if (u.startsWith('r2:') && isAudioKey(u.slice(3))) keys.push(u.slice(3));
  });
  return keys;
}

router.delete('/:id', requireAdminFirebase, async (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!ID_PATTERN.test(id)) {
      return res.status(400).json({ success: false, message: 'Invalid submission id.' });
    }

    const ref = admin.firestore().collection('submissions').doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ success: false, message: 'Submission not found.' });
    }
    const data = snap.data() || {};

    if (data.avvoSendState === 'sending') {
      return res.status(409).json({ success: false, message: 'This release is being sent to AVVO right now. Try again in a minute.' });
    }
    if (data.avvoReleaseId && req.query.force !== '1') {
      return res.status(409).json({
        success: false,
        code: 'AVVO_SENT',
        message: 'This release was already sent to AVVO. Deleting it here does not remove it from AVVO.',
      });
    }

    const keys = r2KeysOf(data);
    const result = await deleteKeys(keys);
    if (result.failed.length) {
      logger.error(`[submission-delete] ${id}: could not delete ${result.failed.length} file(s).`);
      return res.status(502).json({ success: false, message: 'Could not delete the audio files from R2, so the submission was kept. Try again.' });
    }

    await ref.delete();
    logger.info(`[submission-delete] ${req.admin.email} deleted ${id} (${result.deleted.length} R2 file(s)).`);
    return res.json({ success: true, filesDeleted: result.deleted.length });
  } catch (err) {
    logger.error(`[submission-delete] unexpected error: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Unexpected server error.' });
  }
});

module.exports = router;
