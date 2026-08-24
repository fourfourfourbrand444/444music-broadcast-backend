/**
 * autoApproveLiveReleases.js
 * ─────────────────────────────────────────────────────────────────
 * Drop into your backend's services/ folder, next to streamAggregator.js.
 *
 * WHAT IT DOES
 * Runs on a schedule (wired up via node-cron in server.js — see bottom
 * of this file's setup notes). Checks every submission sitting at
 * status: "Review" — i.e. you've already reviewed it and sent it to
 * your distribution partner, just waiting for it to go live.
 *
 * For each one, it searches:
 *   1. YouTube (via your EXISTING utils/youtubeTrackMatcher.js — same
 *      matcher, same quota handling streamAggregator.js already uses,
 *      so there's no second YouTube-matching system to maintain)
 *   2. Spotify (Client Credentials flow — also gives us the real UPC)
 *   3. iTunes (free, no key, last resort)
 *
 * As soon as ANY of them confirms the release is live:
 *   - assigns a catalog number (auto-incrementing counter, same
 *     format your admin panel already uses: 444M-0001, 444M-0002...)
 *   - pulls the real UPC from Spotify if it has matched by then
 *     (if only YouTube has matched so far, UPC stays blank and the
 *     admin's existing "Add UPC / Catalog Number" button on the
 *     Approved card still works exactly as it does today for manual
 *     approvals — nothing about that flow changes)
 *   - sets status: "Approved" (same field your admin panel reads)
 *   - sends the approval email via Brevo — the SAME email service
 *     already configured in your Render env (EMAIL_API_KEY, FROM_EMAIL,
 *     FROM_NAME), the one already sending your rejection emails. No
 *     EmailJS private key needed — that whole extra credential is now
 *     unnecessary for this feature.
 *
 * WHAT IT DOES NOT DO
 * - Never touches "Pending" submissions — only "Review".
 * - Never re-approves something already Approved/Rejected.
 * - Never overwrites a UPC/catalog number that's already set (e.g. if
 *   you'd already manually approved it and it's mid-flight for some
 *   other reason — the query only pulls status:"Review" so this is
 *   naturally impossible, but the code guards it anyway).
 *
 * COST: $0. YouTube reuses your existing key/quota. Spotify free tier.
 * iTunes free, no key. Brevo already paid for/configured.
 *
 * ── ONE-TIME SETUP ──────────────────────────────────────────────
 * 1. npm install node-cron   (in your backend project)
 * 2. Add to Render env vars (Environment tab, same place as the rest):
 *      SPOTIFY_CLIENT_ID
 *      SPOTIFY_CLIENT_SECRET
 *    (YOUTUBE_API_KEY and the Brevo/EMAIL_* vars are already there.)
 * 3. In your server.js / index.js, add near the top:
 *
 *      const cron = require('node-cron');
 *      const { checkReviewSubmissionsForLiveRelease } = require('./services/autoApproveLiveReleases');
 *
 *      // Every day at 9am Accra time
 *      cron.schedule('0 9 * * *', () => {
 *        checkReviewSubmissionsForLiveRelease().catch(err =>
 *          console.error('Auto-approve job failed:', err)
 *        );
 *      }, { timezone: 'Africa/Accra' });
 *
 * 4. Deploy as usual (git push → Render auto-deploys).
 *
 * NOTE ON EMAIL: this assumes Brevo's transactional email REST API
 * (api.brevo.com) — the standard way EMAIL_PROVIDER=brevo setups send.
 * If your backend's rejection-email code actually calls Brevo
 * differently (e.g. through a wrapper in services/emailProvider.js),
 * swap the body of sendApprovalEmail() below to call that same
 * wrapper instead — just keep the {email, artistName, songTitle, upc}
 * inputs the same so the rest of this file doesn't need to change.
 * ─────────────────────────────────────────────────────────────────
 */
const admin = require('firebase-admin');
const db = admin.firestore();
const { matchYouTubeVideo } = require('../utils/youtubeTrackMatcher');
// Same helper controllers/submissionController.js already uses for
// notifyRejection() — sendEmail({ to, subject, html }) -> { success, error }.
// Reusing it means sender address, Brevo auth, and error handling all stay
// exactly as they are today; nothing about emailProvider.js needs to change.
const emailProvider = require('../services/emailProvider');
const logger = require('../utils/logger');

// ── CONFIG ──────────────────────────────────────────────────────
const SPOTIFY_CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

const CATALOG_PREFIX = '444M';

// After this many days sitting in Review with no match anywhere,
// leave it alone rather than checking forever (something likely
// failed distribution silently — worth a human looking at it).
const MAX_CHECK_DAYS = 45;

