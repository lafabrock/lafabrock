#!/usr/bin/env python3
"""Finishing touches applied to data/shows.json after every rebuild.

- slug:   a stable, readable identifier used in links (#/show/s14e05, show/s14e05/).
          Slugs are stored in data/slugs.json (keyed by the show URL) and never change
          once given, so links shared on Spotify, Instagram or elsewhere keep working.
- legacy: the old numeric id (#/show/418) of shows that existed before slugs, so old
          links are redirected to the right show.
- aired:  broadcast date, when it differs from the Mixcloud upload date. Taken from
          data/overrides.json ({"s14e05": {"aired": "2026-10-30"}}) or, failing that,
          from a date written in the show title (20140717, 7th January 2016…).
- artist aliases: data/aliases.json ({"Jay Z": "Jay-Z"}) rewrites artist spellings.

Run alone to re-apply it to the current data without fetching anything
(e.g. after editing overrides.json or aliases.json):
    python3 tools/postprocess.py
"""
import json, os, re, sys, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')


def load(name, default):
    p = os.path.join(DATA, name)
    if not os.path.exists(p):
        return default
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def save(name, obj, compact=False):
    with open(os.path.join(DATA, name), 'w', encoding='utf-8') as f:
        if compact:
            json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
        else:
            json.dump(obj, f, ensure_ascii=False, indent=1, sort_keys=True)
            f.write('\n')


def slugify(text, maxlen=60):
    t = unicodedata.normalize('NFKD', text or '').encode('ascii', 'ignore').decode().lower()
    t = re.sub(r'[^a-z0-9]+', '-', t).strip('-')
    if len(t) > maxlen:
        t = t[:maxlen].rsplit('-', 1)[0]
    return t or 'show'


def is_main(s):
    return s.get('counted', True) and not s.get('version_of')


def base_slug(s):
    if s.get('season') is not None and s.get('episode') is not None:
        code = f"s{s['season']:02d}e{s['episode']:02d}"
        if not s.get('counted', True):
            return code + '-music-only'
        if s.get('version_of'):
            return code + '-alt'
        return code
    name = re.sub(r'^\s*la fab ?rock\s*[|:\-–]\s*', '', s['name'], flags=re.I)
    return slugify(name)


def show_key(s):
    return s.get('url') or 'manual:' + s['name']


def assign_slugs(shows, registry, legacy=False):
    """Give every show a slug, reusing the registry; new shows get a new, unique one."""
    used = {v['slug'] for v in registry.values()}
    # main episodes claim their short code first
    order = sorted(shows, key=lambda s: (not is_main(s), s['date'], s.get('id', 0)))
    for s in order:
        k = show_key(s)
        entry = registry.get(k)
        if not entry and registry.get('manual:' + s['name']) and k != 'manual:' + s['name']:
            # a show added by hand, now online: keep the address it already had
            entry = registry[k] = registry.pop('manual:' + s['name'])
        if not entry:
            b = base_slug(s)
            slug, n = b, 2
            while slug in used:
                slug, n = f'{b}-{n}', n + 1
            used.add(slug)
            entry = registry[k] = {'slug': slug}
            if legacy and s.get('id'):
                entry['legacy'] = s['id']
        s['slug'] = entry['slug']
        if entry.get('legacy'):
            s['legacy'] = entry['legacy']
        else:
            s.pop('legacy', None)


MONTHS = {m: i + 1 for i, m in enumerate(
    'january february march april may june july august september october november december'.split())}
MONTHS.update({m: i + 1 for i, m in enumerate(
    'janvier fevrier mars avril mai juin juillet aout septembre octobre novembre decembre'.split())})


def date_in_name(name):
    n = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode().lower()
    m = re.search(r'(?<!\d)((?:19|20)\d\d)(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)', n)
    if m:
        return f'{m.group(1)}-{m.group(2)}-{m.group(3)}'
    m = re.search(r'(?<!\d)(\d{1,2})(?:st|nd|rd|th|er)?\s+(?:of\s+)?([a-z]+)\s+((?:19|20)\d\d)(?!\d)', n)
    if m and m.group(2) in MONTHS:
        return f'{m.group(3)}-{MONTHS[m.group(2)]:02d}-{int(m.group(1)):02d}'
    m = re.search(r'(?<!\d)(\d{1,2})[/.-](\d{1,2})[/.-]((?:19|20)\d\d)(?!\d)', n)
    if m:  # day/month, except Funky Corners (US show) which writes month/day
        a, b, y = int(m.group(1)), int(m.group(2)), m.group(3)
        d, mo = (b, a) if 'funky corners' in n else (a, b)
        return f'{y}-{mo:02d}-{d:02d}' if 1 <= mo <= 12 else None
    return None


def days(a, b):
    import datetime
    return (datetime.date.fromisoformat(b) - datetime.date.fromisoformat(a)).days


def valid_day(d):
    try:
        y, m, dd = map(int, d.split('-'))
        import datetime
        datetime.date(y, m, dd)
        return True
    except Exception:
        return False


def assign_aired(shows, overrides):
    for s in shows:
        o = overrides.get(s['slug'], {})
        aired = o.get('aired')
        if not aired:
            # a date in the title must be plausible: valid, and at most a year before the upload
            d = date_in_name(s['name'])
            aired = d if d and valid_day(d) and 0 <= days(d, s['date']) <= 366 else None
        if aired and aired != s['date']:
            s['aired'] = aired
        else:
            s.pop('aired', None)


def apply_aliases(shows, aliases):
    low = {k.lower(): v for k, v in aliases.items() if not k.startswith('_')}
    if not low:
        return
    for s in shows:
        for t in s['tracks']:
            if t[0] == 'track' and t[1].lower() in low:
                t[1] = low[t[1].lower()]


def finalize(shows, legacy=False):
    registry = load('slugs.json', {})
    apply_aliases(shows, load('aliases.json', {}))
    assign_slugs(shows, registry, legacy=legacy)
    assign_aired(shows, load('overrides.json', {}))
    save('slugs.json', registry)


def main():
    path = os.path.join(DATA, 'shows.json')
    with open(path, encoding='utf-8') as f:
        d = json.load(f)
    first = not os.path.exists(os.path.join(DATA, 'slugs.json'))
    finalize(d['shows'], legacy=first or '--legacy' in sys.argv)
    save('shows.json', d, compact=True)
    print(f"{len(d['shows'])} shows: slugs, broadcast dates and aliases applied.")


if __name__ == '__main__':
    main()
