/**
 * templates/newsletter.js
 *
 * Monthly/periodic newsletter template. Accepts an array of
 * "highlights" (strings) via templateData to list news items.
 * Exports a function: ({ user, title, highlights }) => ({ html, text })
 */

function newsletter({ user, title, highlights }) {
  const headline = title || '444Music Newsletter';
  const items = Array.isArray(highlights) && highlights.length > 0
    ? highlights
    : ['Thanks for being part of the 444Music community.'];

  const htmlItems = items
    .map(
      (item) => `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #2a2a2a;">
            <span style="color:#a78bfa;margin-right:8px;">●</span>
            <span style="color:#d0d0d0;font-size:14px;line-height:1.6;">${item}</span>
          </td>
        </tr>`
    )
    .join('');

  const textItems = items.map((item) => `- ${item}`).join('\n');

  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${headline}</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;padding:40px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#111111;border-radius:16px;overflow:hidden;border:1px solid #2a2a2a;">
          <tr>
            <td style="background:linear-gradient(135deg,#5b3fd1,#8b5cf6);padding:32px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:800;">${headline}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 32px;color:#e5e5e5;">
              <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#b0b0b0;">Hi {{name}}, here's what's new:</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${htmlItems}
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:28px;">
                <tr>
                  <td style="background:linear-gradient(135deg,#5b3fd1,#8b5cf6);border-radius:100px;">
                    <a href="#" style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;">Visit Dashboard</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px;border-top:1px solid #2a2a2a;text-align:center;">
              <p style="margin:0;font-size:12px;color:#666666;">This email was sent to {{email}} · 444Music Distribution, Ghana</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();

  const text = `${headline}

Hi {{name}}, here's what's new:

${textItems}

— 444Music Distribution
This email was sent to {{email}}`;

  return { html, text };
}

module.exports = newsletter;