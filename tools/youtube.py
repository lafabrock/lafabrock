"""YouTube videos and playlists of La fabrock (mix-only versions exported from DJ Studio,
playlists of the tracks of a show: "playlists": {"s03e12": "https://www.youtube.com/playlist?list=…"}).

data/youtube.json keeps, for each show identifier, the address of its video:
    "videos": {"s14e05": "https://www.youtube.com/watch?v=ojN5DAmTblM"}
A line can be added by hand; it is never overwritten.

fetch() reads the public feed of the channel (latest 15 videos, no API key needed)
and adds every video whose title names an episode: "s14e05", "S14E05" or, when the
title also contains "fabrock" or starts with it, a 4-digit code such as "1405".
apply() adds a "YouTube" listening link to the matching shows.
"""
import json, os, re, xml.etree.ElementTree as ET

DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
PATH = os.path.join(DATA, 'youtube.json')
FEED = 'https://www.youtube.com/feeds/videos.xml?channel_id='
NS = {'a': 'http://www.w3.org/2005/Atom', 'yt': 'http://www.youtube.com/xml/schemas/2015'}


def load():
    try:
        with open(PATH, encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return {'videos': {}}


def save(reg):
    with open(PATH, 'w', encoding='utf-8') as f:
        json.dump(reg, f, ensure_ascii=False, indent=1)
        f.write('\n')


def code_of(title):
    m = re.search(r'\bs(\d{1,2})\s*e(\d{1,3})\b', title, re.I)
    if m:
        return f's{int(m.group(1)):02d}e{int(m.group(2)):02d}'
    m = re.search(r'(?:^|\bfab ?rock\b\D{0,20})\b(0[1-9]|1\d)(\d{2})\b', title, re.I)
    if m and int(m.group(2)) >= 1:
        return f's{int(m.group(1)):02d}e{int(m.group(2)):02d}'
    return None


def fetch(session=None):
    """Add the new episode videos of the channel to data/youtube.json. Never fails the update."""
    reg = load()
    cid = reg.get('channel_id')
    if not cid:
        return 0
    try:
        import requests
        r = (session or requests).get(FEED + cid, timeout=30, headers={'User-Agent': 'Mozilla/5.0'})
        r.raise_for_status()
        root = ET.fromstring(r.content)
    except Exception as e:
        print('YouTube: feed not read, links kept as they were (' + str(e)[:80] + ')')
        return 0
    videos = reg.setdefault('videos', {})
    added = 0
    for entry in root.findall('a:entry', NS):
        vid = entry.findtext('yt:videoId', '', NS)
        code = code_of(entry.findtext('a:title', '', NS))
        if vid and code and code not in videos:
            videos[code] = 'https://www.youtube.com/watch?v=' + vid
            added += 1
    if added:
        save(reg)
    return added


def apply(shows):
    reg = load()
    ok = lambda d: {k: v for k, v in d.items() if isinstance(v, str) and v.startswith('https://')}
    videos, playlists = ok(reg.get('videos', {})), ok(reg.get('playlists', {}))
    for s in shows:
        links = s.setdefault('links', [])
        links[:] = [l for l in links if l.get('site') not in ('YouTube', 'Playlist YouTube')]
        if videos.get(s.get('slug')):
            links.append({'site': 'YouTube', 'url': videos[s['slug']]})
        if playlists.get(s.get('slug')):
            links.append({'site': 'Playlist YouTube', 'url': playlists[s['slug']]})
