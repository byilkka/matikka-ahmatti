// netlify/functions/notify-admin.js
// Kutsutaan kun opettaja lähettää anomuksen
// Lähettää ylläpitäjälle sähköpostin jossa on suora hyväksymislinkki

const FROM_EMAIL = 'noreply@matikka-ahmatti.fi';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { id, name, school, email } = body;
  if (!id || !name || !school || !email) {
    return { statusCode: 400, body: 'Missing fields' };
  }

  const approveUrl = `https://matikka-ahmatti.fi/.netlify/functions/approve-teacher?id=${encodeURIComponent(id)}&token=${encodeURIComponent(process.env.APPROVE_SECRET)}`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: ADMIN_EMAIL,
        subject: `Matikka-Ahmatti: Uusi opettaja-anomus — ${name}`,
        html: adminEmail(name, school, email, approveUrl),
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Resend error: ${err}`);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    };

  } catch (err) {
    console.error('notify-admin error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};

function adminEmail(name, school, email, approveUrl) {
  return `<!DOCTYPE html>
<html lang="fi">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">

    <div style="background:linear-gradient(135deg,#0b1520,#162030);padding:28px 36px;">
      <div style="font-size:1.8rem;margin-bottom:6px;">👩‍🏫</div>
      <div style="color:#f7c948;font-weight:800;font-size:1.1rem;">Uusi opettaja-anomus</div>
      <div style="color:#6a82a0;font-size:.8rem;margin-top:2px;">Matikka-Ahmatti Admin</div>
    </div>

    <div style="padding:32px 36px;">
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <tr><td style="padding:8px 0;font-size:.8rem;font-weight:800;color:#9ca3af;width:100px;">Nimi</td>
            <td style="padding:8px 0;font-size:.9rem;color:#1a1a2e;font-weight:700;">${name}</td></tr>
        <tr style="border-top:1px solid #f3f4f6;">
            <td style="padding:8px 0;font-size:.8rem;font-weight:800;color:#9ca3af;">Koulu</td>
            <td style="padding:8px 0;font-size:.9rem;color:#1a1a2e;font-weight:700;">${school}</td></tr>
        <tr style="border-top:1px solid #f3f4f6;">
            <td style="padding:8px 0;font-size:.8rem;font-weight:800;color:#9ca3af;">Sähköposti</td>
            <td style="padding:8px 0;font-size:.9rem;color:#1a1a2e;font-weight:700;">${email}</td></tr>
      </table>

      <p style="font-size:.85rem;color:#555;margin:0 0 16px;line-height:1.5;">
        Klikkaa alla olevaa nappia hyväksyäksesi anomus. Järjestelmä luo kutsukoodin automaattisesti ja lähettää sen opettajalle sähköpostilla.
      </p>

      <a href="${approveUrl}"
        style="display:block;background:linear-gradient(135deg,#16a34a,#15803d);color:#ffffff;text-decoration:none;text-align:center;padding:16px;border-radius:12px;font-weight:800;font-size:1rem;margin-bottom:16px;">
        ✅ Hyväksy anomus — lähetä kutsukoodi automaattisesti
      </a>

      <p style="font-size:.72rem;color:#9ca3af;text-align:center;margin:0;">
        Linkki on voimassa toistaiseksi. Jos et tunne tätä opettajaa, jätä anomus hyväksymättä.
      </p>
    </div>
  </div>
</body>
</html>`;
}
