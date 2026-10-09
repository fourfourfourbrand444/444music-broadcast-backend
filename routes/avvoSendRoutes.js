/**
 * routes/avvoSendRoutes.js
 *
 * Admin-only endpoints for sending a paid submission to AVVO.
 * Protected by requireAdminFirebase (Firebase login token + ADMIN_EMAILS).
 * Does NOT use x-app-secret or x-admin-secret.
 *
 *   POST /api/avvo-send/:id/send     start sending (runs in background)
 *   GET  /api/avvo-send/:id/preview  show what would be sent (calls nothing at AVVO)
 *
 * Progress is read from the submission itself (avvoSendState, avvoStatus,
 * avvoLastError), so there is no status endpoint.
 */
const express = require('express');
const requireAdminFirebase = require('../middleware/requireAdminFirebase');
const { startSend, previewPayload, AvvoSendError } = require('../services/avvoService');
const logger = require('../utils/logger');

const router = express.Router();

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function checkId(req, res, next) {
  if (!ID_PATTERN.test(String(req.params.id || ''))) {
    return res.status(400).json({ success: false, message: 'Invalid submission id.' });
  }
  next();
}

function handleError(err, req, res) {
  if (err instanceof AvvoSendError) {
    return res.status(err.httpStatus).json({ success: false, message: err.message });
  }
  logger.error(`[avvo-send] unexpected error: ${err && err.message ? err.message : err}`);
  return res.status(500).json({ success: false, message: 'Unexpected server error.' });
}

router.post('/:id/send', requireAdminFirebase, checkId, async (req, res) => {
  try {
    const result = await startSend(req.params.id, req.admin);
    return res.status(202).json({ success: true, ...result });
  } catch (err) {
    return handleError(err, req, res);
  }
});

router.get('/:id/preview', requireAdminFirebase, checkId, async (req, res) => {
  try {
    const result = await previewPayload(req.params.id);
    return res.json({ success: true, ...result });
  } catch (err) {
    return handleError(err, req, res);
  }
});

module.exports = router;
