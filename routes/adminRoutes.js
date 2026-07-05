/**
 * routes/adminRoutes.js
 *
 * Maps the 6 admin endpoints to their controller functions, and
 * applies middleware in this order for every route:
 *   1. requireAdminSecret   (auth)
 *   2. generalLimiter        (baseline rate limit, applied to whole router)
 *   3. validators             (per-route body/param validation)
 *   4. broadcastLimiter       (extra strict limit, only on the broadcast route)
 *
 * asyncHandler wraps every controller function so thrown errors or
 * rejected promises flow to errorHandler.js instead of crashing the
 * server or hanging the request.
 */

const express = require('express');
const router = express.Router();

const requireAdminSecret = require('../middleware/auth');
const { generalLimiter, broadcastLimiter } = require('../middleware/rateLimiter');
const {
  validateBroadcast,
  validateTestEmail,
  validateCampaignId,
} = require('../middleware/validators');
const asyncHandler = require('../utils/asyncHandler');

const broadcastController = require('../controllers/broadcastController');

// Every route below requires the admin secret, and has the general
// rate limit applied as a baseline.
router.use(requireAdminSecret);
router.use(generalLimiter);

// POST /api/admin/broadcast
router.post(
  '/broadcast',
  broadcastLimiter,
  validateBroadcast,
  asyncHandler(broadcastController.sendBroadcast)
);

// POST /api/admin/test-email
router.post(
  '/test-email',
  validateTestEmail,
  asyncHandler(broadcastController.sendTestEmail)
);

// GET /api/admin/campaigns
router.get(
  '/campaigns',
  asyncHandler(broadcastController.listCampaigns)
);

// GET /api/admin/campaign/:id
router.get(
  '/campaign/:id',
  validateCampaignId,
  asyncHandler(broadcastController.getCampaign)
);

// GET /api/admin/statistics
router.get(
  '/statistics',
  asyncHandler(broadcastController.getStatistics)
);

// GET /api/admin/users
router.get(
  '/users',
  asyncHandler(broadcastController.getUsersList)
);

module.exports = router;
