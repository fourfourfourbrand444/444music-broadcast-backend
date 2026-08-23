/**
 * streamAggregator.js
 *
 * Fully automatic YouTube stream tracking — no manual URL entry.
 *
 * IMPORTANT: a submission can represent an EP/Album with MULTIPLE
 * songs. Each song has its own `audioFiles[i].title` (e.g. "Silence",
 * "It's Time"), separate from the overall `releaseTitle` (e.g.
 * "2 Genre"). YouTube uploads are per-song, not per-release, so we
 * must search and match EACH TRACK individually — matching against
 * the release title alone would never find anything for a multi-track
 * release.
 *
 * Per-track match results are stored in a map field on the submission
 * doc: `youtubeTrackMatches: { "0": {...}, "1": {...}, ... }`, keyed
 * by the track's index in `audioFiles`. This keeps each track's match
 * (or lack of one) independent — e.g. one song on an EP can be live
 * and matched while another isn't out yet.
 *
 * Older submissions saved before per-track data existed (no
 * `audioFiles` array) fall back to the original single-track
 * behavior, matching on `releaseTitle` + `artistName` and storing the
 * result directly on `youtubeVideoId` — unchanged from before, so old
 * data keeps working with no migration needed.
 *
 * QUOTA HANDLING: YouTube's search.list endpoint costs 100 quota
 * units per call against a 10,000/day free quota — roughly 100
 * searches/day max. If matchYouTubeVideo() throws a quota-exceeded
 * error partway through a pass, every remaining track would also fail
 * for the same reason — so instead of grinding through the rest of
 * the list generating identical errors, the pass stops immediately
 * and picks back up on the next scheduled run once quota resets.
 *
 * Two jobs, meant to run on a schedule:
 *
 *  1. matchApprovedSubmissions()
 *     Finds "Approved" submissions and tries to match every track
 *     inside them that isn't matched yet. Tracks with no match yet
 *     are simply skipped and retried next cycle (song not live on
 *     YouTube yet — normal). Ambiguous matches are flagged
 *     ('needs_review') instead of guessed.
 *
 *  2. refreshAllUsersYouTubeStreams()
 *     For every user with at least one MATCHED track (across any of
 *     their submissions, any track within them), fetches current view
 *     counts and sums them all into analytics/{uid}.totalStreams —
 *     the number the dashboard displays. Unmatched tracks are excluded
 *     from the sum entirely (never counted as 0).
 */
const admin = require('firebase-admin');
const { getViewCountsBatch } = require('../utils/youtubeViewFetcher');
const { matchYouTubeVideo } = require('../utils/youtubeTrackMatcher');
const db = admin.firestore();

/**
 * Detects whether an error thrown by matchYouTubeVideo represents
 * YouTube's daily quota being exhausted, based on the standard shape
 * Google's APIs use for this (HTTP 403 with reason "quotaExceeded").
 * Checks a few common ways this might surface depending on how the
 * matcher constructs its error, since its exact error format wasn't
 * available while writing this — adjust the matched strings below if
 * real logs show a different message once this runs.
 */
