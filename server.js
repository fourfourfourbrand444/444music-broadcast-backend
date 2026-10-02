/**
 * server.js
 *
 * App entrypoint. Wires together Express, security middleware,
 * routes, and error handling. Also initializes Firebase Admin and
 * the email provider on startup.
 *
 * CHANGES IN THIS VERSION
 *  - Payout emails: added /api/payout (admin, Firebase login) and
 *    /api/payout-report (public, signed links). Nothing else changed.
 *
 * EARLIER CHANGES
 *  - YouTube tracking now runs ONCE A DAY (10:00 Accra) through
 *    runYouTubeTrackerDaily(): views refresh first, then matching.
 *    The old hourly match + 6-hourly refresh jobs are gone. The daily
 *    search cap, retry timing and rolling bookmark now live inside
 *    services/streamAggregator.js.
 *  - A simple lock stops two tracker runs from overlapping.
 *  - All /test-... routes are now LOCKED. They only work when the
 *    TEST_ROUTES_KEY environment variable is set on Render, and every
 *    call must add ?key=<that value>. Without the variable they return
 *    404, so nobody can burn your YouTube quota through them.
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
const r2Routes = require('./routes/r2Routes');
const payoutRoutes = require('./routes/payoutRoutes');
const payoutReportRoutes = require('./routes/payoutReportRoutes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const emailProvider = require('./services/emailProvider');
const logger = require('./utils/logger');
const { getViewCount } = require('./utils/youtubeViewFetcher');
const { matchYouTubeVideo } = require('./utils/youtubeTrackMatcher');
const {
  matchApprovedSubmissions,
  refreshAllUsersYouTubeStreams,
  runYouTubeTrackerDaily,
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
app.use('/api/payout', payoutRoutes);
app.use('/api/payout-report', payoutReportRoutes);
app.use('/r2', r2Routes);

/* ---------------------------------------------------------------------
 * TEST ROUTES — locked behind TEST_ROUTES_KEY
 * Set TEST_ROUTES_KEY in Render → Environment (any long random text),
 * then call e.g.  /test-run-tracker?key=YOUR_LONG_RANDOM_TEXT
 * If the variable is not set, every test route answers 404.
 * ------------------------------------------------------------------- */
function requireTestKey(req, res, next) {
  const expected = process.env.TEST_ROUTES_KEY;
  if (!expected) return res.status(404).json({ error: 'Not found' });
  if (req.query.key !== expected) return res.status(403).json({ error: 'Forbidden' });
  next();
}

// Manual test for a single video's view count.
app.get('/test-youtube-views', requireTestKey, async (req, res) => {
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

// Manual test for the search+match function (costs 100 quota points per call).
// Example: /test-youtube-match?title=Fake%20Smiles&artist=TrapBoyRock&key=...
app.get('/test-youtube-match', requireTestKey, async (req, res) => {
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

// Manually run ONE full daily tracker cycle (views, then matching).
app.get('/test-run-tracker', requireTestKey, async (req, res) => {
  if (trackerRunning) return res.status(409).json({ error: 'A tracker run is already in progress.' });
  trackerRunning = true;
  try {
    res.json(await runYouTubeTrackerDaily());
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    trackerRunning = false;
  }
});

// Manually run only the matching pass.
app.get('/test-match-approved', requireTestKey, async (req, res) => {
  try {
    res.json(await matchApprovedSubmissions());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manually run only the views refresh (one rolling slice).
app.get('/test-refresh-all-youtube-streams', requireTestKey, async (req, res) => {
  try {
    const results = await refreshAllUsersYouTubeStreams();
    res.json({ usersUpdated: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manually run the "check Review submissions for a live release" pass.
app.get('/test-auto-approve', requireTestKey, async (req, res) => {
  try {
    res.json(await checkReviewSubmissionsForLiveRelease());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dumps artistName/releaseTitle/audioFiles for every submission at status "Review".
app.get('/test-review-submissions', requireTestKey, async (req, res) => {
  try {
    const admin = require('firebase-admin');
    const db = admin.firestore();
    const snap = await db.collection('submissions').where('status', '==', 'Review').get();
    const items = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        artistName: d.artistName,
        releaseTitle: d.releaseTitle,
        songTitle: d.songTitle,
        title: d.title,
        audioFiles: (d.audioFiles || []).map((f) => ({
          title: f.title,
          artists: f.artists,
        })),
      };
    });
    res.json({ count: items.length, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Inspect older (single-track) submissions flagged 'needs_review'.
app.get('/test-needs-review', requireTestKey, async (req, res) => {
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

/* ---------------------------------------------------------------------
 * SCHEDULED JOBS
 * ------------------------------------------------------------------- */

// Once a day at 10:00 Accra time (after the 9:00 auto-approve pass):
// refresh YouTube view counts first (cheap), then look for songs that
// have just gone live (capped by the daily search limit inside
// streamAggregator.js). Each job reads a slice of releases and keeps a
// bookmark, so big catalogs are covered over several days.
let trackerRunning = false;
cron.schedule('0 10 * * *', async () => {
  if (trackerRunning) {
    logger.info('YouTube tracker run skipped — the previous run is still in progress.');
    return;
  }
  trackerRunning = true;
  logger.info('Running scheduled YouTube tracker (views, then matching)...');
  try {
    const result = await runYouTubeTrackerDaily();
    logger.info(
      `YouTube tracker complete: ${result.views.length} user(s) refreshed, match pass ${JSON.stringify(result.match)}`
    );
  } catch (err) {
    logger.error(`YouTube tracker failed: ${err.message}`);
  } finally {
    trackerRunning = false;
  }
}, { timezone: 'Africa/Accra' });

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
}, { timezone: 'Africa/Accra' });

module.exports = app;
