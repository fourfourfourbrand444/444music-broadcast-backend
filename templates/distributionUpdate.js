/**
 * templates/distributionUpdate.js
 *
 * General distribution-related update (e.g. platform coverage change,
 * policy update, new store added). Accepts "updateTitle", "updateBody"
 * via templateData.
 * Exports a function: ({ user, updateTitle, updateBody }) => ({ html, text })
 */

function distributionUpdate({ user, updateTitle, updateBody }) {
  const title = updateTitle || 'Distribution Update';
  const body = updateBody || 'We have an update regarding your music distribution.';

  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;padding:40px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#111111;border-radius:16px;overflow:hidden;border:1px solid #2a2a2a;">
          <tr>
            <td style="padding:32px;text-align:center;border-bottom:1px solid #2a2a2a;">
              <span style="display:inline-block;background-color:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.3);border-radius:100px;padding:6px 16px;color:#c4b5fd;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;font-weight:600;">Distribution Update</span>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 32px;color:#e5e5e5;">
              <h2 style="margin:0 0 16px;color:#ffffff;font-size:20px;">${title}</h2>
              <p style="margin:0 0 8px;font-size:15px;line-height:1.7;color:#b0b0b0;">Hi {{name}},</p>
              <p style="margin:0 0 28px;font-size:15px;line-height:1.7;color:#b0b0b0;">${body}</p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:linear-gradient(135deg,#5b3fd1,#8b5cf6);border-radius:100px;">
                    <a href="#" style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;">View Details</a>
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

  const text = `${title}

Hi {{name}},

${body}

— 444Music Distribution
This email was sent to {{email}}`;

  return { html, text };
}

module.exports = distributionUpdate;