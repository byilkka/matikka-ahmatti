// netlify/functions/send-weekly-report.js
// Lähettää viikkoraportin kaikille vanhemmille joiden lapset ovat pelanneet
// Kutsutaan GitHub Actionsista viikoittain (tai manuaalisesti)

const SB_URL    = 'https://whftebwchwvwlyfgytoo.supabase.co';
const FROM_EMAIL = 'noreply@matikka-ahmatti.fi';

exports.handler = async (event) => {
  // Salli sekä GET (GitHub Actions) että POST
  if (!['GET', 'POST'].includes(event.httpMethod)) {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // Tarkista secret token (suojaa endpoint väärinkäytöltä)
  const token = event.queryStringParameters?.token ||
    (event.body ? JSON.parse(event.body).token : null);
  if (token !== process.env.APPROVE_SECRET) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  const SB_H = {
    'Content-Type': 'application/json',
    'apikey':        process.env.SB_SERVICE_KEY,
    'Authorization': `Bearer ${process.env.SB_SERVICE_KEY}`,
  };

  try {
    // 1. Hae kaikki vahvistetut vanhemmat + heidän lapsensa
    const parents = await fetch(
      `${SB_URL}/rest/v1/parent_profiles?verified=eq.true&select=email`,
      { headers: SB_H }
    ).then(r => r.json());

    console.log(`Vanhempia yhteensä: ${parents.length}`);

    let sent = 0, skipped = 0;

    for (const parent of parents) {
      try {
        const result = await sendReportForParent(parent.email, SB_H);
        if (result.sent) sent++;
        else skipped++;
      } catch (err) {
        console.error(`Virhe vanhemmalle ${parent.email}:`, err.message);
        skipped++;
      }
    }

    return json(200, { ok: true, sent, skipped, total: parents.length });
  } catch (err) {
    console.error('send-weekly-report error:', err);
    return json(500, { ok: false, error: err.message });
  }
};

async function sendReportForParent(parentEmail, SB_H) {
  // Hae linkitetyt lapset
  const children = await fetch(
    `${SB_URL}/rest/v1/parent_children?parent_email=eq.${encodeURIComponent(parentEmail)}&select=*`,
    { headers: SB_H }
  ).then(r => r.json());

  if (!children.length) return { sent: false };

  // Hae viikon tiedot jokaiselle lapselle
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const childStats = await Promise.all(children.map(c => fetchChildStats(c, weekAgo, SB_H)));

  // Lähetä vain jos joku lapsista on pelannut tällä viikolla tai on muuta uutta
  const anyActivity = childStats.some(s => s.weekRounds > 0);
  if (!anyActivity) return { sent: false };

  const html = buildEmailHtml(parentEmail, childStats);
  await sendEmail(parentEmail, '📊 Viikkoraportti — Matikka-Ahmatti', html);
  return { sent: true };
}

async function fetchChildStats(child, weekAgo, SB_H) {
  const name = child.player_name;
  const char = child.player_char;
  const nick = child.nickname || name;
  const av   = char === 'boy' ? '🤴' : '👸';

  const [progress, allScores, weekScores, achievements] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/player_progress?player_name=eq.${encodeURIComponent(name)}&player_char=eq.${encodeURIComponent(char)}&select=diff_level,rounds_played`,
      { headers: SB_H }).then(r => r.json()).catch(() => []),
    fetch(`${SB_URL}/rest/v1/scores?name=eq.${encodeURIComponent(name)}&char=eq.${encodeURIComponent(char)}&select=pts,pct&order=created_at.desc&limit=100`,
      { headers: SB_H }).then(r => r.json()).catch(() => []),
    fetch(`${SB_URL}/rest/v1/scores?name=eq.${encodeURIComponent(name)}&char=eq.${encodeURIComponent(char)}&created_at=gte.${weekAgo}&select=pts,pct,created_at`,
      { headers: SB_H }).then(r => r.json()).catch(() => []),
    fetch(`${SB_URL}/rest/v1/achievements?player_name=eq.${encodeURIComponent(name)}&player_char=eq.${encodeURIComponent(char)}&unlocked_at=gte.${weekAgo}&select=achievement_id`,
      { headers: SB_H }).then(r => r.json()).catch(() => []),
  ]);

  const level      = progress.length ? Math.max(...progress.map(p => p.diff_level || 1)) : 1;
  const totalPts   = allScores.reduce((s, r) => s + (r.pts || 0), 0);
  const weekRounds = weekScores.length;
  const weekPts    = weekScores.reduce((s, r) => s + (r.pts || 0), 0);
  const weekAvgPct = weekRounds > 0
    ? Math.round(weekScores.reduce((s, r) => s + (r.pct || 0), 0) / weekRounds)
    : 0;

  return { name, nick, av, level, totalPts, weekRounds, weekPts, weekAvgPct, achievements };
}

function buildEmailHtml(parentEmail, children) {
  const childrenHtml = children.map(c => {
    const weekBar = Math.min(100, c.weekRounds * 14); // 7 kierrosta = täysi palkki
    const achHtml = c.achievements.length > 0
      ? `<p style="margin:10px 0 0;font-size:13px;color:#5a4030;">
          🏅 Uudet saavutukset: <strong>${c.achievements.map(a => achName(a.achievement_id)).join(', ')}</strong>
        </p>`
      : '';

    const motivaatio = getMotivation(c.weekRounds, c.weekAvgPct, c.level);

    return `
    <div style="background:#fff;border-radius:12px;padding:20px 24px;margin-bottom:16px;border:1px solid #e8e0d4;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
        <span style="font-size:28px;">${c.av}</span>
        <div>
          <div style="font-size:17px;font-weight:700;color:#2c1a0e;">${escHtml(c.nick)}</div>
          <div style="font-size:12px;color:#8a6a1a;font-weight:600;">Taso ${c.level} / 50</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px;">
        <div style="background:#f9f5ef;border-radius:8px;padding:10px;text-align:center;">
          <div style="font-size:22px;font-weight:800;color:#c9841a;">${c.weekRounds}</div>
          <div style="font-size:11px;color:#8a6a1a;font-weight:600;">kierrosta</div>
        </div>
        <div style="background:#f9f5ef;border-radius:8px;padding:10px;text-align:center;">
          <div style="font-size:22px;font-weight:800;color:#2d7d46;">${c.weekAvgPct}%</div>
          <div style="font-size:11px;color:#8a6a1a;font-weight:600;">tarkkuus</div>
        </div>
        <div style="background:#f9f5ef;border-radius:8px;padding:10px;text-align:center;">
          <div style="font-size:22px;font-weight:800;color:#1a5276;">${c.weekPts.toLocaleString('fi-FI')}</div>
          <div style="font-size:11px;color:#8a6a1a;font-weight:600;">pistettä</div>
        </div>
      </div>

      <div style="margin-bottom:8px;">
        <div style="font-size:11px;color:#8a6a1a;font-weight:600;margin-bottom:4px;">Viikon aktiivisuus</div>
        <div style="background:#e8e0d4;border-radius:40px;height:8px;overflow:hidden;">
          <div style="width:${weekBar}%;height:100%;background:linear-gradient(90deg,#c9841a,#e8a838);border-radius:40px;"></div>
        </div>
      </div>

      ${achHtml}

      <p style="margin:12px 0 0;font-size:13px;color:#5a4030;background:#fdf8ef;border-radius:8px;padding:10px 12px;border-left:3px solid #c9a84c;">
        ${motivaatio}
      </p>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="fi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Viikkoraportti — Matikka-Ahmatti</title></head>
<body style="margin:0;padding:0;background:#f4f1eb;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:560px;margin:32px auto;padding:0 12px;">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#0b1520,#162030);border-radius:16px 16px 0 0;padding:28px 32px;text-align:center;">
      <div style="font-size:2.4rem;margin-bottom:6px;">📊</div>
      <div style="color:#f7c948;font-weight:800;font-size:1.2rem;letter-spacing:.5px;">Matikka-Ahmatti</div>
      <div style="color:#6a82a0;font-size:.8rem;font-weight:600;margin-top:4px;">Viikkoraportti · ${getWeekLabel()}</div>
    </div>

    <!-- Sisältö -->
    <div style="background:#fdf8ef;border-radius:0 0 16px 16px;padding:24px 24px 28px;border:1px solid #e8e0d4;border-top:none;">
      <p style="font-size:14px;color:#5a4030;margin:0 0 20px;line-height:1.6;">
        Hei! Tässä yhteenveto lapsesi matematiikan harjoittelusta viime viikolta.
      </p>

      ${childrenHtml}

      <!-- Footer linkit -->
      <div style="margin-top:20px;text-align:center;">
        <a href="https://matikka-ahmatti.fi/vanhempi.html"
          style="display:inline-block;background:linear-gradient(135deg,#f7c948,#ff9f43);color:#1a1a1a;text-decoration:none;padding:11px 24px;border-radius:40px;font-weight:800;font-size:.88rem;margin-bottom:10px;">
          📱 Avaa vanhempien näkymä
        </a>
        <br>
        <a href="https://matikka-ahmatti.fi/game.html"
          style="font-size:.75rem;color:#8a6a1a;text-decoration:none;">
          🎮 Pelaa Matikka-Ahmatti
        </a>
      </div>

      <div style="margin-top:20px;padding-top:16px;border-top:1px solid #e8e0d4;text-align:center;">
        <p style="font-size:.7rem;color:#aaa;margin:0;">
          Matikka-Ahmatti · matikka-ahmatti.fi<br>
          Sait tämän viestin koska olet rekisteröitynyt vanhempana.
          <a href="https://matikka-ahmatti.fi/vanhempi.html" style="color:#c9841a;">Hallitse asetuksia</a>
        </p>
      </div>
    </div>
  </div>
</body></html>`;
}

function getWeekLabel() {
  const now = new Date();
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const fmt = d => d.toLocaleDateString('fi-FI', { day:'numeric', month:'numeric' });
  return `${fmt(weekAgo)}–${fmt(now)}`;
}

function getMotivation(rounds, pct, level) {
  if (rounds === 0) return '😴 Ei pelattu tällä viikolla — palataan pelaamaan!';
  if (rounds >= 7 && pct >= 85) return `🌟 Loistava viikko! ${rounds} kierrosta ja ${pct}% tarkkuus — jatka samaan malliin!`;
  if (rounds >= 5) return `💪 Aktiivinen viikko — ${rounds} kierrosta on hienoa! Tavoitellaan seuraavaa tasoa.`;
  if (pct >= 90) return `🎯 Erinomainen tarkkuus ${pct}%! Harjoittele vähän enemmän niin taso nousee pian.`;
  if (level >= 30) return `🔥 Taso ${level} — olet jo edistynyt pelaaja! Jatka harjoittelua.`;
  return `👍 Hyvää työtä! ${rounds} kierrosta pelattu. Säännöllinen harjoittelu on avain oppimiseen.`;
}

function achName(id) {
  const names = {
    first_login:'Tervetuloa', perfect_round:'Täydellinen kierros', streak_5:'5 putki',
    streak_10:'10 putki', level_4:'Taso 4', rounds_100:'100 kierrosta',
    hof_1:'Hall of Fame #1', all_tables:'Kertotaulumestari', perfect_3:'3× Täydellinen',
    streak_20:'20 putki', all_modes:'Monipuolinen', speed_demon:'Nopea',
    level_10:'Taso 10', level_20:'Taso 20', level_30:'Taso 30',
    level_40:'Taso 40', level_50:'Grand Master'
  };
  return names[id] || id;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function sendEmail(to, subject, html) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend error: ${await res.text()}`);
}

function json(status, data) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}
