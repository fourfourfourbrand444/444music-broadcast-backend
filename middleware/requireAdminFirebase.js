/**
 * middleware/requireAdminFirebase.js
 *
 * Protects admin routes that are called from a web page (like the
 * Earnings Manager) without putting any secret in the page.
 *
 * The page sends the admin's Firebase login token:
 *   Authorization: Bearer <Firebase ID token>
 * This checks the token with Firebase Admin and only lets through the
 * emails listed in ADMIN_EMAILS (comma separated) on Render.
 *
 * It does NOT replace middleware/auth.js. The existing x-admin-secret
 * routes keep working exactly as before.
 */
const admin = require('firebase-admin');
const logger = require('../utils/logger');

function allowedEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

async function requireAdminFirebase(req, res, next) {
  const allowed = allowedEmails();
  if (!allowed.length) {
    logger.error('ADMIN_EMAILS is not set in environment variables. Rejecting admin request.');
    return res.status(500).json({
      success: false,
      message: 'Server misconfiguration: ADMIN_EMAILS is not set.',
    });
  }

  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!match) {
    return res.status(401).json({ success: false, message: 'Missing login token.' });
  }

  if (!admin.apps.length) {
    logger.error('Firebase Admin is not initialised, cannot verify login token.');
    return res.status(500).json({
      success: false,
      message: 'Server misconfiguration: Firebase Admin is not ready.',
    });
  }

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(match[1]);
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Login expired. Sign in again.' });
  }

  const email = String(decoded.email || '').toLowerCase();
  if (!allowed.includes(email)) {
    logger.warn(`Rejected admin request from non-admin account ${email || decoded.uid} (IP: ${req.ip}).`);
    return res.status(403).json({ success: false, message: 'This account is not an admin.' });
  }

  req.admin = { uid: decoded.uid, email };
  next();
}

module.exports = requireAdminFirebase;
