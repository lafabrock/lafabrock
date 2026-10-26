# La fabrock – Show archive

A static mini-site to search every song played in La fabrock since 2012:
which show, when, what was played before and after, and how many times.

## Live site
https://lafabrock.github.io/lafabrock/
Deployed automatically by GitHub Pages from the main branch.

## Files
- `index.html`, `style.css`, `app.js`: the site (no framework, no backend)
- `data/shows.json`: all shows and tracklists (generated)
- `data/manual_shows.json`: tracklists you add by hand for shows that have none on Mixcloud
- `tools/update_data.py`: rebuilds `data/shows.json` from Mixcloud
- `.github/workflows/update.yml`: weekly GitHub Actions workflow (see below)

## Hosting
Copy the whole folder to any web server (nginx, Apache, Caddy, a NAS, GitHub Pages…).
It must be served over HTTP: opening index.html directly from disk will not load the data.
Quick local test:  `python3 -m http.server 8000` then open http://localhost:8000

To keep it private, protect the folder with your server's basic auth, e.g. nginx:
    location / { auth_basic "La fabrock"; auth_basic_user_file /etc/nginx/.htpasswd; }
The page also carries a `noindex` tag so search engines skip it.

## Updating after a new show
Fully automated: the GitHub Actions workflow `.github/workflows/update.yml` runs every
Saturday at 09:00 UTC, rebuilds `data/shows.json` from Mixcloud (lafabrock profile,
Radiosixsixsix "la-fabrock" playlist, any Radiosixsixsix upload with "fabrock" in its
title, and hearthis.at/lafabrock), commits the new data and Pages redeploys automatically.
You can also trigger it manually: tab Actions → "Update archive and deploy" → Run workflow.

Locally instead:  `pip install requests` then `python3 tools/update_data.py` (about 1 min).
Add --no-hearthis to skip hearthis.

## How hearthis uploads are merged (tools/hearthis.py)
Each hearthis upload is matched to Mixcloud by episode code (s03e15, 0309…), series number
(Topspin #12, Funky Explorations #46, ZKR5…) or title, then compared by duration:
- same mix (within 3 min): the hearthis link is added to the Mixcloud show
- different duration: added as an "alternate version" linked to the original, using the
  tracklist written in the hearthis description; songs already in the original are not counted twice
- no match: added as a hearthis-only show
Change TOL_MIN in tools/hearthis.py to make the "same mix" rule stricter or looser.
Can run weekly with cron:  `0 9 * * 5 cd /var/www/fabrock && python3 tools/update_data.py`

## Adding a tracklist by hand
Edit data/manual_shows.json. Each entry: `match_name` (exact Mixcloud title, or a new name for a
show not online yet), `name`, `date` (YYYY-MM-DD), `source`, and `tracks`:
`[{"type": "track", "artist": "...", "title": "...", "ts": "12:34"}]`.
An official Mixcloud tracklist always takes priority over the manual one.

## Playing files from your own computer
Click "Local files" (top bar, Chrome or Edge on a computer) and pick your mixes folder
(e.g. D:\LA FABROCK). The site reads only file names until you press play; nothing is uploaded.
Expected layout: sNN\SSEE[_name]\ holds the full mixes (1402.mp3, 1401_live.mp3…) and
sNN\SSEE[_name]\SSEE_xprt\ holds songs named "NNN - Title - Artist.mp3".
The browser remembers the folder; on the next visit click "Reconnect local files" once.
Other browsers (Firefox, Safari) can pick the folder too but have to be asked again each visit.
