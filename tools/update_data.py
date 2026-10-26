#!/usr/bin/env python3
"""Rebuild data/shows.json for the La fabrock archive site.

Fetches every show from the Mixcloud profile "lafabrock", the "la-fabrock"
playlist of Radiosixsixsix, any Radiosixsixsix upload whose title contains
"fabrock", and the hearthis.at/lafabrock uploads (see tools/hearthis.py;
skip them with --no-hearthis). Tracklists come from Mixcloud's tracklist data. Shows without an
official tracklist can be filled in data/manual_shows.json (matched by name).

Usage:  python3 tools/update_data.py        (needs: pip install requests)
"""
import json, os, re, sys, time, concurrent.futures as cf
import requests
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
API = 'https://api.mixcloud.com'
GQL = 'https://app.mixcloud.com/graphql'
H = {'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.mixcloud.com/'}
Q = ('query($u:String!,$s:String!){ cloudcastLookup(lookup:{username:$u,slug:$s}) { sections { __typename '
     '... on TrackSection { artistName songName startSeconds } ... on ChapterSection { chapter startSeconds } } } }')
S = requests.Session()


def get(url):
    for i in range(4):
        try:
            r = S.get(url, timeout=30)
            r.raise_for_status()
            return r.json()
        except Exception:
            time.sleep(2 + i * 2)
    raise RuntimeError('failed: ' + url)


def paged(url):
    out = []
    while url:
        d = get(url)
        out += d.get('data', [])
        url = d.get('paging', {}).get('next')
    return out


def tracklist(user, slug):
    for i in range(4):
        try:
            r = S.post(GQL, json={'query': Q, 'variables': {'u': user, 's': slug}}, headers=H, timeout=30).json()
            return (r['data']['cloudcastLookup'] or {}).get('sections') or []
        except Exception:
            time.sleep(2 + i * 2)
    return []


def ts(sec):
    if sec is None:
        return ''
    sec = int(sec)
    h, m, s = sec // 3600, sec % 3600 // 60, sec % 60
    return f'{h}:{m:02d}:{s:02d}' if h else f'{m}:{s:02d}'


def season_ep(name):
    m = re.search(r'\bs(\d{1,2})\s*e(\d{1,3})\b', name, re.I)
    if m:
        return int(m.group(1)), int(m.group(2))
    m = re.match(r'^0(\d)(\d{2})\s*\|', name)
    if m:
        return int(m.group(1)), int(m.group(2))
    m = re.search(r'Episode (\d+) - Jeudi', name)
    if m:
        return 1, int(m.group(1))
    return None, None


def category(name):
    n = name.lower()
    if 'music only' in n: return 'Music Only (duplicate)'
    if n.startswith('topspin'): return 'Topspin'
    if n.startswith('funky explorations'): return 'Funky Explorations'
    if n.startswith('delitiae'): return 'Delitiae Musicae'
    if re.match(r'^(zkr\d|l7 |e9 )', n) or 'birthday' in n: return 'Birthday mixtape'
    if 'best of' in n or n.startswith(('ttt', 'sélection 20')): return 'Best of'
    if 'death of a villain' in n or 'philippe zdar' in n: return 'Tribute'
    if 'summer snacks' in n: return 'Summer Snacks'
    if n.startswith(('vol.', 'cumbia')): return 'Early mix'
    if season_ep(name)[0] is not None: return 'Season episode'
    return 'Guest / collab'


def clean(t):
    t = (t or '').replace('\r\n', '\n').replace('\r', '\n').replace('\ufeff', '')
    return re.sub(r'\s+', ' ', t).strip() if '\n' not in t else t.strip()


