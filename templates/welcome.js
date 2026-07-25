/**
 * templates/welcome.js
 *
 * NOTE: Repurposed from onboarding "welcome" email to a re-engagement
 * message for artists who haven't released in a while. Kept the
 * function name/export as "welcome" so templateKey: "welcome" in the
 * dashboard still works without any other file needing changes.
 *
 * Exports a function: ({ user }) => ({ html, text })
 */

function welcome({ user }) {
  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>It's time for your next release</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e5e5;">

          <!-- LOGO HEADER -->
          <tr>
            <td style="background-color:#000000;padding:36px 32px;text-align:center;">
              <img src="https://www.444musicdistro.com/black.png" alt="444Music Distribution" width="140" style="display:block;margin:0 auto;max-width:140px;height:auto;">
            </td>
          </tr>

          <!-- HERO BANNER IMAGE -->
          <tr>
            <td style="padding:0;">
              <img src="https://images.unsplash.com/photo-1618233980710-f7ca074de8cd?fm=jpg&q=80&w=1200" alt="Studio headphones and mixing keyboard" width="600" style="display:block;width:100%;max-width:600px;height:auto;filter:grayscale(100%);">
            </td>
          </tr>

          <!-- HERO MESSAGE -->
          <tr>
            <td style="padding:44px 36px 8px;text-align:center;">
              <p style="margin:0 0 10px;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#999999;font-weight:600;">We miss your music</p>
              <h1 style="margin:0 0 20px;color:#000000;font-size:26px;font-weight:800;line-height:1.3;">
                It's been a while, {{name}} —<br>let's get you back on the charts.
              </h1>
              <p style="margin:0;font-size:15px;line-height:1.75;color:#444444;">
                It's been some time since your last release, and your listeners are waiting. Every new drop keeps your momentum alive, your streams climbing, and your name in front of new audiences across every platform we distribute to.
              </p>
            </td>
          </tr>

          <!-- DIVIDER -->
          <tr><td style="padding:32px 36px 0;"><div style="height:1px;background-color:#eeeeee;"></div></td></tr>

          <!-- WHY RELEASE NOW -->
          <tr>
            <td style="padding:32px 36px 8px;">
              <h2 style="margin:0 0 20px;color:#000000;font-size:18px;font-weight:800;">Here's what a new release unlocks for you</h2>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:0 0 20px;vertical-align:top;width:28px;">
                    <span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border:1.5px solid #000000;border-radius:50%;font-size:12px;color:#000000;">✓</span>
                  </td>
                  <td style="padding:0 0 20px;vertical-align:top;">
                    <p style="margin:0;font-size:14px;font-weight:700;color:#000000;">A shot at our official playlists</p>
                    <p style="margin:4px 0 0;font-size:13px;line-height:1.6;color:#666666;">Every new submission is considered for placement on our curated playlists — real exposure to real listeners actively discovering new music.</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 20px;vertical-align:top;width:28px;">
                    <span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border:1.5px solid #000000;border-radius:50%;font-size:12px;color:#000000;">✓</span>
                  </td>
                  <td style="padding:0 0 20px;vertical-align:top;">
                    <p style="margin:0;font-size:14px;font-weight:700;color:#000000;">Reach on 30+ platforms, days from now</p>
                    <p style="margin:4px 0 0;font-size:13px;line-height:1.6;color:#666666;">Spotify, Apple Music, Boomplay, Audiomack, Amazon Music and more — one upload, distributed everywhere your fans already listen.</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 20px;vertical-align:top;width:28px;">
                    <span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border:1.5px solid #000000;border-radius:50%;font-size:12px;color:#000000;">✓</span>
                  </td>
                  <td style="padding:0 0 20px;vertical-align:top;">
                    <p style="margin:0;font-size:14px;font-weight:700;color:#000000;">100% ownership, 100% of your royalties</p>
                    <p style="margin:4px 0 0;font-size:13px;line-height:1.6;color:#666666;">You keep your masters and your rights. No middlemen, no hidden fees, no revenue splits taken from your earnings.</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0;vertical-align:top;width:28px;">
                    <span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border:1.5px solid #000000;border-radius:50%;font-size:12px;color:#000000;">✓</span>
                  </td>
                  <td style="padding:0;vertical-align:top;">
                    <p style="margin:0;font-size:14px;font-weight:700;color:#000000;">Real-time analytics, from day one</p>
                    <p style="margin:4px 0 0;font-size:13px;line-height:1.6;color:#666666;">Track streams, listeners and revenue across every platform from one dashboard — know exactly how your release is performing.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ALGORITHM/MOMENTUM NOTE -->
          <tr>
            <td style="padding:8px 36px 0;">
              <div style="background-color:#f8f8f8;border-left:3px solid #000000;border-radius:6px;padding:18px 20px;">
                <p style="margin:0;font-size:13px;line-height:1.7;color:#333333;">
                  <strong style="color:#000000;">A quick note on momentum:</strong> streaming platforms favor artists who release consistently. Long gaps between drops slow your algorithmic reach — a new release now is one of the fastest ways to bring your catalogue back in front of your existing listeners, and in front of new ones.
                </p>
              </div>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:36px 36px 8px;text-align:center;">
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                <tr>
                  <td style="background-color:#000000;border-radius:100px;">
                    <a href="https://www.444musicdistro.com/wey" style="display:inline-block;padding:16px 40px;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.3px;">Release New Music →</a>
                  </td>
                </tr>
              </table>
              <p style="margin:16px 0 0;font-size:12px;color:#999999;">Takes less than 5 minutes to upload.</p>
            </td>
          </tr>

          <!-- CLOSING -->
          <tr>
            <td style="padding:32px 36px 40px;text-align:center;">
              <p style="margin:0;font-size:14px;line-height:1.7;color:#666666;">
                Your fans are still here. Let's give them something new to play.
              </p>
              <p style="margin:12px 0 0;font-size:14px;font-weight:700;color:#000000;">— The 444Music Team</p>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="padding:24px 32px;border-top:1px solid #eeeeee;text-align:center;background-color:#fafafa;">
              <p style="margin:0;font-size:12px;color:#999999;">This email was sent to {{email}} · 444Music Distribution, Ghana</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();

  const text = `We miss your music, {{name}}!

It's been some time since your last release, and your listeners are waiting. Every new drop keeps your momentum alive, your streams climbing, and your name in front of new audiences across every platform we distribute to.

Here's what a new release unlocks for you:

✓ A shot at our official playlists — every submission is considered for placement on our curated playlists.
✓ Reach on 30+ platforms, days from now — Spotify, Apple Music, Boomplay, Audiomack, Amazon Music and more.
✓ 100% ownership, 100% of your royalties — no middlemen, no hidden fees.
✓ Real-time analytics, from day one — track streams, listeners and revenue across every platform.

A quick note on momentum: streaming platforms favor artists who release consistently. A new release now is one of the fastest ways to bring your catalogue back in front of your listeners, and in front of new ones.

Release new music now: https://www.444musicdistro.com/wey

Your fans are still here. Let's give them something new to play.

— The 444Music Team
This email was sent to {{email}}`;

  return { html, text };
}

module.exports = welcome;