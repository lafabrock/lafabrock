"""hearthis.at import for the La fabrock archive.

Each hearthis upload is compared with the Mixcloud shows (episode code or title,
duration, tracklist written in the description) and classified as:
  same       same mix as a Mixcloud show  -> its hearthis link is added to that show
  alternate  another version of a Mixcloud show (music only, shorter/longer edit,
             parts cut differently) -> added as a version linked to the original;
             its tracks only count as new plays if they are not in the original
  unique     only on hearthis -> added as a new show
"""
import re, time, difflib, unicodedata, requests

API = 'https://api-v2.hearthis.at'
USER = 'lafabrock'
TOL_MIN = 3  # minutes of tolerance to call two uploads the same mix
S = requests.Session()


def fold(s):
    return unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()


def norm(s):
    x = fold(s)
    x = re.sub(r'[\(\[][^\)\]]*[\)\]]', ' ', x)
    x = re.sub(r'\s(feat\.?|ft\.?|featuring)\s.*$', ' ', x)
    x = re.sub(r'\s-\s.*(remaster|version|edit|mix|live|explicit).*$', ' ', x)
    x = x.replace('&', ' and ')
    x = re.sub(r'[^a-z0-9]+', ' ', x).strip()
    return re.sub(r'^the\s', '', x)


def key(a, t):
    return norm(a) + '|' + norm(t)


def code(name):
    m = re.search(r'\bs(\d{1,2})\s*e(\d{1,3})\b', name, re.I)
    if m:
        return int(m.group(1)), int(m.group(2))
    m = re.search(r'(?:^|\|\s*)0(\d)(\d{2})\s*\|', name)
    if m:
        return int(m.group(1)), int(m.group(2))
    return None


def part(name):
    """part marker: 'A', 'B', 'C', '1', '2' or None"""
    n = fold(name)
    for rx in (r'\b(?:part|hour|pt)\.?\s*([0-9abc])\b', r'\|\s*([abc])\s*\|', r'\(([abc])\)\s*(?:\||$)',
               r'^ttt([abc])\b', r'\b20\d\d ([abc])\b', r'\bs\d+e\d+\s+([ab])\b', r'\s-\s([ab])\s*$', r'\s([abc])\s+\|'):
        m = re.search(rx, n)
        if m:
            p = m.group(1)
            return {'1': 'A', '2': 'B', '3': 'C'}.get(p, p.upper())
    return None


def tnorm(name):
    x = fold(name)
    x = re.sub(r'\b(la fabrock|lafabrock|radio 666)\b', ' ', x)
    x = re.sub(r'\d{1,2}(st|nd|rd|th)?( of)? (january|february|march|april|may|june|july|august|september|october|november|december|juin|juillet)( \d{4})?', ' ', x)
    x = re.sub(r'\b20\d{6}\b', ' ', x)
    return re.sub(r'[^a-z0-9]+', ' ', x).strip()


def numbers(name):
    h = ' | '.join(name.split('|')[:2])
    return set(re.findall(r'\d+', re.sub(r'\b20\d{6}\b', '', fold(h))))


def series(name):
    """numbered series id, e.g. ('topspin', 1), ('funky explorations', 46), ('zkr', 5)"""
    n = fold(name)
    m = re.search(r'(topspin|funky explorations|delitiae musicae|zkr|death of a villain \| vol\.)\s*#?\s*(\d+)', n)
    return (m.group(1), int(m.group(2))) if m else None


def similar(a, b):
    r = difflib.SequenceMatcher(None, a, b).ratio()
    n = min(len(a), len(b))
    if n >= 12:  # one title is a shortened version of the other
        r = max(r, difflib.SequenceMatcher(None, a[:n], b[:n]).ratio())
    return r


def head(name):
    """title without the trailing artist list: first two '|' segments"""
    return tnorm(' | '.join(name.split('|')[:2]))