def main():
    print('Listing shows…')
    items = [('lafabrock', o) for o in paged(f'{API}/lafabrock/cloudcasts/?limit=100')]
    rs = {o['key']: o for o in paged(f'{API}/Radiosixsixsix/playlists/la-fabrock/cloudcasts/?limit=100')}
    for o in paged(f'{API}/Radiosixsixsix/cloudcasts/?limit=100'):
        if 'fabrock' in o['name'].lower():
            rs.setdefault(o['key'], o)
    items += [('Radiosixsixsix', o) for o in rs.values()]
    print(len(items), 'shows found. Fetching details and tracklists…')

    def detail(it):
        user, o = it
        d = get(API + o['key'])
        d['_sections'] = tracklist(user, o['slug'])
        d['_user'] = user
        return d

    with cf.ThreadPoolExecutor(6) as ex:
        full = list(ex.map(detail, items))

    manual_path = os.path.join(DATA, 'manual_shows.json')
    manual = json.load(open(manual_path, encoding='utf-8')) if os.path.exists(manual_path) else []
    by_name = {m['match_name']: m for m in manual}
    used = set()

    shows = []
    for d in full:
        name = re.sub(r'\s+', ' ', clean(d['name']))
        secs = d['_sections']
        ntr = sum(1 for x in secs if x['__typename'] == 'TrackSection')
        as_tracks = ntr == 0 and d['slug'].startswith('zkr')
        tracks = []
        if ntr or as_tracks:
            src = 'Mixcloud tracklist' if ntr else 'Mixcloud chapters'
            for x in secs:
                if x['__typename'] == 'TrackSection':
                    a, t = clean(x['artistName']), clean(x['songName'])
                    jingle = re.sub(r'\W', '', a.lower()) == 'lafabrock' or 'fabrock_intro' in t.lower() or 'fabrock intro' in t.lower()
                    tracks.append(['segment' if jingle else 'track', '' if jingle else a, t, ts(x.get('startSeconds'))])
                else:
                    tracks.append(['track' if as_tracks else 'segment', '', clean(x['chapter']).strip(' -'), ts(x.get('startSeconds'))])
        elif name in by_name or d['name'] in by_name:
            m = by_name.get(name) or by_name[d['name']]
            used.add(m['match_name'])
            src = m['source']
            tracks = [[t['type'], t['artist'], t['title'], t['ts']] for t in m['tracks']]
        else:
            src = 'None'
        se, ep = season_ep(name)
        shows.append(dict(
            name=name, account=d['_user'], category=category(name), season=se, episode=ep,
            date=d['created_time'][:10], duration=round(d['audio_length'] / 60) if d.get('audio_length') else None,
            source=src, plays=d.get('play_count'), favorites=d.get('favorite_count'),
            tags=[t['name'] for t in d.get('tags', [])], description=clean(d.get('description'))[:3000],
            url=d['url'], cover=d.get('pictures', {}).get('large', ''), counted='music only' not in name.lower(),
            tracks=tracks))

    # manual shows not on Mixcloud yet (e.g. a prepared playlist)
    online = {s['name'] for s in shows}
    for m in manual:
        if m['match_name'] in used or m['name'] in online:
            continue
        se, ep = season_ep(m['name'])
        shows.append(dict(name=m['name'], account='—', category=category(m['name']), season=se, episode=ep,
                          date=m['date'], duration=m.get('duration_min'), source=m['source'], plays=None,
                          favorites=None, tags=[], description='', url=m.get('url'), cover='', counted=True,
                          tracks=[[t['type'], t['artist'], t['title'], t['ts']] for t in m['tracks']]))

    order = lambda s: (s['date'], s['season'] or 0, s['episode'] or 0, s['name'])
    shows.sort(key=order)
    for i, s in enumerate(shows):
        s['id'] = i + 1

    if '--no-hearthis' not in sys.argv:
        print('Fetching hearthis.at…')
        from hearthis import add_hearthis
        st = add_hearthis(shows, category, season_ep, clean)
        print(f"hearthis: {st['same']} same as a Mixcloud show, {st['alternate']} alternate versions, {st['unique']} only on hearthis")
        shows.sort(key=order)
        remap = {}
        for i, s in enumerate(shows):
            if 'id' in s:
                remap[s['id']] = i + 1
        for i, s in enumerate(shows):
            s['id'] = i + 1
        for s in shows:
            if s.get('version_of'):
                s['version_of'] = [remap[x] for x in s['version_of']]
        by_id = {s['id']: s for s in shows}
        for s in shows:
            for p in s.get('version_of') or []:
                by_id[p].setdefault('versions', []).append(s['id'])
    out = dict(updated=time.strftime('%Y-%m-%d'), shows=shows)
    with open(os.path.join(DATA, 'shows.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    n = sum(1 for s in shows for t in s['tracks'] if t[0] == 'track')
    print(f'Done: {len(shows)} shows, {n} tracks -> data/shows.json')


if __name__ == '__main__':
    sys.exit(main())
