// netlify/functions/admin-monitor.js
// Yleinen admin-monitorointi eri tapahtumille
//
// Kutsutaan Supabase Database Webhookista TAI suoraan game.html:stä
// event.body.type määrittää mikä tapahtuma kyseessä
//
// Tuetut tyypit:
//   new_player      — uusi pelaaja rekisteröityi
//   grand_master    — pelaaja saavutti tason 50
//   suspicious_score — epäilyttävä tulos Hall of Famessa
//   weekly_digest   — viikoittainen admin-yhteenveto (GitHub Actions)
//
// Supabase Webhook -konfiguraatio:
//   Dashboard → Database → Webhooks → Create webhook
//   Table: players, Event: INSERT
//   URL: https://matikka-ahmatti.fi/.netlify/functions/admin-monitor
//   Headers: x-webhook-secret: <APPROVE_SECRET>

const SB_URL      = 'https://whftebwchwvwlyfgytoo.supabase.co';
const FROM_EMAIL  = 'noreply@matikka-ahmatti.fi';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // Tarkista autentikointi — joko webhook-secret tai APPROVE_SECRET queryssa
  const webhookSecret = event.headers['x-webhook-secret'];
  const queryToken    = event.queryStringParameters?.token;
  const secret        = process.env.APPROVE_SECRET;

  if (webhookSecret !== secret && queryToken !== secret) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const SB_H = {
    'Content-Type': 'application/json',
    'apikey': process.env.SB_SERVICE_KEY,
    'Authorization': `Bearer ${process.env.SB_SERVICE_KEY}`,
  };

  // Supabase Database Webhook lähettää { type, table, record, old_record }
  // Oma kutsu lähettää { type, ... }
  const eventType = body.type;

  try {
    switch (eventType) {

      case 'INSERT':
      case 'new_player': {
        // Supabase webhook: players-tauluun tuli uusi rivi
        const record = body.record || body;
        const name   = record.player_name || record.name || '?';
        const char   = record.player_char || record.char || '?';
        await sendEmail(
          `🎮 Uusi pelaaja: ${name}`,
          newPlayerEmail(name, char)
        );
        break;
      }

      case 'grand_master': {
        const { name, char } = body;
        await sendEmail(
          `🏆 Grand Master! ${name} saavutti tason 50`,
          grandMasterEmail(name, char)
        );
        break;
      }

      case 'suspicious_score': {
        const { name, pts, pct, mode } = body;
        await sendEmail(
          `⚠️ Epäilyttävä tulos: ${name} (${pts} pistettä)`,
          suspiciousScoreEmail(name, pts, pct, mode)
        );
        break;
      }

      case 'weekly_digest': {
        const stats = await fetchWeeklyStats(SB_H);
        await sendEmail(
          `📊 Matikka-Ahmatti viikkoyhteenveto`,
          weeklyDigestEmail(stats)
        );
        break;
      }

      default:
        return { statusCode: 400, body: `Unknown event type: ${eventType}` };
    }

    return json(200, { ok: true, type: eventType });
  } catch (err) {
    console.error('admin-monitor error:', err);
    return json(500, { ok: false, error: err.message });
  }
};

// ── Supabase-haut ────────────────────────────────────

