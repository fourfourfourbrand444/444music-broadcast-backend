/**
 * streamAggregator.js  (REBUILT)
 *
 * Automatic YouTube stream tracking, per track.
 *
 * WHAT WAS WRONG BEFORE
 *   1. A track that came back "needs_review" was never searched again.
 *      Songs are often approved BEFORE they are live on YouTube, so the
 *      first search found unrelated videos, got stuck, and never retried.
 *   2. The video link already saved on the release (smartLink.stores)
 *      was never used.
 *   3. Every run read the whole submissions collection, and there was
 *      no daily limit on searches (each search costs 100 quota points
 *      out of 10,000 a day).
 *
 * HOW IT WORKS NOW
 *   - WAIT:   a track is not searched until its release date.
 *   - LINK:   if the release already has a YouTube link saved
 *             (smartLink.stores.youtube or .youtubeMusic) it is checked
 *             first. Costs 1 quota point, no search needed.
 *   - RETRY:  a track that is not found (or is unsure) is searched again
 *             daily for 14 days after its first attempt, then weekly,
 *             and stops after 30 days ("stale").
 *   - CAP:    at most DAILY_SEARCH_CAP searches a day. When the cap is
 *             reached the job stops and continues tomorrow.
 *   - ROLL:   each job reads only a slice of releases per run and keeps
 *             a bookmark (meta/youtubeTrackerState). Next run continues
 *             where it stopped. At the end it starts over.
 *   - SAFE:   a matched track is never re-searched or overwritten.
 *             If YouTube says the daily quota is used up, everything
 *             stops until the next day. No track is ever marked as
 *             failed because of a quota or network error.
 *   - TOTALS: after views are refreshed, analytics/{uid}.totalStreams
 *             is written (this is what the dashboard shows).
 *
 * Exports keep the SAME names as before, so server.js keeps working:
 *   matchApprovedSubmissions, refreshUserYouTubeStreams,
 *   refreshAllUsersYouTubeStreams
 * New: runYouTubeTrackerDaily (views first, then matching), and the
 * shared quota helpers (reserveYouTubeSearch, isYouTubeBlockedToday,
 * markYouTubeBlockedToday) so other jobs can share the same daily cap.
 */
const admin = require('firebase-admin');
const { getViewCountsBatch, parseVideoId } = require('../utils/youtubeViewFetcher');
const { matchYouTubeVideo, similarity } = require('../utils/youtubeTrackMatcher');
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

/* ---------------------------------------------------------------------
 * SETTINGS — change these numbers to tune the job
 * ------------------------------------------------------------------- */
const DAILY_SEARCH_CAP = 50;        // searches per day (50 x 100 = 5,000 of 10,000 quota points)
const MATCH_DOCS_PER_RUN = 3000;    // releases READ per matching run (Firestore reads)
const VIEW_DOCS_PER_RUN = 2000;     // releases READ per views run
const RETRY_DAILY_DAYS = 14;        // search daily for this long after the first attempt...
const RETRY_WEEKLY_DAYS = 7;        // ...then once every this many days
const GIVE_UP_DAYS = 30;            // stop searching after this many days
const LINK_ACCEPT_SIMILARITY = 0.8; // title match needed to trust a saved link on multi-track releases

const DAY_MS = 24 * 60 * 60 * 1000;
const QUOTA_REF = db.collection('meta').doc('youtubeQuota');
const STATE_REF = db.collection('meta').doc('youtubeTrackerState');

/* ---------------------------------------------------------------------
 * QUOTA HELPERS
 * YouTube's daily quota resets at midnight Pacific Time, so the daily
 * counter is keyed to the Pacific date.
 * ------------------------------------------------------------------- */
function ptDateString() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()); // YYYY-MM-DD
}

function isQuotaExceededError(err) {
  const haystack = [err && err.message, err && err.code, err && err.status, err && err.reason]
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

async function isYouTubeBlockedToday() {
  const snap = await QUOTA_REF.get();
  return snap.exists && snap.data().blockedDate === ptDateString();
}

async function markYouTubeBlockedToday() {
  await QUOTA_REF.set({ blockedDate: ptDateString() }, { merge: true });
}

// Reserves ONE search for today. Returns false when the daily cap is
// reached or YouTube has already refused us today.
async function reserveYouTubeSearch() {
  const today = ptDateString();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(QUOTA_REF);
    const d = snap.exists ? snap.data() : {};
    if (d.blockedDate === today) return false;
    const used = d.date === today ? d.searches || 0 : 0;
    if (used >= DAILY_SEARCH_CAP) return false;
    tx.set(QUOTA_REF, { date: today, searches: used + 1 }, { merge: true });
    return true;
  });
}

