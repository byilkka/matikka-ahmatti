// netlify/functions/approve-teacher.js
// Kutsutaan kun ylläpitäjä klikkaa hyväksymislinkkiä sähköpostissa
// 1. Tarkistaa token-salaisuuden (estää ulkopuolisen hyväksymisen)
// 2. Päivittää teacher_invites status = approved
// 3. Lähettää kutsukoodin opettajalle sähköpostilla (Resend)
// 4. Ohjaa ylläpitäjän onnistumissivulle

const SB_URL = 'https://whftebwchwvwlyfgytoo.supabase.co';
const FROM_EMAIL = 'noreply@matikka-ahmatti.fi';
const ADMIN_EMAIL = 'ilkka.loutesalmi@gmail.com'; // ← vaihda omaksi

exports.handler = async (event) => {
  // Vain GET-pyyntö (hyväksymislinkki selaimessa)
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const { id, token } = event.queryStringParameters || {};

  if (!id || !token) {
    return htmlResponse('❌ Virheellinen linkki', 'Puuttuvat parametrit.', false);
  }

  // Tarkista secret token
  if (token !== process.env.APPROVE_SECRET) {
    return htmlResponse('❌ Luvaton pyyntö', 'Virheellinen vahvistusavain.', false);
  }

  const SB_HEADERS = {
    'Content-Type': 'application/json',
    'apikey': process.env.SB_SERVICE_KEY,
    'Authorization': `Bearer ${process.env.SB_SERVICE_KEY}`,
  };

  try {
    // 1. Hae anomus Supabasesta
    const fetchRes = await fetch(
      `${SB_URL}/rest/v1/teacher_invites?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
      { headers: SB_HEADERS }
    );
    const rows = await fetchRes.json();

    if (!rows.length) {
      return htmlResponse('❌ Anomusta ei löydy', `ID: ${id}`, false);
    }

    const inv = rows[0];

    if (inv.status === 'approved' || inv.status === 'used') {
      return htmlResponse(
        '✅ Jo hyväksytty',
        `${inv.teacher_name} (${inv.email}) on jo hyväksytty kutsukoodilla <strong>${inv.invite_code}</strong>.`,
        true
      );
    }

    // 2. Luo kutsukoodi automaattisesti nimestä
    const inviteCode = generateCode(inv.teacher_name);

    // 3. Päivitä Supabase
    const updateRes = await fetch(
      `${SB_URL}/rest/v1/teacher_invites?id=eq.${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers: { ...SB_HEADERS, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ status: 'approved', invite_code: inviteCode })
      }
    );

    if (!updateRes.ok) throw new Error(`Supabase update failed: ${updateRes.status}`);

    // 4. Lähetä kutsukoodi opettajalle sähköpostilla
    await sendEmail({
      to: inv.email,
      subject: 'Matikka-Ahmatti — opettajatunnuksesi ovat valmiit! 🎉',
      html: teacherWelcomeEmail(inv.teacher_name, inv.school, inviteCode),
    });

    return htmlResponse(
      '✅ Hyväksytty!',
      `<strong>${inv.teacher_name}</strong> (${inv.email}) hyväksytty.<br>
       Kutsukoodi: <strong style="font-size:1.4rem;color:#16a34a;">${inviteCode}</strong><br><br>
       Sähköposti lähetetty opettajalle automaattisesti.`,
      true
    );

  } catch (err) {
    console.error('approve-teacher error:', err);
    return htmlResponse('❌ Virhe', `Tekninen virhe: ${err.message}`, false);
  }
};

// Luo kutsukoodi opettajan sukunimestä
function generateCode(fullName) {
  const parts = fullName.trim().toUpperCase().replace(/[^A-ZÄÖÅ]/g, ' ').trim().split(/\s+/);
  const surname = (parts[parts.length - 1] || 'OPETTAJA')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // poista diakriitit
    .replace(/[^A-Z]/g, '')
    .slice(0, 10);
  const num = Math.floor(Math.random() * 90) + 10;
  return `${surname}${num}`;
}

