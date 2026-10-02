/**
 * services/payoutEmailTemplate.js
 *
 * Builds the payout email (HTML + plain text) sent when earnings are
 * added to an artist's or contributor's balance.
 *
 * Pure function, no dependencies: renderPayoutEmail(data) -> { subject, html, text }
 *
 * One email per person. If the person has one song, the email shows the
 * single-song layout. If they have several, it shows a list of songs and a total.
 *
 * data = {
 *   name,           // recipient's name
 *   date,           // Date or ISO string (defaults to now)
 *   reportUrl,      // link for the "Download earnings report" button (optional)
 *   supportEmail,   // optional, adds a "Questions?" line when provided
 *
 *   // Several songs (use this from the batch send):
 *   items: [{
 *     releaseTitle,   // song / release the money came from
 *     artistName,
 *     role,           // 'Owner' | 'Contributor'
 *     sharePct,       // recipient's share of the release, e.g. 100 or 40
 *     amount,         // amount added, in USD (number)
 *     balance,        // recipient's balance on this release after the payout (optional)
 *   }],
 *
 *   // One song (still supported, same fields as one item):
 *   amount, releaseTitle, artistName, role, sharePct, balance
 * }
 */

const LOGO_URL = 'https://www.444musicdistro.com/black.png';
const SITE_URL = 'https://www.444musicdistro.com';
const TIPS_URL = 'https://www.instagram.com/_444musicdistro/';

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const money = n => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dateLabel = d => {
  const x = d ? new Date(d) : new Date();
  return (isNaN(x) ? new Date() : x).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Accra' });
};

const pct = n => {
  const v = Number(n);
  return Number.isFinite(v) ? `${Number.isInteger(v) ? v : v.toFixed(1)}%` : null;
};

/* Turns either the old one-song fields or the new items list into one clean list. */
function songsFrom(d) {
  const src = Array.isArray(d.items) && d.items.length
    ? d.items
    : [{ releaseTitle: d.releaseTitle, artistName: d.artistName, role: d.role, sharePct: d.sharePct, amount: d.amount, balance: d.balance }];
  return src.map(i => ({
    title: i.releaseTitle || 'your release',
    artist: i.artistName || '',
    isOwner: String(i.role || 'Owner').toLowerCase() === 'owner',
    share: pct(i.sharePct),
    amount: Number(i.amount) || 0,
    balance: i.balance,
  }));
}

const cents = n => Math.round((Number(n) || 0) * 100);

