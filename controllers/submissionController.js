/**
 * controllers/submissionController.js
 *
 * Sends the admin-notification and artist-confirmation emails via
 * emailProvider (Brevo) once, when a submission is created in Release
 * Info. The admin email now also carries the cover art and audio file
 * links directly — and each audio file entry now shows its per-track
 * Main Artist and Featured Artist details too, not just the title and
 * download link. Those fields are collected on the Files/Upload page
 * (and can also be tagged per-track on the Release Info page's
 * Featuring section) and now flow all the way through to this email
 * instead of being dropped or merged together across tracks.
 *
 * Also exports notifyPaidExistingSubmission() — reused by
 * paystackRoutes.js to resend this SAME admin email (metadata + files)
 * when a "Pay Now" payment on an already-existing draft clears.
 *
 * Also handles resubmissions (data.type === 'resubmission', sent by
 * rejection_fix_screen.dart) — both the admin email banner and the
 * artist-facing email now correctly say "fix received / back in
 * review" instead of being mislabeled as a new submission or a
 * payment confirmation.
 *
 *   POST /api/submissions/notify
 */

const emailProvider = require('../services/emailProvider');
const logger = require('../utils/logger');

const ADMIN_EMAIL = process.env.ADMIN_NOTIFICATION_EMAIL || process.env.FROM_EMAIL;
const CONTACT_EMAIL = 'contact@444musicdistro.com'.includes('@') ? '444musicdistro@gmail.com' : '444musicdistro@gmail.com';
const LOGO_URL = 'https://444music-distribution.vercel.app/black.png';

const SOCIAL_LINKS = [
  { label: 'Instagram — @_444musicdistro', url: 'https://www.instagram.com/_444musicdistro/' },
  { label: 'Instagram — @444musicdistro_', url: 'https://www.instagram.com/444musicdistro_/' },
  { label: 'Playlists — @444music_playlist', url: 'https://www.instagram.com/444music_playlist/' },
];

// ─── EMAIL STYLE CONSTANTS ────────────────────────────────────────────────
const _colors = {
  bg: '#f4f4f5',
  card: '#ffffff',
  header: '#0a0a0a',
  border: '#e5e5e5',
  label: '#6b6b6b',
  value: '#111111',
  sectionTitle: '#0a0a0a',
  paidBg: '#e8f9ee',
  paidText: '#1b7a3d',
  paidBorder: '#bfead0',
  unpaidBg: '#fdecec',
  unpaidText: '#b3261e',
  unpaidBorder: '#f6c6c4',
  reviewBg: '#eef2ff',
  reviewText: '#3730a3',
  reviewBorder: '#c7d2fe',
};

function _row(label, value) {
  const safeValue = (value === undefined || value === null || value === '')
    ? '<span style="color:#b3b3b3;">Not provided</span>'
    : value;
  return `
    <tr>
      <td style="padding:9px 0; width:42%; vertical-align:top; font-family:Arial,Helvetica,sans-serif; font-size:12px; font-weight:700; letter-spacing:0.3px; color:${_colors.label}; text-transform:uppercase;">
        ${label}
      </td>
      <td style="padding:9px 0; vertical-align:top; font-family:Arial,Helvetica,sans-serif; font-size:14px; color:${_colors.value}; line-height:1.5;">
        ${safeValue}
      </td>
    </tr>
  `;
}

