/**
 * routes/adminRoutes.js
 *
 * Maps the admin endpoints to their controller functions, and
 * applies middleware in this order for every route:
 *   1. requireAdminSecret   (auth)
 *   2. generalLimiter        (baseline rate limit, applied to whole router)
 *   3. validators             (per-route body/param validation)
 *   4. broadcastLimiter       (extra strict limit, only on the broadcast route)
 *
 * asyncHandler wraps every controller function so thrown errors or
 * rejected promises flow to errorHandler.js instead of crashing the
 * server or hanging the request.
 *
 * Campaign GROUP routes (multi-day rollout tracking) are handled
 * inline here, same pattern as email-usage — small enough not to
 * need their own controller file.
 *
 * Email usage routes cover BOTH providers:
 *   - /email-usage            -> Brevo, resets DAILY (300/day cap)
 *   - /sendpulse-usage        -> SendPulse, resets MONTHLY (broadcast-only)
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
const { getEmailUsage } = require('../utils/emailUsageTracker');
const sendpulseProvider = require('../services/sendpulseProvider');
const campaignGroupService = require('../services/campaignGroupService');

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

// GET /api/admin/email-usage
// Returns today's Brevo transactional email usage: how many sent,
// how many remain before the 300/day cap, and time until reset.
router.get(
  '/email-usage',
  asyncHandler(async (req, res) => {
    const usage = await getEmailUsage();
    res.status(200).json({ success: true, ...usage });
  })
);

// GET /api/admin/sendpulse-usage
// Returns this MONTH's SendPulse broadcast email usage: how many sent,
// how many remain before the monthly cap, and time until reset.
router.get(
  '/sendpulse-usage',
  asyncHandler(async (req, res) => {
    const usage = await sendpulseProvider.getUsageSummary();
    res.status(200).json({ success: true, ...usage });
  })
);

// POST /api/admin/campaign-groups
// body: { name }
// Creates a new multi-day rollout tracker.
router.post(
  '/campaign-groups',
  asyncHandler(async (req, res) => {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'A campaign group name is required.' });
    }
    const groupId = await campaignGroupService.createGroup({ name });
    res.status(201).json({ success: true, groupId });
  })
);

// GET /api/admin/campaign-groups
// Lists all rollouts with sent/remaining counts.
router.get(
  '/campaign-groups',
  asyncHandler(async (req, res) => {
    const groups = await campaignGroupService.getGroups();
    res.status(200).json({ success: true, groups });
  })
);

// GET /api/admin/campaign-groups/:id/remaining-users
// Returns the opted-in users who have NOT yet received this
// rollout's send — the pool to pick today's fresh batch from.
router.get(
  '/campaign-groups/:id/remaining-users',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const users = await campaignGroupService.getRemainingUsers(id);
    res.status(200).json({ success: true, count: users.length, users });
  })
);

module.exports = router;