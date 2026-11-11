#!/usr/bin/env python3
"""Build the static, indexable pages of the public site from data/shows.json.

- show/<slug>/index.html  one page per show (title, cover, tracklist, listening links),
                          with Open Graph tags so a shared link shows the episode cover
- show/index.html         plain list of every show (lets search engines find them all)
- sitemap.xml             every page, to submit in Google Search Console
- index.html              the share tags between <!-- og:start --> and <!-- og:end -->
                          are refreshed with the latest show

The output only depends on the data (no build date), so a weekly run rewrites
only the pages that really changed.  Usage:  python3 tools/build_pages.py
"""
import json, os, re, shutil
from html import escape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = 'https://lafabrock.github.io/lafabrock/'

CATEGORIES = {
    'Season episode': 'Épisodes de saison', 'Guest / collab': 'Invité / collab', 'Birthday mixtape': "Mixtape d'anniversaire",
    'Early mix': 'Premiers mixes', 'Tribute': 'Hommage', 'Music Only (duplicate)': 'Music Only (doublon)',
}
MONTHS = 'janvier février mars avril mai juin juillet août septembre octobre novembre décembre'.split()


def e(x):
    return escape(str(x if x is not None else ''), quote=True)


def fr_date(iso):
    y, m, d = iso.split('-')
    return f'{int(d)} {MONTHS[int(m) - 1]} {y}'


def cover(s, size=1000):
    c = s.get('cover') or ''
    return re.sub(r'/unsafe/\d+x\d+/', f'/unsafe/{size}x{size}/', c) if c.startswith('https://') else ''


def is_main(s):
    return s.get('counted', True) and not s.get('version_of')


def tracks(s):
    return [t for t in s['tracks'] if t[0] == 'track']


def summary(s, n=155):
    d = (s.get('description') or '').strip()
    if d:
        d = re.sub(r'\s+', ' ', d)
    else:
        arts = []
        for t in tracks(s):
            if t[1] and t[1] not in arts:
                arts.append(t[1])
        d = f"Tracklist de l'émission ({len(tracks(s))} morceaux) : " + ', '.join(arts[:8]) if arts else \
            "Une émission de La fabrock, le grand mélange musical de Radio 666."
    return d if len(d) <= n else d[:n - 1].rsplit(' ', 1)[0] + '…'


def links(s):
    out = [l for l in s.get('links') or [] if l.get('url', '').startswith('https://')]
    if not out and s.get('url', '').startswith('https://'):
        out = [{'site': 'Mixcloud', 'url': s['url']}]
    m = re.search(r'open\.spotify\.com/(?:intl-[a-z-]+/)?playlist/([A-Za-z0-9]{22})', s.get('description') or '')
    if m:
        out.append({'site': 'Spotify', 'url': 'https://open.spotify.com/playlist/' + m.group(1)})
    return out


HEAD = '''<!doctype html>
<html lang="fr" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{url}">
<meta property="og:site_name" content="La fabrock">
<meta property="og:locale" content="fr_FR">
<meta property="og:type" content="{ogtype}">
<meta property="og:title" content="{ogtitle}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{url}">
{image}<meta name="twitter:card" content="{card}">
<link rel="icon" href="{rel}favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://api.fontshare.com">
<link href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@700,800&f[]=satoshi@400,500,700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="{rel}style.css">
<script>try{{var t=localStorage.getItem('theme')}}catch(e){{}}document.documentElement.dataset.theme=t||(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark')</script>
<script data-goatcounter="https://lafabrock.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>
{jsonld}</head>
<body>
<header class="top">
  <div class="wrap top-inner">
    <a href="{rel}#/home" class="brand" aria-label="Accueil des archives La fabrock">
      <svg class="logo" viewBox="0 0 40 40" fill="none" aria-hidden="true"><circle cx="20" cy="20" r="18" stroke="currentColor" stroke-width="2"/><circle cx="20" cy="20" r="11" stroke="currentColor" stroke-width="1" opacity=".45"/><circle cx="20" cy="20" r="4.5" fill="var(--accent)"/><path d="M20 2v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <span class="brand-text"><strong>La fabrock</strong><span>Les archives</span></span>
    </a>
    <nav class="tabs" aria-label="Rubriques">
      <a href="{rel}#/home">Accueil</a><a href="{rel}#/seasons">Saisons</a><a href="{rel}#/shows" class="on">Émissions</a><a href="{rel}#/songs">Titres</a><a href="{rel}#/artists">Artistes</a><a href="{rel}playlists/">Playlists</a>
    </nav>
  </div>
</header>
<main class="wrap">
'''
FOOT = '''</main>
<footer class="wrap foot">La fabrock, le grand mélange musical de Radio 666 · <a href="{rel}#/home">Les archives interactives</a> · <a href="{rel}show/">Toutes les émissions</a></footer>
</body>
</html>
'''