function _section(title, rowsHtml) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:18px; background:${_colors.card}; border:1px solid ${_colors.border}; border-radius:10px;">
      <tr>
        <td style="padding:16px 20px 4px 20px;">
          <div style="font-family:Arial,Helvetica,sans-serif; font-size:11px; font-weight:800; letter-spacing:1.2px; color:${_colors.sectionTitle}; text-transform:uppercase; padding-bottom:8px; border-bottom:1px solid ${_colors.border}; margin-bottom:4px;">
            ${title}
          </div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${rowsHtml}
          </table>
        </td>
      </tr>
    </table>
  `;
}

/**
 * Renders the cover-art <img> block — but ONLY when `url` actually looks
 * like a real hosted https(s) image link.
 *
 * This guards against three failure modes that would otherwise produce
 * a broken-image icon (seen in Outlook specifically, whose desktop
 * rendering engine does not support data: URIs at all):
 *   1. A `data:image/...;base64,...` URI — e.g. left over from the
 *      Flutter app's "Change Cover" edit feature, which historically
 *      wrote a base64 data URI straight to Firestore's `coverURL`
 *      instead of uploading to Cloudinary and storing the returned
 *      https link.
 *   2. An empty string / undefined / null.
 *   3. Any other malformed value (relative path, plain text, etc).
 *
 * In all three cases we now simply omit the image block entirely,
 * rather than embedding a value we can't be sure is a real link.
 */
function _coverImageBlock(url) {
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) {
    return '';
  }
  return `
    <tr>
      <td style="background:${_colors.card}; border-left:1px solid ${_colors.border}; border-right:1px solid ${_colors.border}; padding:0 24px 20px 24px;">
        <img src="${url}" width="100%" style="max-width:572px; display:block; border-radius:10px; border:1px solid ${_colors.border};" alt="Cover Art" />
      </td>
    </tr>
  `;
}

/**
 * Renders the Audio Files section. Each entry now shows, alongside the
 * title and download button, its own per-track Main Artist and Featured
 * Artist details when present — labeled explicitly so it's unambiguous
 * at a glance which artist is the main credit and which is featured on
 * THAT specific track, without it being confused with the release-wide
 * merged "Featuring" row further down in Release Details.
 */
function _audioSection(files) {
  if (!files || !files.length) {
    return _section('Audio Files', _row('Track File', null));
  }
  const rows = files.map((f, i) => {
    const metaBits = [];
    if (f.artist) metaBits.push(`<div style="font-family:Arial,Helvetica,sans-serif; font-size:11.5px; color:${_colors.label}; margin-top:3px;">Main Artist: <span style="color:${_colors.value};">${f.artist}</span></div>`);
    if (f.featuring) metaBits.push(`<div style="font-family:Arial,Helvetica,sans-serif; font-size:11.5px; color:${_colors.label}; margin-top:1px;">Featured Artist: <span style="color:${_colors.value};">${f.featuring}</span></div>`);

    return `
    <tr>
      <td style="padding:10px 0; ${i < files.length - 1 ? `border-bottom:1px solid ${_colors.border};` : ''}">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="vertical-align:top;">
              <div style="font-family:Arial,Helvetica,sans-serif; font-size:13px; font-weight:600; color:${_colors.value};">
                ${f.title || 'Track'}
              </div>
              ${metaBits.join('')}
            </td>
            <td align="right" style="vertical-align:top;">
              <a href="${f.url}" style="display:inline-block; background:${_colors.header}; color:#ffffff; text-decoration:none; font-family:Arial,Helvetica,sans-serif; font-size:11px; font-weight:700; padding:8px 14px; border-radius:7px;">DOWNLOAD MP3</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;
  }).join('');
  return _section('Audio Files', `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`);
}

/**
 * Builds the internal admin-notification HTML.
 * Header now correctly distinguishes THREE cases instead of two:
 *   - d.type === 'resubmission'  -> fix/resubmit received
 *   - d.is_resend (no type)      -> Pay Now payment confirmation resend
 *   - default                    -> brand new submission
 */