// Lähetä sähköposti Resendillä
async function sendEmail({ to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to,
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error: ${err}`);
  }
  return res.json();
}

// Sähköpostipohja opettajalle
function teacherWelcomeEmail(name, school, code) {
  return `<!DOCTYPE html>
<html lang="fi">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#0b1520,#162030);padding:32px 36px;text-align:center;">
      <div style="font-size:2.5rem;margin-bottom:8px;">🐐</div>
      <div style="font-family:Georgia,serif;font-size:1.5rem;color:#f7c948;font-weight:700;">Matikka-Ahmatti</div>
      <div style="color:#6a82a0;font-size:.8rem;font-weight:600;margin-top:4px;letter-spacing:1px;text-transform:uppercase;">Opettajapaneeli</div>
    </div>

    <!-- Body -->
    <div style="padding:36px;">
      <p style="font-size:1rem;color:#1a1a2e;font-weight:700;margin:0 0 6px;">Hei ${name}! 👋</p>
      <p style="font-size:.9rem;color:#444;line-height:1.6;margin:0 0 24px;">
        Opettajatunnuksesi <strong>${school}</strong>-koululle on hyväksytty. Tässä kutsukoodisi:
      </p>

      <!-- Code box -->
      <div style="background:#f0fdf4;border:2px solid #16a34a;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;">
        <div style="font-size:.7rem;font-weight:800;color:#16a34a;letter-spacing:3px;text-transform:uppercase;margin-bottom:8px;">Kutsukoodisi</div>
        <div style="font-family:'Courier New',monospace;font-size:2rem;font-weight:900;color:#15803d;letter-spacing:4px;">${code}</div>
      </div>

      <!-- Steps -->
      <p style="font-size:.85rem;color:#444;font-weight:700;margin:0 0 12px;">Näin pääset alkuun:</p>
      <ol style="font-size:.85rem;color:#555;line-height:1.8;padding-left:20px;margin:0 0 24px;">
        <li>Mene osoitteeseen <a href="https://matikka-ahmatti.fi/opettaja.html" style="color:#2563eb;">matikka-ahmatti.fi/opettaja.html</a></li>
        <li>Syötä kutsukoodi: <strong>${code}</strong></li>
        <li>Luo oma PIN-koodi</li>
        <li>Luo luokka ja jaa luokkakoodi oppilaillesi</li>
      </ol>

      <a href="https://matikka-ahmatti.fi/opettaja.html"
        style="display:block;background:linear-gradient(135deg,#f7c948,#ff9f43);color:#1a1a1a;text-decoration:none;text-align:center;padding:14px;border-radius:40px;font-weight:800;font-size:.95rem;">
        🚀 Siirry opettajapaneeliin
      </a>
    </div>

    <!-- Footer -->
    <div style="padding:20px 36px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;">
      <p style="font-size:.72rem;color:#9ca3af;margin:0;">
        Matikka-Ahmatti · matikka-ahmatti.fi<br>
        Kysymyksiä? <a href="https://matikka-ahmatti.fi/contact.html" style="color:#6b7280;">Ota yhteyttä</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

// HTML-vastaus ylläpitäjälle selaimessa
function htmlResponse(title, message, success) {
  const color = success ? '#16a34a' : '#dc2626';
  const bg = success ? '#f0fdf4' : '#fef2f2';
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: `<!DOCTYPE html>
<html lang="fi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} — Matikka-Ahmatti</title>
  <style>
    body{margin:0;padding:40px 20px;background:#f4f4f5;font-family:'Helvetica Neue',Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;}
    .box{background:#fff;border-radius:16px;padding:40px;max-width:460px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08);}
    .icon{font-size:3rem;margin-bottom:12px;}
    h1{font-size:1.4rem;color:#1a1a2e;margin:0 0 12px;}
    p{font-size:.9rem;color:#555;line-height:1.6;margin:0 0 20px;}
    a{display:inline-block;padding:10px 24px;background:#0b1520;color:#f7c948;text-decoration:none;border-radius:40px;font-weight:700;font-size:.85rem;}
  </style>
</head>
<body>
  <div class="box">
    <div class="icon">${success ? '✅' : '❌'}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="https://matikka-ahmatti.fi/opettaja.html">← Opettajapaneeli</a>
  </div>
</body>
</html>`,
  };
}
