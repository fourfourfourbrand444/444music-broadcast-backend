const { auth, db } = require('../config/firebase');
const emailProvider = require('../services/emailProvider');

async function sendResetLink(req, res) {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }
  try {
    const actionCodeSettings = {
      url: 'https://444musicdistro.com/reset-complete',
      handleCodeInApp: false,
    };
    const link = await auth.generatePasswordResetLink(email, actionCodeSettings);

    let name = 'there';
    try {
      const userRecord = await auth.getUserByEmail(email);
      const userDoc = await db.collection('users').doc(userRecord.uid).get();
      if (userDoc.exists && userDoc.data().name) name = userDoc.data().name;
    } catch (_) {}

    const html = `
  <div style="font-family:'Nunito',Arial,sans-serif; background:#f4f4f6; padding:48px 20px;">
    <div style="max-width:480px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.08); border:1px solid #ececef;">
      <div style="background:#0a0a0c; padding:32px; text-align:center;">
        <h1 style="margin:0; font-family:'Arial Black',sans-serif; font-size:26px; letter-spacing:2px; color:#ffffff;">444MUSIC</h1>
      </div>
      <div style="padding:40px 36px; text-align:center;">
        <p style="font-size:17px; color:#1a1a1d; margin:0 0 8px;">Hi ${name},</p>
        <p style="font-size:15px; color:#6b6b70; margin:0 0 28px;">We received a request to reset your password. Click below to choose a new one:</p>
        <a href="${link}" style="display:inline-block; background:#0a0a0c; color:#ffffff; padding:16px 40px; border-radius:12px; text-decoration:none; font-weight:800; font-size:15px; letter-spacing:0.3px;">Reset Password</a>
        <p style="font-size:13px; color:#9a9a9f; margin:28px 0 0;">This link expires shortly for your security.</p>
        <p style="font-size:13px; color:#9a9a9f; margin:8px 0 0;">If you didn't request this, you can safely ignore this email.</p>
      </div>
      <div style="background:#f9f9fb; padding:20px; text-align:center; border-top:1px solid #ececef;">
        <p style="font-size:12px; color:#a6a6ab; margin:0;">© 444Music Distribution</p>
      </div>
    </div>
  </div>
`;

    const result = await emailProvider.sendEmail({
      to: email,
      subject: 'Reset your 444Music password',
      html,
    });
    if (!result.success) throw new Error(result.error);

    res.status(200).json({ success: true });
  } catch (err) {
    // Don't leak whether the email exists — always return success-shaped response
    if (err.code === 'auth/user-not-found') {
      return res.status(200).json({ success: true });
    }
    res.status(500).json({ error: err.message });
  }
}

module.exports = { sendResetLink };