function buildAdminHtml(d) {
  const isPaid = (d.payment_status || '').toLowerCase() === 'paid';
  const statusBg = isPaid ? _colors.paidBg : _colors.unpaidBg;
  const statusText = isPaid ? _colors.paidText : _colors.unpaidText;
  const statusBorder = isPaid ? _colors.paidBorder : _colors.unpaidBorder;
  const statusLabel = d.payment_status || 'Not confirmed';

  const isResubmission = d.type === 'resubmission';
  const headerTitle = isResubmission
    ? 'Fix Submitted — Release Back In Review'
    : d.is_resend
      ? 'Payment Confirmed — Release Already Submitted'
      : 'New Release Submission';

  return `
  <div style="background:${_colors.bg}; padding:28px 16px; font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px; margin:0 auto;">

      <!-- Header -->
      <tr>
        <td style="background:${_colors.header}; border-radius:12px 12px 0 0; padding:22px 24px;">
          <div style="font-family:Arial,Helvetica,sans-serif; font-size:13px; font-weight:800; letter-spacing:2px; color:#ffffff; text-transform:uppercase;">
            444Music Distribution
          </div>
          <div style="font-family:Arial,Helvetica,sans-serif; font-size:19px; font-weight:800; color:#ffffff; margin-top:4px;">
            ${headerTitle}
          </div>
        </td>
      </tr>

      ${isResubmission ? `
      <!-- Resubmission context banner -->
      <tr>
        <td style="background:${_colors.card}; border-left:1px solid ${_colors.border}; border-right:1px solid ${_colors.border}; padding:20px 24px 0 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${_colors.reviewBg}; border:1px solid ${_colors.reviewBorder}; border-radius:10px;">
            <tr>
              <td style="padding:14px 18px; font-family:Arial,Helvetica,sans-serif; font-size:13px; color:${_colors.reviewText};">
                <strong>Previous rejection (${d.category || 'unspecified'}):</strong> ${d.previous_reason || 'No reason recorded'}<br>
                <strong>Fix type:</strong> ${d.fix_kind || 'unspecified'}
              </td>
            </tr>
          </table>
        </td>
      </tr>
      ` : ''}

      <!-- Payment status + artist banner -->
      <tr>
        <td style="background:${_colors.card}; border-left:1px solid ${_colors.border}; border-right:1px solid ${_colors.border}; padding:20px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${statusBg}; border:1px solid ${statusBorder}; border-radius:10px;">
            <tr>
              <td style="padding:16px 18px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="font-family:Arial,Helvetica,sans-serif; font-size:11px; font-weight:800; letter-spacing:1px; color:${statusText}; text-transform:uppercase;">
                      Payment Status
                    </td>
                    <td align="right" style="font-family:Arial,Helvetica,sans-serif; font-size:11px; font-weight:800; letter-spacing:1px; color:${statusText}; text-transform:uppercase;">
                      ${statusLabel}
                    </td>
                  </tr>
                </table>
                <div style="font-family:Arial,Helvetica,sans-serif; font-size:20px; font-weight:800; color:#111111; margin-top:8px;">
                  ${d.artist_name || 'Unknown Artist'}
                </div>
                <div style="font-family:Arial,Helvetica,sans-serif; font-size:13px; color:#4a4a4a; margin-top:2px;">
                  ${d.release_title || 'Untitled release'}
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      ${_coverImageBlock(d.cover_url)}

      <!-- Sections -->
      <tr>
        <td style="background:${_colors.bg}; border-left:1px solid ${_colors.border}; border-right:1px solid ${_colors.border}; border-bottom:1px solid ${_colors.border}; border-radius:0 0 12px 12px; padding:4px 24px 24px 24px;">

          ${_audioSection(d.audio_files)}

          ${_section('Release Details', `
            ${_row('Release Title', d.release_title)}
            ${_row('Featuring', (d.featuring || 'None').replace(/\n/g, '<br>'))}
            ${_row('Release Type', d.release_type)}
            ${_row('Genre', d.genre)}
            ${_row('Language', d.language)}
            ${_row('Release Date', d.release_date)}
            ${_row('Explicit', d.explicit)}
            ${_row('Country', d.country)}
          `)}

          ${_section('Song Details &amp; Ownership', `
            ${_row('Version', d.version)}
            ${_row('Vocal Type', d.vocal_type)}
            ${_row('Previously Released', d.previously_released)}
            ${_row('Previous Release Date', d.previous_release_date)}
            ${_row('Ownership Confirmed', d.ownership_confirmed)}
          `)}

          ${_section('Label &amp; Rights', `
            ${_row('Label', d.label)}
            ${_row('Copyright', d.copyright)}
          `)}

          ${_section('Identifiers', `
            ${_row('ISRC', d.isrc)}
            ${_row('UPC', d.upc)}
            ${_row('Catalog Number', d.catalog_number)}
          `)}

          ${_section('Production Credits', `
            ${_row('Producers', (d.producers || 'None').replace(/\n/g, '<br>'))}
            ${_row('Musicians', (d.musicians || 'None').replace(/\n/g, '<br>'))}
            ${_row('Songwriters', (d.songwriters || 'None').replace(/\n/g, '<br>'))}
          `)}

          ${_section('Contact', `
            ${_row('Email', d.email)}
            ${_row('Phone', d.phone)}
          `)}

          ${_section('Lyrics', `
            ${_row('Lyrics', (d.lyrics || 'Not provided').replace(/\n/g, '<br>'))}
          `)}

          <div style="font-family:Arial,Helvetica,sans-serif; font-size:11px; color:#9a9a9a; text-align:center; padding-top:6px;">
            ${isResubmission
      ? 'Automated resubmission notification — 444Music Distribution'
      : d.is_resend
        ? 'Automated payment confirmation — 444Music Distribution'
        : 'Automated submission notification — 444Music Distribution'}
          </div>

        </td>
      </tr>

    </table>
  </div>
  `;
}