def page(s, prev, nxt, by_id):
    url = SITE + 'show/' + s['slug'] + '/'
    app = '../../#/show/' + s['slug']
    img = cover(s)
    tl = tracks(s)
    cat = CATEGORIES.get(s['category'], s['category'])
    eyebrow = ((cat + ' · ' if s['category'] != 'Season episode' else '') + f"Saison {s['season']}, épisode {s['episode']}") if s.get('season') else cat
    jsonld = {
        '@context': 'https://schema.org', '@type': 'RadioEpisode', 'name': s['name'], 'url': url,
        'datePublished': s.get('aired') or s['date'], 'inLanguage': 'fr',
        'partOfSeries': {'@type': 'RadioSeries', 'name': 'La fabrock', 'url': SITE},
    }
    if s.get('season'):
        jsonld['episodeNumber'] = s['episode']
        jsonld['partOfSeason'] = {'@type': 'RadioSeason', 'seasonNumber': s['season']}
    if img:
        jsonld['image'] = img
    if tl:
        jsonld['track'] = [{'@type': 'MusicRecording', 'name': t[2], **({'byArtist': {'@type': 'MusicGroup', 'name': t[1]}} if t[1] else {})} for t in tl]
    h = HEAD.format(
        title=e(s['name'] if 'fabrock' in s['name'].lower() else s['name'] + ' — La fabrock'),
        desc=e(summary(s)), url=e(url), ogtype='article',
        ogtitle=e(s['name']), rel='../../', card='summary_large_image' if img else 'summary',
        image=f'<meta property="og:image" content="{e(img)}">\n<meta property="og:image:width" content="1000">\n<meta property="og:image:height" content="1000">\n' if img else '',
        jsonld='<script type="application/ld+json">' + json.dumps(jsonld, ensure_ascii=False).replace('</', '<\\/') + '</script>\n')
    facts = []
    if s.get('aired'):
        facts.append(f"Diffusée le {fr_date(s['aired'])}")
        facts.append(f"en ligne le {fr_date(s['date'])}")
    else:
        facts.append(f"En ligne le {fr_date(s['date'])}")
    if s.get('duration'):
        facts.append(f"{s['duration']} min")
    facts.append(f"{len(tl)} morceau{'x' if len(tl) > 1 else ''}")
    btns = [f'<a class="btn" href="{e(app)}">▶ Écouter et explorer dans les archives</a>']
    btns += [f'<a class="btn ghost" href="{e(l["url"])}" target="_blank" rel="noopener">{"Les morceaux en playlist YouTube" if l["site"] == "Playlist YouTube" else "Écouter sur " + e(l["site"])} ↗</a>' for l in links(s)]
    out = [h, '<a class="back" href="../../#/shows">← Toutes les émissions</a>\n',
           f'<div class="detail-head {"" if img else "nocover"}">',
           f'<img class="cover" src="{e(cover(s, 600))}" alt="Pochette" width="160" height="160" onerror="this.remove();this.parentElement.classList.add(\'nocover\')">' if img else '',
           f'<div><div class="eyebrow">{e(eyebrow)}</div><h1>{e(s["name"])}</h1>',
           '<div class="facts">' + ''.join(f'<span>{e(f)}</span>' for f in facts) + '</div>',
           '<div class="btns">' + ''.join(btns) + '</div></div></div>\n']
    orig = [by_id[i] for i in s.get('version_of') or [] if i in by_id]
    if orig:
        out.append('<div class="version"><b>Version alternative.</b> Original : ' + ' + '.join(f'<a href="../{e(o["slug"])}/">{e(o["name"])}</a>' for o in orig) + '</div>\n')
    if s.get('description'):
        out.append(f'<div class="desc">{e(s["description"])}</div>\n')
    if s.get('tags'):
        out.append('<div class="tags">' + ''.join(f'<span class="tag">{e(t)}</span>' for t in s['tags']) + '</div>\n')
    out.append('<div class="sec-head"><h2>Tracklist</h2></div>\n')
    if s['tracks']:
        rows, n = [], 0
        for t in s['tracks']:
            if t[0] == 'track':
                n += 1
                rows.append(f'<tr><td class="num">{n}</td><td class="time">{e(t[3])}</td><td><span class="tt">{e(t[2])}</span><br><span class="ta">{e(t[1])}</span></td></tr>')
            else:
                rows.append(f'<tr class="seg"><td class="num"></td><td class="time">{e(t[3])}</td><td>{e(t[2])}</td></tr>')
        out.append('<table class="tracks"><thead><tr><th>#</th><th class="time">Temps</th><th>Titre</th></tr></thead><tbody>\n' + '\n'.join(rows) + '\n</tbody></table>\n')
    else:
        out.append('<div class="empty"><b>Pas de tracklist</b>La liste des morceaux de cette émission n\'est pas disponible.</div>\n')
    out.append('<div class="sec-head">' + (f'<a class="back" href="../{e(prev["slug"])}/">← {e(prev["name"][:48])}</a>' if prev else '<span></span>')
               + (f'<a class="back" href="../{e(nxt["slug"])}/">{e(nxt["name"][:48])} →</a>' if nxt else '') + '</div>\n')
    out.append(FOOT.format(rel='../../'))
    return ''.join(out)