SKIP = re.compile(r'(https?:|www\.|\.com|\.fr|\.at\b|facebook|twitter|mixcloud|radio666|raptz|youtube|soundsgood|tumblr|bandcamp|blogspot|playlist|listen to)', re.I)
TS = re.compile(r'\(?\b(\d{1,2}:\d{2}(?::\d{2})?)\)?\s*$')


def parse_desc(d):
    """Return [(left, right, ts)] for lines that look like 'X - Y [- album - year] [hh:mm:ss]'."""
    out, seen = [], set()
    for raw in (d or '').split('\n'):
        l = raw.strip().strip('•·*').strip()
        l = re.sub(r'^\d{1,3}[\.\)]\s*', '', l)
        if not l or len(l) > 170 or SKIP.search(l):
            continue
        ts = ''
        m = TS.search(l)
        if m:
            ts = m.group(1)
            l = l[:m.start()].rstrip(' -–')
        parts = [p.strip() for p in re.split(r'\s+[-–—]\s+|\s+[-–—]$', l)]
        while parts and (parts[-1] == '' or re.fullmatch(r'\d{4}', parts[-1])) and len(parts) > 2:
            parts.pop()
        if len(parts) < 2 or not parts[0] or not parts[1]:
            continue
        a, b = parts[0].replace('#', '').strip(), parts[1].replace('#', '').strip()
        if re.fullmatch(r'[\d./ ]+', b) or re.fullmatch(r'[\d./ ]+', a):
            continue
        if len(a) > 80 or len(b) > 110 or re.search(r'[.!?]\s+\w+\s+\w+\s', a + ' ' + b):
            continue  # prose, not a track line
        k = key(a, b)
        if k in seen or k == '|':
            continue
        seen.add(k)
        out.append((a, b, ts))
    return out


def fetch_all():
    expected = int(S.get(f'{API}/{USER}/', timeout=60).json().get('track_count') or 0)
    uniq = {}
    for size in (20, 50, 100, 50):  # the API pages inconsistently: combine several page sizes
        page = 1
        while page < 100:
            r = S.get(f'{API}/{USER}/?type=tracks&page={page}&count={size}', timeout=60)
            r.raise_for_status()
            d = r.json()
            if not d:
                break
            for h in d:
                uniq.setdefault(h['id'], h)
            page += 1
            time.sleep(.3)
        if len(uniq) >= expected:
            break
    if len(uniq) < expected:
        print(f'  warning: hearthis returned {len(uniq)} of {expected} uploads')
    out = list(uniq.values())
    for h in out:
        h['_comments'] = []
        if int(h.get('comment_count') or 0):
            try:
                c = S.get(h['uri'] + 'comments/', timeout=30).json()
                h['_comments'] = c if isinstance(c, list) else []
            except Exception:
                pass
    return out


