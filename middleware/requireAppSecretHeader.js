/**
 * middleware/requireAppSecretHeader.js
 *
 * Checks the "x-app-secret" header against APP_SECRET on Render. This is the
 * same header the submissions admin page already sends for the rejection
 * email. It is self-contained, so it does not depend on any other file.
 */
const crypto = require('crypto');
const logger = require('../utils/logger');

const same = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function requireAppSecretHeader(req, res, next) {
  const expected = process.env.APP_SECRET;
  if (!expected) {
    logger.error('APP_SECRET is not set in environment variables. Rejecting request.');
    return res.status(500).json({ success: false, message: 'Server misconfiguration: APP_SECRET is not set.' });
  }
  const given = req.headers['x-app-secret'];
  if (!given) return res.status(401).json({ success: false, message: 'Missing "x-app-secret" header.' });
  if (!same(given, expected)) {
    logger.warn(`Rejected request with invalid app secret from IP: ${req.ip}`);
    return res.status(403).json({ success: false, message: 'Invalid app secret.' });
  }
  next();
}

module.exports = requireAppSecretHeader;
