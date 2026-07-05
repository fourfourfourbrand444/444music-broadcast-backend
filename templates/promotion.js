/**
 * templates/promotion.js
 *
 * Promotional/discount campaign template. Accepts "offerTitle",
 * "offerDetails", and "promoCode" via templateData.
 * Exports a function: ({ user, offerTitle, offerDetails, promoCode }) => ({ html, text })
 */

function promotion({ user, offerTitle, offerDetails, promoCode }) {
  const headline = offerTitle || 'Special Offer for You';
  const details = offerDetails || 'We have a limited-time offer just for our artists.';
  const code = promoCode || '';

  const codeBlockHtml = code
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;width:100%;">
        <tr>
          <td style="background-color:#1a1a1a;border:1.5px dashed #8b5cf6;border-radius:10px;padding:18px;text-align:center;">
            <span style="color:#666;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;display:block;margin-bottom:6px;">Promo Code</span>
            <span style="color:#c4b5fd;font-size:22px;font-weight:800;letter-spacing:2px;">${code}</span>
          </td>
        </tr>
      </table>`
    : '';

  const codeBlockText = code ? `\nPromo Code: ${code}\n` : '';

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
            <td style="background:linear-gradient(135deg,#c084fc,#8b5cf6,#5b3fd1);padding:36px 32px;text-align:center;">
              <span style="display:inline-block;background-color:rgba(255,255,255,0.15);border-radius:100px;padding:6px 16px;color:#ffffff;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;margin-bottom:12px;">Limited Time</span>
              <h1 style="margin:8px 0 0;color:#ffffff;font-size:24px;font-weight:800;">${headline}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 32px;color:#e5e5e5;">
              <p style="margin:0 0 8px;font-size:15px;line-height:1.7;color:#b0b0b0;">Hi {{name}},</p>
              <p style="margin:0 0 8px;font-size:15px;line-height:1.7;color:#b0b0b0;">${details}</p>
              ${codeBlockHtml}
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:12px;">
                <tr>
                  <td style="background:linear-gradient(135deg,#5b3fd1,#8b5cf6);border-radius:100px;">
                    <a href="#" style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;">Claim Offer</a>
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

Hi {{name}},

${details}
${codeBlockText}
— 444Music Distribution
This email was sent to {{email}}`;

  return { html, text };
}

module.exports = promotion;