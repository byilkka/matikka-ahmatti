#!/usr/bin/env python3
"""
confluence_sync.py — Päivittää runbook.md Confluenceen REST API:n kautta.

ASENNUS:
    pip install requests markdown

KÄYTTÖ:
    python3 confluence_sync.py

ENSIMMÄISELLÄ KERRALLA:
    Skripti kysyy tiedot ja tallentaa ne confluence_config.json-tiedostoon.
    Muokkaa tiedostoa suoraan jos tarvitset muuttaa asetuksia myöhemmin.

API-TOKEN:
    1. Mene: https://id.atlassian.com/manage-profile/security/api-tokens
    2. Klikkaa "Create API token"
    3. Anna nimi: "matikka-ahmatti-runbook"
    4. Kopioi token — näkyy vain kerran!
"""

import os
import sys
import json
import re
import base64
import urllib.request
import urllib.error
import urllib.parse

CONFIG_FILE  = os.path.join(os.path.dirname(__file__), 'confluence_config.json')
RUNBOOK_FILE = 'runbook.md'  # Repon juuressa, ei skriptin hakemistossa

# ── Konfiguraatio ──────────────────────────────────────

def load_or_create_config():
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE) as f:
            return json.load(f)

    print("\n=== Confluence-yhteyden asetukset ===\n")
    print("API-token: https://id.atlassian.com/manage-profile/security/api-tokens\n")

    config = {
        "base_url":    input("Confluence URL (esim. https://firma.atlassian.net): ").rstrip('/'),
        "email":       input("Sähköpostiosoitteesi (Atlassian-tili): "),
        "api_token":   input("API-token: "),
        "space_key":   input("Space Key (esim. MATIKKA tai ~accountid): "),
        "page_title":  input("Sivun otsikko Confluencessa [Matikka-Ahmatti Runbook]: ") or "Matikka-Ahmatti Runbook",
        "parent_page_id": input("Yläsivun ID (jätä tyhjäksi jos ei ole): ").strip() or None,
    }

    with open(CONFIG_FILE, 'w') as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
    print(f"\n✅ Asetukset tallennettu: {CONFIG_FILE}\n")
    return config


# ── Confluence API ─────────────────────────────────────

def make_auth_header(email, token):
    creds = base64.b64encode(f"{email}:{token}".encode()).decode()
    return {
        "Authorization": f"Basic {creds}",
        "Content-Type":  "application/json",
        "Accept":        "application/json",
    }

def api_request(method, url, headers, data=None):
    body = json.dumps(data).encode() if data else None
    req  = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        print(f"❌ HTTP {e.code} ({method} {url}):")
        try:
            parsed = json.loads(err)
            print(f"   {parsed.get('message') or parsed.get('errorMessage') or err[:300]}")
        except Exception:
            print(f"   {err[:300]}")
        sys.exit(1)

def find_page(base_url, headers, space_key, title):
    encoded_title = urllib.parse.quote(title)
    encoded_space = urllib.parse.quote(space_key)
    url = f"{base_url}/wiki/rest/api/content?spaceKey={encoded_space}&title={encoded_title}&expand=version"
    try:
        req = urllib.request.Request(url, headers=headers, method="GET")
        with urllib.request.urlopen(req) as r:
            res = json.loads(r.read())
        results = res.get("results", [])
        return results[0] if results else None
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        err = e.read().decode()
        print(f"❌ HTTP {e.code}: {err[:400]}")
        sys.exit(1)

def create_page(base_url, headers, space_key, title, body_html, parent_id=None):
    payload = {
        "type":  "page",
        "title": title,
        "space": {"key": space_key},
        "body":  {
            "storage": {
                "value":          body_html,
                "representation": "storage",
            }
        },
    }
    if parent_id:
        payload["ancestors"] = [{"id": parent_id}]

    url = f"{base_url}/wiki/rest/api/content"
    return api_request("POST", url, headers, payload)

def update_page(base_url, headers, page_id, title, body_html, current_version):
    payload = {
        "type":    "page",
        "title":   title,
        "version": {"number": current_version + 1},
        "body":    {
            "storage": {
                "value":          body_html,
                "representation": "storage",
            }
        },
    }
    url = f"{base_url}/wiki/rest/api/content/{page_id}"
    return api_request("PUT", url, headers, payload)


# ── Markdown → Confluence Storage Format ──────────────

