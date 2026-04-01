// netlify/functions/register-parent.js
// Rekisteröi uuden vanhemman, lähettää vahvistussähköpostin

const SB_URL = 'https://whftebwchwvwlyfgytoo.supabase.co';
const FROM_EMAIL = 'noreply@matikka-ahmatti.fi';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const { email, password } = body;
  if (!email || !password) return json(400, { ok: false, error: 'Puuttuvat kentät' });
  if (password.length < 8) return json(400, { ok: false, error: 'Salasana liian lyhyt (min 8 merkkiä)' });

  const SB_H = {
    'Content-Type': 'application/json',
    'apikey': process.env.SB_SERVICE_KEY,
    'Authorization': `Bearer ${process.env.SB_SERVICE_KEY}`,
  };

  try {
    // Tarkista onko sähköposti jo käytössä
    const existing = await fetch(
      `${SB_URL}/rest/v1/parent_profiles?email=eq.${encodeURIComponent(email)}&select=email&limit=1`,
      { headers: SB_H }
    ).then(r => r.json());

    if (existing.length > 0) return json(409, { ok: false, error: 'Sähköpostiosoite on jo rekisteröity' });

    // Luo salasana-hash ja vahvistustoken
    const pwdHash = await sha256(password + process.env.APPROVE_SECRET);
    const verifyToken = await sha256(email + Date.now() + process.env.APPROVE_SECRET);

    // Tallenna Supabaseen
    const insertRes = await fetch(`${SB_URL}/rest/v1/parent_profiles`, {
      method: 'POST',
      headers: { ...SB_H, 'Prefer': 'return=representation' },
      body: JSON.stringify({ email, pwd_hash: pwdHash, verified: false, verify_token: verifyToken })
    });
    if (!insertRes.ok) throw new Error(`Supabase insert failed: ${insertRes.status}`);

    // Lähetä vahvistussähköposti
    const verifyUrl = `https://matikka-ahmatti.fi/.netlify/functions/verify-parent?token=${verifyToken}&email=${encodeURIComponent(email)}`;
    await sendEmail(email, 'Vahvista sähköpostiosoitteesi — Matikka-Ahmatti', verifyEmailHtml(verifyUrl));

    return json(200, { ok: true });
  } catch (err) {
    console.error('register-parent error:', err);
    return json(500, { ok: false, error: 'Tekninen virhe — yritä uudelleen' });
  }
};

async function sha256(str) {
  const { createHash } = require('crypto');
  return createHash('sha256').update(str).digest('hex');
}

async function sendEmail(to, subject, html) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend error: ${await res.text()}`);
}

function json(status, data) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

function verifyEmailHtml(verifyUrl) {
  return `<!DOCTYPE html><html lang="fi"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:500px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#0b1520,#162030);padding:28px 36px;text-align:center;">
      <div style="font-size:2rem;margin-bottom:8px;">👨‍👩‍👧</div>
      <div style="color:#f7c948;font-weight:800;font-size:1.1rem;">Matikka-Ahmatti</div>
      <div style="color:#6a82a0;font-size:.8rem;margin-top:2px;">Vanhempien näkymä</div>
    </div>
    <div style="padding:32px 36px;">
      <p style="font-size:.9rem;color:#444;line-height:1.6;margin:0 0 20px;">
        Hei! Vahvista sähköpostiosoitteesi jotta voit seurata lapsesi edistymistä Matikka-Ahmattissa.
      </p>
      <a href="${verifyUrl}" style="display:block;background:linear-gradient(135deg,#f7c948,#ff9f43);color:#1a1a1a;text-decoration:none;text-align:center;padding:14px;border-radius:40px;font-weight:800;font-size:.95rem;margin-bottom:16px;">
        ✅ Vahvista sähköpostiosoite
      </a>
      <p style="font-size:.72rem;color:#9ca3af;text-align:center;margin:0;">Linkki vanhenee 24 tunnin kuluttua.</p>
    </div>
  </div>
</body></html>`;
}
