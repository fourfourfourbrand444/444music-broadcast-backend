/**
 * services/avvoService.js
 *
 * Sends ONE paid submission to AVVO (distribution API).
 *
 * What it does, in order:
 *   1. Checks AVVO is switched on (AVVO_ENABLED=true) and the key matches the URL
 *      (a test key can only be used with the sandbox URL, a live key only with live).
 *   2. Reads the submission from Firestore (1 read) and checks it can be sent.
 *   3. Converts it to AVVO's format (language code, Yes/No -> true/false,
 *      copyright year from release date, credits split, and so on).
 *   4. Downloads the cover and each WAV from Cloudinary and uploads them to AVVO.
 *   5. Creates the release at AVVO (with an Idempotency-Key).
 *   6. Saves the result back on the submission (1 write at the end, 1 at the start).
 *
 * The long part (steps 4-6) runs in the background, because it can take
 * longer than a browser request is allowed to stay open. The admin page reads
 * avvoSendState / avvoStatus from the submission to see how it went.
 *
 * Fields this file writes on the submission (it never touches status, upc,
 * isrc, payment, emails or anything else):
 *   avvoSendState        'sending' | 'sent' | 'failed'
 *   avvoSendStartedAt    ms timestamp
 *   avvoReleaseId        AVVO's release id
 *   avvoPartnerReleaseId the id we sent (submission id, or "<id>-v2" for a resend)
 *   avvoAttempt          1, 2, 3 ... (counts releases created at AVVO)
 *   avvoStatus           AVVO's machine status (moderation, scheduled, ...)
 *   avvoTracks           [{ trackId, partnerTrackId, title, isrc }]
 *   avvoSentAt, avvoSentBy, avvoWarnings, avvoLastError, avvoLastErrorAt
 *
 * Not sent to AVVO because AVVO has no field for them: musicians, version,
 * previous release info, artist Spotify/Apple URLs, catalog number, phone.
 *
 * Needs Node 18+ (built-in fetch). No new npm packages.
 */

const crypto = require('crypto');
const admin = require('firebase-admin');
const logger = require('../utils/logger');
const { getObjectBuffer, isAudioKey } = require('./r2Audio');

// Files are only fetched from Cloudinary. The links on a submission are
// written from the browser, so anything else is refused.
const ALLOWED_ASSET_HOSTS = ['res.cloudinary.com'];

const MAX_AUDIO_BYTES = 120 * 1024 * 1024;
const MAX_COVER_BYTES = 40 * 1024 * 1024;
const STALE_SENDING_MS = 20 * 60 * 1000; // a "sending" mark older than this is treated as dead
const RETRY_DELAYS_MS = [1000, 3000, 8000];
const MAX_RETRY_WAIT_MS = 30 * 1000;