/* ---------------------------------------------------------------------
 * ROLLING SLICE (bookmark) HELPERS
 * ------------------------------------------------------------------- */
async function fetchSlice(cursorKey, limit) {
  const stateSnap = await STATE_REF.get();
  const cursor = stateSnap.exists ? stateSnap.data()[cursorKey] || null : null;

  const base = () =>
    db
      .collection('submissions')
      .where('status', '==', 'Approved')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(limit);

  let snap = await (cursor ? base().startAfter(cursor) : base()).get();

  // Reached the end last time -> start over from the beginning.
  if (snap.empty && cursor) snap = await base().get();
  return snap;
}

async function saveCursor(cursorKey, docId) {
  await STATE_REF.set(
    { [cursorKey]: docId, [`${cursorKey}UpdatedAt`]: FieldValue.serverTimestamp() },
    { merge: true }
  );
}

/* ---------------------------------------------------------------------
 * SMALL HELPERS
 * ------------------------------------------------------------------- */
function isReleased(data, now) {
  const t = data.releaseDate ? new Date(data.releaseDate).getTime() : NaN;
  if (isNaN(t)) return true; // unknown date: don't block
  return t <= now;
}

function isDue(entry, now) {
  if (!entry) return true;
  if (entry.stale) return false;
  if (entry.nextSearchAt && new Date(entry.nextSearchAt).getTime() > now) return false;
  return true;
}

function nextSearchAtFor(firstAttemptMs, now) {
  const age = now - firstAttemptMs;
  const waitDays = age < RETRY_DAILY_DAYS * DAY_MS ? 1 : RETRY_WEEKLY_DAYS;
  return new Date(now + waitDays * DAY_MS).toISOString();
}

function videoIdFromStores(data) {
  const stores = (data.smartLink && data.smartLink.stores) || {};
  for (const key of ['youtube', 'youtubeMusic']) {
    const raw = stores[key];
    if (typeof raw === 'string' && raw.trim()) {
      const id = parseVideoId(raw.trim());
      if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) return id;
    }
  }
  return null;
}

// Looks up the video from the saved link ONCE per release (1 quota point).
function makeLinkedGetter(data) {
  let cached = null;
  let done = false;
  return async () => {
    if (done) return cached;
    const id = videoIdFromStores(data);
    if (!id) {
      done = true;
      return null;
    }
    try {
      const results = await getViewCountsBatch([id]);
      cached = results[0] || null;
      done = true;
      return cached;
    } catch (err) {
      if (isQuotaExceededError(err)) throw err;
      console.error(`Saved YouTube link check failed (${id}): ${err.message}`);
      done = true;
      cached = null;
      return null;
    }
  };
}

function buildPendingEntry({ status, trackTitle, candidates, prev, ctx }) {
  const firstAttemptAt = (prev && prev.firstAttemptAt) || new Date(ctx.now).toISOString();
  const firstMs = new Date(firstAttemptAt).getTime();
  const entry = {
    status,
    title: trackTitle,
    firstAttemptAt,
    lastSearchAt: new Date(ctx.now).toISOString(),
    attempts: ((prev && prev.attempts) || 0) + 1,
  };
  if (candidates && candidates.length) {
    entry.candidates = candidates.map((c) => ({
      videoId: c.videoId,
      title: c.title,
      channelTitle: c.channelTitle,
      score: c.score,
    }));
  }
  if (ctx.now - firstMs > GIVE_UP_DAYS * DAY_MS) entry.stale = true;
  else entry.nextSearchAt = nextSearchAtFor(firstMs, ctx.now);
  return entry;
}

/* ---------------------------------------------------------------------
 * TRY TO MATCH ONE TRACK
 * Returns { outcome: 'skip' | 'error' | 'stop' | 'matched' | 'needs_review' | 'not_found', entry? }
 * ------------------------------------------------------------------- */
