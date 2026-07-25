/**
 * routes/submissionRoutes.js
 *
 * Public-facing (app-facing) route called by the Flutter app right
 * after a release submission is saved to Firestore. Replaces the two
 * direct EmailJS calls that used to happen client-side.
 *
 * Order of middleware mirrors adminRoutes.js:
 *   1. requireAppSecret   (auth — separate secret from the admin dashboard)
 *   2. generalLimiter      (baseline rate limit, reused from admin routes)
 *   3. asyncHandler         (forwards thrown errors to errorHandler.js)
 */

const express = require('express');
const router = express.Router();

const requireAppSecret = require('../middleware/appAuth');
const { generalLimiter } = require('../middleware/rateLimiter');
const asyncHandler = require('../utils/asyncHandler');

const submissionController = require('../controllers/submissionController');

router.use(requireAppSecret);
router.use(generalLimiter);

// POST /api/submissions/notify
router.post(
  '/notify',
  asyncHandler(submissionController.notifySubmission)
);

module.exports = router;