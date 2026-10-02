/**
 * controllers/payoutController.js
 *
 *  notify         (admin)  POST /api/payout/notify
 *    body: { recipients: [{ email, name, items: [{ releaseTitle, artistName,
 *            role, sharePct, amount, balance }] }] }
 *  downloadReport (public) GET  /api/payout-report?d=...&s=...
 *    only works with a link signed by this server.
 */
const { sendPayoutEmails } = require('../services/payoutNotifyService');
const { verifyReportToken, reportCsv, csvDate } = require('../utils/payoutReportLink');

const MAX_RECIPIENTS = 50;
const MAX_ITEMS = 30;          // songs per person in one email
const MAX_AMOUNT = 100000;     // USD, per song
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) : '');
const optNumber = (v, min, max) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined; // undefined = invalid
};

/* Checks the request and returns clean data. One entry per email address. */
function validate(body) {
  const list = body && body.recipients;
  if (!Array.isArray(list) || !list.length) return { error: 'No recipients to email.' };
  if (list.length > MAX_RECIPIENTS) return { error: `Too many recipients (max ${MAX_RECIPIENTS}).` };

  const byEmail = new Map();
  for (const r of list) {
    const email = clean(r && r.email, 254).toLowerCase();
    if (!EMAIL_RE.test(email)) return { error: `Invalid email: ${email || '(empty)'}` };
    if (!Array.isArray(r.items) || !r.items.length) return { error: `No songs listed for ${email}.` };

    let entry = byEmail.get(email);
    if (!entry) { entry = { email, name: clean(r.name, 120), items: [] }; byEmail.set(email, entry); }

    for (const i of r.items) {
      const amount = Number(i && i.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
        return { error: `Invalid amount for ${email}.` };
      }
      const role = String((i && i.role) || '').toLowerCase();
      if (role !== 'owner' && role !== 'contributor') return { error: `Invalid role for ${email}.` };
      const sharePct = optNumber(i.sharePct, 0, 100);
      const balance = optNumber(i.balance, 0, 10000000);
      if (sharePct === undefined || balance === undefined) return { error: `Invalid share or balance for ${email}.` };

      entry.items.push({
        releaseTitle: clean(i.releaseTitle, 100) || 'Untitled',
        artistName: clean(i.artistName, 60),
        role: role === 'owner' ? 'Owner' : 'Contributor',
        sharePct,
        amount: Math.round(amount * 100) / 100,
        balance,
      });
    }
    if (entry.items.length > MAX_ITEMS) return { error: `Too many songs for ${email} (max ${MAX_ITEMS}).` };
  }
  return { recipients: [...byEmail.values()] };
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const notify = wrap(async (req, res) => {
  const v = validate(req.body);
  if (v.error) return res.status(400).json({ success: false, message: v.error });
  if (!process.env.PAYOUT_REPORT_SECRET) {
    return res.status(500).json({ success: false, message: 'Server misconfiguration: PAYOUT_REPORT_SECRET is not set.' });
  }

  const results = await sendPayoutEmails(v.recipients);
  const sent = results.filter((r) => r.success).length;
  res.status(200).json({ success: true, sent, failed: results.length - sent, results });
});

function downloadReport(req, res) {
  const payload = verifyReportToken(req.query.d, req.query.s);
  if (!payload) {
    return res.status(403).type('text/plain').send('This link is not valid.');
  }
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="444music-earnings-${csvDate(payload.d)}.csv"`,
    'Cache-Control': 'no-store',
  });
  res.send(reportCsv(payload));
}

module.exports = { notify, downloadReport, validate };
