/**
 * routes/r2AudioRoutes.js
 *
 *   POST /api/audio/upload-url   signed-in user: link to upload one WAV
 *   GET  /api/audio/play-url     owner or admin: link to play a stored WAV
 *
 * Login: Authorization: Bearer <Firebase ID token>. No shared secret.
 * Admins are the emails in ADMIN_EMAILS (same list as the AVVO route).
 */
const express = require('express');
const admin = require('firebase-admin');
const logger = require('../utils/logger');
const { isAudioKey, createUploadUrl, createReadUrl } = require('../services/r2Audio');

const router = express.Router();
const MAX_AUDIO_BYTES = 120 * 1024 * 1024;

function adminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

async function requireUser(req, res, next) {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!match) {
    return res.status(401).json({ success: false, message: 'Missing login token.' });
  }
  if (!admin.apps.length) {
    return res.status(500).json({ success: false, message: 'Server misconfiguration: Firebase Admin is not ready.' });
  }
  try {
    const decoded = await admin.auth().verifyIdToken(match[1]);
    const email = String(decoded.email || '').toLowerCase();
    req.user = { uid: decoded.uid, email, isAdmin: adminEmails().includes(email) };
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Login expired. Sign in again.' });
  }
}

router.post('/upload-url', requireUser, async (req, res) => {
  try {
    const { contentType, size } = req.body || {};
    if (!/^audio\/(wav|x-wav|wave)$/i.test(String(contentType || ''))) {
      return res.status(400).json({ success: false, message: 'Only WAV audio can be uploaded.' });
    }
    const bytes = Number(size);
    if (!Number.isFinite(bytes) || bytes <= 0 || bytes > MAX_AUDIO_BYTES) {
      return res.status(400).json({ success: false, message: 'File size must be between 1 byte and 120 MB.' });
    }
    const result = await createUploadUrl(req.user.uid);
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error(`[r2-audio] upload-url failed: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Could not create upload link.' });
  }
});

router.get('/play-url', requireUser, async (req, res) => {
  try {
    const key = String(req.query.key || '');
    if (!isAudioKey(key)) {
      return res.status(400).json({ success: false, message: 'Invalid audio key.' });
    }
    const isOwner = key.startsWith(`audio/${req.user.uid}/`);
    if (!isOwner && !req.user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Not allowed.' });
    }
    const url = await createReadUrl(key);
    return res.json({ success: true, url, expiresIn: 3600 });
  } catch (err) {
    logger.error(`[r2-audio] play-url failed: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Could not create play link.' });
  }
});

module.exports = router;