const NOT_WAV = /\.(mp3|m4a|aac|ogg|flac|wma|mp4)(\?|#|$)/i;
const NOT_JPG = /\.(png|gif|webp|bmp|tiff?)(\?|#|$)/i;

// One server instance, so an in-memory set is enough to stop a double click.
const inFlight = new Set();

/* ───────────────────────── errors ───────────────────────── */

// A problem we can explain to the admin (bad data, switched off, already sent...).
class AvvoSendError extends Error {
  constructor(message, httpStatus) {
    super(message);
    this.name = 'AvvoSendError';
    this.httpStatus = httpStatus || 400;
  }
}

// A problem talking to AVVO or downloading/uploading a file.
class AvvoApiError extends Error {
  constructor(message, info) {
    super(message);
    this.name = 'AvvoApiError';
    const i = info || {};
    this.status = i.status || 0;
    this.code = i.code || '';
    this.field = i.field || '';
    this.requestId = i.requestId || '';
    this.retryable = !!i.retryable;
    this.retryAfterMs = i.retryAfterMs || 0;
  }
}

function describeError(err) {
  if (err instanceof AvvoApiError) {
    let text = (err.code ? `${err.code}: ` : '') + err.message;
    if (err.field) text += ` (field: ${err.field})`;
    if (err.requestId) text += ` [${err.requestId}]`;
    return text.slice(0, 500);
  }
  return String(err && err.message ? err.message : err).slice(0, 500);
}

// fetch() hides the real reason inside err.cause (ENOTFOUND, ECONNREFUSED,
// certificate errors...). This pulls it out so it can be shown and logged.
function networkDetail(e) {
  if (!e) return 'unknown error';
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return 'timed out';
  const cause = e.cause || {};
  const parts = [];
  if (cause.code) parts.push(cause.code);
  else if (e.code) parts.push(e.code);
  const msg = cause.message || e.message;
  if (msg && !parts.includes(msg)) parts.push(msg);
  return (parts.join(' - ') || e.name || 'network error').slice(0, 200);
}

// Retrying will not fix a hostname that does not exist or a bad certificate.
function networkErrorIsRetryable(e) {
  if (!e) return true;
  const code = String((e.cause && e.cause.code) || e.code || '');
  const text = String((e.cause && e.cause.message) || e.message || '');
  if (code === 'ENOTFOUND' || code === 'ERR_INVALID_URL') return false;
  if (/^(CERT_|ERR_TLS_|UNABLE_TO_|DEPTH_ZERO_|SELF_SIGNED_|ERR_SSL_)/.test(code)) return false;
  if (/certificate|invalid url/i.test(text)) return false;
  return true;
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch (e) {
    return String(url).slice(0, 60);
  }
}

/* ───────────────────────── config ───────────────────────── */

function isEnabled() {
  return String(process.env.AVVO_ENABLED || '').trim().toLowerCase() === 'true';
}

function getConfig() {
  if (!isEnabled()) {
    throw new AvvoSendError('AVVO is switched off (AVVO_ENABLED is not true).', 503);
  }
  if (typeof fetch !== 'function') {
    throw new AvvoSendError('This server needs Node 18 or newer (built-in fetch is missing).', 500);
  }
  const apiKey = String(process.env.AVVO_API_KEY || '').trim();
  const baseUrl = String(process.env.AVVO_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!apiKey) throw new AvvoSendError('AVVO_API_KEY is not set on the server.', 500);
  if (!baseUrl) throw new AvvoSendError('AVVO_BASE_URL is not set on the server.', 500);
  if (!/^https:\/\//i.test(baseUrl)) throw new AvvoSendError('AVVO_BASE_URL must start with https://', 500);

  // Safety: a test key must never point at live and a live key must never point at sandbox.
  const sandboxUrl = /sandbox-api\./i.test(baseUrl);
  if (apiKey.startsWith('avvo_live_') && sandboxUrl) {
    throw new AvvoSendError('AVVO_API_KEY is a live key but AVVO_BASE_URL is the sandbox. Fix the settings.', 500);
  }
  if (apiKey.startsWith('avvo_test_') && !sandboxUrl) {
    throw new AvvoSendError('AVVO_API_KEY is a test key but AVVO_BASE_URL is not the sandbox. Fix the settings.', 500);
  }
  return { apiKey, baseUrl, sandbox: sandboxUrl };
}

/* ───────────────────────── small helpers ───────────────────────── */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clean = (v) => String(v == null ? '' : v).trim();

function uniqueNames(list) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach((n) => {
    const s = clean(n);
    if (s && !out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s);
  });
  return out;
}

function isYes(v) {
  return v === true || clean(v).toLowerCase() === 'yes' || clean(v).toLowerCase() === 'true';
}

function isPaid(d) {
  return d.paymentVerified === true || clean(d.paid).toLowerCase() === 'paid';
}

function toIsoDate(value) {
  const s = clean(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// "© 2026 Kwame" -> "Kwame" (AVVO asks for the holder name and the year separately)
function cleanHolder(value) {
  return clean(value)
    .replace(/[©℗]/g, '')
    .replace(/\((c|p)\)/gi, '')
    .replace(/^\s*\d{4}\s*/, '')
    .trim();
}

function validUpc(value, warnings) {
  const raw = clean(value);
  if (!/\d/.test(raw)) return null;
  const digits = raw.replace(/[\s-]/g, '');
  if (/^\d{12,14}$/.test(digits)) return digits;
  warnings.push(`UPC "${raw}" is not 12-14 digits, so it was not sent and AVVO will assign one.`);
  return null;
}

function validIsrc(value, warnings) {
  const raw = clean(value);
  if (!/\d/.test(raw)) return null;
  const code = raw.replace(/[\s-]/g, '').toUpperCase();
  if (/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(code)) return code;
  warnings.push(`ISRC "${raw}" is not a valid ISRC, so it was not sent and AVVO will assign one.`);
  return null;
}

function normaliseType(value) {
  const t = clean(value).toLowerCase().replace(/\./g, '');
  if (t === 'single' || t === 'ep' || t === 'album') return t;
  throw new AvvoSendError(`Release type "${clean(value) || 'empty'}" is not single, EP or album.`, 400);
}

// Songwriter credits -> AVVO composers and lyricists.
// Role mentions lyrics/author -> lyricist. Role mentions composer/music -> composer.
// Anything else (for example "Songwriter") counts as both.
function splitWriters(writers) {
  const composers = [];
  const lyricists = [];
  (Array.isArray(writers) ? writers : []).forEach((w) => {
    const name = clean(w && w.name);
    if (!name) return;
    const role = clean(w.role).toLowerCase();
    const isLyric = /lyric|author|word/.test(role);
    const isComp = /compos|music|melod/.test(role);
    if (isLyric || (!isLyric && !isComp)) lyricists.push(name);
    if (isComp || (!isLyric && !isComp)) composers.push(name);
  });
  return { composers: uniqueNames(composers), lyricists: uniqueNames(lyricists) };
}

/* ───────────────────────── language codes ───────────────────────── */
// The Release Info dropdown stores a name (for example "Akan (Twi)"). AVVO wants a code.
// Codes for languages without a 2-letter code are best guesses: the sandbox will tell us.
const LANGUAGE_CODES = {
  english: 'en', french: 'fr', spanish: 'es', portuguese: 'pt', arabic: 'ar', german: 'de',
  italian: 'it', dutch: 'nl', russian: 'ru', turkish: 'tr', hindi: 'hi', urdu: 'ur',
  chinese: 'zh', mandarin: 'zh', japanese: 'ja', korean: 'ko', swahili: 'sw', hausa: 'ha',
  yoruba: 'yo', igbo: 'ig', amharic: 'am', somali: 'so', zulu: 'zu', xhosa: 'xh',
  afrikaans: 'af', shona: 'sn', wolof: 'wo', lingala: 'ln', tigrinya: 'ti', oromo: 'om',
  malagasy: 'mg', kinyarwanda: 'rw', kirundi: 'rn', sesotho: 'st', setswana: 'tn', tswana: 'tn',
  akan: 'ak', twi: 'ak', fante: 'fat', ga: 'gaa', ewe: 'ee', dagbani: 'dag', dagaare: 'dga',
  nzema: 'nzi', pidgin: 'pcm', 'nigerian pidgin': 'pcm', 'pidgin english': 'pcm',
  'русский': 'ru', 'español': 'es', 'français': 'fr', deutsch: 'de', italiano: 'it', 'português': 'pt',
  '日本語': 'ja', '한국어': 'ko', '中文': 'zh', 'العربية': 'ar', 'हिन्दी': 'hi', 'türkçe': 'tr',
  nederlands: 'nl', polski: 'pl', svenska: 'sv', norsk: 'no', suomi: 'fi', dansk: 'da',
  'čeština': 'cs', 'română': 'ro', magyar: 'hu', 'ελληνικά': 'el', 'українська': 'uk',
  "o'zbek": 'uz', 'қазақ': 'kk', 'தமிழ்': 'ta', 'తెలుగు': 'te', 'ไทย': 'th', 'tiếng việt': 'vi',
  'bahasa indonesia': 'id', 'bahasa melayu': 'ms', filipino: 'fil', kiswahili: 'sw',
};

function languageToCode(name) {
  const full = clean(name).toLowerCase().replace(/\s+/g, ' ');
  if (!full) return null;
  if (LANGUAGE_CODES[full]) return LANGUAGE_CODES[full];
  const before = full.split('(')[0].trim();
  if (LANGUAGE_CODES[before]) return LANGUAGE_CODES[before];
  const inside = (/\(([^)]+)\)/.exec(full) || [])[1];
  if (inside && LANGUAGE_CODES[inside.trim()]) return LANGUAGE_CODES[inside.trim()];
  const firstWord = before.split(' ')[0];
  if (LANGUAGE_CODES[firstWord]) return LANGUAGE_CODES[firstWord];
  return null;
}

/* ───────────────────────── submission -> AVVO ───────────────────────── */

const AVVO_GENRES = ['Pop', 'Rock', 'Hip-Hop/Rap', 'R&B', 'Electronic', 'Jazz', 'Classical', 'Country', 'Latin',
  'Reggaeton', 'K-Pop', 'Indie', 'Metal', 'Punk', 'Blues', 'Soul', 'Funk', 'Disco', 'House', 'Techno', 'Trap',
  'Drill', 'Afrobeat', 'Dancehall', 'Folk', 'Other'];

function toAvvoGenre(value) {
  const g = clean(value).toLowerCase();
  const exact = AVVO_GENRES.find((x) => x.toLowerCase() === g);
  if (exact) return exact;
  if (/hip|rap/.test(g)) return 'Hip-Hop/Rap';
  if (/r&b|rnb|r and b/.test(g)) return 'R&B';
  if (/afro/.test(g)) return 'Afrobeat';
  if (/dancehall|reggae/.test(g)) return /reggaeton/.test(g) ? 'Reggaeton' : 'Dancehall';
  if (/electro|dance|edm/.test(g)) return 'Electronic';
  if (/alternative|indie/.test(g)) return 'Indie';
  if (/rock/.test(g)) return 'Rock';
  if (/metal/.test(g)) return 'Metal';
  if (/pop/.test(g)) return 'Pop';
  if (/jazz/.test(g)) return 'Jazz';
  if (/classic/.test(g)) return 'Classical';
  if (/country/.test(g)) return 'Country';
  if (/latin/.test(g)) return 'Latin';
  if (/soul/.test(g)) return 'Soul';
  if (/folk/.test(g)) return 'Folk';
  return 'Other';
}

function assertAssetUrl(url, label, wrongTypePattern, expectedType) {
  if (!url) throw new AvvoSendError(`${label} is missing on this submission.`, 400);
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    throw new AvvoSendError(`${label} link is not a valid URL.`, 400);
  }
  if (parsed.protocol !== 'https:' || !ALLOWED_ASSET_HOSTS.includes(parsed.hostname)) {
    throw new AvvoSendError(`${label} is not hosted on Cloudinary, so it was not downloaded.`, 400);
  }
  if (wrongTypePattern.test(parsed.pathname)) {
    throw new AvvoSendError(`${label} is not a ${expectedType} file. AVVO only accepts ${expectedType === 'WAV' ? 'WAV audio' : 'JPG artwork'}.`, 400);
  }
}

// Audio can come from R2 ("r2:audio/<uid>/<id>.wav") or, for older releases, Cloudinary.
function assertAudioSource(url, label) {
  if (typeof url === 'string' && url.startsWith('r2:')) {
    if (!isAudioKey(url.slice(3))) throw new AvvoSendError(`${label} has an invalid file key.`, 400);
    return;
  }
  assertAssetUrl(url, label, NOT_WAV, 'WAV');
}

// Builds the AVVO request body. The upload ids are placeholders here and are
// replaced by the real ones after the files are uploaded.
function buildRelease(data, partnerReleaseId) {
  const warnings = [];

  const title = clean(data.releaseTitle);
  const artist = clean(data.artistName);
  if (!title) throw new AvvoSendError('Release title is missing.', 400);
  if (!artist) throw new AvvoSendError('Artist name is missing.', 400);

  const type = normaliseType(data.releaseType);
  const isSingle = type === 'single';

   let releaseDate = toIsoDate(data.releaseDate);
  let dateShift = null;
  if (!releaseDate) throw new AvvoSendError('Release date is missing or not a valid date.', 400);
   const floorDay = new Date();
  floorDay.setUTCHours(0, 0, 0, 0);
  floorDay.setUTCDate(floorDay.getUTCDate() + 3);
  const floorIso = floorDay.toISOString().slice(0, 10);
  if (releaseDate < floorIso) {
    const days = Math.round((floorDay - new Date(releaseDate + 'T00:00:00Z')) / 86400000);
    dateShift = { from: releaseDate, to: floorIso, days };
    releaseDate = floorIso;
    warnings.push(`Release date moved from ${dateShift.from} to ${dateShift.to} (${days} day${days === 1 ? '' : 's'} later) because it was less than 3 days away.`);
  }
      
  const year = parseInt(releaseDate.slice(0, 4), 10);
  const minDay = new Date();
  minDay.setUTCHours(0, 0, 0, 0);
  minDay.setUTCDate(minDay.getUTCDate() + 3);
  if (new Date(releaseDate + 'T00:00:00Z') < minDay) {
    throw new AvvoSendError('Release date must be at least 3 days from today. Ask the artist to pick a later date.', 400);
  }

  const audioFiles = Array.isArray(data.audioFiles) ? data.audioFiles : [];
  if (!audioFiles.length) throw new AvvoSendError('This submission has no audio files.', 400);
  if (isSingle && audioFiles.length > 1) throw new AvvoSendError('A single can only have one track.', 400);

  // The original upload, not a dashboard quick-edit cover.
  const coverUrl = clean(data.officialCoverURL) || clean(data.coverURL);
  assertAssetUrl(coverUrl, 'Cover art', NOT_JPG, 'JPG');

  const holder = cleanHolder(data.copyright) || artist;
  const languageCode = languageToCode(data.language);
  if (clean(data.language) && clean(data.language).toLowerCase() !== 'other' && !languageCode) {
    warnings.push(`Language "${clean(data.language)}" has no code in avvoService.js, so no language was sent.`);
  }

  const credits = data.credits || {};
  const producers = uniqueNames((Array.isArray(credits.producer) ? credits.producer : []).map((c) => c && c.name));
  const publishers = uniqueNames((Array.isArray(credits.publishing) ? credits.publishing : []).map((c) => c && c.name));
  const { composers, lyricists } = splitWriters(credits.writer);

  const explicit = isYes(data.explicit);
  const instrumental = /instrumental/i.test(clean(data.vocalType));

  // ISRC / lyrics are one field on our side, so they only fit a single.
  let isrc = null;
  if (isSingle) {
    isrc = validIsrc(data.isrc, warnings);
  } else if (/\d/.test(clean(data.isrc))) {
    warnings.push('ISRC was not sent for an EP/album (one field cannot cover several tracks), so AVVO will assign them.');
  }
  const lyrics = clean(data.lyrics);
  if (lyrics && !isSingle) warnings.push('Lyrics were not sent for an EP/album (one field cannot cover several tracks).');

  const tracks = audioFiles.map((t, i) => {
    const n = i + 1;
    const audioUrl = clean(t && t.url);
        assertAudioSource(audioUrl, `Track ${n} audio`);

    const artistList = Array.isArray(t.artists) ? t.artists : [];
    const mains = uniqueNames(artistList.filter((a) => a && a.type === 'main').map((a) => a.name));
    const feats = uniqueNames(artistList.filter((a) => a && a.type === 'featured').map((a) => a.name));

    const track = {
      partner_track_id: `${partnerReleaseId}-t${n}`,
      track_number: n,
      title: clean(t.title) || title,
      artist: mains.length ? mains.join(', ') : artist,
      explicit,
      instrumental,
      isrc,
      audio_upload_id: 'PENDING_UPLOAD',
    };
    if (feats.length) track.feat_artist = feats.join(', ');
    if (languageCode && !instrumental) track.language = languageCode;
    if (producers.length) track.producers = producers;
    if (composers.length) track.composers = composers;
    if (lyricists.length) track.lyricists = lyricists;
    if (publishers.length) track.publishers = publishers;
    if (isSingle && lyrics) track.lyrics = lyrics;

    return { track, audioUrl, feats };
  });

  const payload = {
    partner_release_id: partnerReleaseId,
    title,
    artist,
    type,
    label: clean(data.label) || 'Independent',
    c_year: year,
    c_holders: [holder],
    p_year: year,
    p_holders: [holder],
    release_date: releaseDate,
    explicit,
    upc: validUpc(data.upc, warnings), // null = AVVO assigns
    cover_upload_id: 'PENDING_UPLOAD',
    territory: 'worldwide',
    tracks: tracks.map((x) => x.track),
  };
  if (clean(data.genre)) payload.genre = toAvvoGenre(data.genre);
  if (languageCode) payload.language = languageCode;
  if (lyricists.length) payload.author = lyricists.join(', ');
  if (composers.length) payload.composer = composers.join(', ');
  if (isSingle && tracks[0].feats.length) payload.feat_artist = tracks[0].feats.join(', ');

  // Optional: AVVO_DSP="spotify,apple_music,..." sends a store list.
  // Left unset, dsp is left out and AVVO decides (to be confirmed with AVVO / sandbox).
  const dsp = String(process.env.AVVO_DSP || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (dsp.length) payload.dsp = dsp;

    return {
    payload,
    warnings,
    dateShift,
    coverUrl,
    trackAudioUrls: tracks.map((x) => x.audioUrl),
  };
}

// First send uses the submission id. A resend after AVVO returned the release
// uses "<id>-v2", "<id>-v3"... because AVVO treats a repeated id as "already exists".
function partnerIdFor(submissionId, data) {
  const attempt = (Number(data.avvoAttempt) || 0) + 1;
  return {
    attempt,
    partnerReleaseId: attempt === 1 ? submissionId : `${submissionId}-v${attempt}`,
  };
}

// Used by the webhook later: "<id>-v2" -> "<id>"
function submissionIdFromPartnerReleaseId(partnerReleaseId) {
  return clean(partnerReleaseId).replace(/-v\d+$/, '');
}

function assertSendable(data) {
  if (!data) throw new AvvoSendError('Submission not found.', 404);
  if (clean(data.status).toLowerCase() !== 'review') {
    throw new AvvoSendError(`Only releases in Review can be sent (this one is "${clean(data.status) || 'unknown'}").`, 409);
  }
  if (!isPaid(data)) throw new AvvoSendError('This release is not paid yet.', 409);
  if (
    data.avvoSendState === 'sending' &&
    Date.now() - Number(data.avvoSendStartedAt || 0) < STALE_SENDING_MS
  ) {
    throw new AvvoSendError('This release is already being sent to AVVO.', 409);
  }
  if (data.avvoReleaseId && clean(data.avvoStatus).toLowerCase() !== 'returned') {
    throw new AvvoSendError(`Already sent to AVVO (status: ${data.avvoStatus || 'unknown'}).`, 409);
  }
}

/* ───────────────────────── talking to AVVO ───────────────────────── */

async function withRetry(fn) {
  let lastErr;
  for (let i = 0; i <= RETRY_DELAYS_MS.length; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!err.retryable || i === RETRY_DELAYS_MS.length) throw err;
      const wait = err.retryAfterMs || RETRY_DELAYS_MS[i];
      logger.warn(`[avvo] retrying in ${wait} ms after: ${describeError(err)}`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

async function avvoRequest(cfg, method, path, body, extraHeaders) {
  const headers = Object.assign(
    { Authorization: `Bearer ${cfg.apiKey}`, Accept: 'application/json' },
    extraHeaders || {}
  );
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const url = `${cfg.baseUrl}${path}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60 * 1000),
    });
  } catch (e) {
    throw new AvvoApiError(
      `Could not reach AVVO at ${hostOf(url)} (${networkDetail(e)}).`,
      { retryable: networkErrorIsRetryable(e) }
    );
  }

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (e) {
    json = null;
  }

  if (!res.ok) {
    const e = (json && json.error) || {};
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new AvvoApiError(e.message || `AVVO returned HTTP ${res.status}.`, {
      status: res.status,
      code: e.code,
      field: e.field,
      requestId: e.request_id,
      retryable: res.status === 429 || res.status >= 500,
      retryAfterMs: retryAfter > 0 ? Math.min(retryAfter * 1000, MAX_RETRY_WAIT_MS) : 0,
    });
  }
  return json || {};
}

async function downloadFile(url, label, maxBytes) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(5 * 60 * 1000) });
  } catch (e) {
    throw new AvvoApiError(
      `Could not download ${label} from Cloudinary (${networkDetail(e)}).`,
      { retryable: networkErrorIsRetryable(e) }
    );
  }
  if (!res.ok) {
    throw new AvvoApiError(`Could not download ${label} from Cloudinary (HTTP ${res.status}).`, {
      status: res.status,
      retryable: res.status >= 500,
    });
  }
  const declared = Number(res.headers.get('content-length'));
  if (declared > maxBytes) {
    throw new AvvoApiError(`${label} is too large (${Math.round(declared / 1048576)} MB).`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > maxBytes) {
    throw new AvvoApiError(`${label} is too large (${Math.round(buffer.length / 1048576)} MB).`);
  }
  return buffer;
}

// Reads one WAV straight from the private R2 bucket (server-side, no public link).
async function downloadR2(key, label, maxBytes) {
  let buffer;
  try {
    buffer = await getObjectBuffer(key);
  } catch (e) {
    const status = (e && e.$metadata && e.$metadata.httpStatusCode) || 0;
    if (status === 404 || (e && e.name === 'NoSuchKey')) {
      throw new AvvoApiError(`${label} was not found in R2. It may have been deleted.`, { status: 404 });
    }
    throw new AvvoApiError(`Could not read ${label} from R2 (${(e && e.message) || 'unknown error'}).`, {
      status,
      retryable: !status || status >= 500,
    });
  }
  if (buffer.length > maxBytes) {
    throw new AvvoApiError(`${label} is too large (${Math.round(buffer.length / 1048576)} MB).`);
  }
  return buffer;
}

// The upload link AVVO gives us is already signed, so NO Authorization header here.
async function putFile(uploadUrl, method, contentType, buffer, label) {
  let res;
  try {
    res = await fetch(uploadUrl, {
      method: method || 'PUT',
      headers: { 'Content-Type': contentType },
      body: buffer,
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
  } catch (e) {
    throw new AvvoApiError(
      `Upload of ${label} to AVVO failed at ${hostOf(uploadUrl)} (${networkDetail(e)}).`,
      { retryable: networkErrorIsRetryable(e) }
    );
  }
  if (!res.ok) {
    const snippet = (await res.text().catch(() => '')).slice(0, 200);
    throw new AvvoApiError(`Upload of ${label} to AVVO was refused (HTTP ${res.status}). ${snippet}`.trim(), {
      status: res.status,
      retryable: res.status >= 500,
    });
  }
}

// download -> ask AVVO for an upload slot -> upload -> validate
async function uploadAsset(cfg, spec) {
  const buffer = String(spec.url).startsWith('r2:')
    ? await withRetry(() => downloadR2(String(spec.url).slice(3), spec.label, spec.maxBytes))
    : await withRetry(() => downloadFile(spec.url, spec.label, spec.maxBytes));
  const slot = await withRetry(() =>
    avvoRequest(cfg, 'POST', '/uploads', {
      type: spec.type,
      filename: spec.filename,
      content_type: spec.contentType,
    })
  );
  if (!slot.upload_id || !slot.upload_url) {
    throw new Error(`AVVO did not return an upload slot for ${spec.label}.`);
  }
  await withRetry(() => putFile(slot.upload_url, slot.upload_method, spec.contentType, buffer, spec.label));
  await withRetry(() => avvoRequest(cfg, 'POST', `/uploads/${encodeURIComponent(slot.upload_id)}/complete`));
  return slot.upload_id;
}

/* ───────────────────────── the send itself ───────────────────────── */

function submissionRef(submissionId) {
  return admin.firestore().collection('submissions').doc(submissionId);
}

// Runs in the background. Never throws: any failure is saved on the submission.
async function runSend(submissionId, cfg, built, ctx) {
  const ref = submissionRef(submissionId);
  const FieldValue = admin.firestore.FieldValue;
  try {
    const payload = built.payload;

    payload.cover_upload_id = await uploadAsset(cfg, {
      type: 'artwork',
      url: built.coverUrl,
      filename: `${ctx.partnerReleaseId}-cover.jpg`,
      contentType: 'image/jpeg',
      label: 'cover art',
      maxBytes: MAX_COVER_BYTES,
    });

    for (let i = 0; i < payload.tracks.length; i++) {
      payload.tracks[i].audio_upload_id = await uploadAsset(cfg, {
        type: 'audio',
        url: built.trackAudioUrls[i],
        filename: `${ctx.partnerReleaseId}-t${i + 1}.wav`,
        contentType: 'audio/wav',
        label: `track ${i + 1} audio`,
        maxBytes: MAX_AUDIO_BYTES,
      });
    }

    const idempotencyKey = crypto.randomUUID();
    const created = await withRetry(() =>
      avvoRequest(cfg, 'POST', '/releases', payload, { 'Idempotency-Key': idempotencyKey })
    );

    const warnings = built.warnings.slice();
    if (created.duplicate) {
      warnings.push('AVVO already had a release with this id, so this was linked to the existing one.');
    }

    await ref.update({
      avvoSendState: 'sent',
      avvoReleaseId: created.release_id || '',
      avvoPartnerReleaseId: ctx.partnerReleaseId,
      avvoAttempt: ctx.attempt,
      avvoStatus: created.status || 'moderation',
      avvoSentAt: Date.now(),
      avvoSentBy: ctx.adminEmail,
      ...(built.dateShift ? {
        releaseDate: `${built.dateShift.to}T00:00:00.000Z`,
        originalReleaseDate: built.dateShift.from,
        avvoDateShiftDays: built.dateShift.days,
      } : {}),
      avvoTracks: (Array.isArray(created.tracks) ? created.tracks : []).map((t) => ({
        trackId: t.track_id || '',
        partnerTrackId: t.partner_track_id || '',
        title: t.title || '',
        isrc: t.isrc || null,
      })),
      avvoWarnings: warnings,
      avvoLastError: FieldValue.delete(),
      avvoLastErrorAt: FieldValue.delete(),
    });
    logger.info(`[avvo] ${submissionId} sent as ${ctx.partnerReleaseId} (AVVO release ${created.release_id}).`);
  } catch (err) {
    const message = describeError(err);
    logger.error(`[avvo] sending ${submissionId} failed: ${message}`);
    try {
      await ref.update({
        avvoSendState: 'failed',
        avvoLastError: message,
        avvoLastErrorAt: Date.now(),
      });
    } catch (writeErr) {
      logger.error(`[avvo] could not save the failure for ${submissionId}: ${writeErr.message}`);
    }
  } finally {
    inFlight.delete(submissionId);
  }
}

// Checks everything, marks the submission as "sending", starts the background job.
// Throws AvvoSendError if it cannot be sent (nothing is written in that case).
async function startSend(submissionId, adminInfo) {
  const cfg = getConfig();
  if (inFlight.has(submissionId)) {
    throw new AvvoSendError('This release is already being sent to AVVO.', 409);
  }

  const ref = submissionRef(submissionId);
  const snap = await ref.get();
  const data = snap.exists ? snap.data() : null;
  assertSendable(data);

  const ids = partnerIdFor(submissionId, data);
  const built = buildRelease(data, ids.partnerReleaseId);

  inFlight.add(submissionId);
  try {
    await ref.update({
      avvoSendState: 'sending',
      avvoSendStartedAt: Date.now(),
      avvoLastError: admin.firestore.FieldValue.delete(),
    });
  } catch (err) {
    inFlight.delete(submissionId);
    throw err;
  }

  logger.info(`[avvo] ${adminInfo.email} started sending ${submissionId} as ${ids.partnerReleaseId} (${cfg.sandbox ? 'sandbox' : 'LIVE'}, host ${hostOf(cfg.baseUrl)}).`);

  // Fire and forget. runSend handles its own errors.
  runSend(submissionId, cfg, built, {
    partnerReleaseId: ids.partnerReleaseId,
    attempt: ids.attempt,
    adminEmail: adminInfo.email,
  });

  return {
    partnerReleaseId: ids.partnerReleaseId,
    attempt: ids.attempt,
    tracks: built.payload.tracks.length,
    environment: cfg.sandbox ? 'sandbox' : 'live',
    dateShift: built.dateShift,
    warnings: built.warnings,
  };
}

// Read-only: shows what WOULD be sent. Calls nothing at AVVO, uploads nothing.
async function previewPayload(submissionId) {
  if (!isEnabled()) {
    throw new AvvoSendError('AVVO is switched off (AVVO_ENABLED is not true).', 503);
  }
  const snap = await submissionRef(submissionId).get();
  const data = snap.exists ? snap.data() : null;
  if (!data) throw new AvvoSendError('Submission not found.', 404);

  let sendable = true;
  let blockedReason = '';
  try {
    assertSendable(data);
  } catch (err) {
    if (!(err instanceof AvvoSendError)) throw err;
    sendable = false;
    blockedReason = err.message;
  }

  const ids = partnerIdFor(submissionId, data);
  const built = buildRelease(data, ids.partnerReleaseId);
  return {
    sendable,
    blockedReason,
    partnerReleaseId: ids.partnerReleaseId,
    attempt: ids.attempt,
    warnings: built.warnings,
    payload: built.payload,
    dateShift: built.dateShift,
  };
}

module.exports = {
  startSend,
  previewPayload,
  submissionIdFromPartnerReleaseId,
  AvvoSendError,
};
