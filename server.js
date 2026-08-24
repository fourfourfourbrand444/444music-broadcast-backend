/**
 * server.js
 *
 * App entrypoint. Wires together Express, security middleware,
 * routes, and error handling. Also initializes Firebase Admin and
 * the email provider on startup.
 */
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cron = require('node-cron');
const adminRoutes = require('./routes/adminRoutes');
const submissionRoutes = require('./routes/submissionRoutes');
const verificationRoutes = require('./routes/verificationRoutes');
const paystackRoutes = require('./routes/paystackRoutes');
const passwordResetRoutes = require('./routes/passwordResetRoutes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const emailProvider = require('./services/emailProvider');
const logger = require('./utils/logger');
const { getViewCount } = require('./utils/youtubeViewFetcher');
const { matchYouTubeVideo } = require('./utils/youtubeTrackMatcher');
const {
  matchApprovedSubmissions,
  refreshAllUsersYouTubeStreams,
} = require('./services/streamAggregator');
const {
  checkReviewSubmissionsForLiveRelease,
} = require('./services/autoApproveLiveReleases');

const app = express();
const PORT = process.env.PORT || 5000;
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
}));
app.use(cors());
// The Paystack webhook needs the raw body for signature verification,
// so it must be mounted BEFORE express.json() touches the request.
app.use('/api/paystack/webhooks/paystack', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.get('/health', (req, res) => {
  res.status(200).json({ success: true, message: '444Music Broadcast Backend is running.' });
});

app.use('/api/admin', adminRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/verification', verificationRoutes);
app.use('/api/verification', passwordResetRoutes);
app.use('/api/paystack', paystackRoutes);

// TEMPORARY — manual test route for a single video's view count.
app.get('/test-youtube-views', async (req, res) => {
  const input = req.query.url;
  if (!input) {
    return res.status(400).json({ error: 'Add ?url=<youtube link or video ID> to the address' });
  }
  try {
    res.json(await getViewCount(input));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// TEMPORARY — manual test route for the search+match function, so you
// can sanity-check matching for one track without waiting for the cron.
// Example: /test-youtube-match?title=Fake%20Smiles&artist=TrapBoyRock
app.get('/test-youtube-match', async (req, res) => {
  const { title, artist } = req.query;
  if (!title || !artist) {
    return res.status(400).json({ error: 'Add ?title=<track title>&artist=<artist name>' });
  }
  try {
    res.json(await matchYouTubeVideo(title, artist));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// TEMPORARY — manually trigger the "match Approved submissions" pass.
app.get('/test-match-approved', async (req, res) => {
  try {
    res.json(await matchApprovedSubmissions());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// TEMPORARY — manually trigger a full view-count refresh for all users.
app.get('/test-refresh-all-youtube-streams', async (req, res) => {
  try {
    const results = await refreshAllUsersYouTubeStreams();
    res.json({ usersUpdated: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// TEMPORARY — manually trigger the "check Review submissions for a live
// release" pass, so you can confirm it works without waiting for 9am.
app.get('/test-auto-approve', async (req, res) => {
  try {
    res.json(await checkReviewSubmissionsForLiveRelease());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// TEMPORARY — inspect submissions flagged 'needs_review' so we can see
// exactly what they matched to (and why) instead of guessing at fixes.
app.get('/test-needs-review', async (req, res) => {
  try {
    const admin = require('firebase-admin');
    const db = admin.firestore();
    const snap = await db
      .collection('submissions')
      .where('youtubeMatchStatus', '==', 'needs_review')
      .get();

    const items = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        releaseTitle: d.releaseTitle || d.songTitle || d.title || '',
        artistName: d.artistName || '',
        topCandidates: (d.youtubeMatchCandidates || []).map((c) => ({
          title: c.title,
          channelTitle: c.channelTitle,
          score: c.score,
        })),
      };
    });

    res.json({ count: items.length, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use(notFoundHandler);
app.use(errorHandler);

async function startServer() {
  try {
    await emailProvider.initialize();
    app.listen(PORT, () => {
      logger.info(`444Music Broadcast Backend listening on port ${PORT}`);
      logger.info(`Email provider: ${emailProvider.getProviderName()}`);
    });
  } catch (err) {
    logger.error(`Failed to start server: ${err.message}`);
    process.exit(1);
  }
}
startServer();

// Every hour: try to match any newly-Approved submissions to a YouTube
// video. Runs more often than the view-count refresh below because a
// song going live on YouTube is the thing we're racing to catch quickly;
// once matched, cost per cycle is just one search call per unmatched track.
cron.schedule('0 * * * *', async () => {
  logger.info('Running scheduled YouTube match pass...');
  try {
    const result = await matchApprovedSubmissions();
    logger.info(`YouTube match pass complete: ${JSON.stringify(result)}`);
  } catch (err) {
    logger.error(`YouTube match pass failed: ${err.message}`);
  }
});

// Every 6 hours: refresh real view counts for all matched tracks and
// roll them into each user's totalStreams.
cron.schedule('0 */6 * * *', async () => {
  logger.info('Running scheduled YouTube streams refresh...');
  try {
    const results = await refreshAllUsersYouTubeStreams();
    logger.info(`YouTube streams refresh complete: ${results.length} users updated`);
  } catch (err) {
    logger.error(`YouTube streams refresh failed: ${err.message}`);
  }
});

// Once a day at 9am Accra time: check every "Review" submission against
// YouTube/Spotify/iTunes, and auto-approve the ones that are now live.
cron.schedule('0 9 * * *', async () => {
  logger.info('Running scheduled auto-approve pass...');
  try {
    const result = await checkReviewSubmissionsForLiveRelease();
    logger.info(`Auto-approve pass complete: ${JSON.stringify(result)}`);
  } catch (err) {
    logger.error(`Auto-approve pass failed: ${err.message}`);
  }
});

module.exports = app;
