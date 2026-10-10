/**
 * routes/approvalCleanupRoutes.js
 *   POST /api/approval-cleanup/:id    admin only (Firebase login + ADMIN_EMAILS)
 */
const express = require('express');
const requireAdminFirebase = require('../middleware/requireAdminFirebase');
const { deleteApprovedAudio } = require('../services/audioCleanup');
const logger = require('../utils/logger');

const router = express.Router();
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MESSAGES = {
  not_found: [404, 'Submission not found.'],
  not_approved: [409, 'This release is not Approved, so its audio was kept.'],
  sending: [409, 'This release is being sent to AVVO right now. Try again in a minute.'],
  delete_failed: [502, 'Could not delete the audio from R2. Try again.'],
};

router.post('/:id', requireAdminFirebase, async (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!ID_PATTERN.test(id)) return res.status(400).json({ success: false, message: 'Invalid submission id.' });
    const out = await deleteApprovedAudio(id);
    if (!out.ok) {
      const [status, message] = MESSAGES[out.reason] || [500, 'Unexpected error.'];
      return res.status(status).json({ success: false, message });
    }
    return res.json({ success: true, deleted: out.deleted });
  } catch (err) {
    logger.error(`[approval-cleanup] unexpected error: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Unexpected server error.' });
  }
});

module.exports = router;
