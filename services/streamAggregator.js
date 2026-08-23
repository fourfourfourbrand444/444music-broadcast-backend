/**
 * streamAggregator.js
 *
 * Sums real YouTube view counts across every release belonging to a
 * user, and writes the total into the SAME analytics/{uid} document
 * the Artist Insights dashboard already reads from. Nothing on the
 * frontend needs to change — this just makes the numbers real.
 *
 * ASSUMES: each submission document may have a `youtubeUrl` field
 * (a plain pasted video link, e.g. https://youtube.com/watch?v=...).
 * Submissions without one are simply skipped — no error, no 0 shown
 * as if it were a real count.
 */

const admin = require('firebase-admin');
const { getViewCountsBatch } = require('./youtubeViewFetcher');

const db = admin.firestore();

/**
 * Recalculates and saves youtubeStreams + totalStreams for ONE user.
 *
 * @param {string} userId
 * @returns {Promise<{ userId: string, tracksFound: number, totalViews: number }>}
 */
async function refreshUserYouTubeStreams(userId) {
  const submissionsSnap = await db
    .collection('submissions')
    .where('userId', '==', userId)
    .get();

  const videoLinks = [];
  submissionsSnap.forEach((doc) => {
    const data = doc.data();
    if (data.youtubeUrl) {
      videoLinks.push({ docId: doc.id, url: data.youtubeUrl });
    }
  });

  if (videoLinks.length === 0) {
    return { userId, tracksFound: 0, totalViews: 0 };
  }

  // YouTube's API accepts up to 50 IDs per call — chunk if a user
  // somehow has more than 50 linked releases.
  const chunks = [];
  for (let i = 0; i < videoLinks.length; i += 50) {
    chunks.push(videoLinks.slice(i, i + 50));
  }

  let totalViews = 0;
  const perTrackResults = [];

  for (const chunk of chunks) {
    const urls = chunk.map((v) => v.url);
    const results = await getViewCountsBatch(urls);

    results.forEach((result) => {
      if (typeof result.views === 'number') {
        totalViews += result.views;
      }
      perTrackResults.push(result);
    });
  }

  // Write per-track counts back onto each submission (for the
  // optional "per-track performance" view later), and roll the
  // total into analytics/{uid} for the dashboard's hero number.
  const batch = db.batch();

  videoLinks.forEach((link) => {
    const match = perTrackResults.find((r) => link.url.includes(r.videoId));
    if (match && typeof match.views === 'number') {
      batch.set(
        db.collection('submissions').doc(link.docId),
        { youtubeViews: match.views, youtubeViewsUpdatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    }
  });

  batch.set(
    db.collection('analytics').doc(userId),
    {
      youtubeStreams: totalViews,
      totalStreams: totalViews, // update this formula if/when other sources get added back in
      streamsUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await batch.commit();

  return { userId, tracksFound: videoLinks.length, totalViews };
}

/**
 * Recalculates YouTube streams for EVERY user who has at least one
 * submission with a youtubeUrl. Meant to be run on a schedule.
 *
 * @returns {Promise<Array<{ userId: string, tracksFound: number, totalViews: number }>>}
 */
async function refreshAllUsersYouTubeStreams() {
  const submissionsSnap = await db
    .collection('submissions')
    .where('youtubeUrl', '!=', null)
    .get();

  const userIds = new Set();
  submissionsSnap.forEach((doc) => {
    const data = doc.data();
    if (data.userId) userIds.add(data.userId);
  });

  const results = [];
  for (const userId of userIds) {
    try {
      const result = await refreshUserYouTubeStreams(userId);
      results.push(result);
    } catch (err) {
      results.push({ userId, error: err.message });
    }
  }

  return results;
}

module.exports = { refreshUserYouTubeStreams, refreshAllUsersYouTubeStreams };
