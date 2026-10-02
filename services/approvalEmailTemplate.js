/**
 * services/approvalEmailTemplate.js
 *
 * Builds the "release approved" email (HTML + plain text).
 * Pure function, no dependencies:
 *   renderApprovalEmail(data) -> { subject, html, text }
 *
 * data = {
 *   name,           // artist name (used in the greeting)
 *   releaseTitle,   // song / release title
 *   upc,            // UPC code
 *   catalogNumber,  // catalog number (optional)
 *   loginUrl,       // optional, defaults to the dashboard login
 * }
 *
 * To change the store list, edit STORES below.
 */

const LOGO_URL = 'https://www.444musicdistro.com/black.png';
const SITE_URL = 'https://www.444musicdistro.com';
const LOGIN_URL = 'https://www.444musicdistro.com/wey';

const STORES = [
  'Spotify', 'Apple Music', 'iTunes', 'YouTube Music', 'Amazon Music',
  'Deezer', 'Tidal', 'Audiomack', 'Boomplay', 'TikTok',
  'Instagram', 'Facebook', 'Shazam', 'Pandora', 'Anghami',
];

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderApprovalEmail(d) {
  const name = String(d.name || '').trim() || 'there';
  const title = String(d.releaseTitle || '').trim() || 'your release';
  const upc = String(d.upc || '').trim();
  const cat = String(d.catalogNumber || '').trim();
  const loginUrl = d.loginUrl || LOGIN_URL;

  const subject = `Your release "${title}" has been approved`;
  const preheader = `"${title}" has been approved and is on its way to the stores.`;

  const detailRows = [
    upc ? ['UPC', upc] : null,
    cat ? ['Catalog number', cat] : null,
  ].filter(Boolean).map(([label, value]) => `
              <tr>
                <td style="padding:13px 0;border-bottom:1px solid #e9e9e9;font-family:${FONT};font-size:14px;line-height:20px;color:#6b6b6b;">${label}</td>
                <td align="right" style="padding:13px 0 13px 16px;border-bottom:1px solid #e9e9e9;font-family:${FONT};font-size:14px;line-height:20px;color:#000000;font-weight:500;word-break:break-word;">${esc(value)}</td>
              </tr>`).join('');

  const details = detailRows ? `
              <tr>
                <td style="padding:6px 0 0 0;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${detailRows}
                  </table>
                </td>
              </tr>` : '';

  const pill = 'display:inline-block;margin:0 6px 8px 0;padding:7px 13px;border:1px solid #dcdcdc;border-radius:999px;font-family:' + FONT + ';font-size:13px;line-height:18px;color:#111111;';
  const pills = STORES.map(s => `<span style="${pill}">${esc(s)}</span>`).join('\n                        ')
    + `\n                        <span style="display:inline-block;margin:0 0 8px 0;padding:7px 4px;font-family:${FONT};font-size:13px;line-height:18px;color:#6b6b6b;">and more</span>`;

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
    .ttl { font-size:30px !important; line-height:36px !important; }
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
                  <p style="margin:0 0 12px 0;font-size:18px;line-height:26px;font-weight:600;color:#000000;">Hi ${esc(name)},</p>
                  <p style="margin:0;color:#444444;">Congratulations! Your release has been approved and is on its way to the world's top stores and streaming platforms.</p>
                </td>
              </tr>

              <tr>
                <td style="padding:28px 0 0 0;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="padding:18px 0 14px 0;">
                        <div style="font-family:${FONT};font-size:12px;line-height:16px;letter-spacing:1px;text-transform:uppercase;color:#6b6b6b;">Approved release</div>
                        <div class="ttl" style="margin-top:6px;font-family:${FONT};font-size:34px;line-height:40px;font-weight:700;letter-spacing:-0.8px;color:#000000;word-break:break-word;">${esc(title)}</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
${details}
              <tr>
                <td style="padding:28px 0 0 0;">
                  <div style="padding:0 0 12px 0;font-family:${FONT};font-size:12px;line-height:16px;letter-spacing:1px;text-transform:uppercase;color:#6b6b6b;">Distributing to</div>
                  <div style="font-size:0;line-height:0;">
                        ${pills}
                  </div>
                </td>
              </tr>

              <tr>
                <td style="padding:22px 0 0 0;">
                  <table role="presentation" class="btn" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td bgcolor="#000000" style="border-radius:6px;">
                        <a href="${esc(loginUrl)}" style="display:inline-block;padding:14px 26px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;text-align:center;">Log in to your dashboard</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <tr><td style="height:56px;line-height:56px;font-size:0;">&nbsp;</td></tr>
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
    `Hi ${name},`,
    '',
    "Congratulations! Your release has been approved and is on its way to the world's top stores and streaming platforms.",
    '',
    `Approved release: ${title}`,
    upc ? `UPC: ${upc}` : null,
    cat ? `Catalog number: ${cat}` : null,
    '',
    `Distributing to: ${STORES.join(', ')} and more.`,
    '',
    `Log in to your dashboard: ${loginUrl}`,
  ].filter(l => l !== null).join('\n');

  return { subject, html, text };
}

module.exports = { renderApprovalEmail };
