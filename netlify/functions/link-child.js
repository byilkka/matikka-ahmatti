// netlify/functions/link-child.js
// Linkittää lapsen profiilin vanhemman tiliin
// Tarkistaa että lapsi löytyy players-taulusta ennen linkitystä

const SB_URL = 'https://whftebwchwvwlyfgytoo.supabase.co';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { ok: false, error: 'Invalid JSON' }); }

  const { parentEmail, password, playerName, playerChar, nickname } = body;
  if (!parentEmail || !password || !playerName || !playerChar) {
    return json(400, { ok: false, error: 'Puuttuvat kentät' });
  }

  const SB_H = {
    'Content-Type': 'application/json',
    'apikey': process.env.SB_SERVICE_KEY,
    'Authorization': `Bearer ${process.env.SB_SERVICE_KEY}`,
  };

  try {
    const { createHash } = require('crypto');
    const pwdHash = createHash('sha256').update(password + process.env.APPROVE_SECRET).digest('hex');

    // 1. Tarkista vanhemman kirjautuminen
    const parent = await fetch(
      `${SB_URL}/rest/v1/parent_profiles?email=eq.${encodeURIComponent(parentEmail)}&pwd_hash=eq.${pwdHash}&select=email,verified&limit=1`,
      { headers: SB_H }
    ).then(r => r.json());

    if (!parent.length) return json(401, { ok: false, error: 'Väärä sähköposti tai salasana' });
    if (!parent[0].verified) return json(403, { ok: false, error: 'Vahvista sähköpostiosoitteesi ensin' });

    // 2. Tarkista että lapsi löytyy
    const player = await fetch(
      `${SB_URL}/rest/v1/players?player_name=eq.${encodeURIComponent(playerName)}&player_char=eq.${encodeURIComponent(playerChar)}&select=player_name&limit=1`,
      { headers: SB_H }
    ).then(r => r.json());

    if (!player.length) return json(404, { ok: false, error: 'Pelaajaa ei löydy — tarkista nimi ja hahmo' });

    // 3. Linkitä
    const linkRes = await fetch(`${SB_URL}/rest/v1/parent_children`, {
      method: 'POST',
      headers: { ...SB_H, 'Prefer': 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({
        parent_email: parentEmail,
        player_name: playerName,
        player_char: playerChar,
        nickname: nickname || playerName
      })
    });
    if (!linkRes.ok) throw new Error(`Link insert failed: ${linkRes.status}`);

    return json(200, { ok: true });
  } catch (err) {
    console.error('link-child error:', err);
    return json(500, { ok: false, error: 'Tekninen virhe — yritä uudelleen' });
  }
};

function json(status, data) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}
