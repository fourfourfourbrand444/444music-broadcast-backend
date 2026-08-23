/**
 * streamAggregator.js
 *
 * Fully automatic YouTube stream tracking — no manual URL entry.
 *
 * Two jobs, meant to run on a schedule:
 *
 *  1. matchApprovedSubmissions()
 *     Finds "Approved" submissions with no youtubeVideoId yet, searches
 *     YouTube for each one, and saves a match when confidence is high
 *     enough. Submissions with no match yet are simply skipped and
 *     retried next cycle (song not live on YouTube yet — normal).
 *     Ambiguous matches are flagged (youtubeMatchStatus: 'needs_review')
 *     instead of guessed.
 *
 *  2. refreshAllUsersYouTubeStreams()
 *     For every user with at least one MATCHED track, fetches current
 *     view counts and sums them into analytics/{uid}.totalStreams —
 *     the number the dashboard displays. Unmatched tracks are excluded
 *     from the sum entirely (never counted as 0).
 */
const admin = require('firebase-admin');
const { getViewCountsBatch } = require('../utils/youtubeViewFetcher');
const { matchYouTubeVideo } = require('../utils/youtubeTrackMatcher');
const db = admin.firestore();

/* ---------------------------------------------------------------------
 * JOB 1: MATCH APPROVED SUBMISSIONS TO YOUTUBE VIDEOS
 * ------------------------------------------------------------------- */
/**
 * @returns {Promise<{ checked: number, matched: number, needsReview: number, stillPending: number }>}
 */
async function matchApprovedSubmissions() {
  const snap = await db
    .collection('submissions')
    .where('status', '==', 'Approved')
    .get();

  let checked = 0, matched = 0, needsReview = 0, stillPending = 0;

  for (const doc of snap.docs) {
    const data = doc.data();

    // Already matched — nothing to do here (view-count refresh handles it).
    if (data.youtubeVideoId) continue;

    // Already flagged for manual review — don't re-flag every cycle.
    if (data.youtubeMatchStatus === 'needs_review') continue;

    const trackTitle = data.releaseTitle || data.songTitle || data.title || '';
    const artistName = data.artistName || '';
    if (!trackTitle || !artistName) continue;

    checked++;

    let result;
    try {
      result = await matchYouTubeVideo(trackTitle, artistName);
    } catch (err) {
      console.error(`YouTube match failed for ${doc.id}: ${err.message}`);
      continue;
    }

    if (result.autoAccepted && result.bestMatch) {
      await doc.ref.set(
        {
          youtubeVideoId: result.bestMatch.videoId,
          youtubeMatchScore: result.score,
          youtubeMatchStatus: 'matched',
          youtubeMatchedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      matched++;
    } else if (result.found && result.candidates.length > 0) {
      // Found results, but nothing confident enough — flag for a human
      // instead of guessing wrong (e.g. covers, reuploads, duplicate titles).
      await doc.ref.set(
        {
          youtubeMatchStatus: 'needs_review',
          youtubeMatchCandidates: result.candidates.map((c) => ({
            videoId: c.videoId,
            title: c.title,
            channelTitle: c.channelTitle,
            score: c.score,
          })),
        },
        { merge: true }
      );
      needsReview++;
    } else {
      // Not live on YouTube yet — totally normal, just try again next cycle.
      stillPending++;
    }
  }

  return { checked, matched, needsReview, stillPending };
}

/* ---------------------------------------------------------------------
 * JOB 2: REFRESH VIEW COUNTS + ROLL UP TOTALS
 * ------------------------------------------------------------------- */
/**
 * Recalculates and saves youtubeStreams + totalStreams for ONE user,
 * based on already-matched tracks only.
 *
 * @param {string} userId
 */
async function refreshUserYouTubeStreams(userId) {
  const submissionsSnap = await db
    .collection('submissions')
    .where('userId', '==', userId)
    .where('youtubeVideoId', '!=', null)
    .get();

  const matchedTracks = [];
  submissionsSnap.forEach((doc) => {
    const data = doc.data();
    if (data.youtubeVideoId) {
      matchedTracks.push({ docId: doc.id, videoId: data.youtubeVideoId });
    }
  });

  if (matchedTracks.length === 0) {
    return { userId, tracksFound: 0, totalViews: 0 };
  }

  const chunks = [];
  for (let i = 0; i < matchedTracks.length; i += 50) {
    chunks.push(matchedTracks.slice(i, i + 50));
  }

  let totalViews = 0;
  const viewsByVideoId = {};

  for (const chunk of chunks) {
    const ids = chunk.map((t) => t.videoId);
    const results = await getViewCountsBatch(ids);
    results.forEach((r) => {
      if (typeof r.views === 'number') {
        viewsByVideoId[r.videoId] = r.views;
        totalViews += r.views;
      }
    });
  }

  const batch = db.batch();
  matchedTracks.forEach((track) => {
    const views = viewsByVideoId[track.videoId];
    if (typeof views === 'number') {
      batch.set(
        db.collection('submissions').doc(track.docId),
        { youtubeViews: views, youtubeViewsUpdatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    }
  });

  batch.set(
    db.collection('analytics').doc(userId),
    {
      youtubeStreams: totalViews,
      totalStreams: totalViews, // update this formula if other sources get added back in later
      streamsUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await batch.commit();
  return { userId, tracksFound: matchedTracks.length, totalViews };
}

/**
 * Refreshes YouTube streams for EVERY user with at least one matched track.
 */
async function refreshAllUsersYouTubeStreams() {
  const snap = await db
    .collection('submissions')
    .where('youtubeVideoId', '!=', null)
    .get();

  const userIds = new Set();
  snap.forEach((doc) => {
    const data = doc.data();
    if (data.userId) userIds.add(data.userId);
  });

  const results = [];
  for (const userId of userIds) {
    try {
      results.push(await refreshUserYouTubeStreams(userId));
    } catch (err) {
      results.push({ userId, error: err.message });
    }
  }
  return results;
}

module.exports = {
  matchApprovedSubmissions,
  refreshUserYouTubeStreams,
  refreshAllUsersYouTubeStreams,
};
