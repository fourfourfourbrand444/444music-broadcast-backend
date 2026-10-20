/**
 * routes/approvalCleanupRoutes.js
 *   POST /api/approval-cleanup/:id            admin only (Firebase login + ADMIN_EMAILS)
 *   POST /api/approval-cleanup/rejected/:id   admin only, deletes audio of a Rejected release
 */
const express = require('express');
const requireAdminFirebase = require('../middleware/requireAdminFirebase');
const { deleteApprovedAudio, deleteRejectedAudio } = require('../services/audioCleanup');
const logger = require('../utils/logger');

const router = express.Router();
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MESSAGES = {
  not_found: [404, 'Submission not found.'],
  not_approved: [409, 'This release is not Approved, so its audio was kept.'],
  not_rejected: [409, 'This release is not Rejected, so its audio was kept.'],
  sending: [409, 'This release is being sent to AVVO right now. Try again in a minute.'],
  delete_failed: [502, 'Could not delete the audio from R2. Try again.'],
};

function makeHandler(label, deleteFn) {
  return async (req, res) => {
    try {
      const id = String(req.params.id || '');
      if (!ID_PATTERN.test(id)) return res.status(400).json({ success: false, message: 'Invalid submission id.' });
      const out = await deleteFn(id);
      if (!out.ok) {
        const [status, message] = MESSAGES[out.reason] || [500, 'Unexpected error.'];
        return res.status(status).json({ success: false, message });
      }
      return res.json({ success: true, deleted: out.deleted });
    } catch (err) {
      logger.error(`[${label}] unexpected error: ${err.message}`);
      return res.status(500).json({ success: false, message: 'Unexpected server error.' });
    }
  };
}

router.post('/rejected/:id', requireAdminFirebase, makeHandler('rejection-cleanup', deleteRejectedAudio));
router.post('/:id', requireAdminFirebase, makeHandler('approval-cleanup', deleteApprovedAudio));

module.exports = router;
