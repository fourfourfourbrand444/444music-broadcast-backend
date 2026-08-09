const { db, auth } = require('../config/firebase');
const emailProvider = require('../services/emailProvider');
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
async function sendVerificationCode(req, res) {
  const { uid, email, name } = req.body;
  if (!uid || !email) {
    return res.status(400).json({ error: 'uid and email are required.' });
  }
  const code = generateCode();
  const expiresAt = Date.now() + 15 * 60 * 1000;
  try {
    await db.collection('verificationCodes').doc(uid).set({ code, email, expiresAt });
    const html = `
  <div style="font-family:'Nunito',Arial,sans-serif; background:#f4f4f6; padding:48px 20px;">
    <div style="max-width:480px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.08); border:1px solid #ececef;">
      
      <div style="background:#0a0a0c; padding:32px; text-align:center;">
        <h1 style="margin:0; font-family:'Arial Black',sans-serif; font-size:26px; letter-spacing:2px; color:#ffffff;">444MUSIC</h1>
      </div>
      <div style="padding:40px 36px; text-align:center;">
        <p style="font-size:17px; color:#1a1a1d; margin:0 0 8px;">Hi ${name || 'there'},</p>
        <p style="font-size:15px; color:#6b6b70; margin:0 0 32px;">Enter this code to verify your email address:</p>
        <div style="display:inline-block; background:#0a0a0c; padding:22px 36px; border-radius:12px; margin:0 0 28px;">
          <span style="font-size:42px; font-weight:800; letter-spacing:10px; color:#ffffff; font-family:Arial,sans-serif;">
            ${code}
          </span>
        </div>
        <p style="font-size:13px; color:#9a9a9f; margin:0;">This code expires in 15 minutes.</p>
        <p style="font-size:13px; color:#9a9a9f; margin:8px 0 0;">If you didn't request this, you can safely ignore this email.</p>
      </div>
      <div style="background:#f9f9fb; padding:20px; text-align:center; border-top:1px solid #ececef;">
        <p style="font-size:12px; color:#a6a6ab; margin:0;">© 444Music Distribution</p>
      </div>
    </div>
  </div>
`;
    const result = await emailProvider.sendEmail({ to: email, subject: 'Your 444Music verification code', html });
    if (!result.success) throw new Error(result.error);
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
async function verifyCode(req, res) {
  const { uid, code } = req.body;
  if (!uid || !code) {
    return res.status(400).json({ error: 'uid and code are required.' });
  }
  try {
    const docRef = db.collection('verificationCodes').doc(uid);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      return res.status(400).json({ error: 'No verification code found. Please request a new one.' });
    }
    const data = docSnap.data();
    if (Date.now() > data.expiresAt) {
      return res.status(400).json({ error: 'This code has expired. Please request a new one.' });
    }
    if (data.code !== code) {
      return res.status(400).json({ error: 'Incorrect code. Please try again.' });
    }
    await auth.updateUser(uid, { emailVerified: true });
    await docRef.delete();
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
module.exports = { sendVerificationCode, verifyCode };
