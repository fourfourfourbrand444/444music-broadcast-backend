/**
 * utils/payoutReportLink.js
 *
 * Signed "Download earnings report" links.
 *
 * The link carries the recipient's own payout rows inside it, signed with
 * HMAC-SHA256 using PAYOUT_REPORT_SECRET. When it is opened, the server only
 * checks the signature and builds the CSV from the link itself, so no
 * Firestore reads are needed and a changed link is rejected.
 *
 *   buildReportUrl({ email, name, date, items }) -> string
 *   verifyReportToken(d, s)                      -> payload | null
 *   reportCsv(payload)                           -> string (CSV with BOM)
 */
const crypto = require('crypto');

const DEFAULT_BASE = 'https://four44music-broadcast-backend.onrender.com';
const MAX_TOKEN_LENGTH = 14000;   // keeps the whole URL inside Node's header limit
const MAX_ROWS = 100;

const toB64u = (str) => Buffer.from(str, 'utf8').toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (b64) => Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

function secret() {
  const s = process.env.PAYOUT_REPORT_SECRET;
  if (!s) throw new Error('PAYOUT_REPORT_SECRET is not set.');
  return s;
}

const sign = (data) => crypto.createHmac('sha256', secret()).update(data).digest('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function buildReportUrl({ email, name, date, items }) {
  const payload = {
    v: 1,
    e: email,
    n: name || '',
    d: date,
    // [release, artist, role, share %, amount, balance]
    r: items.map((i) => [i.releaseTitle, i.artistName, i.role, i.sharePct, i.amount, i.balance]),
  };
  const d = toB64u(JSON.stringify(payload));
  if (d.length > MAX_TOKEN_LENGTH) throw new Error('Report link would be too long.');
  const base = (process.env.PAYOUT_REPORT_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
  return `${base}/api/payout-report?d=${d}&s=${sign(d)}`;
}

function verifyReportToken(d, s) {
  if (typeof d !== 'string' || typeof s !== 'string') return null;
  if (!d || d.length > MAX_TOKEN_LENGTH || s.length > 100) return null;
  let expected;
  try { expected = sign(d); } catch (e) { return null; }
  const a = Buffer.from(s);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(fromB64u(d));
    if (!p || p.v !== 1 || !Array.isArray(p.r) || p.r.length > MAX_ROWS) return null;
    return p;
  } catch (e) {
    return null;
  }
}

/* Text cells: quote them, and defuse anything a spreadsheet could run as a formula. */
function textCell(v) {
  let t = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
  return '"' + t.replace(/"/g, '""') + '"';
}

const money = (n) => (Number.isFinite(Number(n)) && n !== null && n !== '' ? Number(n).toFixed(2) : '');
const share = (n) => (Number.isFinite(Number(n)) && n !== null && n !== '' ? `${Number(n)}%` : '');

function csvDate(iso) {
  const x = new Date(iso);
  const ok = !isNaN(x);
  return (ok ? x : new Date()).toLocaleDateString('en-CA', { timeZone: 'Africa/Accra' }); // YYYY-MM-DD
}

function reportCsv(payload) {
  const date = csvDate(payload.d);
  const lines = [['Date', 'Release', 'Artist', 'Role', 'Royalty share', 'Payout amount (USD)', 'Release balance']
    .map(textCell).join(',')];
  payload.r.forEach((row) => {
    const [release, artist, role, pct, amount, balance] = Array.isArray(row) ? row : [];
    const roleLabel = String(role || '').toLowerCase() === 'contributor' ? 'Contributor' : 'Account owner';
    lines.push([
      textCell(date),
      textCell(release),
      textCell(artist),
      textCell(roleLabel),
      textCell(share(pct)),
      money(amount),
      money(balance),
    ].join(','));
  });
  return '\ufeff' + lines.join('\r\n') + '\r\n';
}

module.exports = { buildReportUrl, verifyReportToken, reportCsv, csvDate };
