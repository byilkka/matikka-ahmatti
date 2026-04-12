// netlify/functions/delete-player.js
// Poistaa pelaajan kaikista tauluista. Vaatii APPROVE_SECRET-tokenin.

const SB_URL = 'https://whftebwchwvwlyfgytoo.supabase.co';

exports.handler = async (event) => {
  if (event.httpMethod !== 'DELETE') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const secret = event.queryStringParameters?.secret;
  if (!secret || secret !== process.env.APPROVE_SECRET) {
    return { statusCode: 403, body: 'Forbidden' };
  }

  const { name, char } = JSON.parse(event.body || '{}');
  if (!name || !char) {
    return { statusCode: 400, body: 'Missing name or char' };
  }

  const SB_KEY = process.env.SB_SERVICE_KEY;
  const headers = {
    'Content-Type': 'application/json',
    'apikey': SB_KEY,
    'Authorization': `Bearer ${SB_KEY}`
  };

  const enc = encodeURIComponent(name);
  const tables = [
    { table: 'achievements',    filter: `player_name=eq.${enc}&player_char=eq.${char}` },
    { table: 'player_progress', filter: `player_name=eq.${enc}&player_char=eq.${char}` },
    { table: 'class_members',   filter: `player_name=eq.${enc}&player_char=eq.${char}` },
    { table: 'parent_children', filter: `player_name=eq.${enc}&player_char=eq.${char}` },
    { table: 'scores',          filter: `name=eq.${enc}&char=eq.${char}` },
    { table: 'players',         filter: `player_name=eq.${enc}&player_char=eq.${char}` },
  ];

  const results = {};
  for (const { table, filter } of tables) {
    try {
      const res = await fetch(`${SB_URL}/rest/v1/${table}?${filter}`, {
        method: 'DELETE',
        headers
      });
      results[table] = res.status;
    } catch (err) {
      results[table] = `error: ${err.message}`;
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deleted: name, char, results })
  };
};