// ─── ARTIST-FACING EMAIL — SHARED SHELL ────────────────────────────────────
// Full-screen, white-themed, branded. Used for both "new submission
// received" and "fix received / back in review" — only the badge glyph,
// headline, and message text change between the two.
function _artistEmailShell({ badgeGlyph, badgeColor, headline, subhead, bodyHtml }) {
  return `
  <div style="background:${_colors.bg}; margin:0; padding:0; font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${_colors.bg}; padding:36px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

            <!-- Logo -->
            <tr>
              <td align="center" style="padding-bottom:28px;">
                <img src="${LOGO_URL}" alt="444Music Distribution" height="34" style="height:34px; width:auto; display:inline-block;" />
              </td>
            </tr>

            <!-- Status badge + headline -->
            <tr>
              <td align="center" style="padding-bottom:24px;">
                <div style="width:56px; height:56px; line-height:56px; border-radius:50%; background:${badgeColor}; color:#ffffff; font-size:26px; font-weight:800; text-align:center; margin:0 auto 16px auto;">
                  ${badgeGlyph}
                </div>
                <div style="font-family:Arial,Helvetica,sans-serif; font-size:22px; font-weight:800; color:#0a0a0a;">
                  ${headline}
                </div>
                <div style="font-family:Arial,Helvetica,sans-serif; font-size:13.5px; color:#6b6b6b; margin-top:6px;">
                  ${subhead}
                </div>
              </td>
            </tr>

            <!-- Body card -->
            <tr>
              <td style="background:${_colors.card}; border:1px solid ${_colors.border}; border-radius:14px; padding:28px 26px;">
                ${bodyHtml}
              </td>
            </tr>

            <!-- Contact CTA -->
            <tr>
              <td align="center" style="padding:28px 0 8px 0;">
                <a href="mailto:${CONTACT_EMAIL}" style="display:inline-block; background:${_colors.header}; color:#ffffff; text-decoration:none; font-family:Arial,Helvetica,sans-serif; font-size:13px; font-weight:700; padding:13px 26px; border-radius:9px;">
                  Questions? Email ${CONTACT_EMAIL}
                </a>
              </td>
            </tr>

            <!-- Social links -->
            <tr>
              <td align="center" style="padding:18px 0 6px 0;">
                <div style="font-family:Arial,Helvetica,sans-serif; font-size:11px; font-weight:800; letter-spacing:1px; color:#9a9a9a; text-transform:uppercase; padding-bottom:10px;">
                  Follow 444Music Distribution
                </div>
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    ${SOCIAL_LINKS.map((s, i) => `
                      <td style="padding:${i === 0 ? '0' : '0 0 0 8px'};">
                        <a href="${s.url}" style="display:inline-block; background:#ffffff; border:1px solid ${_colors.border}; color:#0a0a0a; text-decoration:none; font-family:Arial,Helvetica,sans-serif; font-size:11px; font-weight:700; padding:9px 12px; border-radius:20px;">
                          ${s.label}
                        </a>
                      </td>
                    `).join('')}
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td align="center" style="padding-top:24px;">
                <div style="font-family:Arial,Helvetica,sans-serif; font-size:11px; color:#b3b3b3;">
                  © ${new Date().getFullYear()} 444Music Distribution. All rights reserved.
                </div>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </div>
  `;
}

