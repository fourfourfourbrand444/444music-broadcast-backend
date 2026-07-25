/**
 * middleware/appAuth.js
 *
 * Protects app-facing routes (called by the 444Music Flutter app
 * itself, e.g. release-submission notifications) by checking a
 * shared secret sent in the "x-app-secret" request header against
 * APP_SECRET in .env.
 *
 * This is intentionally separate from middleware/auth.js
 * (requireAdminSecret). The admin secret protects the broadcast
 * dashboard and should never leave your machine/browser. This
 * secret, by contrast, is baked into the Flutter app itself (similar
 * to how the EmailJS public key was previously embedded in the app),
 * so it must be a DIFFERENT value — if it's ever extracted from the
 * compiled app, it should only be able to trigger submission
 * notifications, never broadcast to your whole user base.
 */

const logger = require('../utils/logger');

function requireAppSecret(req, res, next) {
  const providedSecret = req.headers['x-app-secret'];
  const expectedSecret = process.env.APP_SECRET;

  if (!expectedSecret) {
    logger.error('APP_SECRET is not set in environment variables. Rejecting all app requests.');
    return res.status(500).json({
      success: false,
      message: 'Server misconfiguration: app authentication is not set up.',
    });
  }

  if (!providedSecret) {
    return res.status(401).json({
      success: false,
      message: 'Missing "x-app-secret" header.',
    });
  }

  if (providedSecret !== expectedSecret) {
    logger.warn(`Rejected app request with invalid secret from IP: ${req.ip}`);
    return res.status(403).json({
      success: false,
      message: 'Invalid app secret.',
    });
  }

  next();
}

module.exports = requireAppSecret;