def index_page(shows):
    h = HEAD.format(title="Toutes les émissions — La fabrock", desc=e(f"Les {len(shows)} émissions de La fabrock sur Radio 666, avec leur tracklist."),
                    url=e(SITE + 'show/'), ogtype='website', ogtitle='Toutes les émissions de La fabrock', rel='../',
                    card='summary', image='', jsonld='')
    rows = ''.join(f'<li><a class="row show-row" href="{e(s["slug"])}/"><span class="d">{e((s.get("aired") or s["date"])[:4])}</span>'
                   f'<div><div class="n">{e(s["name"])}</div></div><span class="badge">{len(tracks(s)) or "—"}</span></a></li>\n'
                   for s in sorted(shows, key=lambda s: (s['date'], s['id']), reverse=True))
    return h + f'<section class="hero"><h1>Toutes les émissions</h1><p>{len(shows)} émissions, de la plus récente à la plus ancienne. Pour chercher un titre ou un artiste, passez par <a href="../#/songs">les archives interactives</a>.</p></section>\n<ul class="list">\n{rows}</ul>\n' + FOOT.format(rel='../')


def playlists_page():
    """playlists/index.html : the themed YouTube playlists of the channel (data/youtube.json, "themes")."""
    themes = json.load(open(os.path.join(ROOT, 'data', 'youtube.json'), encoding='utf-8')).get('themes', [])
    themes = [t for t in themes if t.get('url', '').startswith('https://www.youtube.com/')]
    h = HEAD.format(title="Playlists thématiques — La fabrock", desc=e("Les playlists YouTube de La fabrock : les meilleurs titres de l'année par genre, les clips, les samples."),
                    url=e(SITE + 'playlists/'), ogtype='website', ogtitle='Les playlists thématiques de La fabrock', rel='../',
                    card='summary', image='', jsonld='').replace(' class="on">Émissions', '>Émissions').replace('playlists/">Playlists', 'playlists/" class="on">Playlists')
    groups = []
    for t in themes:
        if t['group'] not in groups:
            groups.append(t['group'])
    body = ''
    for g in groups:
        rows = ''.join(f'<li><a class="row show-row" href="{e(t["url"])}" target="_blank" rel="noopener"><span class="d">▶</span>'
                       f'<div><div class="n">{e(t["title"])}</div><div class="small">Playlist YouTube ↗</div></div>'
                       f'<span class="badge">{e(str(t["videos"])) + " vidéo" + ("s" if t["videos"] > 1 else "") if t.get("videos") else "—"}</span></a></li>\n'
                       for t in themes if t['group'] == g)
        body += f'<div class="sec-head"><h2>{e(g)}</h2><span class="count">{sum(t["group"] == g for t in themes)}</span></div>\n<ul class="list">\n{rows}</ul>\n'
    n = sum(t.get('videos') or 0 for t in themes)
    return h + (f'<section class="hero"><h1>Playlists thématiques</h1><p>{len(themes)} playlists et plus de {n // 100 * 100} vidéos sur la chaîne '
                f'<a href="https://www.youtube.com/@lafabrock" target="_blank" rel="noopener">YouTube de La fabrock</a> : le meilleur de chaque année par genre, '
                f'les clips, les samples. Les playlists liées à une émission sont sur la page de l\'émission.</p></section>\n') + body + FOOT.format(rel='../')


