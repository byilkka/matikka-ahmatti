// netlify/functions/verify-parent.js
// Vahvistaa vanhemman sähköpostin linkin kautta

const SB_URL = 'https://whftebwchwvwlyfgytoo.supabase.co';

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method not allowed' };

  const { token, email } = event.queryStringParameters || {};
  if (!token || !email) return htmlResponse('❌ Virheellinen linkki', 'Puuttuvat parametrit.', false);

  const SB_H = {
    'Content-Type': 'application/json',
    'apikey': process.env.SB_SERVICE_KEY,
    'Authorization': `Bearer ${process.env.SB_SERVICE_KEY}`,
  };

  try {
    // Tarkista token
    const rows = await fetch(
      `${SB_URL}/rest/v1/parent_profiles?email=eq.${encodeURIComponent(email)}&verify_token=eq.${encodeURIComponent(token)}&select=email,verified&limit=1`,
      { headers: SB_H }
    ).then(r => r.json());

    if (!rows.length) return htmlResponse('❌ Linkki ei kelpaa', 'Vahvistustunniste ei täsmää tai on vanhentunut.', false);
    if (rows[0].verified) return htmlResponse('✅ Jo vahvistettu', 'Sähköpostiosoitteesi on jo vahvistettu. Voit kirjautua sisään.', true);

    // Merkitse vahvistetuksi
    await fetch(`${SB_URL}/rest/v1/parent_profiles?email=eq.${encodeURIComponent(email)}`, {
      method: 'PATCH',
      headers: { ...SB_H, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ verified: true, verify_token: null })
    });

    return htmlResponse('✅ Sähköposti vahvistettu!', 'Hienoa! Voit nyt kirjautua sisään ja linkittää lapsesi profiilin.', true);
  } catch (err) {
    console.error('verify-parent error:', err);
    return htmlResponse('❌ Virhe', `Tekninen virhe: ${err.message}`, false);
  }
};

function htmlResponse(title, message, success) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: `<!DOCTYPE html>
<html lang="fi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Matikka-Ahmatti</title>
<style>body{margin:0;padding:40px 20px;background:#f4f4f5;font-family:'Helvetica Neue',Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;}
.box{background:#fff;border-radius:16px;padding:40px;max-width:440px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08);}
h1{font-size:1.3rem;color:#1a1a2e;margin:12px 0;}
p{font-size:.88rem;color:#555;line-height:1.6;margin:0 0 20px;}
a{display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#f7c948,#ff9f43);color:#1a1a1a;text-decoration:none;border-radius:40px;font-weight:800;font-size:.88rem;}</style>
</head><body><div class="box">
  <div style="font-size:2.5rem;">${success ? '✅' : '❌'}</div>
  <h1>${title}</h1>
  <p>${message}</p>
  <a href="https://matikka-ahmatti.fi/vanhempi.html">→ Siirry vanhempien näkymään</a>
</div></body></html>`,
  };
}