function buildUserHtml(d) {
  const isResubmission = d.type === 'resubmission';

  if (isResubmission) {
    return _artistEmailShell({
      badgeGlyph: '&#8635;', // circular arrow glyph — "back in review"
      badgeColor: '#3730a3',
      headline: 'Your Fix Is In',
      subhead: 'We received your update and it\'s back under review.',
      bodyHtml: `
        <p style="font-family:Arial,Helvetica,sans-serif; font-size:14.5px; color:#1a1a1a; line-height:1.6; margin:0 0 14px 0;">
          Hi ${d.artist_name || 'there'},
        </p>
        <p style="font-family:Arial,Helvetica,sans-serif; font-size:14.5px; color:#1a1a1a; line-height:1.6; margin:0 0 18px 0;">
          Thanks for fixing up "<strong>${d.release_title || 'your release'}</strong>". Your update has been
          submitted successfully and our team will take another look shortly. No further action is
          needed from you right now — we'll email you as soon as it's approved and moving to distribution.
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${_colors.reviewBg}; border:1px solid ${_colors.reviewBorder}; border-radius:10px;">
          <tr>
            <td style="padding:13px 16px; font-family:Arial,Helvetica,sans-serif; font-size:12.5px; color:${_colors.reviewText}; font-weight:700;">
              Status: Back in Review
            </td>
          </tr>
        </table>
      `,
    });
  }

  return _artistEmailShell({
    badgeGlyph: '&#10003;', // checkmark
    badgeColor: '#0a0a0a',
    headline: 'Submission Received',
    subhead: 'Your release is now pending review.',
    bodyHtml: `
      <p style="font-family:Arial,Helvetica,sans-serif; font-size:14.5px; color:#1a1a1a; line-height:1.6; margin:0 0 14px 0;">
        Hi ${d.artist_name || 'there'},
      </p>
      <p style="font-family:Arial,Helvetica,sans-serif; font-size:14.5px; color:#1a1a1a; line-height:1.6; margin:0 0 18px 0;">
        We've received your submission for "<strong>${d.release_title || 'your release'}</strong>" and
        it's now pending review by our team. We'll be in touch as soon as it's approved and moving
        to distribution.
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${_colors.paidBg}; border:1px solid ${_colors.paidBorder}; border-radius:10px;">
        <tr>
          <td style="padding:13px 16px; font-family:Arial,Helvetica,sans-serif; font-size:12.5px; color:${_colors.paidText}; font-weight:700;">
            Status: Pending Review
          </td>
        </tr>
      </table>
    `,
  });
}

// ─── SHARED ADMIN SEND (used by normal submit flow, resend, and resubmit) ─
async function _sendAdminNotification(data) {
  if (!ADMIN_EMAIL) {
    logger.error('ADMIN_NOTIFICATION_EMAIL (or FROM_EMAIL) is not set — cannot send admin notification.');
    return { success: false, error: 'ADMIN_NOTIFICATION_EMAIL not configured' };
  }
  const isResubmission = data.type === 'resubmission';
  const subjectPrefix = isResubmission
    ? 'Fix Submitted — '
    : data.is_resend
      ? 'Payment Confirmed — '
      : 'New Release Submission — ';
  return emailProvider.sendEmail({
    to: ADMIN_EMAIL,
    subject: `${subjectPrefix}${data.release_title || 'Untitled release'}`,
    html: buildAdminHtml(data),
  });
}

/**
 * POST /api/submissions/notify
 * Fires when a submission is first created (Release Info) AND when a
 * rejected submission is fixed/resubmitted (rejection_fix_screen.dart,
 * data.type === 'resubmission'). Sends both the admin notification and
 * an artist-facing email — the artist email content now correctly
 * reflects which case it is instead of always saying "we received your
 * submission" even on a resubmit.
 */
async function notifySubmission(req, res) {
  const data = req.body || {};

  if (!data.email || !data.artist_name || !data.release_title) {
    return res.status(400).json({
      success: false,
      message: 'Missing required fields: "email", "artist_name", and "release_title" are required.',
    });
  }

  const isResubmission = data.type === 'resubmission';
  const userSubject = isResubmission
    ? `Your fix is in — ${data.release_title}`
    : `We received your submission — ${data.release_title}`;

  const [adminResult, userResult] = await Promise.all([
    _sendAdminNotification(data),
    emailProvider.sendEmail({
      to: data.email,
      subject: userSubject,
      html: buildUserHtml(data),
    }),
  ]);

  if (!adminResult.success) {
    logger.error(`Admin notification email failed: ${adminResult.error}`);
  }
  if (!userResult.success) {
    logger.error(`Artist confirmation email failed: ${userResult.error}`);
  }

  return res.status(200).json({
    success: true,
    adminEmailSent: adminResult.success,
    userEmailSent: userResult.success,
  });
}

