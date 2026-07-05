/**
 * templates/welcome.js
 *
 * Sent to new artists after they sign up.
 * Exports a function: ({ user }) => ({ html, text })
 */

function welcome({ user }) {
  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Welcome to 444Music</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;padding:40px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#111111;border-radius:16px;overflow:hidden;border:1px solid #2a2a2a;">
          <tr>
            <td style="background:linear-gradient(135deg,#5b3fd1,#8b5cf6);padding:40px 32px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:800;letter-spacing:-0.5px;">444Music Distribution</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 32px;color:#e5e5e5;">
              <h2 style="margin:0 0 16px;color:#ffffff;font-size:22px;">Welcome, {{name}}! 🎵</h2>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#b0b0b0;">
                We're thrilled to have you on board. Your account is ready, and your music is one step closer to reaching Spotify, Apple Music, Boomplay, Audiomack and 30+ platforms worldwide.
              </p>
              <p style="margin:0 0 28px;font-size:15px;line-height:1.7;color:#b0b0b0;">
                Here's what you can do right now:
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="padding:14px 18px;background-color:#1a1a1a;border-radius:10px;border:1px solid #2a2a2a;">
                    <span style="color:#a78bfa;font-weight:600;font-size:14px;">✓ Upload your first release</span>
                  </td>
                </tr>
                <tr><td style="height:10px;"></td></tr>
                <tr>
                  <td style="padding:14px 18px;background-color:#1a1a1a;border-radius:10px;border:1px solid #2a2a2a;">
                    <span style="color:#a78bfa;font-weight:600;font-size:14px;">✓ Set up your artist profile</span>
                  </td>
                </tr>
                <tr><td style="height:10px;"></td></tr>
                <tr>
                  <td style="padding:14px 18px;background-color:#1a1a1a;border-radius:10px;border:1px solid #2a2a2a;">
                    <span style="color:#a78bfa;font-weight:600;font-size:14px;">✓ Explore your analytics dashboard</span>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:linear-gradient(135deg,#5b3fd1,#8b5cf6);border-radius:100px;">
                    <a href="#" style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;">Go to Dashboard</a>
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

  const text = `Welcome, {{name}}!

We're thrilled to have you on board. Your account is ready, and your music is one step closer to reaching Spotify, Apple Music, Boomplay, Audiomack and 30+ platforms worldwide.

What you can do right now:
- Upload your first release
- Set up your artist profile
- Explore your analytics dashboard

Go to your dashboard to get started.

— 444Music Distribution
This email was sent to {{email}}`;

  return { html, text };
}

module.exports = welcome;