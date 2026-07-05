/**
 * middleware/rateLimiter.js
 *
 * Two rate limiters:
 * 1. generalLimiter — applies to all /api/admin/* routes as a baseline
 *    safety net against accidental hammering (e.g. a broken frontend
 *    loop, or someone poking the API with Postman).
 * 2. broadcastLimiter — stricter limit applied ONLY to the
 *    POST /api/admin/broadcast route, since sending a campaign is the
 *    most expensive/dangerous action (mass emails). Prevents someone
 *    from accidentally firing off multiple full broadcasts in a short
 *    window.
 */

const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per IP per window across all admin routes
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please wait a few minutes and try again.',
  },
  handler: (req, res, next, options) => {
    logger.warn(`General rate limit hit by IP: ${req.ip} on ${req.originalUrl}`);
    res.status(options.statusCode).json(options.message);
  },
});

const broadcastLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // only 5 broadcast attempts per IP per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Broadcast limit reached. You can only send a few campaigns per hour. Please wait before trying again.',
  },
  handler: (req, res, next, options) => {
    logger.warn(`Broadcast rate limit hit by IP: ${req.ip}`);
    res.status(options.statusCode).json(options.message);
  },
});

module.exports = { generalLimiter, broadcastLimiter };