// ── HELPERS ──────────────────────────────────────────────────────
function normalize(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isCloseMatch(a, b) {
  const na = normalize(a), nb = normalize(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

async function getSpotifyToken() {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  return data.access_token;
}

async function findOnSpotify(token, artistName, songTitle) {
  const q = encodeURIComponent(`track:${songTitle} artist:${artistName}`);
  const searchRes = await fetch(`https://api.spotify.com/v1/search?q=${q}&type=track&limit=5`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const searchData = await searchRes.json();
  const tracks = searchData?.tracks?.items || [];

  const match = tracks.find(
    (t) => isCloseMatch(t.name, songTitle) && t.artists.some((a) => isCloseMatch(a.name, artistName))
  );
  if (!match) return null;

  const albumRes = await fetch(`https://api.spotify.com/v1/albums/${match.album.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const albumData = await albumRes.json();

  return {
    upc: albumData?.external_ids?.upc || null,
    spotifyUrl: match.external_urls?.spotify || null,
  };
}

async function findOnItunes(artistName, songTitle) {
  const term = encodeURIComponent(`${artistName} ${songTitle}`);
  const res = await fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=5`);
  const data = await res.json();
  const match = (data.results || []).find(
    (r) => isCloseMatch(r.trackName, songTitle) && isCloseMatch(r.artistName, artistName)
  );
  return match ? { itunesUrl: match.trackViewUrl } : null;
}

async function nextCatalogNumber() {
  const counterRef = db.collection('meta').doc('catalogCounter');
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const next = (snap.exists ? snap.data().value : 0) + 1;
    tx.set(counterRef, { value: next }, { merge: true });
    return `${CATALOG_PREFIX}-${String(next).padStart(4, '0')}`;
  });
}

// Builds the approval email HTML — light theme, matching the visual
// style of buildUserHtml()'s "Submission Received" card in
// submissionController.js (same fonts, colors, card layout), so this
// email looks consistent with the rest of your artist-facing emails
// even though it's built here rather than in that file.
function buildApprovalHtml({ artistName, songTitle, upc }) {
  return `
  <div style="background:#f4f4f5; padding:36px 16px; font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; margin:0 auto;">
      <tr>
        <td align="center" style="padding-bottom:24px;">
          <div style="width:56px; height:56px; line-height:56px; border-radius:50%; background:#1b7a3d; color:#ffffff; font-size:26px; font-weight:800; text-align:center; margin:0 auto 16px auto;">
            &#10003;
          </div>
          <div style="font-size:22px; font-weight:800; color:#0a0a0a;">Your Release Is Live!</div>
          <div style="font-size:13.5px; color:#6b6b6b; margin-top:6px;">It's approved and out on streaming platforms.</div>
        </td>
      </tr>
      <tr>
        <td style="background:#ffffff; border:1px solid #e5e5e5; border-radius:14px; padding:28px 26px;">
          <p style="font-size:14.5px; color:#1a1a1a; line-height:1.6; margin:0 0 14px 0;">
            Hi ${escHtml(artistName || 'there')},
          </p>
          <p style="font-size:14.5px; color:#1a1a1a; line-height:1.6; margin:0 0 18px 0;">
            Great news — we found "<strong>${escHtml(songTitle || 'your release')}</strong>" live on streaming platforms and it's now approved.
          </p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e8f9ee; border:1px solid #bfead0; border-radius:10px;">
            <tr>
              <td style="padding:13px 16px; font-size:12.5px; color:#1b7a3d; font-weight:700;">
                Status: Approved${upc ? ` &nbsp;·&nbsp; UPC: ${escHtml(upc)}` : ''}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </div>`;
}

// Sends the approval email through the SAME emailProvider.sendEmail()
// helper notifyRejection() already uses — same Brevo account, same
// sender config, same error-handling contract ({ success, error }).
async function sendApprovalEmail({ email, artistName, songTitle, upc }) {
  if (!email) return;
  const result = await emailProvider.sendEmail({
    to: email,
    subject: `Your release "${songTitle}" is live and approved 🎉`,
    html: buildApprovalHtml({ artistName, songTitle, upc }),
  });
  if (!result.success) {
    logger.error(`Approval email failed for ${email}: ${result.error}`);
  }
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function isQuotaExceededError(err) {
  const haystack = [err && err.message, err && err.code, err && err.status, err && err.reason]
    .filter(Boolean).join(' ').toLowerCase();
  return (
    haystack.includes('quotaexceeded') ||
    haystack.includes('quota exceeded') ||
    haystack.includes('dailylimitexceeded') ||
    (haystack.includes('403') && haystack.includes('quota'))
  );
}

// Tries YouTube first (reusing your existing matcher/quota-handling),
// then Spotify (also gives the UPC), then iTunes as a last resort.
async function checkIfLive(spotifyToken, artistName, songTitle) {
  try {
    const ytResult = await matchYouTubeVideo(songTitle, artistName);
    if (ytResult && ytResult.autoAccepted && ytResult.bestMatch) {
      return { via: 'youtube', videoId: ytResult.bestMatch.videoId, upc: null };
    }
  } catch (err) {
    if (isQuotaExceededError(err)) {
      return { quotaExceeded: true };
    }
    console.error(`YouTube check failed for "${songTitle}" by ${artistName}:`, err.message);
  }

  const spotifyMatch = await findOnSpotify(spotifyToken, artistName, songTitle).catch((err) => {
    console.error(`Spotify check failed for "${songTitle}" by ${artistName}:`, err.message);
    return null;
  });
  if (spotifyMatch) return { via: 'spotify', upc: spotifyMatch.upc };

  const itunesMatch = await findOnItunes(artistName, songTitle).catch((err) => {
    console.error(`iTunes check failed for "${songTitle}" by ${artistName}:`, err.message);
    return null;
  });
  if (itunesMatch) return { via: 'itunes', upc: null };

  return null;
}

// A submission's releaseTitle is the EP/Album name, NOT necessarily what's
// on YouTube — YouTube uploads are per-track, same as streamAggregator.js
// already accounts for. So: try the release title first (this covers the
// common case — a single, where release title IS the song title), and if
// that finds nothing, fall back to checking each individual track title
// from audioFiles[]. Stops at the very first hit found anywhere.
async function checkIfLiveForSubmission(spotifyToken, sub) {
  const releaseTitle = sub.releaseTitle || sub.songTitle || sub.title || '';
  const artistName = sub.artistName || '';

  if (releaseTitle && artistName) {
    const result = await checkIfLive(spotifyToken, artistName, releaseTitle);
    if (result) return result;
  }

  if (Array.isArray(sub.audioFiles)) {
    for (const track of sub.audioFiles) {
      const trackTitle = (track.title || '').trim();
      if (!trackTitle) continue;

      const mainArtist = Array.isArray(track.artists)
        ? track.artists.find((a) => a.type === 'main')
        : null;
      const trackArtist = (mainArtist && mainArtist.name) || artistName;
      if (!trackArtist) continue;

      const result = await checkIfLive(spotifyToken, trackArtist, trackTitle);
      if (result) return result;
    }
  }

  return null;
}

// ── MAIN JOB ─────────────────────────────────────────────────────
async function checkReviewSubmissionsForLiveRelease() {
  const snap = await db.collection('submissions').where('status', '==', 'Review').get();
  if (snap.empty) return { checked: 0, approved: 0 };

  const spotifyToken = await getSpotifyToken();
  let checked = 0, approved = 0;

  for (const docSnap of snap.docs) {
    const sub = docSnap.data();
    const artistName = sub.artistName || '';
    const songTitle = sub.releaseTitle || sub.songTitle || sub.title || '';
    if (!artistName || !songTitle) continue;

    checked++;

    const result = await checkIfLiveForSubmission(spotifyToken, sub);

    if (result?.quotaExceeded) {
      console.log('YouTube quota exhausted — stopping this pass, will resume next run.');
      break;
    }

    if (result) {
      const catalogNumber = sub.catalogNumber || (await nextCatalogNumber());
      const upc = result.upc || sub.upc || '';

      await docSnap.ref.update({
        status: 'Approved',
        upc,
        catalogNumber,
        needsUpcBackfill: !upc,
        liveConfirmedAt: admin.firestore.FieldValue.serverTimestamp(),
        liveConfirmedVia: result.via,
        rejectionReason: '',
        rejectionCategory: '',
        licenseProofUrl: '',
      });

      await sendApprovalEmail({ email: sub.email, artistName, songTitle, upc });

      approved++;
      console.log(`Approved "${songTitle}" by ${artistName} — live via ${result.via}.`);
    } else {
      const firstChecked = sub.firstCheckedAt?.toDate?.() || new Date();
      const daysSince = (Date.now() - firstChecked.getTime()) / (1000 * 60 * 60 * 24);
      await docSnap.ref.update({
        firstCheckedAt: sub.firstCheckedAt || admin.firestore.FieldValue.serverTimestamp(),
        lastCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
        // Left as "Review" even past MAX_CHECK_DAYS — unlike a Pending
        // queue, Review already means a human is tracking it, so we
        // just stop burning API calls on it rather than changing status.
        ...(daysSince > MAX_CHECK_DAYS ? { autoCheckStale: true } : {}),
      });
    }
  }

  // ── UPC BACKFILL PASS ──────────────────────────────────────────
  // For releases approved via a YouTube-only match, keep checking
  // Spotify until the real UPC shows up.
  const backfillSnap = await db
    .collection('submissions')
    .where('status', '==', 'Approved')
    .where('needsUpcBackfill', '==', true)
    .get();

  for (const docSnap of backfillSnap.docs) {
    const sub = docSnap.data();
    const artistName = sub.artistName || '';
    const songTitle = sub.releaseTitle || sub.songTitle || sub.title || '';
    if (!artistName || !songTitle) continue;

    try {
      const spotifyMatch = await findOnSpotify(spotifyToken, artistName, songTitle);
      if (spotifyMatch?.upc) {
        await docSnap.ref.update({ upc: spotifyMatch.upc, needsUpcBackfill: false });
        console.log(`Backfilled UPC for "${songTitle}" by ${artistName}.`);
      }
    } catch (err) {
      console.error(`UPC backfill failed for "${songTitle}" by ${artistName}:`, err.message);
    }
  }

  return { checked, approved };
}

module.exports = { checkReviewSubmissionsForLiveRelease };