async function attemptMatch({ trackTitle, artistName, entry, allowLinkWithoutTitle, getLinked, ctx }) {
  // Never touch a track that is already matched (including manual matches).
  if (entry && entry.status === 'matched') return { outcome: 'skip' };
  if (!isDue(entry, ctx.now)) return { outcome: 'skip' };

  // 1) Use the link already saved on the release, if there is one.
  let linked = null;
  try {
    linked = await getLinked();
  } catch (err) {
    await markYouTubeBlockedToday();
    ctx.summary.quotaExceeded = true;
    return { outcome: 'stop' };
  }
  if (linked) {
    const sim = similarity(trackTitle, linked.title || '');
    if (allowLinkWithoutTitle || sim >= LINK_ACCEPT_SIMILARITY) {
      const matched = {
        videoId: linked.videoId,
        score: sim,
        status: 'matched',
        title: trackTitle,
        matchedVia: 'saved-link',
        matchedAt: new Date(ctx.now).toISOString(),
      };
      if (typeof linked.views === 'number') matched.views = linked.views;
      return { outcome: 'matched', entry: matched };
    }
  }

  // 2) Search YouTube (costs 100 points, limited to the daily cap).
  const allowed = await reserveYouTubeSearch();
  if (!allowed) {
    if (await isYouTubeBlockedToday()) ctx.summary.quotaExceeded = true;
    else ctx.summary.cappedForToday = true;
    return { outcome: 'stop' };
  }
  ctx.summary.searchesUsed++;

  let result;
  try {
    result = await matchYouTubeVideo(trackTitle, artistName);
  } catch (err) {
    if (isQuotaExceededError(err)) {
      await markYouTubeBlockedToday();
      ctx.summary.quotaExceeded = true;
      return { outcome: 'stop' };
    }
    // Network / key / other problem: change nothing, try again next run.
    console.error(`YouTube search failed for "${trackTitle}" by ${artistName}: ${err.message}`);
    return { outcome: 'error' };
  }

  if (result.autoAccepted && result.bestMatch) {
    return {
      outcome: 'matched',
      entry: {
        videoId: result.bestMatch.videoId,
        score: result.score,
        status: 'matched',
        title: trackTitle,
        matchedVia: 'search',
        matchedAt: new Date(ctx.now).toISOString(),
      },
    };
  }
  if (result.found && result.candidates.length > 0) {
    return {
      outcome: 'needs_review',
      entry: buildPendingEntry({ status: 'needs_review', trackTitle, candidates: result.candidates, prev: entry, ctx }),
    };
  }
  return {
    outcome: 'not_found',
    entry: buildPendingEntry({ status: 'not_found', trackTitle, candidates: null, prev: entry, ctx }),
  };
}

function countOutcome(outcome, summary) {
  summary.checked++;
  if (outcome === 'matched') summary.matched++;
  else if (outcome === 'needs_review') summary.needsReview++;
  else if (outcome === 'not_found') summary.stillPending++;
}

/* ---------------------------------------------------------------------
 * JOB 1: MATCH APPROVED RELEASES TO YOUTUBE VIDEOS (PER TRACK)
 * ------------------------------------------------------------------- */
async function processSubmissionForMatching(doc, ctx) {
  const data = doc.data();

  // WAIT: not released yet -> no search, no cost.
  if (!isReleased(data, ctx.now)) {
    ctx.summary.waiting++;
    return 'ok';
  }

  const getLinked = makeLinkedGetter(data);
  const hasTrackList = Array.isArray(data.audioFiles) && data.audioFiles.length > 0;

  if (hasTrackList) {
    const existing = data.youtubeTrackMatches || {};
    const allowLinkWithoutTitle = data.audioFiles.length === 1;
    const updates = {};

    for (let i = 0; i < data.audioFiles.length; i++) {
      const key = String(i);
      const track = data.audioFiles[i];
      const trackTitle = (track.title || '').trim();
      const mainArtist = Array.isArray(track.artists) ? track.artists.find((a) => a.type === 'main') : null;
      const artistName = (mainArtist && mainArtist.name) || data.artistName || '';
      if (!trackTitle || !artistName) continue;

      const res = await attemptMatch({
        trackTitle,
        artistName,
        entry: existing[key],
        allowLinkWithoutTitle,
        getLinked,
        ctx,
      });

      if (res.outcome === 'skip' || res.outcome === 'error') continue;
      if (res.outcome === 'stop') {
        if (Object.keys(updates).length) await doc.ref.update(updates);
        return 'stop';
      }
      updates[`youtubeTrackMatches.${key}`] = res.entry;
      countOutcome(res.outcome, ctx.summary);
      if (res.outcome === 'matched' && data.userId) ctx.usersToRefresh.add(data.userId);
    }

    if (Object.keys(updates).length) await doc.ref.update(updates);
    return 'ok';
  }

  // ── LEGACY release (no audioFiles list): single track by release title ──
  if (data.youtubeVideoId) return 'ok';
  const trackTitle = data.releaseTitle || data.songTitle || data.title || '';
  const artistName = data.artistName || '';
  if (!trackTitle || !artistName) return 'ok';

  const legacyEntry = {
    status: data.youtubeMatchStatus || null,
    nextSearchAt: data.youtubeNextSearchAt || null,
    firstAttemptAt: data.youtubeFirstAttemptAt || null,
    attempts: data.youtubeAttempts || 0,
    stale: !!data.youtubeStale,
  };

  const res = await attemptMatch({
    trackTitle,
    artistName,
    entry: legacyEntry,
    allowLinkWithoutTitle: true,
    getLinked,
    ctx,
  });

  if (res.outcome === 'skip' || res.outcome === 'error') return 'ok';
  if (res.outcome === 'stop') return 'stop';

  if (res.outcome === 'matched') {
    const payload = {
      youtubeVideoId: res.entry.videoId,
      youtubeMatchScore: res.entry.score,
      youtubeMatchStatus: 'matched',
      youtubeMatchedVia: res.entry.matchedVia,
      youtubeMatchedAt: FieldValue.serverTimestamp(),
    };
    if (typeof res.entry.views === 'number') payload.youtubeViews = res.entry.views;
    await doc.ref.update(payload);
    if (data.userId) ctx.usersToRefresh.add(data.userId);
  } else {
    await doc.ref.update({
      youtubeMatchStatus: res.entry.status,
      youtubeMatchCandidates: res.entry.candidates || [],
      youtubeNextSearchAt: res.entry.nextSearchAt || null,
      youtubeFirstAttemptAt: res.entry.firstAttemptAt,
      youtubeAttempts: res.entry.attempts,
      youtubeStale: !!res.entry.stale,
    });
  }
  countOutcome(res.outcome, ctx.summary);
  return 'ok';
}

