/**
 * controllers/approvalController.js
 *
 *  notify  POST /api/approval/notify
 *    body: { submissionId }
 *    -> { success: true, email } or { success: false, message }
 */
const { sendApprovalEmail } = require('../services/approvalNotifyService');

const ID_RE = /^[A-Za-z0-9_-]{5,128}$/;
const COOLDOWN_MS = 30000;       // blocks accidental double clicks on the same release
const recent = new Map();        // submissionId -> time of last send

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const notify = wrap(async (req, res) => {
  const id = req.body && req.body.submissionId;
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    return res.status(400).json({ success: false, message: 'A valid submissionId is required.' });
  }

  const now = Date.now();
  recent.forEach((t, k) => { if (now - t > COOLDOWN_MS) recent.delete(k); });
  if (recent.has(id)) {
    return res.status(429).json({ success: false, message: 'This email was just sent. Wait a moment before sending again.' });
  }
  recent.set(id, now);

  const out = await sendApprovalEmail(id);
  if (!out.success) {
    recent.delete(id);   // a failed send can be retried straight away
    return res.status(out.status || 502).json({ success: false, message: out.message });
  }
  res.status(200).json({ success: true, email: out.email });
});

module.exports = { notify };
