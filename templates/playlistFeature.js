/**
 * templates/playlistFeature.js
 *
 * Congratulates an artist on being featured on a playlist.
 * Accepts "trackTitle", "playlistName" via templateData.
 * Exports a function: ({ user, trackTitle, playlistName }) => ({ html, text })
 */

function playlistFeature({ user, trackTitle, playlistName }) {
  const track = trackTitle || 'your track';
  const playlist = playlistName || 'a featured playlist';

  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Playlist Feature</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;padding:40px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#111111;border-radius:16px;overflow:hidden;border:1px solid #2a2a2a;">
          <tr>
            <td style="background:linear-gradient(135deg,#5b3fd1,#8b5cf6);padding:40px 32px;text-align:center;">
              <div style="font-size:34px;margin-bottom:8px;">🎉</div>
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:800;">You've Been Featured!</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 32px;color:#e5e5e5;">
              <p style="margin:0 0 8px;font-size:15px;line-height:1.7;color:#b0b0b0;">Hi {{name}},</p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#b0b0b0;">
                Great news — <strong style="color:#c4b5fd;">"${track}"</strong> has just been added to <strong style="color:#c4b5fd;">${playlist}</strong>. This is a big step toward reaching new listeners.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:linear-gradient(135deg,#5b3fd1,#8b5cf6);border-radius:100px;">
                    <a href="#" style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;">View Analytics</a>
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

  const text = `You've Been Featured! 🎉

Hi {{name}},

Great news — "${track}" has just been added to ${playlist}. This is a big step toward reaching new listeners.

— 444Music Distribution
This email was sent to {{email}}`;

  return { html, text };
}

module.exports = playlistFeature;