/**
 * @returns {Promise<{ checked, matched, needsReview, stillPending, waiting, searchesUsed, quotaExceeded, cappedForToday }>}
 */
async function matchApprovedSubmissions() {
  const summary = {
    checked: 0,
    matched: 0,
    needsReview: 0,
    stillPending: 0,
    waiting: 0,
    searchesUsed: 0,
    quotaExceeded: false,
    cappedForToday: false,
  };

  if (await isYouTubeBlockedToday()) {
    summary.quotaExceeded = true;
    console.log('YouTube quota used up today — matching skipped until tomorrow.');
    return summary;
  }

  const snap = await fetchSlice('matchCursor', MATCH_DOCS_PER_RUN);
  if (snap.empty) {
    await saveCursor('matchCursor', null);
    return summary;
  }

  const ctx = { now: Date.now(), summary, usersToRefresh: new Set() };
  let lastDoneId = null;
  let stoppedEarly = false;

  for (const doc of snap.docs) {
    let status;
    try {
      status = await processSubmissionForMatching(doc, ctx);
    } catch (err) {
      console.error(`Matching failed for ${doc.id}: ${err.message}`);
      status = 'ok'; // don't get stuck on one bad document
    }
    if (status === 'stop') {
      stoppedEarly = true;
      break;
    }
    lastDoneId = doc.id;
  }

  // Bookmark: where to continue next run.
  if (!stoppedEarly) {
    const lastDoc = snap.docs[snap.docs.length - 1];
    await saveCursor('matchCursor', snap.size < MATCH_DOCS_PER_RUN ? null : lastDoc.id);
  } else if (lastDoneId) {
    await saveCursor('matchCursor', lastDoneId); // the stopped release is retried next run
  }

  // Newly matched tracks: update views + dashboard totals right away.
  if (!summary.quotaExceeded) {
    for (const uid of ctx.usersToRefresh) {
      try {
        await refreshUserYouTubeStreams(uid);
      } catch (err) {
        if (isQuotaExceededError(err)) {
          await markYouTubeBlockedToday();
          summary.quotaExceeded = true;
          break;
        }
        console.error(`Views refresh failed for user ${uid}: ${err.message}`);
      }
    }
  }

  console.log('YouTube matching pass:', JSON.stringify(summary));
  return summary;
}

/* ---------------------------------------------------------------------
 * JOB 2: REFRESH VIEW COUNTS + ROLL UP TOTALS
 * Views are cheap: 1 quota point per call of up to 50 videos.
 * ------------------------------------------------------------------- */
