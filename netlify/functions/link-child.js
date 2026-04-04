// netlify/functions/link-child.js
// Linkittää lapsen profiilin vanhemman tiliin
// Tarkistaa että lapsi löytyy players-taulusta ennen linkitystä

const SB_URL = 'https://whftebwchwvwlyfgytoo.supabase.co';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { ok: false, error: 'Invalid JSON' }); }

  const { parentEmail, password, playerName, playerChar, pin, nickname } = body;
  if (!parentEmail || !password || !playerName || !playerChar || !pin) {
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

    // 2. Tarkista että lapsi löytyy JA PIN täsmää
    // PIN on hashattu samalla XOR+rotate-algoritmilla kuin pelissä
    // Mutta koska hash-algoritmi on client-side JS, tarkistamme Supabasesta
    // raa'an pin_hash-arvon — vanhemman pitää tietää PIN
    const player = await fetch(
      `${SB_URL}/rest/v1/players?player_name=eq.${encodeURIComponent(playerName)}&player_char=eq.${encodeURIComponent(playerChar)}&select=player_name,pin_hash&limit=1`,
      { headers: SB_H }
    ).then(r => r.json());

    if (!player.length) return json(404, { ok: false, error: 'Pelaajaa ei löydy — tarkista nimi ja hahmo' });

    // Tarkista PIN — sama hash-funktio kuin game.html:ssä
    const pinHash = hashPin(pin, playerName + playerChar);
    if (player[0].pin_hash && player[0].pin_hash !== pinHash) {
      return json(403, { ok: false, error: 'Väärä PIN-koodi — kysy lapseltasi oikea PIN' });
    }

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

// Sama hash-algoritmi kuin game.html:ssä
function hashPin(pin, salt) {
  let h = 0;
  const s = pin + salt + 'matikka_ahmatti_salt_2024';
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(16);
}
