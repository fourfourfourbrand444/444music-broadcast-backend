// ═══════════════════════════════════════════════════════════════════
//  444MUSIC — Cloudflare R2 presigned-upload route
//
//  Handles feed image uploads (avatars, posts, stories) only.
//  Song artwork / distribution uploads are untouched and stay on
//  Cloudinary — this route has nothing to do with that flow.
//
//  Env vars required on Render (Settings → Environment):
//    R2_ACCOUNT_ID        — from the R2 bucket's "S3 API" endpoint URL
//                            (the part before .r2.cloudflarestorage.com)
//    R2_ACCESS_KEY_ID     — from the API token you created
//    R2_SECRET_ACCESS_KEY — from the same API token
//    R2_BUCKET_NAME        — "444music-feed"
//    R2_PUBLIC_URL         — your pub-xxxxxxxx.r2.dev URL, NO trailing slash
//
//  Install deps first (in your backend project root):
//    npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
//
//  Mount this in your main server file:
//    const r2Routes = require('./r2Routes');
//    app.use('/r2', r2Routes);
// ═══════════════════════════════════════════════════════════════════

const express = require('express');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');

const router = express.Router();

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// Which upload "kinds" this endpoint accepts, and the key (file path)
// pattern for each — matches the structure planned before building this.
const ALLOWED_KINDS = new Set(['avatar', 'post', 'story']);

function buildKey(kind, uid, ext) {
  const id = crypto.randomUUID();
  switch (kind) {
    case 'avatar':
      // One key per user — a new avatar upload overwrites the old file
      // at the same path, so old avatars don't pile up in the bucket.
      return `avatars/${uid}.${ext}`;
    case 'post':
      return `posts/${uid}/${id}.${ext}`;
    case 'story':
      return `stories/${uid}/${id}.${ext}`;
    default:
      return `misc/${uid}/${id}.${ext}`;
  }
}

// POST /r2/upload-url
// body: { kind: 'avatar' | 'post' | 'story', uid: string, contentType: string }
// returns: { uploadUrl, publicUrl, key }
router.post('/upload-url', async (req, res) => {
  try {
    const { kind, uid, contentType } = req.body || {};

    if (!ALLOWED_KINDS.has(kind)) {
      return res.status(400).json({ error: 'invalid kind' });
    }
    if (!uid || typeof uid !== 'string') {
      return res.status(400).json({ error: 'uid required' });
    }
    if (!contentType || !contentType.startsWith('image/')) {
      return res.status(400).json({ error: 'contentType must be an image type' });
    }

    const ext = (contentType.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const key = buildKey(kind, uid, ext);

    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      ContentType: contentType,
    });

    // Short-lived on purpose — the app is expected to use this within a
    // couple of minutes of requesting it, not stash it for later.
    const uploadUrl = await getSignedUrl(r2, command, { expiresIn: 120 });
    const publicUrl = `${process.env.R2_PUBLIC_URL}/${key}`;

    res.json({ uploadUrl, publicUrl, key });
  } catch (err) {
    console.error('R2 upload-url error:', err);
    res.status(500).json({ error: 'failed to create upload url' });
  }
});

module.exports = router;
