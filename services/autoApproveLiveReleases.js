/**
 * autoApproveLiveReleases.js
 * ─────────────────────────────────────────────────────────────────
 * Drop into your backend's services/ folder, next to streamAggregator.js.
 * This is a full rewrite of the existing file — same job, same schedule,
 * same triggers — with SmartLink capture added on top.
 *
 * WHAT IT DOES (unchanged from before)
 * Runs on a schedule (node-cron, wired in server.js — see setup notes
 * at the bottom of this comment block). Checks every submission at
 * status: "Review" — already reviewed, sent to your distribution
 * partner, waiting to go live.
 *
 * For each one, it searches:
 *   1. YouTube (via your EXISTING utils/youtubeTrackMatcher.js)
 *   2. Spotify (Client Credentials flow — also gives us UPC + URL)
 *   3. iTunes (free, no key, last resort)
 *
 * As soon as ANY of them confirms the release is live, it:
 *   - assigns a catalog number (444M-0001, 444M-0002, ...)
 *   - pulls the real UPC from Spotify if matched by then
 *   - sets status: "Approved"
 *   - sends the approval email via Brevo (emailProvider.sendEmail)
 *
 * WHAT'S NEW — SMARTLINK CAPTURE
 * The exact same API calls above already return a usable store URL
 * (Spotify track URL, YouTube video URL, iTunes track URL) — this
 * rewrite just stops throwing that data away. At the moment a release
 * is approved, it now also:
 *   - generates a `smartLinkSlug` (e.g. "hold-on-kobe-denzil")
 *   - writes whichever store URL was just found into
 *     `smartLink.stores.{spotify|youtube|itunes}`
 *
 * A second pass (SMARTLINK COMPLETION PASS, replaces the old "UPC
 * backfill" pass — it does everything that one did, plus more) then
 * runs over every Approved release and fills in whatever's still
 * missing:
 *   - Spotify UPC + URL, if the release was only confirmed via
 *     YouTube or iTunes
 *   - Deezer URL, via a free no-auth UPC lookup, once a UPC exists
 * This pass does NOT re-run the YouTube matcher (to avoid burning
 * extra quota on releases it already checked once) — if YouTube
 * didn't match at approval time, it's left for a manual paste-in on
 * the admin panel, same as Boomplay/Amazon/Apple Music already are.
 *
 * Every release ends up with the SAME `smartLink.stores` shape
 * whether a link got there automatically or was pasted in manually
 * by admin.html — the public /l/{slug} page doesn't need to know or
 * care which happened.
 *
 * COST: $0. YouTube reuses your existing key/quota. Spotify + Deezer
 * are both free tier / no-auth. iTunes free, no key. Brevo already
 * paid for/configured.
 *
 * ── ONE-TIME SETUP (unchanged if you already did this before) ─────
 * 1. npm install node-cron   (in your backend project)
 * 2. Render env vars (Environment tab):
 *      SPOTIFY_CLIENT_ID
 *      SPOTIFY_CLIENT_SECRET
 *    (YOUTUBE_API_KEY and the Brevo/EMAIL_* vars are already there.)
 * 3. In server.js / index.js:
 *
 *      const cron = require('node-cron');
 *      const { checkReviewSubmissionsForLiveRelease } = require('./services/autoApproveLiveReleases');
 *
 *      cron.schedule('0 9 * * *', () => {
 *        checkReviewSubmissionsForLiveRelease().catch(err =>
 *          console.error('Auto-approve job failed:', err)
 *        );
 *      }, { timezone: 'Africa/Accra' });
 *
 * 4. Deploy as usual (git push → Render auto-deploys).
 * ─────────────────────────────────────────────────────────────────
 */
const admin = require('firebase-admin');
const db = admin.firestore();
const { matchYouTubeVideo } = require('../utils/youtubeTrackMatcher');
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

