/**
 * services/payoutEmailTemplate.js
 *
 * Builds the payout email (HTML + plain text) sent when earnings are
 * added to an artist's or contributor's balance.
 *
 * Pure function, no dependencies: renderPayoutEmail(data) -> { subject, html, text }
 *
 * data = {
 *   name,           // recipient's name
 *   amount,         // amount added, in USD (number)
 *   releaseTitle,   // song / release the money came from
 *   artistName,
 *   role,           // 'Owner' | 'Contributor'
 *   sharePct,       // recipient's share of the release, e.g. 100 or 40
 *   balance,        // recipient's balance on this release after the payout (optional)
 *   date,           // Date or ISO string (defaults to now)
 *   reportUrl,      // link for the "Download earnings report" button (optional)
 *   supportEmail,   // optional, adds a "Questions?" line when provided
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

function renderPayoutEmail(d) {
  const first = String(d.name || '').trim().split(/\s+/)[0] || 'there';
  const isOwner = String(d.role || 'Owner').toLowerCase() === 'owner';
  const role = isOwner ? 'Owner' : 'Contributor';
  const title = d.releaseTitle || 'your release';
  const amount = money(d.amount);
  const date = dateLabel(d.date);
  const share = pct(d.sharePct);

  const subject = `New earnings: ${amount} from "${title}"`;
  const preheader = `${amount} has been added to your 444Music balance.`;

  const intro = isOwner
    ? `Earnings from <strong style="color:#000000;">${esc(title)}</strong> have been added to your 444Music balance. Here are the details.`
    : `Your share of the earnings from <strong style="color:#000000;">${esc(title)}</strong> has been added to your 444Music balance. Here are the details.`;

  const rows = [
    ['Release', esc(title)],
    d.artistName ? ['Artist', esc(d.artistName)] : null,
    ['Your role', role],
    share ? ['Your share', share] : null,
    ['Amount added', money(d.amount), true],
    d.balance != null ? ['Balance on this release', money(d.balance)] : null,
    ['Date', date],
  ].filter(Boolean);

  const rowHtml = rows.map(([label, value, strong]) => `
              <tr>
                <td style="padding:13px 0;border-bottom:1px solid #e9e9e9;font-family:${FONT};font-size:14px;line-height:20px;color:#6b6b6b;">${label}</td>
                <td align="right" style="padding:13px 0 13px 16px;border-bottom:1px solid #e9e9e9;font-family:${FONT};font-size:14px;line-height:20px;color:#000000;font-weight:${strong ? '700' : '500'};word-break:break-word;">${value}</td>
              </tr>`).join('');

  const button = d.reportUrl ? `
          <tr>
            <td style="padding:30px 0 0 0;">
              <table role="presentation" class="btn" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td bgcolor="#000000" style="border-radius:6px;">
                    <a href="${esc(d.reportUrl)}" style="display:inline-block;padding:14px 26px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;text-align:center;">Download earnings report (CSV)</a>
                  </td>
                </tr>
              </table>
              <p style="margin:10px 0 0 0;font-family:${FONT};font-size:12.5px;line-height:18px;color:#8a8a8a;">A spreadsheet of this payout. Opens in Excel or Google Sheets.</p>
            </td>
          </tr>` : '';

  const support = d.supportEmail
    ? ` Questions? Write to <a href="mailto:${esc(d.supportEmail)}" style="color:#000000;">${esc(d.supportEmail)}</a>.` : '';

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
                <td style="padding:0 0 34px 0;">
                  <a href="${SITE_URL}" style="text-decoration:none;"><img src="${LOGO_URL}" alt="444Music" height="30" style="height:30px;width:auto;border:0;"></a>
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
                      <td style="padding:22px 0;border-top:2px solid #000000;border-bottom:1px solid #e9e9e9;">
                        <div style="font-family:${FONT};font-size:12px;line-height:16px;letter-spacing:1px;text-transform:uppercase;color:#6b6b6b;">Amount added</div>
                        <div class="amt" style="margin-top:6px;font-family:${FONT};font-size:48px;line-height:52px;font-weight:700;letter-spacing:-1.5px;color:#000000;">${amount}</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <tr>
                <td style="padding:6px 0 0 0;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rowHtml}
                  </table>
                </td>
              </tr>
${button}
              <tr>
                <td style="padding:30px 0 0 0;font-family:${FONT};font-size:14px;line-height:22px;color:#444444;">
                  You can see all of your releases and earnings in your <a href="${SITE_URL}" style="color:#000000;font-weight:600;">444Music dashboard</a>.${support}
                </td>
              </tr>

              <tr>
                <td style="padding:36px 0 0 0;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="padding:22px 0 0 0;border-top:1px solid #e9e9e9;font-family:${FONT};font-size:14px;line-height:22px;color:#111111;">
                        Want to grow your royalties? <a href="${TIPS_URL}" style="color:#000000;font-weight:700;text-decoration:underline;">Click here</a> to see tips.
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:18px 0 40px 0;font-family:${FONT};font-size:12px;line-height:19px;color:#8a8a8a;">
                        444Music Distribution &middot; <a href="${SITE_URL}" style="color:#8a8a8a;text-decoration:none;">444musicdistro.com</a><br>
                        You are receiving this email because earnings were added to your 444Music account.
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
    isOwner
      ? `Earnings from "${title}" have been added to your 444Music balance.`
      : `Your share of the earnings from "${title}" has been added to your 444Music balance.`,
    '',
    `Amount added: ${amount}`,
    `Release: ${title}`,
    d.artistName ? `Artist: ${d.artistName}` : null,
    `Your role: ${role}`,
    share ? `Your share: ${share}` : null,
    d.balance != null ? `Balance on this release: ${money(d.balance)}` : null,
    `Date: ${date}`,
    '',
    d.reportUrl ? `Download your earnings report (CSV): ${d.reportUrl}` : null,
    d.reportUrl ? '' : null,
    `Dashboard: ${SITE_URL}`,
    d.supportEmail ? `Questions? ${d.supportEmail}` : null,
    '',
    `Want to grow your royalties? See tips: ${TIPS_URL}`,
    '',
    '444Music Distribution - 444musicdistro.com',
  ].filter(l => l !== null).join('\n');

  return { subject, html, text };
}

module.exports = { renderPayoutEmail };
