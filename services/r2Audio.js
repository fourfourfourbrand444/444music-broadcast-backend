/**
 * services/r2Audio.js
 *
 * Private audio bucket on Cloudflare R2 (444music-audio).
 * Never public: files are reached only through short-lived signed links
 * or directly by this server (AVVO sender, delete).
 *
 * Env vars on Render:
 *   R2_ACCOUNT_ID, R2_AUDIO_ACCESS_KEY_ID,
 *   R2_AUDIO_SECRET_ACCESS_KEY, R2_AUDIO_BUCKET_NAME
 */
const crypto = require('crypto');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const logger = require('../utils/logger');

// audio/<uid>/<uuid>.wav
const KEY_PATTERN = /^audio\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9-]{1,64}\.wav$/;

let client = null;

function getClient() {
  if (client) return client;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_AUDIO_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_AUDIO_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey || !process.env.R2_AUDIO_BUCKET_NAME) {
    throw new Error('R2 audio settings are missing on the server.');
  }
  client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return client;
}

const bucket = () => process.env.R2_AUDIO_BUCKET_NAME;

function isAudioKey(key) {
  return typeof key === 'string' && KEY_PATTERN.test(key);
}

// Link the browser uses to upload ONE wav (valid 30 minutes, big files are slow).
async function createUploadUrl(uid) {
  const key = `audio/${uid}/${crypto.randomUUID()}.wav`;
  const command = new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    ContentType: 'audio/wav',
  });
  const expiresIn = 1800;
  const uploadUrl = await getSignedUrl(getClient(), command, { expiresIn });
  return { uploadUrl, key, contentType: 'audio/wav', expiresIn };
}

// Link for playing a file in the browser (valid 1 hour).
async function createReadUrl(key, expiresIn = 3600, downloadName = '') {
  if (!isAudioKey(key)) throw new Error('Invalid audio key.');
  const params = { Bucket: bucket(), Key: key };
  if (downloadName) {
    const safe = String(downloadName).replace(/[^A-Za-z0-9 ._-]/g, '_').slice(0, 120);
    params.ResponseContentDisposition = `attachment; filename="${safe}.wav"`;
    params.ResponseContentType = 'audio/wav';
  }
  const command = new GetObjectCommand(params);
  return getSignedUrl(getClient(), command, { expiresIn });
}

// Used by the AVVO sender later (server downloads the file itself).
async function getObjectBuffer(key) {
  if (!isAudioKey(key)) throw new Error('Invalid audio key.');
  const res = await getClient().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
   const size = Number(res.ContentLength);
  if (!(size > 0)) return Buffer.from(await res.Body.transformToByteArray());
  // One buffer of the exact size, filled piece by piece (no second copy).
  const buf = Buffer.allocUnsafe(size);
  let offset = 0;
  for await (const chunk of res.Body) {
    chunk.copy(buf, offset);
    offset += chunk.length;
  }
  return offset === size ? buf : buf.subarray(0, offset);
}

// Used after approval and when a submission is deleted. Deleting is free on R2.
async function deleteKeys(keys) {
  const result = { deleted: [], failed: [] };
  for (const key of Array.isArray(keys) ? keys : []) {
    if (!isAudioKey(key)) {
      result.failed.push(key);
      continue;
    }
    try {
      await getClient().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
      result.deleted.push(key);
    } catch (err) {
      logger.error(`[r2-audio] could not delete ${key}: ${err.message}`);
      result.failed.push(key);
    }
  }
  return result;
}

module.exports = { isAudioKey, createUploadUrl, createReadUrl, getObjectBuffer, deleteKeys };