def add_hearthis(shows, category, season_ep, clean):
    """Mutates `shows` in place (adds links / new entries). Returns stats dict."""
    H = sorted(fetch_all(), key=lambda h: h['created_at'])
    for s in shows:
        s.setdefault('links', [{'site': 'Mixcloud', 'url': s['url']}] if s.get('url') else [])
        s['_keys'] = {key(t[1], t[2]) for t in s['tracks'] if t[0] == 'track'}
        s['_code'], s['_part'], s['_t'] = code(s['name']), part(s['name']), tnorm(s['name'])
    pool = [s for s in shows if 'music only' not in s['name'].lower() and s.get('account') != '—']
    artists = {}
    for s in shows:
        for t in s['tracks']:
            if t[0] == 'track':
                artists[norm(t[1])] = artists.get(norm(t[1]), 0) + 1

    stats = {'same': 0, 'alternate': 0, 'unique': 0}
    new = []
    for h in H:
        title = clean(h['title']).strip()
        dur = round(int(h.get('duration') or 0) / 60)
        hc, hp = code(title), part(title)
        cands = []
        if hc:
            cands = [s for s in pool if s['_code'] == hc]
            if len(cands) > 1 and hp:
                same_part = [s for s in cands if s['_part'] == hp]
                cands = same_part or cands
        else:
            ht, hn, hs = tnorm(title), numbers(title), series(title)
            if hs:
                cands = [s for s in pool if series(s['name']) == hs]
            hh = head(title)
            scored = [] if cands else sorted(((max(similar(ht, s['_t']), similar(hh, head(s['name']))), s) for s in pool), key=lambda x: -x[0])
            for r, s in scored[:5]:
                if r < 0.72:
                    break
                if numbers(s['name']) == hn and s['_part'] == hp:
                    cands = [s]
                    break
        pairs = parse_desc(h.get('description'))
        keys = set().union(*[c['_keys'] for c in cands]) if cands else set()
        ab = sum(1 for a, b, _ in pairs if key(a, b) in keys)
        ba = sum(1 for a, b, _ in pairs if key(b, a) in keys)
        if keys:
            orient = 'TA' if ba > ab else 'AT'
            if pairs and max(ab, ba) == 0:
                pairs = []  # the lines found are not this show's tracks
        else:
            sa = sum(artists.get(norm(a), 0) > 0 for a, b, _ in pairs)
            sb = sum(artists.get(norm(b), 0) > 0 for a, b, _ in pairs)
            orient = 'TA' if sb > sa else 'AT'
        if 'interview' in fold(title) or 'blessing' in fold(title):
            pairs = []  # interview chapters, not songs
        tracks = [['track', a, b, ts] if orient == 'AT' else ['track', b, a, ts] for a, b, ts in pairs]
        mdur = sum(c['duration'] or 0 for c in cands)
        desc = clean(h.get('description'))[:3000]
        hcomments = [{'user': (c.get('user') or {}).get('username', ''), 'text': clean(c.get('comment') or c.get('body') or '')} for c in h['_comments']]
        hlink = {'site': 'hearthis', 'url': h['permalink_url'], 'stream': h.get('stream_url') or '', 'duration': int(h.get('duration') or 0), 'plays': int(h.get('playback_count') or 0), 'comments': hcomments}

        if cands and abs(dur - mdur) <= TOL_MIN:
            stats['same'] += 1
            for c in cands:
                c['links'].append(dict(hlink, note='same mix' if len(cands) == 1 else f'one upload for {len(cands)} Mixcloud parts'))
            continue

        se, ep = season_ep(title)
        entry = dict(name=title, account='hearthis', category=category(title), season=se, episode=ep,
                     date=h['created_at'][:10], duration=dur, plays=int(h.get('playback_count') or 0),
                     favorites=int(h.get('favoritings_count') or 0), tags=[t for t in (h.get('tags_arr') or []) if t] or ([h['genre']] if h.get('genre') else []),
                     description=desc, url=h['permalink_url'], cover=h.get('artwork_url') or '', counted=True,
                     links=[hlink])
        if cands:
            stats['alternate'] += 1
            low = fold(desc)
            if 'music only' in low or 'full radio show' in low or 'commentaries' in low or 'hosted version' in low:
                note = f'Music-only version ({dur} min), the Mixcloud upload is the full radio show with talk ({mdur} min)'
            elif dur < mdur:
                note = f'Shorter version ({dur} min vs {mdur} min on Mixcloud)'
            else:
                note = f'Longer version ({dur} min vs {mdur} min on Mixcloud)'
            if len(cands) > 1:
                note += f', covers {len(cands)} Mixcloud parts'
            entry.update(category=cands[0]['category'], season=cands[0]['season'], episode=cands[0]['episode'],
                         version_of=[c['id'] for c in cands], version_note=note)
            for t in tracks:
                if key(t[1], t[2]) in keys:
                    t.append(0)  # already counted in the original show
            entry['source'] = 'hearthis description' if tracks else 'None (see original)'
        else:
            stats['unique'] += 1
            entry['source'] = 'hearthis description' if tracks else 'None'
        entry['tracks'] = tracks
        new.append(entry)

    shows.extend(new)
    for s in shows:
        for k in ('_keys', '_code', '_part', '_t'):
            s.pop(k, None)
    return stats
