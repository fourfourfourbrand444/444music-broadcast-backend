/**
 * services/mp3Download.js
 * Signed link + streaming WAV -> MP3 conversion for the admin email.
 * Nothing is stored: R2 keeps the WAV, the MP3 is made while you download.
 */
const crypto = require('crypto');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const logger = require('../utils/logger');
const { isAudioKey, getObjectStream, createReadUrl } = require('./r2Audio');

const BASE_URL = process.env.BACKEND_PUBLIC_URL || 'https://four44music-broadcast-backend.onrender.com';
const MP3_KBPS = process.env.MP3_KBPS || '192';
const MAX_JOBS = 2; // conversions at once, protects the Render instance
let running = 0;

const secret = () => process.env.R2_AUDIO_SECRET_ACCESS_KEY || '';
const sign = (key, exp, name) =>
  crypto.createHmac('sha256', secret()).update(`${key}|${exp}|${name}`).digest('hex');
const safeName = (s) => String(s || 'track').replace(/[^A-Za-z0-9 ._-]/g, '_').slice(0, 120);

function createMp3Link(key, ttlSeconds, title) {
  if (!isAudioKey(key)) throw new Error('Invalid audio key.');
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const name = safeName(title);
  const q = new URLSearchParams({ key, exp: String(exp), name, sig: sign(key, exp, name) });
  return `${BASE_URL}/api/submissions/audio-mp3?${q.toString()}`;
}

function validSignature(key, exp, name, sig) {
  if ([key, exp, name, sig].some((v) => typeof v !== 'string' || !v)) return false;
  if (!isAudioKey(key) || !(Number(exp) > Date.now() / 1000)) return false;
  const a = Buffer.from(sign(key, exp, name));
  const b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function handleMp3Download(req, res) {
  const { key, exp, name, sig } = req.query;
  if (!validSignature(key, exp, name, sig)) {
    return res.status(403).send('This download link is invalid or has expired.');
  }

  // If conversion can't run, fall back to the original WAV so you never lose access.
  const fallback = async () => {
    if (res.headersSent) return res.end();
    try { res.redirect(await createReadUrl(key, 3600, name)); }
    catch (e) { res.status(500).send('Download failed.'); }
  };

  if (running >= MAX_JOBS) return fallback();

  let obj;
  try {
    obj = await getObjectStream(key);
  } catch (err) {
    return res.status(404).send('File not found. It may have been deleted after review.');
  }

  running++;
  let done = false;
  const finish = () => { if (!done) { done = true; running--; } };

  const ff = spawn(ffmpegPath, [
    '-i', 'pipe:0', '-vn', '-map_metadata', '-1',
    '-codec:a', 'libmp3lame', '-b:a', `${MP3_KBPS}k`,
    '-f', 'mp3', 'pipe:1',
  ]);

  let sent = false;
  ff.stdout.on('data', (chunk) => {
    if (!sent) {
      sent = true;
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Disposition', `attachment; filename="${name}.mp3"`);
      res.setHeader('Cache-Control', 'private, no-store');
    }
    if (!res.write(chunk)) {
      ff.stdout.pause();
      res.once('drain', () => ff.stdout.resume());
    }
  });
  ff.on('error', (err) => {
    logger.error(`[mp3] ffmpeg could not start: ${err.message}`);
    finish();
    if (!sent) fallback();
  });
  ff.on('close', (code) => {
    finish();
    if (sent) return code === 0 ? res.end() : res.destroy();
    logger.error(`[mp3] conversion failed for ${key} (code ${code}), serving WAV instead`);
    fallback();
  });

  obj.Body.on('error', () => ff.kill('SIGKILL'));
  ff.stdin.on('error', () => {});
  obj.Body.pipe(ff.stdin);
  res.on('close', () => { ff.kill('SIGKILL'); finish(); });
}

module.exports = { createMp3Link, handleMp3Download };
