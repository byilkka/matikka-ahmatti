#!/usr/bin/env python3
"""
confluence_sync.py — Päivittää runbook.md Confluenceen REST API:n kautta.
Atlassian Cloud -yhteensopiva (/wiki/ -prefiksi kaikissa kutsuissa).
"""

import os, sys, json, re, base64
import urllib.request, urllib.error, urllib.parse

CONFIG_FILE  = 'confluence_config.json'
RUNBOOK_FILE = 'runbook.md'


def load_config():
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE) as f:
            return json.load(f)
    print("\n=== Confluence-asetukset ===")
    print("Luo API-token: https://id.atlassian.com/manage-profile/security/api-tokens\n")
    cfg = {
        "base_url":   input("URL (esim. https://firma.atlassian.net): ").rstrip('/'),
        "email":      input("Sähköposti: "),
        "api_token":  input("API-token: "),
        "space_key":  input("Space Key (esim. OPERATIONS): "),
        "page_title": input("Sivun otsikko [Matikka-Ahmatti Runbook]: ") or "Matikka-Ahmatti Runbook",
    }
    with open(CONFIG_FILE, 'w') as f:
        json.dump(cfg, f, indent=2)
    print(f"✅ Tallennettu: {CONFIG_FILE}")
    return cfg


def auth_headers(email, token):
    creds = base64.b64encode(f"{email}:{token}".encode()).decode()
    return {
        "Authorization": f"Basic {creds}",
        "Content-Type":  "application/json",
        "Accept":        "application/json",
    }


def api(method, url, headers, data=None):
    body = json.dumps(data).encode() if data else None
    req  = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def find_page(base, headers, space, title):
    url = (f"{base}/wiki/rest/api/content"
           f"?spaceKey={urllib.parse.quote(space)}"
           f"&title={urllib.parse.quote(title)}"
           f"&expand=version&limit=1")
    status, res = api("GET", url, headers)
    if status != 200:
        print(f"  find_page HTTP {status}: {str(res)[:200]}")
        return None
    results = res.get("results", []) if isinstance(res, dict) else []
    if results:
        p = results[0]
        return p["id"], p["version"]["number"]
    return None


def create_page(base, headers, space, title, body_html):
    url  = f"{base}/wiki/rest/api/content"
    data = {
        "type":  "page",
        "title": title,
        "space": {"key": space},
        "body":  {"storage": {"value": body_html, "representation": "storage"}},
    }
    status, res = api("POST", url, headers, data)
    if status not in (200, 201):
        print(f"❌ create_page HTTP {status}: {str(res)[:400]}")
        sys.exit(1)
    return res


def update_page(base, headers, page_id, title, body_html, version):
    url  = f"{base}/wiki/rest/api/content/{page_id}"
    data = {
        "type":    "page",
        "title":   title,
        "version": {"number": version + 1},
        "body":    {"storage": {"value": body_html, "representation": "storage"}},
    }
    status, res = api("PUT", url, headers, data)
    if status not in (200, 201):
        print(f"❌ update_page HTTP {status}: {str(res)[:400]}")
        sys.exit(1)
    return res


def inline(text):
    text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)
    text = re.sub(r'\*(.+?)\*',     r'<em>\1</em>',         text)
    text = re.sub(r'`([^`]+)`',     r'<code>\1</code>',     text)
    text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', text)
    return text


def md_to_confluence(md):
    output, in_code, code_buf = [], False, []
    in_table, table_buf = False, []

    def flush_table():
        if not table_buf: return
        output.append('<table><tbody>')
        for i, row in enumerate(table_buf):
            cells = [c.strip() for c in row.strip('|').split('|')]
            if all(set(c.strip()) <= set('-: ') for c in cells): continue
            tag = 'th' if i == 0 else 'td'
            output.append('<tr>' + ''.join(f'<{tag}>{inline(c)}</{tag}>' for c in cells) + '</tr>')
        output.append('</tbody></table>')

    lines, i = md.split('\n'), 0
    while i < len(lines):
        line = lines[i]
        if line.startswith('```'):
            if not in_code:
                lang = line[3:].strip() or 'text'
                in_code, code_buf = True, []
                output.append(f'<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">{lang}</ac:parameter><ac:plain-text-body><![CDATA[')
            else:
                in_code = False
                output.append('\n'.join(code_buf))
                output.append(']]></ac:plain-text-body></ac:structured-macro>')
            i += 1; continue
        if in_code:
            code_buf.append(line); i += 1; continue
        if line.startswith('|'):
            if not in_table: in_table, table_buf = True, []
            table_buf.append(line); i += 1; continue
        elif in_table:
            flush_table(); table_buf, in_table = [], False
        m = re.match(r'^(#{1,6})\s+(.+)', line)
        if m:
            lvl = len(m.group(1))
            output.append(f'<h{lvl}>{inline(m.group(2))}</h{lvl}>'); i += 1; continue
        if re.match(r'^---+$', line.strip()):
            output.append('<hr/>'); i += 1; continue
        if not line.strip():
            i += 1; continue
        if re.match(r'^[\-\*]\s', line):
            items = []
            while i < len(lines) and re.match(r'^[\-\*]\s', lines[i]):
                items.append(f'<li>{inline(lines[i][2:])}</li>'); i += 1
            output.append('<ul>' + ''.join(items) + '</ul>'); continue
        if re.match(r'^\d+\.\s', line):
            items = []
            while i < len(lines) and re.match(r'^\d+\.\s', lines[i]):
                items.append(f'<li>{inline(re.sub(r"^\d+\.\s","",lines[i]))}</li>'); i += 1
            output.append('<ol>' + ''.join(items) + '</ol>'); continue
        output.append(f'<p>{inline(line)}</p>'); i += 1
    if in_table: flush_table()
    return '\n'.join(output)


def main():
    print("🔄 Matikka-Ahmatti Runbook → Confluence")
    print("=" * 45)
    cfg     = load_config()
    base    = cfg['base_url']
    space   = cfg['space_key']
    title   = cfg.get('page_title', 'Matikka-Ahmatti Runbook')
    headers = auth_headers(cfg['email'], cfg['api_token'])

    if not os.path.exists(RUNBOOK_FILE):
        print(f"❌ Runbook ei löydy: {os.path.abspath(RUNBOOK_FILE)}")
        sys.exit(1)

    with open(RUNBOOK_FILE, encoding='utf-8') as f:
        md = f.read()
    print(f"📄 Runbook luettu ({len(md)} merkkiä)")
    body_html = md_to_confluence(md)
    print("🔀 Muunnettu Confluence Storage -formaattiin")
    print(f"🔍 Haetaan sivua '{title}' spacesta '{space}'...")

    existing = find_page(base, headers, space, title)
    if existing:
        page_id, version = existing
        print(f"✏️  Päivitetään sivu (ID: {page_id}, v{version}→{version+1})...")
        res = update_page(base, headers, page_id, title, body_html, version)
        action = "päivitetty"
    else:
        print("✨ Sivua ei löydy — luodaan uusi...")
        res = create_page(base, headers, space, title, body_html)
        action = "luotu"

    pid = res.get('id', '?') if isinstance(res, dict) else '?'
    print(f"\n✅ Runbook {action}!")
    print(f"🔗 {base}/wiki/spaces/{space}/pages/{pid}")


if __name__ == '__main__':
    main()