function renderPayoutEmail(d) {
  const first = String(d.name || '').trim().split(/\s+/)[0] || 'there';
  const songs = songsFrom(d);
  const many = songs.length > 1;
  const date = dateLabel(d.date);
  const total = songs.reduce((n, s) => n + cents(s.amount), 0) / 100;
  const amount = money(total);

  let subject, preheader, intro, amountLabel, rows, textBody;

  if (!many) {
    /* ---- one song: layout unchanged ---- */
    const s = songs[0];
    const role = s.isOwner ? 'Account owner' : 'Contributor';

    subject = `Payout notification: ${amount} for "${s.title}"`;
    preheader = `A payout of ${amount} has been credited to your 444Music account.`;
    intro = s.isOwner
      ? `Your royalty payout for <strong style="color:#000000;">${esc(s.title)}</strong> has been credited to your 444Music account.`
      : `Your royalty share for <strong style="color:#000000;">${esc(s.title)}</strong> has been credited to your 444Music account.`;
    amountLabel = 'Payout amount';

    const list = [
      ['Release', esc(s.title)],
      s.artist ? ['Artist', esc(s.artist)] : null,
      ['Role', role],
      s.share ? ['Royalty share', s.share] : null,
      s.balance != null ? ['Release balance', money(s.balance)] : null,
      ['Date issued', date],
    ].filter(Boolean);

    rows = list.map(([label, value]) => `
              <tr>
                <td style="padding:13px 0;border-bottom:1px solid #e9e9e9;font-family:${FONT};font-size:14px;line-height:20px;color:#6b6b6b;">${label}</td>
                <td align="right" style="padding:13px 0 13px 16px;border-bottom:1px solid #e9e9e9;font-family:${FONT};font-size:14px;line-height:20px;color:#000000;font-weight:500;word-break:break-word;">${value}</td>
              </tr>`).join('');

    textBody = [
      s.isOwner
        ? `Your royalty payout for "${s.title}" has been credited to your 444Music account.`
        : `Your royalty share for "${s.title}" has been credited to your 444Music account.`,
      '',
      `Payout amount: ${amount}`,
      `Release: ${s.title}`,
      s.artist ? `Artist: ${s.artist}` : null,
      `Role: ${role}`,
      s.share ? `Royalty share: ${s.share}` : null,
      s.balance != null ? `Release balance: ${money(s.balance)}` : null,
      `Date issued: ${date}`,
    ].filter(l => l !== null).join('\n');

  } else {
    /* ---- several songs: list with a total ---- */
    subject = `Payout notification: ${amount} across ${songs.length} releases`;
    preheader = `Payouts totalling ${amount} have been credited to your 444Music account.`;
    intro = `Your royalty payouts for <strong style="color:#000000;">${songs.length} releases</strong> have been credited to your 444Music account.`;
    amountLabel = 'Total payout';

    const detail = s => [s.artist, s.isOwner ? 'Account owner' : 'Contributor', s.share ? `${s.share} share` : null].filter(Boolean).join(', ');

    const songRows = songs.map(s => `
              <tr>
                <td style="padding:14px 0;border-bottom:1px solid #e9e9e9;font-family:${FONT};font-size:14px;line-height:20px;color:#000000;font-weight:500;word-break:break-word;">${esc(s.title)}<div style="margin-top:2px;font-size:12.5px;line-height:18px;color:#6b6b6b;font-weight:400;">${esc(detail(s))}</div></td>
                <td align="right" valign="top" style="padding:14px 0 14px 16px;border-bottom:1px solid #e9e9e9;font-family:${FONT};font-size:14px;line-height:20px;color:#000000;font-weight:600;white-space:nowrap;">${money(s.amount)}</td>
              </tr>`).join('');

    const dateRow = `
              <tr>
                <td style="padding:13px 0;border-bottom:1px solid #e9e9e9;font-family:${FONT};font-size:14px;line-height:20px;color:#6b6b6b;">Date issued</td>
                <td align="right" style="padding:13px 0 13px 16px;border-bottom:1px solid #e9e9e9;font-family:${FONT};font-size:14px;line-height:20px;color:#000000;font-weight:500;white-space:nowrap;">${date}</td>
              </tr>`;

    rows = songRows + dateRow;

    textBody = [
      `Your royalty payouts for ${songs.length} releases have been credited to your 444Music account.`,
      '',
      `Total payout: ${amount}`,
      '',
      ...songs.map(s => `${s.title} (${detail(s)}): ${money(s.amount)}`),
      '',
      `Date issued: ${date}`,
    ].join('\n');
  }

  const button = d.reportUrl ? `
          <tr>
            <td style="padding:30px 0 0 0;">
              <table role="presentation" class="btn" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td bgcolor="#000000" style="border-radius:6px;">
                    <a href="${esc(d.reportUrl)}" style="display:inline-block;padding:14px 26px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;text-align:center;">Download earnings report</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>` : '';

  const supportRow = d.supportEmail ? `
              <tr>
                <td style="padding:26px 0 0 0;font-family:${FONT};font-size:14px;line-height:22px;color:#444444;">
                  Questions about this payout? Contact <a href="mailto:${esc(d.supportEmail)}" style="color:#000000;font-weight:600;">${esc(d.supportEmail)}</a>.
                </td>
              </tr>` : '';

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(subject)}</title>
<style>
  body { margin:0; padding:0; width:100%; background:#ffffff; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table { border-collapse:collapse; }
  img { border:0; outline:none; text-decoration:none; display:block; }
  a { color:#000000; }
  @media only screen and (max-width:600px) {
    .px { padding-left:22px !important; padding-right:22px !important; }
    .amt { font-size:42px !important; line-height:46px !important; }
    table.btn, table.btn td { width:100% !important; }
    .btn a { display:block !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#ffffff;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#ffffff;">${esc(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff">
  <tr>
    <td align="center" style="padding:0;">
      <!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
        <tr>
          <td class="px" style="padding:36px 32px 0 32px;">

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" style="padding:0 0 34px 0;text-align:center;">
                  <a href="${SITE_URL}" style="text-decoration:none;"><img src="${LOGO_URL}" alt="444Music" height="30" style="height:30px;width:auto;border:0;margin:0 auto;"></a>
                </td>
              </tr>
              <tr>
                <td style="font-family:${FONT};font-size:16px;line-height:26px;color:#111111;">
                  <p style="margin:0 0 12px 0;font-size:18px;line-height:26px;font-weight:600;color:#000000;">Hi ${esc(first)},</p>
                  <p style="margin:0;color:#444444;">${intro}</p>
                </td>
              </tr>

              <tr>
                <td style="padding:28px 0 0 0;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="padding:18px 0 14px 0;">
                        <div style="font-family:${FONT};font-size:12px;line-height:16px;letter-spacing:1px;text-transform:uppercase;color:#6b6b6b;">${amountLabel}</div>
                        <div class="amt" style="margin-top:6px;font-family:${FONT};font-size:48px;line-height:52px;font-weight:700;letter-spacing:-1.5px;color:#000000;">${amount}</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <tr>
                <td style="padding:6px 0 0 0;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}
                  </table>
                </td>
              </tr>
${button}
${supportRow}
              <tr>
                <td style="padding:36px 0 0 0;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="padding:0 0 44px 0;font-family:${FONT};font-size:14px;line-height:22px;color:#111111;">
                        Want to grow your royalties? <a href="${TIPS_URL}" style="color:#000000;font-weight:700;text-decoration:underline;">Click here</a> to see tips.
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

          </td>
        </tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td>
  </tr>
</table>
</body>
</html>`;

  const text = [
    `Hi ${first},`,
    '',
    textBody,
    '',
    d.reportUrl ? `Download earnings report: ${d.reportUrl}` : null,
    d.reportUrl ? '' : null,
    d.supportEmail ? `Questions about this payout? ${d.supportEmail}` : null,
    d.supportEmail ? '' : null,
    `Want to grow your royalties? See tips: ${TIPS_URL}`,
  ].filter(l => l !== null).join('\n');

  return { subject, html, text };
}

module.exports = { renderPayoutEmail };
