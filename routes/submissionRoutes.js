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
const approvalController = require('../controllers/approvalController');
const { resolveFromSpotifyLink } = require('../services/spotifyLinkResolver');
router.use(requireAppSecret);
router.use(generalLimiter);
// POST /api/submissions/notify
router.post(
  '/notify',
  asyncHandler(submissionController.notifySubmission)
);
// POST /api/submissions/notify-rejection
router.post(
  '/notify-rejection',
  asyncHandler(submissionController.notifyRejection)
);

// POST /api/submissions/notify-approval
// body: { submissionId }
// Sends the approval email (song, UPC, catalog number, stores, login
// button) through SendPulse. The backend reads the submission from
// Firestore itself, so the admin page only sends the id. Called from
// adminpage.html with the same x-app-secret header as notify-rejection.
router.post(
  '/notify-approval',
  asyncHandler(approvalController.notify)
);

// POST /api/submissions/resolve-spotify-link
// body: { spotifyUrl }
// Given one Spotify track link, returns its real title/artist/UPC
// plus whatever was found on YouTube, iTunes, and Deezer. Called
// from admin.html with the same x-app-secret header already in use
// there — not exposed to the Flutter app or public.
router.post(
  '/resolve-spotify-link',
  asyncHandler(async (req, res) => {
    const { spotifyUrl } = req.body;
    if (!spotifyUrl || !spotifyUrl.trim()) {
      return res.status(400).json({ success: false, message: 'A Spotify track link is required.' });
    }
    try {
      const result = await resolveFromSpotifyLink(spotifyUrl.trim());
      res.status(200).json({ success: true, ...result });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  })
);

module.exports = router;