async function refreshUserYouTubeStreams(userId) {
  const submissionsSnap = await db.collection('submissions').where('userId', '==', userId).get();

  const docsById = {};
  const matchedTracks = [];

  submissionsSnap.forEach((doc) => {
    const data = doc.data();
    docsById[doc.id] = { ref: doc.ref, data };

    if (data.youtubeTrackMatches) {
      Object.entries(data.youtubeTrackMatches).forEach(([key, match]) => {
        if (match && match.status === 'matched' && match.videoId) {
          matchedTracks.push({
            docId: doc.id,
            trackKey: key,
            videoId: match.videoId,
            stored: typeof match.views === 'number' ? match.views : null,
          });
        }
      });
    }
    if (data.youtubeVideoId) {
      matchedTracks.push({
        docId: doc.id,
        trackKey: null,
        videoId: data.youtubeVideoId,
        stored: typeof data.youtubeViews === 'number' ? data.youtubeViews : null,
      });
    }
  });

  if (matchedTracks.length === 0) return { userId, tracksFound: 0, totalViews: 0 };

  // Fetch fresh view counts, 50 videos per call.
  const uniqueIds = [...new Set(matchedTracks.map((t) => t.videoId))];
  const viewsByVideoId = {};
  for (let i = 0; i < uniqueIds.length; i += 50) {
    const results = await getViewCountsBatch(uniqueIds.slice(i, i + 50));
    results.forEach((r) => {
      if (typeof r.views === 'number') viewsByVideoId[r.videoId] = r.views;
    });
  }

  // Total = fresh views when available, otherwise the last saved number
  // (a hidden/removed video never makes the total silently drop).
  let totalViews = 0;
  const payloadByDoc = {};
  matchedTracks.forEach((t) => {
    const fresh = viewsByVideoId[t.videoId];
    const finalViews = typeof fresh === 'number' ? fresh : t.stored;
    if (typeof finalViews === 'number') totalViews += finalViews;

    if (typeof fresh === 'number' && fresh !== t.stored) {
      if (!payloadByDoc[t.docId]) payloadByDoc[t.docId] = { youtubeViewsUpdatedAt: FieldValue.serverTimestamp() };
      if (t.trackKey === null) payloadByDoc[t.docId].youtubeViews = fresh;
      else payloadByDoc[t.docId][`youtubeTrackMatches.${t.trackKey}.views`] = fresh;
    }
  });

  // Only write releases whose view count actually changed.
  const ops = Object.entries(payloadByDoc).map(([docId, data]) => ({ ref: docsById[docId].ref, data }));
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch();
    ops.slice(i, i + 400).forEach((o) => batch.update(o.ref, o.data));
    await batch.commit();
  }

  await db.collection('analytics').doc(userId).set(
    {
      youtubeStreams: totalViews,
      totalStreams: totalViews,
      streamsUpdatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { userId, tracksFound: matchedTracks.length, totalViews };
}

async function refreshAllUsersYouTubeStreams() {
  const results = [];

  if (await isYouTubeBlockedToday()) {
    console.log('YouTube quota used up today — views refresh skipped until tomorrow.');
    return results;
  }

  const snap = await fetchSlice('viewsCursor', VIEW_DOCS_PER_RUN);
  if (snap.empty) {
    await saveCursor('viewsCursor', null);
    return results;
  }

  const userIds = new Set();
  snap.forEach((doc) => {
    const data = doc.data();
    if (!data.userId) return;
    const hasNewMatch =
      data.youtubeTrackMatches &&
      Object.values(data.youtubeTrackMatches).some((m) => m && m.status === 'matched' && m.videoId);
    if (hasNewMatch || data.youtubeVideoId) userIds.add(data.userId);
  });

  let stoppedForQuota = false;
  for (const userId of userIds) {
    try {
      results.push(await refreshUserYouTubeStreams(userId));
    } catch (err) {
      if (isQuotaExceededError(err)) {
        await markYouTubeBlockedToday();
        stoppedForQuota = true;
        break;
      }
      results.push({ userId, error: err.message });
    }
  }

  // Only move the bookmark forward if the whole slice was handled.
  if (!stoppedForQuota) {
    const lastDoc = snap.docs[snap.docs.length - 1];
    await saveCursor('viewsCursor', snap.size < VIEW_DOCS_PER_RUN ? null : lastDoc.id);
  }

  console.log(`YouTube views pass: ${results.length} user(s) refreshed${stoppedForQuota ? ' (stopped: quota)' : ''}.`);
  return results;
}

/* ---------------------------------------------------------------------
 * ONE CALL FOR THE DAILY SCHEDULE: views first (cheap, always gets its
 * share of the quota), then matching (capped).
 * ------------------------------------------------------------------- */
async function runYouTubeTrackerDaily() {
  const views = await refreshAllUsersYouTubeStreams();
  const match = await matchApprovedSubmissions();
  return { views, match };
}

module.exports = {
  matchApprovedSubmissions,
  refreshUserYouTubeStreams,
  refreshAllUsersYouTubeStreams,
  runYouTubeTrackerDaily,
  reserveYouTubeSearch,
  isYouTubeBlockedToday,
  markYouTubeBlockedToday,
};