function isQuotaExceededError(err) {
  const haystack = [
    err && err.message,
    err && err.code,
    err && err.status,
    err && err.reason,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return (
    haystack.includes('quotaexceeded') ||
    haystack.includes('quota exceeded') ||
    haystack.includes('dailylimitexceeded') ||
    (haystack.includes('403') && haystack.includes('quota'))
  );
}

/* ---------------------------------------------------------------------
 * JOB 1: MATCH APPROVED SUBMISSIONS TO YOUTUBE VIDEOS (PER TRACK)
 * ------------------------------------------------------------------- */
/**
 * @returns {Promise<{ checked: number, matched: number, needsReview: number, stillPending: number, quotaExceeded: boolean }>}
 */
async function matchApprovedSubmissions() {
  const snap = await db
    .collection('submissions')
    .where('status', '==', 'Approved')
    .get();

  let checked = 0, matched = 0, needsReview = 0, stillPending = 0;
  let quotaExceeded = false;

  outer: for (const doc of snap.docs) {
    const data = doc.data();
    const hasTrackList = Array.isArray(data.audioFiles) && data.audioFiles.length > 0;

    if (hasTrackList) {
      // ── MULTI/SINGLE-TRACK RELEASE WITH A REAL TRACK LIST ──────────
      const existingMatches = { ...(data.youtubeTrackMatches || {}) };
      let anyChange = false;

      for (let i = 0; i < data.audioFiles.length; i++) {
        const key = String(i);
        const existing = existingMatches[key];

        // Already matched, or already flagged for manual review —
        // don't re-search every cycle.
        if (existing && (existing.status === 'matched' || existing.status === 'needs_review')) continue;

        const track = data.audioFiles[i];
        const trackTitle = (track.title || '').trim();

        // Prefer this track's own Main-tagged artist (handles EPs
        // where featuring changes per track); fall back to the
        // submission-level artistName.
        const mainArtist = Array.isArray(track.artists)
          ? track.artists.find((a) => a.type === 'main')
          : null;
        const artistName = (mainArtist && mainArtist.name) || data.artistName || '';

        if (!trackTitle || !artistName) continue;

        checked++;

        let result;
        try {
          result = await matchYouTubeVideo(trackTitle, artistName);
        } catch (err) {
          if (isQuotaExceededError(err)) {
            console.error(`YouTube search quota exceeded — stopping this pass early. Will retry remaining tracks next cycle. (hit while matching ${doc.id} track ${i})`);
            quotaExceeded = true;
            if (anyChange) {
              await doc.ref.set({ youtubeTrackMatches: existingMatches }, { merge: true });
            }
            break outer;
          }
          console.error(`YouTube match failed for ${doc.id} track ${i}: ${err.message}`);
          continue;
        }

        if (result.autoAccepted && result.bestMatch) {
          existingMatches[key] = {
            videoId: result.bestMatch.videoId,
            score: result.score,
            status: 'matched',
            title: trackTitle,
            matchedAt: new Date().toISOString(),
          };
          anyChange = true;
          matched++;
        } else if (result.found && result.candidates.length > 0) {
          existingMatches[key] = {
            status: 'needs_review',
            title: trackTitle,
            candidates: result.candidates.map((c) => ({
              videoId: c.videoId,
              title: c.title,
              channelTitle: c.channelTitle,
              score: c.score,
            })),
          };
          anyChange = true;
          needsReview++;
        } else {
          // Not live on YouTube yet — normal, retry next cycle.
          stillPending++;
        }
      }

      if (anyChange) {
        await doc.ref.set({ youtubeTrackMatches: existingMatches }, { merge: true });
      }
    } else {
      // ── LEGACY SUBMISSION: no audioFiles[] — original single-track
      // behavior, matching on the overall releaseTitle. ──────────────
      if (data.youtubeVideoId) continue;
      if (data.youtubeMatchStatus === 'needs_review') continue;

      const trackTitle = data.releaseTitle || data.songTitle || data.title || '';
      const artistName = data.artistName || '';
      if (!trackTitle || !artistName) continue;

      checked++;

      let result;
      try {
        result = await matchYouTubeVideo(trackTitle, artistName);
      } catch (err) {
        if (isQuotaExceededError(err)) {
          console.error(`YouTube search quota exceeded — stopping this pass early. Will retry remaining submissions next cycle. (hit while matching ${doc.id})`);
          quotaExceeded = true;
          break outer;
        }
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
        stillPending++;
      }
    }
  }

  return { checked, matched, needsReview, stillPending, quotaExceeded };
}

/* ---------------------------------------------------------------------
 * JOB 2: REFRESH VIEW COUNTS + ROLL UP TOTALS
 * ------------------------------------------------------------------- */
async function refreshUserYouTubeStreams(userId) {
  const submissionsSnap = await db
    .collection('submissions')
    .where('userId', '==', userId)
    .get();

  const matchedTracks = [];

  submissionsSnap.forEach((doc) => {
    const data = doc.data();

    if (data.youtubeTrackMatches) {
      Object.entries(data.youtubeTrackMatches).forEach(([key, match]) => {
        if (match && match.status === 'matched' && match.videoId) {
          matchedTracks.push({ docId: doc.id, trackKey: key, videoId: match.videoId });
        }
      });
    }

    if (data.youtubeVideoId) {
      matchedTracks.push({ docId: doc.id, trackKey: null, videoId: data.youtubeVideoId });
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

  const byDoc = {};
  matchedTracks.forEach((t) => {
    const views = viewsByVideoId[t.videoId];
    if (typeof views !== 'number') return;
    if (!byDoc[t.docId]) byDoc[t.docId] = [];
    byDoc[t.docId].push({ trackKey: t.trackKey, views });
  });

  const batch = db.batch();
  for (const [docId, updates] of Object.entries(byDoc)) {
    const docSnap = submissionsSnap.docs.find((d) => d.id === docId);
    const data = docSnap.data();
    const trackMatches = { ...(data.youtubeTrackMatches || {}) };
    let legacyViews = null;

    updates.forEach((u) => {
      if (u.trackKey === null) {
        legacyViews = u.views;
      } else if (trackMatches[u.trackKey]) {
        trackMatches[u.trackKey] = { ...trackMatches[u.trackKey], views: u.views };
      }
    });

    const payload = { youtubeTrackMatches: trackMatches, youtubeViewsUpdatedAt: admin.firestore.FieldValue.serverTimestamp() };
    if (legacyViews !== null) payload.youtubeViews = legacyViews;

    batch.set(db.collection('submissions').doc(docId), payload, { merge: true });
  }

  batch.set(
    db.collection('analytics').doc(userId),
    {
      youtubeStreams: totalViews,
      totalStreams: totalViews,
      streamsUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await batch.commit();
  return { userId, tracksFound: matchedTracks.length, totalViews };
}

async function refreshAllUsersYouTubeStreams() {
  const snap = await db.collection('submissions').get();

  const userIds = new Set();
  snap.forEach((doc) => {
    const data = doc.data();
    if (!data.userId) return;

    const hasNewMatch = data.youtubeTrackMatches &&
      Object.values(data.youtubeTrackMatches).some((m) => m && m.status === 'matched' && m.videoId);
    const hasLegacyMatch = !!data.youtubeVideoId;

    if (hasNewMatch || hasLegacyMatch) userIds.add(data.userId);
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