def og_block(latest):
    img = cover(latest)
    tags = [
        '<meta property="og:site_name" content="La fabrock">',
        '<meta property="og:locale" content="fr_FR">',
        '<meta property="og:type" content="website">',
        '<meta property="og:title" content="La fabrock — les archives de l\'émission de Radio 666">',
        '<meta property="og:description" content="Toutes les tracklists de La fabrock depuis 2012 : cherchez un titre ou un artiste, réécoutez les émissions.">',
        f'<meta property="og:url" content="{SITE}">',
    ]
    if img:
        tags += [f'<meta property="og:image" content="{e(img)}">', '<meta property="og:image:width" content="1000">',
                 '<meta property="og:image:height" content="1000">', '<meta name="twitter:card" content="summary_large_image">']
    return '<!-- og:start -->\n' + '\n'.join(tags) + '\n<!-- og:end -->'


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    old = open(path, encoding='utf-8').read() if os.path.exists(path) else None
    if old != text:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(text)


def main():
    d = json.load(open(os.path.join(ROOT, 'data', 'shows.json'), encoding='utf-8'))
    shows = sorted(d['shows'], key=lambda s: (s['date'], s['id']))
    by_id = {s['id']: s for s in shows}
    out_dir = os.path.join(ROOT, 'show')
    keep = {s['slug'] for s in shows}
    if os.path.isdir(out_dir):  # remove pages of shows that no longer exist
        for name in os.listdir(out_dir):
            if os.path.isdir(os.path.join(out_dir, name)) and name not in keep:
                shutil.rmtree(os.path.join(out_dir, name))
    for i, s in enumerate(shows):
        write(os.path.join(out_dir, s['slug'], 'index.html'),
              page(s, shows[i - 1] if i else None, shows[i + 1] if i + 1 < len(shows) else None, by_id))
    write(os.path.join(out_dir, 'index.html'), index_page(shows))
    write(os.path.join(ROOT, 'playlists', 'index.html'), playlists_page())

    urls = [(SITE, d['updated']), (SITE + 'show/', d['updated']), (SITE + 'playlists/', d['updated'])] + [(SITE + 'show/' + s['slug'] + '/', s['date']) for s in shows]
    write(os.path.join(ROOT, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
          + ''.join(f'<url><loc>{e(u)}</loc><lastmod>{m}</lastmod></url>\n' for u, m in urls) + '</urlset>\n')

    latest = max((s for s in shows if is_main(s)), key=lambda s: (s['date'], s['id']))
    ip = os.path.join(ROOT, 'index.html')
    html = open(ip, encoding='utf-8').read()
    html = re.sub(r'<!-- og:start -->.*?<!-- og:end -->', lambda m: og_block(latest), html, flags=re.S)
    write(ip, html)
    print(f'{len(shows)} show pages, show/index.html, sitemap.xml and share tags written.')


if __name__ == '__main__':
    main()