/**
 * Resends the SAME admin email (metadata + cover art + audio links)
 * with payment_status forced to 'Paid' and is_resend:true. Called by
 * paystackRoutes.js right after a Pay Now payment clears on an existing
 * draft. Admin-only — the artist already got their confirmation email
 * the first time, at submission.
 */
async function notifyPaidExistingSubmission(data) {
  const result = await _sendAdminNotification({
    ...data,
    is_resend: true,
    payment_status: 'Paid',
  });
  if (!result.success) {
    logger.error(`Pay Now confirmation email failed: ${result.error}`);
  }
  return result;
}

/**
 * Maps a raw Firestore `submissions` doc (camelCase, as written by
 * release_info_screen.dart) into the flat snake_case shape buildAdminHtml
 * expects. Centralized here so paystackRoutes.js doesn't have to
 * duplicate this field-by-field mapping.
 */
function mapSubmissionForEmail(sub) {
  const credits = sub.credits || {};

  const fmtCredits = (list) => {
    const filtered = (list || []).filter((c) => (c.name || '').trim());
    if (!filtered.length) return 'None';
    return filtered
      .map((c) => `• ${c.name}${c.role ? ' — ' + c.role : ''}${c.ipi ? ' (IPI: ' + c.ipi + ')' : ''}`)
      .join('\n');
  };

  const featuredList = sub.featuredArtists || [];
  const featuring = featuredList.length
    ? featuredList
      .map((f) => `${f.name} (${f.role})${f.url ? ' — ' + f.url : ''}`)
      .join('\n')
    : 'None';

  return {
    email: sub.email,
    artist_name: sub.artistName,
    release_title: sub.releaseTitle,
    featuring,
    release_type: sub.releaseType,
    genre: sub.genre,
    language: sub.language || 'Not specified',
    release_date: sub.releaseDate || 'Not set',
    explicit: sub.explicit,
    country: sub.country,
    phone: sub.phone || 'Not provided',
    label: sub.label || 'Independent',
    copyright: sub.copyright || 'Not provided',
    isrc: sub.isrc || 'Not provided',
    upc: sub.upc || 'Auto-assign',
    catalog_number: sub.catalogNumber || 'Not provided',
    version: sub.version,
    previously_released: sub.previouslyReleased,
    previous_release_date: sub.previousReleaseDate || 'N/A',
    vocal_type: sub.vocalType,
    ownership_confirmed: sub.ownershipConfirmed
      ? 'Yes — confirmed original work'
      : 'Not confirmed',
    producers: fmtCredits(credits.producer),
    musicians: fmtCredits(credits.musician),
    songwriters: fmtCredits(credits.writer),
    lyrics: sub.lyrics || 'Not provided',
    // Deliberately NOT sub.coverURL — that field can be overwritten at
    // any time by the artist's "Change Cover" quick-edit on their
    // dashboard, which is a frontend-only convenience feature we don't
    // want reflected in admin/payment emails. officialCoverURL is only
    // ever set at the original Files-page upload and by the rejection-fix
    // resubmission flow, so it always reflects the cover art actually
    // going to distribution. Falls back to coverURL only for older
    // submissions saved before this field existed.
    cover_url: sub.officialCoverURL || sub.coverURL || '',
    // Carries Main Artist + Featured Artist per track (previously only
    // title and url), matching what _audioSection now renders. Each
    // track's `featuring` value is whatever was resolved and tagged on
    // the Release Info page (upload-page text, or a manually assigned
    // track), so per-track features never collapse into one bucket.
    audio_files: (sub.audioFiles || [])
      .filter((f) => f && f.url)
      .map((f) => ({
        title: f.title || sub.releaseTitle || 'Track',
        artist: f.artist || sub.artistName || '',
        featuring: f.featuring || '',
        url: f.url,
      })),
  };
}

module.exports = {
  notifySubmission,
  notifyPaidExistingSubmission,
  mapSubmissionForEmail,
};