async function fetchWeeklyStats(SB_H) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [players, scores, newPlayers, pending] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/players?select=count`, { headers: { ...SB_H, 'Prefer': 'count=exact', 'Range': '0-0' } }),
    fetch(`${SB_URL}/rest/v1/scores?created_at=gte.${weekAgo}&select=pts,pct,name`, { headers: SB_H }),
    fetch(`${SB_URL}/rest/v1/players?created_at=gte.${weekAgo}&select=player_name,player_char,created_at`, { headers: SB_H }),
    fetch(`${SB_URL}/rest/v1/teacher_invites?status=eq.pending&select=teacher_name,school,created_at`, { headers: SB_H }),
  ]);

  const totalPlayers  = parseInt(players.headers.get('content-range')?.split('/')[1] || '0');
  const weekScores    = await scores.json();
  const newPlayerList = await newPlayers.json();
  const pendingList   = await pending.json();

  const weekRounds  = weekScores.length;
  const weekAvgPct  = weekRounds > 0
    ? Math.round(weekScores.reduce((s, r) => s + (r.pct || 0), 0) / weekRounds)
    : 0;
  const uniqueActive = new Set(weekScores.map(s => s.name)).size;

  return { totalPlayers, weekRounds, weekAvgPct, uniqueActive, newPlayerList, pendingList };
}

// ── Sähköpostimallit ─────────────────────────────────

function newPlayerEmail(name, char) {
  const av = char === 'boy' ? '🤴' : '👸';
  const now = new Date().toLocaleString('fi-FI', { timeZone: 'Europe/Helsinki' });
  return baseTemplate('🎮 Uusi pelaaja', `
    <div style="text-align:center;padding:24px 0;">
      <div style="font-size:3.5rem;margin-bottom:12px;">${av}</div>
      <div style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:1.4rem;font-weight:800;color:#1a1a2e;margin-bottom:4px;">${escHtml(name)}</div>
      <div style="font-size:.85rem;color:#9ca3af;">${char === 'boy' ? 'Prinssi' : 'Prinsessa'}</div>
    </div>
    <div style="background:#f9fafb;border-radius:10px;padding:14px 16px;text-align:center;margin-bottom:20px;">
      <div style="font-size:.75rem;color:#9ca3af;font-weight:700;margin-bottom:4px;">REKISTERÖITYI</div>
      <div style="font-size:.9rem;color:#374151;font-weight:700;">${now}</div>
    </div>
    <p style="font-size:.85rem;color:#555;margin:0;line-height:1.6;">
      Uusi pelaaja on liittynyt Matikka-Ahmatiin! 🎉 
      Tarkista <a href="https://matikka-ahmatti.fi/game.html" style="color:#16a34a;">pelin tilastot</a> tai
      <a href="https://app.supabase.com" style="color:#16a34a;">Supabase</a>.
    </p>
  `);
}

function grandMasterEmail(name, char) {
  const av = char === 'boy' ? '🤴' : '👸';
  return baseTemplate('🏆 Grand Master!', `
    <div style="text-align:center;padding:20px 0;">
      <div style="font-size:3rem;margin-bottom:8px;">✨🏆✨</div>
      <div style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:1.3rem;font-weight:800;color:#1a1a2e;margin-bottom:4px;">${av} ${escHtml(name)}</div>
      <div style="font-size:.85rem;color:#9ca3af;margin-bottom:16px;">on saavuttanut tason 50 — GRAND MASTER!</div>
      <div style="background:linear-gradient(135deg,#fef3c7,#fde68a);border-radius:12px;padding:16px;display:inline-block;">
        <div style="font-size:2rem;font-weight:900;color:#92400e;">Taso 50 / 50</div>
        <div style="font-size:.75rem;color:#78350f;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Grand Master</div>
      </div>
    </div>
    <p style="font-size:.85rem;color:#555;margin:12px 0 0;line-height:1.6;text-align:center;">
      Tämä pelaaja on läpäissyt kaikki 50 tasoa! 🎓
    </p>
  `);
}

function suspiciousScoreEmail(name, pts, pct, mode) {
  return baseTemplate('⚠️ Epäilyttävä tulos', `
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:16px;margin-bottom:20px;">
      <div style="font-size:.8rem;font-weight:800;color:#dc2626;margin-bottom:8px;">⚠️ EPÄILYTTÄVÄ TULOS HALL OF FAMESSA</div>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:4px 0;font-size:.8rem;color:#9ca3af;width:120px;">Pelaaja</td>
            <td style="font-size:.9rem;color:#1a1a2e;font-weight:700;">${escHtml(name)}</td></tr>
        <tr><td style="padding:4px 0;font-size:.8rem;color:#9ca3af;">Pisteet</td>
            <td style="font-size:.9rem;color:#dc2626;font-weight:800;">${pts?.toLocaleString('fi-FI')}</td></tr>
        <tr><td style="padding:4px 0;font-size:.8rem;color:#9ca3af;">Tarkkuus</td>
            <td style="font-size:.9rem;color:#1a1a2e;font-weight:700;">${pct}%</td></tr>
        <tr><td style="padding:4px 0;font-size:.8rem;color:#9ca3af;">Moodi</td>
            <td style="font-size:.9rem;color:#1a1a2e;font-weight:700;">${escHtml(mode || '?')}</td></tr>
      </table>
    </div>
    <p style="font-size:.85rem;color:#555;margin:0 0 16px;line-height:1.6;">
      Tulos ylitti automaattisen hälytysrajan. Tarkista onko kyseessä virheellinen tulos ja poista tarvittaessa Supabasesta.
    </p>
    <a href="https://app.supabase.com/project/whftebwchwvwlyfgytoo/editor"
      style="display:block;background:#dc2626;color:#fff;text-decoration:none;text-align:center;padding:12px;border-radius:10px;font-weight:800;font-size:.9rem;">
      🗑️ Tarkista Supabasessa
    </a>
  `);
}

function weeklyDigestEmail(stats) {
  const { totalPlayers, weekRounds, weekAvgPct, uniqueActive, newPlayerList, pendingList } = stats;

  const newPlayersHtml = newPlayerList.length > 0
    ? newPlayerList.slice(0, 10).map(p =>
        `<tr><td style="padding:5px 8px;font-size:.82rem;color:#374151;">${p.player_char === 'boy' ? '🤴' : '👸'} ${escHtml(p.player_name)}</td>
         <td style="padding:5px 8px;font-size:.75rem;color:#9ca3af;">${new Date(p.created_at).toLocaleDateString('fi-FI')}</td></tr>`
      ).join('')
    : '<tr><td colspan="2" style="padding:8px;font-size:.82rem;color:#9ca3af;text-align:center;">Ei uusia pelaajia tällä viikolla</td></tr>';

  const pendingHtml = pendingList.length > 0
    ? `<div style="background:#fef3c7;border-radius:8px;padding:12px 14px;margin-top:16px;">
        <div style="font-size:.75rem;font-weight:800;color:#92400e;margin-bottom:6px;">⏳ ODOTTAVAT OPETTAJA-ANOMUKSET (${pendingList.length})</div>
        ${pendingList.map(t => `<div style="font-size:.82rem;color:#78350f;padding:2px 0;">👩‍🏫 ${escHtml(t.teacher_name)} — ${escHtml(t.school)}</div>`).join('')}
        <a href="https://app.supabase.com/project/whftebwchwvwlyfgytoo/editor" style="font-size:.78rem;color:#92400e;font-weight:700;">Hyväksy Supabasessa →</a>
      </div>`
    : '';

  return baseTemplate('📊 Viikkoyhteenveto', `
    <!-- Stats grid -->
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:20px;">
      ${statBox('Pelaajia yhteensä', totalPlayers, '#3b82f6')}
      ${statBox('Aktiivisia viikolla', uniqueActive, '#10b981')}
      ${statBox('Kierroksia viikolla', weekRounds, '#f59e0b')}
      ${statBox('Keskim. tarkkuus', weekAvgPct + '%', '#8b5cf6')}
    </div>

    <!-- Uudet pelaajat -->
    <div style="margin-bottom:4px;">
      <div style="font-size:.72rem;font-weight:800;color:#9ca3af;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">
        🆕 UUDET PELAAJAT VIIKOLLA (${newPlayerList.length})
      </div>
      <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;overflow:hidden;">
        ${newPlayersHtml}
      </table>
    </div>

    ${pendingHtml}

    <div style="margin-top:20px;text-align:center;">
      <a href="https://app.supabase.com/project/whftebwchwvwlyfgytoo/editor"
        style="display:inline-block;background:#0b1520;color:#f7c948;text-decoration:none;padding:10px 22px;border-radius:40px;font-weight:800;font-size:.85rem;">
        Avaa Supabase →
      </a>
    </div>
  `);
}

function statBox(label, value, color) {
  return `<div style="background:#f9fafb;border-radius:10px;padding:14px;text-align:center;border-top:3px solid ${color};">
    <div style="font-size:1.4rem;font-weight:900;color:${color};">${value}</div>
    <div style="font-size:.7rem;color:#9ca3af;font-weight:700;margin-top:2px;">${label}</div>
  </div>`;
}

function baseTemplate(title, content) {
  return `<!DOCTYPE html>
<html lang="fi">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:520px;margin:32px auto;padding:0 12px;">
    <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
      <div style="background:linear-gradient(135deg,#0b1520,#162030);padding:24px 28px;">
        <div style="color:#f7c948;font-weight:800;font-size:1.05rem;">${title}</div>
        <div style="color:#6a82a0;font-size:.75rem;margin-top:2px;">Matikka-Ahmatti Admin</div>
      </div>
      <div style="padding:24px 28px;">${content}</div>
      <div style="padding:14px 28px;border-top:1px solid #f3f4f6;text-align:center;">
        <span style="font-size:.7rem;color:#d1d5db;">matikka-ahmatti.fi · Automaattinen ilmoitus</span>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function sendEmail(subject, html) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: process.env.ADMIN_EMAIL,
      subject,
      html
    })
  });
  if (!res.ok) throw new Error(`Resend: ${await res.text()}`);
}

function json(status, data) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  };
}
