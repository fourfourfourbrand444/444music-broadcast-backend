/**
 * middleware/auth.js
 *
 * Protects admin-only routes by checking a shared secret sent in the
 * "x-admin-secret" request header against ADMIN_SECRET in .env.
 *
 * This is intentionally simple (not full Firebase Auth token
 * verification) because this backend is a separate internal service
 * meant to be called only by you/your admin dashboard — not by
 * regular app users. It does NOT touch or replace your existing
 * Firebase Authentication system used on the main site.
 */

const logger = require('../utils/logger');

function requireAdminSecret(req, res, next) {
  const providedSecret = req.headers['x-admin-secret'];
  const expectedSecret = process.env.ADMIN_SECRET;

  if (!expectedSecret) {
    logger.error('ADMIN_SECRET is not set in environment variables. Rejecting all admin requests.');
    return res.status(500).json({
      success: false,
      message: 'Server misconfiguration: admin authentication is not set up.',
    });
  }

  if (!providedSecret) {
    return res.status(401).json({
      success: false,
      message: 'Missing "x-admin-secret" header.',
    });
  }

  if (providedSecret !== expectedSecret) {
    logger.warn(`Rejected admin request with invalid secret from IP: ${req.ip}`);
    return res.status(403).json({
      success: false,
      message: 'Invalid admin secret.',
    });
  }

  next();
}

module.exports = requireAdminSecret;