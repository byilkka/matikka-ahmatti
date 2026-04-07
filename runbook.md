# Matikka-Ahmatti — Ylläpidon Runbook

**Versio:** 1.3
**Päivitetty:** 2026-04-05
**Ylläpitäjä:** Ilkka

---

## 📋 Sisällysluettelo

1. [Infrastruktuuri](#infrastruktuuri)
2. [Päivittäiset operaatiot](#päivittäiset-operaatiot)
3. [Opettajatunnusten hallinta](#opettajatunnusten-hallinta)
4. [Pelaajien hallinta](#pelaajien-hallinta)
5. [Vanhempien hallinta](#vanhempien-hallinta)
6. [Supabase-kyselyt](#supabase-kyselyt)
7. [Deployaus](#deployaus)
8. [Vianetsintä](#vianetsintä)
9. [Tietoturva](#tietoturva)
10. [Hätätoimenpiteet](#hätätoimenpiteet)

---

## 🏗️ Infrastruktuuri

| Komponentti | Palvelu | Osoite |
|---|---|---|
| Frontend | Netlify | matikka-ahmatti.fi |
| Tietokanta | Supabase | whftebwchwvwlyfgytoo.supabase.co |
| Domain | Netlify DNS | matikka-ahmatti.fi + www |
| Koodi | GitHub | github.com/byilkka/matikka-ahmatti |
| Sähköposti | Resend | resend.com |
| Analytiikka | Google Analytics 4 | G-B0GHH9704Y |
| Automaatio | GitHub Actions | Viikkoraportti joka maanantai |
| Yhteydenotto | Formspree | xwvwovgk |
| GDPR-työkalu | gdpr-admin.html | Ei GitHubissa — paikallinen |

### Tiedostorakenne GitHubissa
```
/ (juuri)
├── index.html                  ← Landing page
├── game.html                   ← Peli
├── ohjeet.html                 ← Peliohje
├── contact.html                ← Yhteydenottolomake
├── opettaja.html               ← Opettajapaneeli
├── vanhempi.html               ← Vanhempien dashboard
├── tietosuoja.html             ← GDPR-tietosuojaseloste
├── favicon.svg                 ← Sivuston kuvake (SVG)
├── favicon.ico                 ← Sivuston kuvake (ICO, Google)
├── favicon-192.png             ← Sivuston kuvake (PNG, Android)
├── favicon-512.png             ← Sivuston kuvake (PNG, suuri)
├── _headers                    ← Netlify security headers
├── netlify.toml                ← Netlify-konfiguraatio
├── .gitignore                  ← Estää .env:n GitHubiin
├── .env.template               ← Muistilista ympäristömuuttujista
├── .github/
│   └── workflows/
│       └── weekly-report.yml  ← Viikkoraportti cron-job
└── netlify/
    └── functions/
        ├── approve-teacher.js      ← Hyväksyy anomuksen + lähettää kutsukoodin
        ├── notify-admin.js         ← Lähettää ilmoituksen ylläpitäjälle
        ├── register-parent.js      ← Vanhemman rekisteröinti + vahvistussähköposti
        ├── verify-parent.js        ← Sähköpostivahvistus vanhemmalle
        ├── link-child.js           ← Lapsen linkitys vanhemman tiliin (PIN-vahvistus)
        └── send-weekly-report.js   ← Viikkoraportin lähetys kaikille vanhemmille
```

### Netlify Environment Variables
| Muuttuja | Kuvaus |
|---|---|
| `RESEND_API_KEY` | Resend API-avain sähköpostien lähetykseen |
| `SB_SERVICE_KEY` | Supabase Service Role Key (ei anon!) |
| `APPROVE_SECRET` | Salainen token — hyväksymislinkki + viikkoraportti-endpoint |
| `ADMIN_EMAIL` | Ylläpitäjän sähköposti — anomusilmoitukset tähän |

### GitHub Actions Secrets
| Secret | Kuvaus |
|---|---|
| `APPROVE_SECRET` | Sama arvo kuin Netlify — suojaa viikkoraportti-endpointin |

### Supabase-taulut

| Taulu | Sisältö |
|---|---|
| `scores` | Pelitulokset |
| `players` | Pelaajien PIN-hashit |
| `player_progress` | Tasot, spaced repetition -painot, globalStreak, levelDropCooldown, xp |
| `achievements` | Avatut saavutukset |
| `classes` | Opettajien luokat ja PIN-hashit |
| `class_members` | Luokkiin liittyneet pelaajat |
| `teacher_invites` | Opettajatunnusten anomukset |
| `parent_profiles` | Vanhempien sähköposti + salasana-hash + vahvistustila |
| `parent_children` | Vanhempi–lapsi linkitykset |

---

## 📅 Päivittäiset operaatiot

### Tarkista aktiivisuus (viikon sisällä pelanneet)
```sql
SELECT COUNT(DISTINCT name) as aktiiviset_pelaajat
FROM scores
WHERE created_at > NOW() - INTERVAL '7 days';
```

### Tarkista uudet pelaajat tänään
```sql
SELECT name, char, created_at
FROM players
WHERE created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;
```

### Tarkista uudet vanhemmat
```sql
SELECT email, verified, created_at
FROM parent_profiles
ORDER BY created_at DESC
LIMIT 20;
```

### Tarkista odottavat opettaja-anomukset
> ⚠️ Anomukset hyväksytään sähköpostilinkin kautta automaattisesti.
> SQL-kysely on tarpeen vain jos sähköposti ei saapunut.

```sql
SELECT id, teacher_name, school, email, created_at
FROM teacher_invites
WHERE status = 'pending'
ORDER BY created_at ASC;
```

---

## 👩‍🏫 Opettajatunnusten hallinta

### Työnkulku: Uusi opettaja-anomus (automatisoitu)

```
1. Opettaja menee matikka-ahmatti.fi/opettaja.html
2. Klikkaa "Hae opettajatunnuksia"
3. Täyttää: nimi, koulu, sähköposti
4. Anomus tallentuu Supabaseen (status: pending)
5. Sinulle lähtee sähköposti jossa on vihreä "Hyväksy anomus" -nappi
6. Klikkaat nappia → kutsukoodi luodaan automaattisesti
7. Opettaja saa kutsukoodin sähköpostiinsa automaattisesti
8. Opettaja kirjautuu kutsukoodilla → luo PIN → pääsee sisään
```

### Hyväksymislinkki ei toiminut — manuaalinen vaihtoehto
```sql
-- 1. Hae anomuksen ID
SELECT id, teacher_name, email FROM teacher_invites WHERE status = 'pending';

-- 2. Hyväksy manuaalisesti
UPDATE teacher_invites
SET status = 'approved',
    invite_code = 'VIRTANEN25'   -- ← Sukunimi + numero
WHERE id = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
```
Muista lähettää kutsukoodi opettajalle sähköpostilla manuaalisesti jos käytät SQL-reittiä.

### Peruuta tai hylkää anomus
```sql
UPDATE teacher_invites
SET status = 'rejected'
WHERE id = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
```

### Katso kaikki opettajat ja heidän luokkansa
```sql
SELECT
  ti.teacher_name,
  ti.email,
  ti.school,
  ti.status,
  c.class_code,
  c.created_at AS luokka_luotu,
  COUNT(cm.player_name) AS oppilaita
FROM teacher_invites ti
LEFT JOIN classes c ON c.class_code = ti.invite_code
LEFT JOIN class_members cm ON cm.class_code = c.class_code
GROUP BY ti.teacher_name, ti.email, ti.school, ti.status, c.class_code, c.created_at
ORDER BY ti.created_at DESC;
```

---

## 🎮 Pelaajien hallinta

### Hae pelaajan tiedot
```sql
SELECT
  p.player_name,
  p.player_char,
  MAX(pp.diff_level) AS taso,
  SUM(pp.rounds_played) AS kierroksia,
  COUNT(DISTINCT a.achievement_id) AS saavutuksia
FROM players p
LEFT JOIN player_progress pp ON pp.player_name = p.player_name AND pp.player_char = p.player_char
LEFT JOIN achievements a ON a.player_name = p.player_name AND a.player_char = p.player_char
WHERE p.player_name = 'Emma'
GROUP BY p.player_name, p.player_char;
```

### Nollaa pelaajan PIN (jos unohtui)
```sql
UPDATE players
SET pin_hash = NULL
WHERE player_name = 'Emma'
  AND player_char = 'girl';   -- ← 'boy' tai 'girl'
```

### Nollaa pelaajan taso
```sql
UPDATE player_progress
SET diff_level = 1, weights = '{}', xp = 0
WHERE player_name = 'Emma'
  AND player_char = 'girl';
```

### Poista pelaaja kokonaan
```sql
-- ⚠️ HUOMIO: Ei palauteta! Poista tässä järjestyksessä:
DELETE FROM achievements    WHERE player_name = 'Emma' AND player_char = 'girl';
DELETE FROM player_progress WHERE player_name = 'Emma' AND player_char = 'girl';
DELETE FROM class_members   WHERE player_name = 'Emma' AND player_char = 'girl';
DELETE FROM parent_children WHERE player_name = 'Emma' AND player_char = 'girl';
DELETE FROM scores          WHERE name = 'Emma' AND char = 'girl';
DELETE FROM players         WHERE player_name = 'Emma' AND player_char = 'girl';
```

### GDPR-tietopyyntö
Käytä `gdpr-admin.html`-työkalua (ei GitHubissa — pidä paikallisesti).
- Haku nimimerkillä → näyttää kaikki tiedot
- Lataa JSON → GDPR artikla 15 mukainen vienti
- Poista-nappi → poistaa kaikki tiedot automaattisesti

### Hall of Fame — top 10
```sql
SELECT name, char, SUM(pts) AS yhteispisteet, COUNT(*) AS kierroksia, ROUND(AVG(pct), 1) AS keskitarkkuus
FROM scores
GROUP BY name, char
ORDER BY yhteispisteet DESC
LIMIT 10;
```

### Poista epäilyttävä tulos
```sql
-- Tutki ensin
SELECT mode_label, level, COUNT(*) as kierroksia, SUM(pts) as pisteet
FROM scores WHERE name = 'EpäilyttäväNimi'
GROUP BY mode_label, level ORDER BY pisteet DESC;

-- Poista kaikki tietyn pelaajan tulokset
DELETE FROM scores WHERE name = 'EpäilyttäväNimi';
```

---

## 👨‍👩‍👧 Vanhempien hallinta

### Työnkulku: Vanhempi rekisteröityy

```
1. Vanhempi menee matikka-ahmatti.fi/vanhempi.html
2. Rekisteröidy-välilehti → sähköposti + salasana
3. Vahvistussähköposti lähtee (Resend)
4. Vanhempi klikkaa vahvistuslinkkiä
5. Kirjautuu sisään → "Lisää lapsi" → nimimerkki + hahmo + lapsen PIN
6. Dashboard näyttää lapsen tason, pisteet, tarkkuuden ja saavutukset
```

### Viikkoraportti (automaattinen)
```
Joka maanantai klo 8:00 GitHub Actions ajaa weekly-report.yml
→ Kutsuu send-weekly-report Netlify Functionia
→ Lähettää sähköpostiraportin kaikille vahvistetuille vanhemmille
   joiden lapset ovat pelanneet viikon aikana
```

### Testaa viikkoraportti manuaalisesti
```
github.com/byilkka/matikka-ahmatti
→ Actions → Viikkoraportti vanhemmille → Run workflow
```

Tai suoraan selaimessa (korvaa SECRET oikealla arvolla):
```
https://matikka-ahmatti.fi/.netlify/functions/send-weekly-report?token=SECRET
```

### Hae kaikki vanhemmat ja heidän lapsensa
```sql
SELECT
  pp.email,
  pp.verified,
  pc.player_name,
  pc.player_char,
  pc.nickname,
  pp.created_at
FROM parent_profiles pp
LEFT JOIN parent_children pc ON pc.parent_email = pp.email
ORDER BY pp.created_at DESC;
```

### Poista vanhemman tili
```sql
DELETE FROM parent_children WHERE parent_email = 'vanhempi@example.com';
DELETE FROM parent_profiles WHERE email = 'vanhempi@example.com';
```

### Nollaa vanhemman salasana
Vanhempi täytyy rekisteröityä uudelleen — ei salasanan nollausominaisuutta vielä.
Poista profiili yllä olevalla SQL:llä ja pyydä rekisteröitymään uudelleen.

---

## 🔧 Supabase-kyselyt

### Tilastot yhteensä
```sql
SELECT
  (SELECT COUNT(*) FROM players)                                       AS pelaajia,
  (SELECT COUNT(*) FROM scores)                                        AS kierroksia,
  (SELECT COUNT(*) FROM classes)                                       AS luokkia,
  (SELECT COUNT(*) FROM teacher_invites WHERE status='approved')       AS opettajia,
  (SELECT COUNT(*) FROM parent_profiles WHERE verified=true)          AS vanhempia,
  (SELECT COUNT(*) FROM scores WHERE created_at > NOW() - INTERVAL '7 days') AS kierroksia_viikolla;
```

### Luokan oppilaat ja tilastot
```sql
SELECT
  cm.player_name AS nimi,
  cm.player_char AS hahmo,
  MAX(pp.diff_level) AS taso,
  SUM(s.pts) AS pisteet,
  COUNT(s.id) AS kierroksia,
  ROUND(AVG(s.pct), 1) AS tarkkuus,
  MAX(s.created_at) AS viimeksi_pelannut
FROM class_members cm
LEFT JOIN player_progress pp ON pp.player_name = cm.player_name AND pp.player_char = cm.player_char
LEFT JOIN scores s ON s.name = cm.player_name AND s.char = cm.player_char
WHERE cm.class_code = 'KOALA42'   -- ← Vaihda luokkakoodi
GROUP BY cm.player_name, cm.player_char
ORDER BY pisteet DESC NULLS LAST;
```

---

## 🚀 Deployaus

### Normaalin päivityksen työnkulku
```
1. Tee muutokset tiedostoihin
2. Lataa muutetut tiedostot GitHubiin (main-haara)
3. Netlify deploy käynnistyy automaattisesti (~30 sekuntia)
4. Tarkista matikka-ahmatti.fi
```

### Netlify Functions — osoitteet
```
https://matikka-ahmatti.fi/.netlify/functions/approve-teacher
https://matikka-ahmatti.fi/.netlify/functions/notify-admin
https://matikka-ahmatti.fi/.netlify/functions/register-parent
https://matikka-ahmatti.fi/.netlify/functions/verify-parent
https://matikka-ahmatti.fi/.netlify/functions/link-child
https://matikka-ahmatti.fi/.netlify/functions/send-weekly-report
```

### Pakota uudelleendeploy
```
Netlify → Sites → matikka-ahmatti.fi
→ Deploys → Trigger deploy → Clear cache and deploy site
```

### DNS-tietueet (Netlify DNS)
```
matikka-ahmatti.fi     → Netlify hoitaa automaattisesti
www.matikka-ahmatti.fi → Ohjautuu automaattisesti päädomainiin
TXT:                   → Google Search Console + Resend-domain
```

---

## 🔍 Vianetsintä

### Sivu ei lataudu / "Index of /"
1. Tarkista GitHub: onko `index.html` repon juuressa?
2. Netlify → Deploys → katso deploy-loki
3. Pakota uudelleendeploy

### www-osoite ei toimi
```
Netlify → Domain management → tarkista että www.matikka-ahmatti.fi on lisätty domain aliaksena
```

### Supabase-yhteys ei toimi
1. Tarkista HTTPS — Supabase ei toimi `file://`-protokollalla
2. Tarkista Supabase-dashboard: onko projekti aktiivinen?

### Netlify Function ei toimi
1. Netlify → Functions → tarkista lokit
2. Tarkista että kaikki 4 Environment Variable on asetettu
3. Tarkista että `netlify.toml`:ssa on `functions = "netlify/functions"`

### Viikkoraportti ei lähtenyt
1. GitHub → Actions → Viikkoraportti vanhemmille → katso lokit
2. Tarkista että `APPROVE_SECRET` on sama GitHubissa ja Netlifyssä
3. Testaa manuaalisesti: Actions → Run workflow
4. Tarkista Resend dashboard → Emails

### Opettajan hyväksymissähköposti ei tullut
1. Tarkista Resend dashboard → onko lähetys epäonnistunut?
2. Tarkista Netlify Functions -lokit
3. Hyväksy manuaalisesti SQL:llä

### Opettaja ei pääse kirjautumaan
```sql
SELECT status, invite_code FROM teacher_invites
WHERE teacher_name ILIKE '%Virtanen%';
-- pending → hyväksy anomus
-- invite_code NULL → lisää koodi manuaalisesti
-- used → luokka luotu, PIN unohtunut → nollaa PIN
```

### PIN unohtunut — opettaja
```sql
UPDATE classes SET pin_hash = NULL WHERE class_code = 'VIRTANEN25';
```

### Pelaaja ei pääse kirjautumaan (PIN unohtunut)
```sql
UPDATE players SET pin_hash = NULL
WHERE player_name = 'Emma' AND player_char = 'girl';
```

### Taso ei tallennu
```sql
SELECT * FROM player_progress WHERE player_name = 'Emma';
```

### Favicon ei näy Googlessa
- Odota 1–7 päivää indeksoinnin päivitystä
- Nopeuta: Google Search Console → URL-tarkistus → Pyydä indeksointia

### SecurityHeaders-arvosana laski
```
Testaa: securityheaders.com/?q=matikka-ahmatti.fi — tavoite A tai A+
```

---

## 🔒 Tietoturva

### Tärkeät muistutukset
- ✅ **ADMIN_PIN** — vaihdettu 2026-04-01, ei enää '0000'
- ✅ **APPROVE_SECRET** — tallennettu Netlify + GitHub Secrets, ei koodissa
- ✅ **Resend API-avain** — Netlify Environment Variables
- ✅ **SB_SERVICE_KEY** — vain Netlify Functionsilla, ei frontendissä
- ✅ **Vanhemman PIN-vahvistus** — lapsen linkitys vaatii lapsen PIN-koodin
- Supabase anon-avain on tarkoituksella julkinen — se on ok
- PIN-hashit tallennetaan XOR+rotate-hashilla — riittävä lapsipelille
- HTTPS päällä, SecurityHeaders: **A**
- `gdpr-admin.html` — EI GitHubissa, pidä paikallisesti

### Vaihda APPROVE_SECRET
1. Keksi uusi pitkä satunnainen merkkijono
2. Netlify → Environment Variables → päivitä `APPROVE_SECRET`
3. GitHub → Settings → Secrets → päivitä `APPROVE_SECRET`
4. Netlify → Trigger deploy

### Vaihda Resend API-avain
1. Resend dashboard → API Keys → luo uusi avain
2. Netlify → Environment Variables → päivitä `RESEND_API_KEY`
3. Netlify → Trigger deploy

### RLS-politiikat (Row Level Security)
Kaikki taulut käyttävät `USING (true)` — tietoinen valinta lapsipelille.

---

## 🚨 Hätätoimenpiteet

### Poista kaikki tulokset (nuclear option)
```sql
-- ⚠️⚠️⚠️ EI PALAUTETA! Varmista ensin varmuuskopio!
TRUNCATE scores RESTART IDENTITY;
```

### Ota varmuuskopio ennen isoja muutoksia
```
Supabase → Table Editor → scores → Export → CSV
```

### Netlify rollback
```
Netlify → Deploys → klikkaa vanhempaa deployta → Publish deploy
```

---

## 📞 Yhteystiedot ja linkit

| Resurssi | URL |
|---|---|
| Netlify dashboard | app.netlify.com |
| Netlify Functions -lokit | app.netlify.com → Functions |
| Supabase dashboard | app.supabase.com |
| GitHub repo | github.com/byilkka/matikka-ahmatti |
| GitHub Actions | github.com/byilkka/matikka-ahmatti/actions |
| Resend dashboard | resend.com/emails |
| Google Analytics | analytics.google.com |
| Google Search Console | search.google.com/search-console |
| SecurityHeaders testi | securityheaders.com/?q=matikka-ahmatti.fi |
| Formspree dashboard | formspree.io/forms/xwvwovgk |

---

*Päivitä tämä dokumentti aina kun infrastruktuuri tai toimintamallit muuttuvat.*