def md_to_confluence(md):
    """
    Yksinkertainen Markdown → Confluence Storage Format muunnos.
    Tukee: otsikot, lihavointi, koodi, linkit, taulukot, listat.
    """
    lines  = md.split('\n')
    output = []
    in_code = False
    code_buf = []
    in_table = False
    table_buf = []

    def flush_table():
        if not table_buf:
            return ''
        html = '<table><tbody>'
        for i, row in enumerate(table_buf):
            cells = [c.strip() for c in row.strip('|').split('|')]
            if all(set(c.strip()) <= set('-: ') for c in cells):
                continue  # erotinrivi
            tag = 'th' if i == 0 else 'td'
            html += '<tr>' + ''.join(f'<{tag}>{inline(c)}</{tag}>' for c in cells) + '</tr>'
        html += '</tbody></table>'
        return html

    def inline(text):
        # Bold
        text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)
        # Italic
        text = re.sub(r'\*(.+?)\*',     r'<em>\1</em>', text)
        # Inline code
        text = re.sub(r'`([^`]+)`',     r'<code>\1</code>', text)
        # Link
        text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', text)
        return text

    i = 0
    while i < len(lines):
        line = lines[i]

        # Koodilohko
        if line.startswith('```'):
            if not in_code:
                lang = line[3:].strip() or 'text'
                in_code = True
                code_buf = []
                output.append(f'<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">{lang}</ac:parameter><ac:plain-text-body><![CDATA[')
            else:
                in_code = False
                output.append('\n'.join(code_buf))
                output.append(']]></ac:plain-text-body></ac:structured-macro>')
                code_buf = []
            i += 1
            continue

        if in_code:
            code_buf.append(line)
            i += 1
            continue

        # Taulukko
        if line.startswith('|'):
            if not in_table:
                in_table = True
                table_buf = []
            table_buf.append(line)
            i += 1
            continue
        else:
            if in_table:
                output.append(flush_table())
                table_buf = []
                in_table = False

        # Otsikot
        m = re.match(r'^(#{1,6})\s+(.+)', line)
        if m:
            level = len(m.group(1))
            output.append(f'<h{level}>{inline(m.group(2))}</h{level}>')
            i += 1
            continue

        # Vaakaviiva
        if re.match(r'^---+$', line.strip()):
            output.append('<hr/>')
            i += 1
            continue

        # Tyhjä rivi
        if line.strip() == '':
            output.append('')
            i += 1
            continue

        # Lista (- tai *)
        if re.match(r'^[\-\*]\s', line):
            items = []
            while i < len(lines) and re.match(r'^[\-\*]\s', lines[i]):
                items.append(f'<li>{inline(lines[i][2:])}</li>')
                i += 1
            output.append('<ul>' + ''.join(items) + '</ul>')
            continue

        # Numeroitu lista
        if re.match(r'^\d+\.\s', line):
            items = []
            while i < len(lines) and re.match(r'^\d+\.\s', lines[i]):
                text = re.sub(r'^\d+\.\s', '', lines[i])
                items.append(f'<li>{inline(text)}</li>')
                i += 1
            output.append('<ol>' + ''.join(items) + '</ol>')
            continue

        # Normaali kappale
        output.append(f'<p>{inline(line)}</p>')
        i += 1

    # Flush taulukko jos tiedosto loppuu taulukkoon
    if in_table:
        output.append(flush_table())

    return '\n'.join(output)


# ── Pääohjelma ─────────────────────────────────────────

def main():
    print("🔄 Matikka-Ahmatti Runbook → Confluence")
    print("=" * 45)

    # Lataa asetukset
    cfg = load_or_create_config()

    base_url  = cfg['base_url']
    email     = cfg['email']
    token     = cfg['api_token']
    space     = cfg['space_key']
    title     = cfg['page_title']
    parent_id = cfg.get('parent_page_id')

    headers = make_auth_header(email, token)

    # Lue runbook
    if not os.path.exists(RUNBOOK_FILE):
        print(f"❌ Runbook ei löydy: {RUNBOOK_FILE}")
        sys.exit(1)

    with open(RUNBOOK_FILE, encoding='utf-8') as f:
        md = f.read()

    print(f"📄 Runbook luettu ({len(md)} merkkiä)")

    # Muunna Confluence-formaattiin
    body_html = md_to_confluence(md)
    print(f"🔀 Muunnettu Confluence Storage -formaattiin")

    # Tarkista onko sivu jo olemassa
    print(f"🔍 Haetaan sivua '{title}' spacesta '{space}'...")
    existing = find_page(base_url, headers, space, title)

    if existing:
        page_id = existing['id']
        version = existing['version']['number']
        print(f"✏️  Päivitetään olemassa oleva sivu (ID: {page_id}, versio {version}→{version+1})...")
        result = update_page(base_url, headers, page_id, title, body_html, version)
        action = "päivitetty"
    else:
        print(f"✨ Luodaan uusi sivu...")
        result = create_page(base_url, headers, space, title, body_html, parent_id)
        action = "luotu"

    page_url = f"{base_url}/wiki/spaces/{space}/pages/{result['id']}"
    print(f"\n✅ Runbook {action} onnistuneesti!")
    print(f"🔗 {page_url}")


if __name__ == '__main__':
    main()