// Turns "Kobe Denzil" + "Hold On" into "hold-on-kobe-denzil".
function slugify(artistName, releaseTitle) {
  const raw = `${releaseTitle || ''} ${artistName || ''}`;
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2') // camelCase boundary -> hyphen
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
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
  const searchRes = await fetch(`https://api.spotify.com/v1/search?q=${q}&type=track&limit=20`, {
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

// Deezer — free, no auth, direct UPC lookup. Only usable once we
// already have a UPC in hand (from Spotify, either at approval time
// or via the completion pass below).
async function findOnDeezer(upc) {
  if (!upc) return null;
  try {
    const res = await fetch(`https://api.deezer.com/2.0/album/upc:${encodeURIComponent(upc)}`);
    const data = await res.json();
    if (data && data.error) return null; // Deezer returns {error:...} for no match, not a 404
    return data && data.link ? { deezerUrl: data.link } : null;
  } catch (err) {
    console.error(`Deezer lookup failed for UPC ${upc}:`, err.message);
    return null;
  }
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
// submissionController.js.
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
// then Spotify (also gives UPC + URL), then iTunes as a last resort.
// Now returns whichever store URL it actually found, not just `via`.
async function checkIfLive(spotifyToken, artistName, songTitle) {
  try {
    const ytResult = await matchYouTubeVideo(songTitle, artistName);
    if (ytResult && ytResult.autoAccepted && ytResult.bestMatch) {
      return {
        via: 'youtube',
        upc: null,
        youtubeUrl: `https://www.youtube.com/watch?v=${ytResult.bestMatch.videoId}`,
      };
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
  if (spotifyMatch) {
    return { via: 'spotify', upc: spotifyMatch.upc, spotifyUrl: spotifyMatch.spotifyUrl };
  }

  const itunesMatch = await findOnItunes(artistName, songTitle).catch((err) => {
    console.error(`iTunes check failed for "${songTitle}" by ${artistName}:`, err.message);
    return null;
  });
  if (itunesMatch) {
    return { via: 'itunes', upc: null, itunesUrl: itunesMatch.itunesUrl };
  }

  return null;
}

// A submission's releaseTitle is the EP/Album name, NOT necessarily what's
// on YouTube — YouTube uploads are per-track. So: try the release title
// first (covers the common case — a single), and if that finds nothing,
// fall back to checking each individual track title from audioFiles[].
// Stops at the very first hit found anywhere.
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
      const slug = sub.smartLinkSlug || slugify(artistName, songTitle);

      // Whichever store this particular check found a URL for — build
      // just that one entry now. Anything else gets filled in by the
      // completion pass below (or pasted manually in admin.html).
      const storeUpdates = {};
      if (result.spotifyUrl) storeUpdates['smartLink.stores.spotify'] = result.spotifyUrl;
      if (result.youtubeUrl) storeUpdates['smartLink.stores.youtube'] = result.youtubeUrl;
      if (result.itunesUrl)  storeUpdates['smartLink.stores.itunes']  = result.itunesUrl;

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
        smartLinkSlug: slug,
        'smartLink.lastAutoCheckedAt': admin.firestore.FieldValue.serverTimestamp(),
        ...storeUpdates,
      });

      await sendApprovalEmail({ email: sub.email, artistName, songTitle, upc });

      approved++;
      console.log(`Approved "${songTitle}" by ${artistName} — live via ${result.via}. SmartLink: /l/${slug}`);
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

  // ── SMARTLINK COMPLETION PASS ────────────────────────────────────
  // Runs over every Approved release and fills in whatever's still
  // missing: Spotify UPC/URL (if only YouTube/iTunes matched at
  // approval time), then Deezer once a UPC exists. Does NOT re-run
  // the YouTube matcher, to avoid burning extra quota on releases it
  // already checked once — a missing YouTube link stays a manual
  // paste-in on the admin panel, same as Boomplay/Amazon/Apple Music.
  const approvedSnap = await db.collection('submissions').where('status', '==', 'Approved').get();
  for (const docSnap of approvedSnap.docs) {
    const sub = docSnap.data();
    const artistName = sub.artistName || '';
    const songTitle = sub.releaseTitle || sub.songTitle || sub.title || '';
    if (!artistName || !songTitle) continue;

    const stores = (sub.smartLink && sub.smartLink.stores) || {};
    const updates = {};
    let upcForDeezer = sub.upc || '';

    // BACKFILL — releases approved before SmartLink existed (or
    // approved manually via admin.html, which never wrote this field)
    // have no smartLinkSlug at all. Generate one now, once, same as
    // the main job does at approval time. This never overwrites an
    // existing slug.
    if (!sub.smartLinkSlug) {
      updates.smartLinkSlug = slugify(artistName, songTitle);
    }
    if (!stores.spotify || !sub.upc) {
      try {
        const spotifyMatch = await findOnSpotify(spotifyToken, artistName, songTitle);
        if (spotifyMatch) {
          if (spotifyMatch.upc && !sub.upc) {
            updates.upc = spotifyMatch.upc;
            updates.needsUpcBackfill = false;
            upcForDeezer = spotifyMatch.upc;
          }
          if (spotifyMatch.spotifyUrl && !stores.spotify) {
            updates['smartLink.stores.spotify'] = spotifyMatch.spotifyUrl;
          }
        }
      } catch (err) {
        console.error(`Spotify completion check failed for "${songTitle}" by ${artistName}:`, err.message);
      }
    }

    if (!stores.deezer && upcForDeezer) {
      const deezerMatch = await findOnDeezer(upcForDeezer);
      if (deezerMatch?.deezerUrl) {
        updates['smartLink.stores.deezer'] = deezerMatch.deezerUrl;
      }
    }

    if (Object.keys(updates).length > 0) {
      updates['smartLink.lastAutoCheckedAt'] = admin.firestore.FieldValue.serverTimestamp();
      await docSnap.ref.update(updates);
      console.log(`SmartLink completion updated "${songTitle}" by ${artistName}:`, Object.keys(updates));
    }
  }

  return { checked, approved };
}

module.exports = { checkReviewSubmissionsForLiveRelease };
