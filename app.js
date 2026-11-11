(() => {
  'use strict';
  const app = document.getElementById('app');
  const root = document.documentElement;

  // ---------- theme ----------
  // the theme is set in <head> (saved choice, else the system setting); the button switches and remembers it
  if (!root.dataset.theme) root.dataset.theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.getElementById('theme').addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('theme', root.dataset.theme); } catch (e) {}
  });

  // ---------- helpers ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = u => { try { const x = new URL(u); return x.protocol === 'https:' && /(^|\.)(mixcloud\.com|hearthis\.at|hearthis\.app|youtube\.com|youtu\.be)$/.test(x.hostname) ? x.href : ''; } catch { return ''; } };
  const fold = s => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const norm = s => {
    let x = fold(s);
    x = x.replace(/[([][^)\]]*[)\]]/g, ' ');
    x = x.replace(/\s(feat\.?|ft\.?|featuring)\s.*$/, ' ');
    x = x.replace(/\s-\s.*(remaster|version|edit|mix|live|explicit).*$/, ' ');
    x = x.replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/^the\s/, '');
    return x;
  };
  // artist keys: spellings that differ only by spaces or punctuation (Jay Z, JAY-Z, JayZ) share one key
  const AKEYS = new Map();
  const akey = a => { const k = norm(a); if (!k) return k; const c = k.replace(/ /g, ''); if (!AKEYS.has(c)) AKEYS.set(c, k); return AKEYS.get(c); };
  const CAT = { 'Season episode': 'Épisodes de saison', 'Guest / collab': 'Invité / collab', 'Birthday mixtape': "Mixtape d'anniversaire", 'Early mix': 'Premiers mixes', 'Tribute': 'Hommage', 'Music Only (duplicate)': 'Music Only (doublon)' };
  const cat = c => CAT[c] || c;
  const SRC = { 'Mixcloud tracklist': 'tracklist Mixcloud', 'Mixcloud chapters': 'chapitres Mixcloud', 'Mixcloud comment': 'commentaire Mixcloud', 'hearthis description': 'description hearthis', 'None': 'aucune', 'None (see original)': "aucune (voir l'original)" };
  const srcLabel = x => SRC[x] || x;
  const fmtDate = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
  const label = t => t.artist ? `${t.artist} – ${t.title}` : t.title;
  const hl = (text, q) => {
    const s = esc(text);
    if (!q) return s;
    const f = fold(text), i = f.indexOf(q);
    if (i < 0) return s;
    return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
  };
  const plural = (n, w, pl) => `${n.toLocaleString('fr')} ${n > 1 ? (pl || w + 's') : w}`;
  const searchIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

  // ---------- data ----------
  let DB;
  function build(raw) {
    const shows = raw.shows;
    const showById = new Map(), showBySlug = new Map(), legacy = new Map();
    const tracks = [];
    const songs = new Map();   // key -> {key, artist, title, plays:[], count}
    const artists = new Map(); // akey -> {key, name, count, shows:Set}
    for (const s of shows) {
      showById.set(s.id, s);
      s.slug = s.slug || String(s.id);
      showBySlug.set(s.slug, s);
      if (s.legacy) legacy.set(s.legacy, s);
      s.day = s.aired || s.date; // broadcast date when known, else the upload date
      s.year = +s.date.slice(0, 4);
      s.items = s.tracks.map((t, i) => ({ type: t[0], artist: t[1], title: t[2], ts: t[3], pos: i + 1, show: s, counted: s.counted && t[4] !== 0 }));
      s.links = (s.links || (s.url ? [{ site: 'Mixcloud', url: s.url }] : [])).map(l => ({ ...l, url: safeUrl(l.url), stream: l.stream ? safeUrl(l.stream) : '' })).filter(l => l.url);
      s.cover = s.cover && /^https:\/\//.test(s.cover) ? s.cover : '';
      // Spotify playlist pasted in the Mixcloud description -> "Listen on Spotify" button (link rebuilt from the id only)
      const sp = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?playlist\/([A-Za-z0-9]{22})/.exec(s.description || '');
      s.spotify = sp ? 'https://open.spotify.com/playlist/' + sp[1] : '';
      s.platform = s.account === 'hearthis' ? (s.version_of ? 'alternate' : 'hearthis') : 'mixcloud';
      const tl = s.items.filter(t => t.type === 'track');
      s.nTracks = tl.length;
      tl.forEach((t, i) => {
        t.prev = tl[i - 1] || null; t.next = tl[i + 1] || null;
        t.key = akey(t.artist) + '|' + norm(t.title);
        t.search = fold(t.artist + ' ' + t.title);
        let g = songs.get(t.key);
        if (!g) { g = { key: t.key, artist: t.artist, title: t.title, plays: [], count: 0 }; songs.set(t.key, g); }
        g.plays.push(t);
        if (t.counted) g.count++;
        t.song = g;
        tracks.push(t);
        const ak = akey(t.artist);
        if (ak && t.counted) {
          let a = artists.get(ak);
          if (!a) { a = { key: ak, name: t.artist, count: 0, shows: new Set(), songs: new Set(), spell: new Map() }; artists.set(ak, a); }
          a.count++; a.shows.add(s.id); a.songs.add(t.key); a.spell.set(t.artist, (a.spell.get(t.artist) || 0) + 1);
        }
      });
    }
    for (const g of songs.values()) g.search = fold(g.artist + ' ' + g.title);
    // show each artist under its most used spelling (all-caps loses ties)
    const caps = x => x === x.toUpperCase() && x !== x.toLowerCase();
    for (const a of artists.values()) a.name = [...a.spell].sort((x, y) => y[1] - x[1] || caps(x[0]) - caps(y[0]))[0][0];
    // seasons: main uploads only (no alternate versions, no Music Only duplicates)
    const seasons = new Map();
    for (const s of shows) {
      if (!s.season) continue;
      let se = seasons.get(s.season);
      if (!se) { se = { n: s.season, eps: new Map(), uploads: [], first: s.date, last: s.date }; seasons.set(s.season, se); }
      se.uploads.push(s);
      if (s.date < se.first) se.first = s.date;
      if (s.date > se.last) se.last = s.date;
      const main = !s.version_of && s.counted;
      let ep = se.eps.get(s.episode);
      if (!ep) { ep = { n: s.episode, main: [], extra: [] }; se.eps.set(s.episode, ep); }
      (main ? ep.main : ep.extra).push(s);
    }
    for (const se of seasons.values()) {
      se.episodes = [...se.eps.values()].filter(e => e.main.length).sort((x, y) => x.n - y.n);
      se.tracks = se.episodes.reduce((n, e) => n + e.main.reduce((m, s) => m + s.nTracks, 0), 0);
      se.live = se.episodes.filter(e => e.main.some(s => /\blive\b/i.test(s.name))).length;
    }
    const years = [...new Set(shows.map(s => s.year))].sort((a, b) => b - a);
    const cats = [...new Set(shows.map(s => s.category))].sort();
    // song/artist dates (counted plays only)
    for (const g of songs.values()) {
      g.dates = g.plays.filter(p => p.counted).map(p => p.show.date).sort();
      g.first = g.dates[0] || g.plays[0].show.date; g.last = g.dates[g.dates.length - 1] || g.first;
      let gap = 0;
      for (let i = 1; i < g.dates.length; i++) gap = Math.max(gap, (new Date(g.dates[i]) - new Date(g.dates[i - 1])) / 864e5);
      g.gap = gap;
    }
    for (const t of tracks) {
      const ak = akey(t.artist), a = artists.get(ak);
      if (!a || !t.counted) continue;
      a.first = !a.first || t.show.date < a.first ? t.show.date : a.first;
      a.last = !a.last || t.show.date > a.last ? t.show.date : a.last;
      a.years = a.years || {}; a.years[t.show.year] = (a.years[t.show.year] || 0) + 1;
    }
    return { raw, shows, showById, showBySlug, legacy, tracks, songs, artists, years, cats, seasons };
  }

  // ---------- routing ----------
  function parse() {
    const h = location.hash.replace(/^#\/?/, '') || 'home';
    const [path, qs] = h.split('?');
    const parts = path.split('/').map(decodeURIComponent);
    return { parts, params: new URLSearchParams(qs || '') };
  }
  function setTab(name) {
    document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === name));
  }
  const HOME_TITLE = "La fabrock — les archives de l'émission de Radio 666";
  function render() {
    if (!DB) return;
    const { parts, params } = parse();
    const [p0, p1] = parts;
    // old links used a number (#/show/418): send them to the show's permanent address
    if (p0 === 'show' && /^\d+$/.test(p1 || '') && DB.legacy.has(+p1)) {
      const q = params.toString();
      history.replaceState(null, '', '#/show/' + DB.legacy.get(+p1).slug + (q ? '?' + q : ''));
      return render();
    }
    route(p0, p1, params);
    const h = app.querySelector('h1'), t = h ? h.textContent.trim() : '';
    document.title = !p0 || p0 === 'home' || !t ? HOME_TITLE : /fabrock/i.test(t) ? t : t + ' — La fabrock';
    const an = document.getElementById('announce'); if (an) an.textContent = t;
  }
  function route(p0, p1, params) {
    if (p0 === 'show' && p1) { setTab('shows'); return viewShow(p1, params); }
    if (p0 === 'song' && p1) { setTab('songs'); return viewSong(p1); }
    if (p0 === 'artist' && p1) { setTab('artists'); return viewArtist(p1); }
    if (p0 === 'season' && p1) { setTab('seasons'); return viewSeason(+p1); }
    if (p0 === 'seasons') { setTab('seasons'); return viewSeasons(params); }
    if (p0 === 'songs') { setTab('songs'); return viewSongs(params); }
    if (p0 === 'shows') { setTab('shows'); return viewShows(params); }
    if (p0 === 'artists') { setTab('artists'); return viewArtists(params); }
    if (p0 === 'random') { setTab('random'); return viewRandom(params); }
    setTab('home'); return viewHome();
  }
  const replaceParams = (base, obj) => {
    const p = new URLSearchParams();
    Object.entries(obj).forEach(([k, v]) => { if (v) p.set(k, v); });
    const s = p.toString();
    history.replaceState(null, '', `#/${base}${s ? '?' + s : ''}`);
  };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // ---------- player ----------
  const tsSec = ts => { if (ts == null || ts === '') return null; const p = String(ts).trim().split(':').map(Number); if (p.some(isNaN) || p.length < 2) return null; return p.reduce((n, x) => n * 60 + x, 0); };
  const fmtTs = sec => { const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = Math.floor(sec % 60); return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };

  const sources = s => [...s.links.filter(l => l.site === 'Mixcloud' || (l.site === 'hearthis' && l.stream))];
  const playable = s => sources(s).length > 0;
  const hasTs = s => s.items.some(t => tsSec(t.ts) != null);
  const jumpable = (s, t) => playable(s) && tsSec(t.ts) != null && !(t.pos === 1 && tsSec(t.ts) === 0 && !s.items.some(x => tsSec(x.ts) > 0));

  const Player = (() => {
    const bar = document.getElementById('player');
    let show = null, src = null, widget = null, audio = null, apiPromise = null, timer = null;
    const loadApi = () => apiPromise || (apiPromise = new Promise((ok, ko) => {
      const sc = document.createElement('script'); sc.src = 'https://widget.mixcloud.com/media/js/widgetApi.js'; sc.onload = ok; sc.onerror = ko; document.head.appendChild(sc);
    }));
    const feedOf = url => new URL(url).pathname;
    function chrome() {
      const srcs = sources(show);
      bar.innerHTML = `
        <div class="wrap pl-inner">
          <div class="pl-meta">
            <div class="eyebrow">En lecture<span id="pl-now"></span></div>
            <a class="pl-name" href="#/show/${show.slug}">${esc(show.name)}</a>
          </div>
          <div class="pl-src" role="group" aria-label="Source">${srcs.map(l => `<button data-src="${esc(l.site)}" class="${l.site === (src && src.site) ? 'on' : ''}" ${l.label ? `title="${esc(l.label)}"` : ''}>${esc(l.site)}</button>`).join('')}</div>
          <div class="pl-slot" id="pl-slot"></div>
          <button class="pl-close" aria-label="Fermer le lecteur" title="Fermer">×</button>
        </div>
        <div class="wrap pl-msg" id="pl-msg"></div>`;
      bar.querySelector('.pl-close').onclick = close;
      bar.querySelectorAll('[data-src]').forEach(b => b.onclick = async () => {
        const pos = await position();
        open(show, pos, srcs.find(l => l.site === b.dataset.src));
      });
    }
    function msg(t) { const m = document.getElementById('pl-msg'); if (m) m.textContent = t || ''; }
    async function position() {
      try { if (audio) return audio.currentTime; if (widget) return await widget.getPosition(); } catch (e) {}
      return 0;
    }
    function stop() {
      clearInterval(timer); timer = null;
      if (audio) { audio.pause(); audio.src = ''; audio = null; }
      widget = null;
    }
    function close() { stop(); show = src = null; bar.hidden = true; bar.innerHTML = ''; document.body.classList.remove('has-player'); markShow(); }
    function track(pos) {
      // highlight the song currently playing on the show page
      if (!show) return;
      const rows = [...document.querySelectorAll('#app tr[data-sec]')].filter(r => r.dataset.sec !== '');
      if (!rows.length || location.hash.split('?')[0] !== '#/show/' + show.slug) return;
      let cur = null;
      for (const r of rows) if (+r.dataset.sec <= pos + 1) cur = r;
      rows.forEach(r => r.classList.toggle('now', r === cur));
      const now = document.getElementById('pl-now');
      if (now) now.textContent = cur ? ' · ' + cur.querySelector('.tt, td[colspan]')?.textContent : '';
    }
    async function open(s, sec = 0, pick) {
      const srcs = sources(s);
      if (!srcs.length) return;
      const same = show && show.id === s.id;
      const want = pick || (same && src) || srcs[0];
      if (same && want === src && (audio || widget)) return seek(sec);
      stop();
      show = s; src = want;
      bar.hidden = false; document.body.classList.add('has-player');
      chrome();
      const slot = document.getElementById('pl-slot');
      if (src.site === 'hearthis') {
        audio = new Audio(); audio.controls = true; audio.preload = 'auto';
        audio.src = src.stream;
        slot.appendChild(audio);
        const go = () => { if (sec) audio.currentTime = sec; };
        audio.addEventListener('loadedmetadata', go, { once: true });
        audio.addEventListener('timeupdate', () => track(audio.currentTime));
        audio.play().catch(() => msg('Appuyez sur lecture pour démarrer.'));
        if (src.site === 'hearthis' && show.links[0].site !== 'hearthis' && sec) msg('Les minutages viennent de la tracklist Mixcloud : sur hearthis, ils peuvent être décalés de quelques secondes.');
      } else {
        const ifr = document.createElement('iframe');
        ifr.title = 'Lecteur Mixcloud'; ifr.allow = 'autoplay; encrypted-media'; ifr.height = 60; ifr.width = '100%'; ifr.frameBorder = 0;
        ifr.src = `https://player-widget.mixcloud.com/widget/iframe/?hide_cover=1&mini=1&autoplay=1&feed=${encodeURIComponent(feedOf(src.url))}`;
        slot.appendChild(ifr);
        msg('Chargement de Mixcloud…');
        try {
          await loadApi();
          const w = window.Mixcloud.PlayerWidget(ifr);
          await w.ready;
          if (show !== s) return;
          widget = w;
          w.events.progress.on(p => track(p));
          msg('');
          const timeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(r, ms))]);
          timeout(w.play(), 3000);
          if (sec) {
            msg('Saut à ' + fmtTs(sec) + '…');
            for (let i = 0; i < 20; i++) { // wait until playback has actually started
              const paused = await timeout(w.getIsPaused(), 1500);
              if (paused === false) break;
              await new Promise(r => setTimeout(r, 500));
            }
            await seek(sec);
          }
        } catch (e) { msg('Le lecteur Mixcloud n\'a pas pu se charger. Utilisez plutôt le bouton Écouter sur Mixcloud.'); }
      }
    }
    async function seek(sec) {
      if (audio) {
        if (audio.readyState >= 1) audio.currentTime = sec; else audio.addEventListener('loadedmetadata', () => { audio.currentTime = sec; }, { once: true });
        audio.play().catch(() => msg('Appuyez sur lecture pour démarrer.'));
        return;
      }
      if (!widget) return;
      try {
        await Promise.race([widget.play(), new Promise(r => setTimeout(r, 3000))]);
        // Mixcloud may ignore a seek while the show is still starting: check the position and retry
        let ok = false;
        for (let i = 0; i < 12 && !ok; i++) {
          const allowed = await widget.seek(sec);
          await new Promise(r => setTimeout(r, 900));
          const pos = await widget.getPosition();
          ok = allowed && Math.abs(pos - sec) < 8;
          if (!ok && !allowed && i > 6) break;
        }
        if (!ok) {
          const ht = sources(show).find(l => l.site === 'hearthis');
          msg(ht ? 'Mixcloud n\'autorise pas ce saut, passage sur hearthis…' : 'Mixcloud n\'autorise pas le saut à ce moment. Utilisez la barre de progression du lecteur.');
          if (ht) setTimeout(() => open(show, sec, ht), 900);
        } else msg('');
      } catch (e) { msg('Impossible d\'aller à ce moment.'); }
    }
    function markShow() { if (show) track(audio ? audio.currentTime : 0); }
    return { open, seek, close, markShow };
  })();

  // ---------- views ----------
  function viewSongs(params) {
    const q0 = params.get('q') || '';
    const nShows = DB.shows.length, nTracks = DB.tracks.length, nSongs = DB.songs.size;
    app.innerHTML = `
      <section class="hero">
        <h1>Je l'ai déjà passé ?</h1>
        <p>Cherchez dans toutes les tracklists depuis 2012 : dans quelles émissions un titre est passé, et ce qui l'entourait.</p>
        <div class="stats">
          <div class="stat"><b>${nShows.toLocaleString('fr')}</b><span>Émissions</span></div>
          <div class="stat"><b>${nTracks.toLocaleString('fr')}</b><span>Morceaux passés</span></div>
          <div class="stat"><b>${nSongs.toLocaleString('fr')}</b><span>Titres différents</span></div>
          <div class="stat"><b>${DB.years[DB.years.length - 1]}–${DB.years[0]}</b><span>À l'antenne</span></div>
        </div>
        <div class="search">${searchIcon}<input id="q" type="search" placeholder="Artiste ou titre, ex. Gorillaz, lady, daft…" value="${esc(q0)}" autocomplete="off" aria-label="Chercher un titre ou un artiste"></div>
        <p class="hint">Majuscules et accents ignorés. Les passages dans les doublons « Music Only » sont listés mais pas comptés.</p>
      </section>
      <div id="res"></div>`;
    const input = document.getElementById('q');
    const res = document.getElementById('res');
    let limit = 60;
    const draw = () => {
      const q = fold(input.value.trim());
      let list, title;
      if (!q) {
        list = [...DB.songs.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title)).slice(0, 50);
        title = 'Les titres les plus passés';
        if (!res.dataset.disc) { res.insertAdjacentHTML('beforebegin', '<div id="disc"></div>'); res.dataset.disc = 1; drawSongDiscover(document.getElementById('disc')); }
        document.getElementById('disc').hidden = false;
      } else {
        const dz = document.getElementById('disc'); if (dz) dz.hidden = true;
        const words = q.split(/\s+/);
        list = [...DB.songs.values()].filter(g => words.every(w => g.search.includes(w)))
          .sort((a, b) => b.count - a.count || a.artist.localeCompare(b.artist));
        title = list.length ? `${plural(list.length, 'titre')} pour « ${esc(input.value.trim())} »` : '';
      }
      if (q && !list.length) {
        res.innerHTML = `<div class="empty"><b>Jamais passé</b>Rien dans les archives ne correspond à « ${esc(input.value.trim())} ».</div>`;
        return;
      }
      const shown = list.slice(0, limit);
      const qh = q.split(/\s+/)[0];
      res.innerHTML = `
        <div class="sec-head"><h2>${title}</h2>${q ? `<span class="count">${plural(list.reduce((n, g) => n + g.count, 0), 'play')}</span>` : ''}</div>
        <ul class="list">${shown.map(g => songRow(g, qh)).join('')}</ul>
        ${list.length > limit ? `<button class="more" id="more">Afficher plus (encore ${list.length - limit})</button>` : ''}`;
      const m = document.getElementById('more');
      if (m) m.onclick = () => { limit += 100; draw(); };
    };
    input.addEventListener('input', debounce(() => { limit = 60; replaceParams('songs', { q: input.value.trim() }); draw(); }, 120));
    draw();
    if (!q0) input.focus({ preventScroll: true });
  }

  function songRow(g, q) {
    const dates = g.plays.map(p => p.show.day).sort();
    const span = dates.length > 1 ? `${fmtDate(dates[0])} → ${fmtDate(dates[dates.length - 1])}` : fmtDate(dates[0]);
    return `<li><a class="row song-row" href="#/song/${encodeURIComponent(g.key)}">
      <div><div><span class="t">${hl(g.title, q)}</span> <span class="a">· ${hl(g.artist || 'Artiste inconnu', q)}</span></div>
      <div class="meta">${span}</div></div>
      <span class="badge ${g.count > 1 ? 'hot' : ''}" title="Nombre de passages">${g.count}×</span></a></li>`;
  }


  function viewSong(key) {
    const g = DB.songs.get(key);
    if (!g) return notFound('Ce titre n\'est pas dans les archives.');
    const plays = [...g.plays].sort((a, b) => b.show.date.localeCompare(a.show.date));
    const ak = akey(g.artist);
    app.innerHTML = `
      <a class="back" href="javascript:history.back()">← Retour</a>
      <div class="detail-head nocover"><div>
        <div class="eyebrow">Titre</div>
        <h1>${esc(g.title)}</h1>
        <div class="facts">
          ${g.artist ? `<a href="#/artist/${encodeURIComponent(ak)}">${esc(g.artist)}</a>` : '<span>Artiste inconnu</span>'}
          <span>Passé ${plural(g.count, 'fois', 'fois')}</span>
          <span>Première fois : ${fmtDate(plays[plays.length - 1].show.day)}</span>
          <span>Dernière fois : ${fmtDate(plays[0].show.day)}</span>
        </div></div></div>
      ${relatedSongsBlock(g)}
      <div class="sec-head"><h2>Tous les passages</h2><span class="count">avec ce qui passait avant et après</span></div>
      <div class="list">${plays.map(p => `
        <div class="play">
          <div class="d">${fmtDate(p.show.day)}</div>
          <div class="n">
            <a href="#/show/${p.show.slug}">${esc(p.show.name)}</a>
            <div class="small">Morceau ${p.show.items.filter(x => x.type === 'track').indexOf(p) + 1} sur ${p.show.nTracks}${p.ts ? ` · à ${jumpable(p.show, p) ? `<a href="#/show/${p.show.slug}?t=${tsSec(p.ts)}">▶ ${esc(p.ts)}</a>` : esc(p.ts)}` : ''}${p.counted ? '' : (p.show.version_of ? ' · version alternative, déjà comptée dans l\'émission originale' : ' · doublon Music Only (non compté)')}${p.artist !== g.artist || p.title !== g.title ? ` · listé comme « ${esc(label(p))} »` : ''}</div>
            <div class="ctx">
              <span>Avant</span>${p.prev ? `<a href="#/song/${encodeURIComponent(p.prev.key)}">${esc(label(p.prev))}</a>` : '<em class="small">Premier morceau</em>'}
              <span>Après</span>${p.next ? `<a href="#/song/${encodeURIComponent(p.next.key)}">${esc(label(p.next))}</a>` : '<em class="small">Dernier morceau</em>'}
            </div>
          </div>
          ${p.show.links.length ? `<div class="listen-col">${p.show.links.map(l => `<a class="listen" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.site)} ↗</a>`).join('')}</div>` : '<span></span>'}
        </div>`).join('')}</div>`;
    scrollTo(0, 0);
  }

  function viewShows(params) {
    const st = { q: params.get('q') || '', cat: params.get('cat') || '', year: params.get('year') || '', p: params.get('p') || '' };
    app.innerHTML = `
      <section class="hero"><h1>Toutes les émissions</h1><p>${plural(DB.shows.length, 'émission')} sur Mixcloud (lafabrock et Radio 666) et hearthis.</p></section>
      <div class="filters">
        <input id="fq" type="search" placeholder="Filtrer par nom d'émission ou invité…" value="${esc(st.q)}" aria-label="Filtrer les émissions">
        <select id="fc" aria-label="Catégorie"><option value="">Toutes les catégories</option>${DB.cats.map(c => `<option value="${esc(c)}" ${c === st.cat ? 'selected' : ''}>${esc(cat(c))}</option>`).join('')}</select>
        <select id="fp" aria-label="Plateforme"><option value="">Toutes les plateformes</option><option value="mixcloud" ${st.p === 'mixcloud' ? 'selected' : ''}>Mixcloud</option><option value="hearthis-any" ${st.p === 'hearthis-any' ? 'selected' : ''}>Aussi sur hearthis</option><option value="hearthis" ${st.p === 'hearthis' ? 'selected' : ''}>Seulement sur hearthis</option><option value="alternate" ${st.p === 'alternate' ? 'selected' : ''}>Versions alternatives</option></select>
        <select id="fy" aria-label="Année"><option value="">Toutes les années</option>${DB.years.map(y => `<option ${String(y) === st.year ? 'selected' : ''}>${y}</option>`).join('')}</select>
      </div>
      <div id="res"></div>`;
    const fq = document.getElementById('fq'), fc = document.getElementById('fc'), fy = document.getElementById('fy'), fp = document.getElementById('fp');
    const platformOk = s => !fp.value || (fp.value === 'hearthis-any' ? s.links.some(l => l.site === 'hearthis') : s.platform === fp.value);
    const res = document.getElementById('res');
    const draw = () => {
      const q = fold(fq.value.trim());
      const list = DB.shows.filter(s => (!q || fold(s.name).includes(q)) && (!fc.value || s.category === fc.value) && (!fy.value || String(s.year) === fy.value) && platformOk(s))
        .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
      replaceParams('shows', { q: fq.value.trim(), cat: fc.value, year: fy.value, p: fp.value });
      res.innerHTML = list.length ? `
        <div class="sec-head"><h2>${plural(list.length, 'émission')}</h2><span class="count">les plus récentes d'abord</span></div>
        <ul class="list">${list.map(s => `<li><a class="row show-row" href="#/show/${s.slug}">
          <span class="d">${fmtDate(s.day)}</span>
          <div><div class="n">${hl(s.name, q)}</div><div class="c">${platformTag(s)}${esc(cat(s.category))}${s.duration ? ` · ${s.duration} min` : ''}${s.plays != null ? ` · ${s.plays.toLocaleString('fr')} écoutes` : ''}</div></div>
          <span class="badge" title="Morceaux">${s.nTracks || '—'}</span></a></li>`).join('')}</ul>`
        : `<div class="empty"><b>Aucune émission trouvée</b>Essayez un autre filtre.</div>`;
    };
    fq.addEventListener('input', debounce(draw, 120));
    fc.addEventListener('change', draw); fy.addEventListener('change', draw); fp.addEventListener('change', draw);
    draw();
  }

  function viewShow(slug, params, opts) {
    const s = DB.showBySlug.get(slug);
    if (!s) return notFound('Cette émission n\'est pas dans les archives.');
    const idx = DB.shows.indexOf(s);
    const prev = DB.shows[idx - 1], next = DB.shows[idx + 1];
    let n = 0;
    app.innerHTML = `
      ${opts?.back ?? '<a class="back" href="#/shows">← Toutes les émissions</a>'}
      <div class="detail-head ${s.cover ? '' : 'nocover'}">
        ${s.cover ? `<img class="cover" src="${esc(s.cover)}" alt="" width="160" height="160" loading="lazy" onerror="this.remove();this.parentElement&&this.parentElement.classList.add('nocover')">` : ''}
        <div>
          <div class="eyebrow">${s.season ? `${s.category === 'Season episode' ? '' : esc(cat(s.category)) + ' · '}Saison ${s.season}, épisode ${s.episode}` : esc(cat(s.category))}</div>
          <h1>${esc(s.name)}</h1>
          <div class="facts">
            <span>${s.aired ? `Diffusée le ${fmtDate(s.aired)} · en ligne le ${fmtDate(s.date)}` : `En ligne le ${fmtDate(s.date)}`}</span>
            ${s.duration ? `<span>${s.duration} min</span>` : ''}
            <span>${plural(s.nTracks, 'morceau', 'morceaux')}</span>
            ${s.plays != null ? `<span>${s.plays.toLocaleString('fr')} écoutes${s.account === 'hearthis' ? ' sur hearthis' : ' sur Mixcloud'}${s.favorites != null ? ` · ${s.favorites} favoris` : ''}</span>` : ''}
            ${s.links.filter(l => l.site === 'hearthis' && s.account !== 'hearthis').map(l => `<span>${(l.plays || 0).toLocaleString('fr')} écoutes sur hearthis</span>`).join('')}
            <span>Tracklist : ${esc(srcLabel(s.source))}</span>
            <a class="share-link" href="show/${esc(s.slug)}/" title="Page avec la pochette et la tracklist, à partager sur les réseaux">Page à partager ↗</a>
          </div>
          <div class="btns">${s.links.map((l, i) => `<a class="btn ${i ? 'ghost' : ''}" href="${esc(l.url)}" target="_blank" rel="noopener">${l.site === 'Playlist YouTube' ? 'Les morceaux en playlist YouTube' : 'Écouter sur ' + esc(l.site)} ↗</a>`).join('')}${s.spotify ? `<a class="btn ghost" href="${esc(s.spotify)}" target="_blank" rel="noopener">Écouter sur Spotify ↗</a>` : ''}</div>
        </div>
      </div>
      ${episodeNav(s)}
      ${versionBlock(s)}
      ${s.description ? `<div class="desc">${esc(s.description)}</div>` : ''}
      ${s.tags.length ? `<div class="tags">${s.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
      ${commentsBlock(s)}
      ${spotifyKit(s)}
      ${playable(s) ? `<div class="listen-here"><button class="btn" data-play="0">▶ Écouter l'émission ici</button>${hasTs(s) ? `<span class="small">Cliquez sur un titre pour y aller directement dans le mix.</span>` : `<span class="small">Pas de minutage dans cette tracklist : impossible d'aller directement à un titre.</span>`}</div>` : ''}
      <div class="sec-head"><h2>Tracklist</h2><span class="count">× = nombre de passages du titre dans toutes les émissions</span></div>
      ${s.items.length ? `<table class="tracks"><thead><tr><th>#</th><th class="time">Temps</th><th>Titre</th><th class="r">Passages</th></tr></thead><tbody>
        ${s.items.map(t => t.type === 'track'
          ? `<tr data-sec="${tsSec(t.ts) ?? ''}"><td class="num">${++n}</td><td class="time">${jumpable(s, t) ? `<button class="jump" data-play="${tsSec(t.ts)}" aria-label="Écouter à partir de ${esc(t.ts)}">▶ ${esc(t.ts)}</button>` : esc(t.ts)}</td>
              <td>${jumpable(s, t) ? `<button class="songjump" data-play="${tsSec(t.ts)}" title="Écouter à partir de ${esc(t.ts)}">` : `<a href="#/song/${encodeURIComponent(t.key)}">`}<span class="tt">${esc(t.title)}</span><br><span class="ta">${esc(t.artist)}</span>${jumpable(s, t) ? '</button>' : '</a>'}</td>
              <td class="r"><a class="badge ${t.song.count > 1 ? 'hot' : ''}" href="#/song/${encodeURIComponent(t.key)}" title="${t.counted ? 'Nombre de passages : voir chaque passage' : 'Déjà compté dans l\'émission originale'}">${t.song.count}×</a></td></tr>`
          : `<tr class="seg" data-sec="${tsSec(t.ts) ?? ''}"><td class="num"></td><td class="time">${jumpable(s, t) ? `<button class="jump" data-play="${tsSec(t.ts)}">▶ ${esc(t.ts)}</button>` : esc(t.ts)}</td><td colspan="2">${esc(t.title)}</td></tr>`).join('')}
        </tbody></table>` : `<div class="empty"><b>Pas de tracklist</b>${s.version_of ? 'Cette version n\'a pas de tracklist propre. Voir l\'émission originale plus haut.' : 'La liste des morceaux de cette émission n\'est pas disponible.'}</div>`}
      <div class="sec-head">
        ${prev ? `<a class="back" href="#/show/${prev.slug}">← ${esc(prev.name.slice(0, 48))}</a>` : '<span></span>'}
        ${next ? `<a class="back" href="#/show/${next.slug}">${esc(next.name.slice(0, 48))} →</a>` : ''}
      </div>`;
    app.querySelectorAll('[data-play]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); Player.open(s, +b.dataset.play || 0); }));
    bindKit(s);
    Player.markShow();
    const tp = params && params.get('t'); const t0 = tp && /^\d+$/.test(tp) ? +tp : tsSec(tp || '');
    if (t0 != null && playable(s)) {
      const row = [...app.querySelectorAll('tr[data-sec]')].find(r => r.dataset.sec === String(t0));
      if (row) { row.classList.add('cued'); setTimeout(() => row.scrollIntoView({ block: 'center' }), 50); }
      const lh = app.querySelector('.listen-here');
      if (lh) lh.insertAdjacentHTML('afterbegin', `<button class="btn" data-cue>▶ Écouter à partir de ${fmtTs(t0)}</button>`);
      app.querySelector('[data-cue]')?.addEventListener('click', () => Player.open(s, t0));
      app.querySelector('[data-play="0"]')?.classList.add('ghost');
    } else scrollTo(0, 0);
  }

  // ---------- Spotify playlist kit: everything needed to build an episode playlist by hand ----------
  const SITE = 'https://lafabrock.github.io/lafabrock/';
  const kitData = s => {
    const code = s.season != null && s.episode != null ? `S${String(s.season).padStart(2, '0')}E${String(s.episode).padStart(2, '0')}` : '';
    const page = SITE + 'show/' + s.slug + '/';
    const mc = (s.links.find(l => l.site === 'Mixcloud') || s.links[0] || {}).url || '';
    const desc = `La fabrock${code ? ' ' + code : ''} sur Radio 666.${mc ? ' Le mix complet : ' + mc : ''} Tracklist : ${page}`.slice(0, 300);
    return {
      name: s.name.slice(0, 100),
      tracks: s.items.filter(t => t.type === 'track').map(t => `${t.artist} - ${t.title}`).join('\n'),
      desc, page,
      cover: s.cover ? s.cover.replace(/\/unsafe\/\d+x\d+\//, '/unsafe/1000x1000/') : '',
    };
  };
  function spotifyKit(s) {
    if (!s.nTracks) return '';
    const k = kitData(s);
    const box = (id, label, text, rows) => `<div class="kit-step"><div class="kit-head"><b>${label}</b><button class="btn ghost kit-btn" data-kcopy="${id}">Copier</button></div>
      <textarea id="kit-${id}" rows="${rows}" readonly>${esc(text)}</textarea></div>`;
    return `<details class="kit"><summary>Kit playlist Spotify${s.spotify ? ' <span class="small">· playlist déjà liée</span>' : ''}</summary>
      <p class="small">Pour TuneMyMusic (import de texte) et « Modifier les informations » de la playlist dans Spotify.</p>
      <div class="kit-step"><div class="kit-head"><b>1. Tracklist (${s.nTracks} titres)</b><span><button class="btn ghost kit-btn" data-kcopy="tracks">Copier</button><button class="btn ghost kit-btn" data-ktxt>Télécharger le .txt</button></span></div>
        <textarea id="kit-tracks" rows="6" readonly>${esc(k.tracks)}</textarea></div>
      ${box('name', '2. Nom de la playlist', k.name, 2)}
      <div class="kit-step"><div class="kit-head"><b>3. Pochette</b>${k.cover ? '<button class="btn ghost kit-btn" data-kcover>Télécharger le PNG</button>' : '<span class="small">Pas de pochette pour cette émission</span>'}</div>
        ${k.cover ? `<img class="kit-cover" src="${esc(k.cover)}" alt="" loading="lazy">` : ''}</div>
      ${box('desc', '4. Description de la playlist', k.desc, 3)}
      <div class="kit-step"><div class="kit-head"><b>5. Ligne pour la description Mixcloud</b><button class="btn ghost kit-btn" data-kcopy="mc">Copier</button></div>
        <input id="kit-url" type="url" placeholder="Collez ici le lien de la playlist Spotify" value="${esc(s.spotify)}">
        <textarea id="kit-mc" rows="2" readonly></textarea></div>
    </details>`;
  }
  function bindKit(s) {
    const kit = app.querySelector('.kit');
    if (!kit) return;
    const k = kitData(s), $ = id => kit.querySelector('#kit-' + id);
    const flash = (b, txt) => { const o = b.textContent; b.textContent = txt; setTimeout(() => b.textContent = o, 1500); };
    const save = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
    const fileBase = (s.season != null && s.episode != null ? `La fabrock s${String(s.season).padStart(2, '0')}e${String(s.episode).padStart(2, '0')}` : s.name).replace(/[\\/:*?"<>|]+/g, ' ').trim();
    const mcLine = () => {
      const m = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?playlist\/([A-Za-z0-9]{22})/.exec($('url').value);
      $('mc').value = m ? 'Spautifaille : https://open.spotify.com/playlist/' + m[1] : '';
    };
    $('url').addEventListener('input', mcLine); mcLine();
    kit.querySelectorAll('[data-kcopy]').forEach(b => b.addEventListener('click', async () => {
      const ta = $(b.dataset.kcopy);
      if (!ta.value) return flash(b, 'Collez d\'abord le lien');
      try { await navigator.clipboard.writeText(ta.value); } catch { ta.select(); document.execCommand('copy'); }
      flash(b, 'Copié ✓');
    }));
    kit.querySelector('[data-ktxt]').addEventListener('click', () => save(new Blob([k.tracks + '\n'], { type: 'text/plain;charset=utf-8' }), fileBase + '.txt'));
    kit.querySelector('[data-kcover]')?.addEventListener('click', async e => {
      const b = e.currentTarget;
      try {
        const img = await new Promise((ok, ko) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = ko; i.src = k.cover + (k.cover.includes('?') ? '&' : '?') + 'kit=1'; });
        const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        const blob = await new Promise((ok, ko) => c.toBlob(x => x ? ok(x) : ko(), 'image/png'));
        save(blob, fileBase + '.png'); flash(b, 'Téléchargé ✓');
      } catch {
        // Mixcloud refused the conversion: open the full-size image so it can be saved by hand (Spotify also takes JPEG)
        window.open(k.cover, '_blank', 'noopener'); flash(b, 'Ouvert dans un nouvel onglet');
      }
    });
  }

  function platformTag(s) {
    if (s.platform === 'alternate') return '<span class="ptag alt">Version alt.</span>';
    if (s.platform === 'hearthis') return '<span class="ptag ht">seulement hearthis</span>';
    return s.links.some(l => l.site === 'hearthis') ? '<span class="ptag">+ hearthis</span>' : '';
  }
  function versionBlock(s) {
    const orig = (s.version_of || []).map(id => DB.showById.get(id)).filter(Boolean);
    const alts = (s.versions || []).map(id => DB.showById.get(id)).filter(Boolean);
    if (!orig.length && !alts.length) return '';
    let h = '<div class="version">';
    if (orig.length) h += `<div><b>Version alternative.</b> ${esc(s.version_note || '')}</div><div class="small">Original : ${orig.map(o => `<a href="#/show/${o.slug}">${esc(o.name)}</a>`).join(' + ')}. Les titres déjà présents dans l'original ne sont pas comptés deux fois.</div>`;
    if (alts.length) h += `<div><b>Autre${alts.length > 1 ? 's' : ''} version${alts.length > 1 ? 's' : ''} sur hearthis :</b> ${alts.map(o => `<a href="#/show/${o.slug}">${esc(o.name)}</a> <span class="small">(${esc(o.version_note || '')})</span>`).join(' · ')}</div>`;
    return h + '</div>';
  }
  function commentsBlock(s) {
    const cs = s.links.flatMap(l => (l.comments || []).map(c => ({ ...c, site: l.site })));
    if (!cs.length) return '';
    return `<div class="sec-head"><h2>Commentaires sur hearthis</h2><span class="count">${cs.length}</span></div><ul class="comments">${cs.map(c => `<li><b>${esc(c.user)}</b> ${esc(c.text)}</li>`).join('')}</ul>`;
  }


  // ---------- home ----------
  const latestFirst = (a, b) => b.date.localeCompare(a.date) || b.id - a.id;
  function shortName(s) {
    // "La fabrock | s14e03 | Live | Mogwai, ..." -> title part and guests
    const isDate = x => /^(live\s*)?\d{8}$/i.test(x) || /^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}$/.test(x) || /^\d{1,2}(st|nd|rd|th|h)?\s+(of\s+)?[a-zéû]+\s+\d{4}$/i.test(x) || /^\d{1,2}(st|nd|rd|th)?\s+(of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)$/i.test(x);
    const parts = s.name.split('|').map(x => x.trim()).filter(x => x && !/^la fabrock$/i.test(x) && !/^s\d+\s*e\d+$/i.test(x) && !/^0\d{3}$/.test(x) && !isDate(x));
    return parts.join(' · ') || s.name;
  }
  function epCode(s) { return s.season ? `S${String(s.season).padStart(2, '0')}E${String(s.episode).padStart(2, '0')}` : ''; }
  function showCard(s) {
    return `<a class="card" href="#/show/${s.slug}">
      ${s.cover ? `<img src="${esc(s.cover)}" alt="" loading="lazy" width="300" height="300" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ph'}))">` : '<div class="ph"></div>'}
      <div class="card-b">
        <div class="eyebrow">${epCode(s) || esc(cat(s.category))}</div>
        <div class="card-t">${esc(shortName(s))}</div>
        <div class="small">${fmtDate(s.day)} · ${plural(s.nTracks, 'morceau', 'morceaux')}</div>
        <div class="card-p">${s.links.map(l => `<span class="ptag ${l.site === 'hearthis' ? 'ht' : ''}">${esc(l.site)}</span>`).join('')}${s.spotify ? '<span class="ptag">Spotify</span>' : ''}</div>
      </div></a>`;
  }
  function viewHome() {
    const main = DB.shows.filter(s => !s.version_of && s.counted).sort(latestFirst);
    const latest = main[0];
    const recent = main.slice(1, 13);
    const tl = latest.items.filter(t => t.type === 'track');
    const desc = (latest.description || '').split('\n').filter(Boolean).slice(0, 8).join('\n');
    const seasonsList = [...DB.seasons.values()].sort((a, b) => b.n - a.n);
    app.innerHTML = `
      <section class="feature">
        <div class="feature-art">${latest.cover ? `<img src="${esc(latest.cover)}" alt="" width="300" height="300" onerror="this.remove()">` : ''}</div>
        <div class="feature-body">
          <div class="eyebrow">Dernière émission · ${fmtDate(latest.day)}</div>
          <h1>${esc(shortName(latest))}</h1>
          <div class="facts">${latest.season ? `<a href="#/season/${latest.season}">Saison ${latest.season}, épisode ${latest.episode}</a>` : `<span>${esc(cat(latest.category))}</span>`}${latest.duration ? `<span>${latest.duration} min</span>` : ''}<span>${plural(latest.nTracks, 'morceau', 'morceaux')}</span></div>
          ${desc ? `<div class="feature-desc">${esc(desc)}</div>` : ''}
          <div class="btns">${latest.links.map((l, i) => `<a class="btn ${i ? 'ghost' : ''}" href="${esc(l.url)}" target="_blank" rel="noopener">${l.site === 'Playlist YouTube' ? 'Les morceaux en playlist YouTube' : 'Écouter sur ' + esc(l.site)} ↗</a>`).join('')}${latest.spotify ? `<a class="btn ghost" href="${esc(latest.spotify)}" target="_blank" rel="noopener">Écouter sur Spotify ↗</a>` : ''}<a class="btn ghost" href="#/show/${latest.slug}">Toute la tracklist</a></div>
        </div>
        ${tl.length ? `<ol class="feature-tl">${tl.slice(0, 8).map(t => `<li><a href="#/song/${encodeURIComponent(t.key)}"><span class="tt">${esc(t.title)}</span> <span class="ta">${esc(t.artist)}</span></a></li>`).join('')}${tl.length > 8 ? `<li class="more-li"><a href="#/show/${latest.slug}">+ ${tl.length - 8} autres</a></li>` : ''}</ol>` : ''}
      </section>

      <form class="search home-search" id="hs">${searchIcon}<input id="hq" type="search" placeholder="Je l'ai déjà passé ? Cherchez un titre ou un artiste…" aria-label="Chercher un titre"></form>

      <div class="sec-head"><h2>Dernières émissions</h2><a class="count" href="#/shows">Les ${DB.shows.length} émissions →</a></div>
      <div class="cards">${recent.map(showCard).join('')}</div>

      <div class="sec-head"><h2>Saisons</h2><a class="count" href="#/seasons">Vue d'ensemble →</a></div>
      <div class="season-strip">${seasonsList.map(se => `<a href="#/season/${se.n}" class="chip"><b>S${se.n}</b><span>${se.episodes.length} ép.</span></a>`).join('')}</div>`;
    document.getElementById('hs').addEventListener('submit', e => {
      e.preventDefault();
      location.hash = '#/songs?q=' + encodeURIComponent(document.getElementById('hq').value.trim());
    });
    scrollTo(0, 0);
  }

  // ---------- seasons ----------
  function seasonYears(se) {
    const a = se.first.slice(0, 4), b = se.last.slice(0, 4);
    return a === b ? a : `${a}–${b}`;
  }
  function viewSeasons(params) {
    if (params && params.get('view') === 'grid') return viewSeasonGrid(params);
    const list = [...DB.seasons.values()].sort((a, b) => b.n - a.n);
    const max = Math.max(...list.map(se => se.episodes.length));
    const totalEps = list.reduce((n, se) => n + se.episodes.length, 0);
    app.innerHTML = `
      <section class="hero"><h1>Saisons</h1><p>${list.length} saisons et ${totalEps} épisodes sur Radio 666, de ${list[list.length - 1].first.slice(0, 4)} à aujourd'hui. Les parties et versions alternatives sont regroupées sous leur épisode.</p>
        ${viewToggle('cards')}</section>
      <div class="seasons">${list.map(se => {
        const latest = se.episodes[se.episodes.length - 1];
        return `<a class="season" href="#/season/${se.n}">
          <div class="season-n"><span>Saison</span><b>${se.n}</b></div>
          <div class="season-b">
            <div class="season-y">${seasonYears(se)}</div>
            <div class="season-c"><b>${se.episodes.length}</b> épisode${se.episodes.length > 1 ? 's' : ''}${se.live ? ` · ${se.live} en direct` : ''} · ${se.tracks.toLocaleString('fr')} morceaux</div>
            <div class="bar"><i style="width:${Math.round(se.episodes.length / max * 100)}%"></i></div>
            <div class="small season-last">Dernier : ${esc(shortName(latest.main[0]))}</div>
          </div></a>`;
      }).join('')}</div>`;
    scrollTo(0, 0);
  }
  function viewSeason(n) {
    const se = DB.seasons.get(n);
    if (!se) return notFound('Cette saison n\'est pas dans les archives.');
    const nums = [...DB.seasons.keys()].sort((a, b) => a - b);
    const i = nums.indexOf(n), prev = nums[i - 1], next = nums[i + 1];
    const missing = [];
    const maxEp = Math.max(...se.episodes.map(e => e.n));
    const have = new Set(se.episodes.map(e => e.n));
    for (let k = 1; k <= maxEp; k++) if (!have.has(k)) missing.push(k);
    app.innerHTML = `
      <a class="back" href="#/seasons">← Toutes les saisons</a>
      <div class="detail-head nocover"><div>
        <div class="eyebrow">Saison ${n} · ${seasonYears(se)}</div>
        <h1>Saison ${n}</h1>
        <div class="facts"><span>${plural(se.episodes.length, 'épisode')}</span>${se.live ? `<span>${se.live} en direct</span>` : ''}<span>${se.tracks.toLocaleString('fr')} morceaux</span><span>${fmtDate(se.first)} → ${fmtDate(se.last)}</span></div>
        ${missing.length ? `<p class="small">Absent${missing.length > 1 ? 's' : ''} des archives : épisode${missing.length > 1 ? 's' : ''} ${missing.join(', ')}.</p>` : ''}
      </div></div>
      <ul class="list">${se.episodes.map(e => {
        const m = e.main[0];
        const allTracks = e.main.reduce((k, s) => k + s.nTracks, 0);
        const others = [...e.main.slice(1), ...e.extra];
        return `<li class="ep">
          <a class="ep-n" href="#/show/${m.slug}">${String(e.n).padStart(2, '0')}</a>
          <div class="ep-b">
            <a class="ep-t" href="#/show/${m.slug}">${esc(shortName(m))}</a>
            <div class="small">${fmtDate(m.day)}${m.duration ? ` · ${e.main.reduce((k, s) => k + (s.duration || 0), 0)} min` : ''} · ${plural(allTracks, 'morceau', 'morceaux')}${e.main.length > 1 ? ` · ${e.main.length} parties` : ''}</div>
            ${others.length ? `<div class="ep-v">${others.map(s => `<a href="#/show/${s.slug}">${s.version_of ? 'Version alt.' : s.counted ? 'Partie' : 'Music Only'}: ${esc(shortName(s).slice(0, 50))}</a>`).join('')}</div>` : ''}
          </div>
          <div class="ep-l">${[...new Set(e.main.flatMap(s => s.links.map(l => l.site).concat(s.spotify ? ['Spotify'] : [])))].map(site => `<span class="ptag ${site === 'hearthis' ? 'ht' : ''}">${esc(site)}</span>`).join('')}</div>
        </li>`;
      }).join('')}</ul>
      <div class="sec-head">
        ${prev ? `<a class="back" href="#/season/${prev}">← Saison ${prev}</a>` : '<span></span>'}
        ${next ? `<a class="back" href="#/season/${next}">Saison ${next} →</a>` : ''}
      </div>`;
    scrollTo(0, 0);
  }


  // ---------- shared helpers for discovery ----------
  const sample = (arr, n) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); };
  const yearsAgo = d => Math.floor((Date.now() - new Date(d)) / 31557600000);
  const mainShows = () => DB.shows.filter(s => !s.version_of && s.counted).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const songLink = g => `<a href="#/song/${encodeURIComponent(g.key)}"><span class="tt">${esc(g.title)}</span> <span class="ta">${esc(g.artist || '')}</span></a>`;
  const artistLink = a => `<a href="#/artist/${encodeURIComponent(a.key)}">${esc(a.name)}</a>`;
  const shuffleBtn = id => `<button class="shuffle" data-shuffle="${id}" aria-label="Mélanger">↻ Mélanger</button>`;
  function panel(title, sub, body, extra = '') {
    return `<section class="panel"><header><div><h3>${title}</h3>${sub ? `<p>${sub}</p>` : ''}</div>${extra}</header>${body}</section>`;
  }

  function drawSongDiscover(el) {
    const all = [...DB.songs.values()].filter(g => g.count > 0);
    const once = all.filter(g => g.count === 1 && yearsAgo(g.first) >= 3);
    const recentShows = mainShows().slice(0, 3);
    const recent = []; const seen = new Set();
    for (const s of recentShows) for (const t of s.items) if (t.type === 'track' && !seen.has(t.key)) { seen.add(t.key); recent.push({ g: t.song, s }); }
    const gaps = all.filter(g => g.dates.length > 1).sort((a, b) => b.gap - a.gap).slice(0, 8);
    const render = which => {
      if (!which || which === 'rand') {
        const g = sample(all, 1)[0];
        const firstPlay = g.plays.slice().sort((x, y) => x.show.date.localeCompare(y.show.date))[0];
        el.querySelector('#p-rand').innerHTML = `
          <a class="pick" href="#/song/${encodeURIComponent(g.key)}"><span class="pick-t">${esc(g.title)}</span><span class="pick-a">${esc(g.artist || 'Artiste inconnu')}</span></a>
          <div class="facts"><span>Passé ${plural(g.count, 'fois', 'fois')}</span><span>D'abord dans ${esc(shortName(firstPlay.show).slice(0, 60))}</span><span>${fmtDate(g.first)}</span></div>`;
      }
      if (!which || which === 'once') {
        el.querySelector('#p-once').innerHTML = `<ol class="mini">${sample(once, 7).map(g => `<li>${songLink(g)}<span class="small">${g.first.slice(0, 4)}</span></li>`).join('')}</ol>`;
      }
    };
    el.innerHTML = `<div class="discover">
      ${panel('Au hasard', 'Un titre des archives, tiré au sort', '<div id="p-rand"></div>', shuffleBtn('rand'))}
      ${panel('Passés récemment', `Dans les ${recentShows.length} dernières émissions`, `<ol class="mini">${recent.slice(0, 7).map(r => `<li>${songLink(r.g)}<a class="small" href="#/show/${r.s.slug}">${epCode(r.s) || fmtDate(r.s.day)}</a></li>`).join('')}</ol>`)}
      ${panel('Passés une seule fois', `${once.length.toLocaleString('fr')} titres passés une seule fois, il y a au moins 3 ans`, '<div id="p-once"></div>', shuffleBtn('once'))}
      ${panel('Le plus long retour', 'Des titres revenus après des années', `<ol class="mini">${gaps.slice(0, 7).map(g => `<li>${songLink(g)}<span class="small">${Math.round(g.gap / 365.25)} ans</span></li>`).join('')}</ol>`)}
    </div>`;
    render();
    el.querySelectorAll('[data-shuffle]').forEach(b => b.onclick = () => render(b.dataset.shuffle));
  }

  function drawArtistDiscover(el) {
    const all = [...DB.artists.values()];
    const multi = all.filter(a => a.count >= 3);
    const once = all.filter(a => a.count === 1);
    const comeback = all.filter(a => a.count >= 4).sort((x, y) => x.last.localeCompare(y.last)).slice(0, 7);
    const recentShows = mainShows().slice(0, 3);
    const recent = []; const seen = new Set();
    for (const s of recentShows) for (const t of s.items) { if (t.type !== 'track') continue; const a = DB.artists.get(akey(t.artist)); if (a && !seen.has(a.key)) { seen.add(a.key); recent.push(a); } }
    const render = which => {
      if (!which || which === 'arand') {
        const a = sample(multi, 1)[0];
        const top = [...DB.songs.values()].filter(g => akey(g.artist) === a.key).sort((x, y) => y.count - x.count)[0];
        el.querySelector('#p-arand').innerHTML = `
          <a class="pick" href="#/artist/${encodeURIComponent(a.key)}"><span class="pick-t">${esc(a.name)}</span><span class="pick-a">${top ? 'Le plus passé : ' + esc(top.title) : ''}</span></a>
          <div class="facts"><span>${plural(a.count, 'passage')}</span><span>${plural(a.songs.size, 'titre')}</span><span>${a.first.slice(0, 4)}–${a.last.slice(0, 4)}</span></div>`;
      }
      if (!which || which === 'aonce') {
        el.querySelector('#p-aonce').innerHTML = `<div class="chips">${sample(once, 14).map(a => `<a class="chip" href="#/artist/${encodeURIComponent(a.key)}">${esc(a.name)}</a>`).join('')}</div>`;
      }
    };
    el.innerHTML = `<div class="discover">
      ${panel('Au hasard', 'Un artiste passé au moins 3 fois', '<div id="p-arand"></div>', shuffleBtn('arand'))}
      ${panel('Passés récemment', `Les artistes des ${recentShows.length} dernières émissions`, `<div class="chips">${recent.slice(0, 18).map(a => `<a class="chip" href="#/artist/${encodeURIComponent(a.key)}">${esc(a.name)}<span>${a.count}×</span></a>`).join('')}</div>`)}
      ${panel('À ressortir', 'Passés au moins 4 fois, mais pas depuis longtemps', `<ol class="mini">${comeback.map(a => `<li>${artistLink(a)}<span class="small">dernier : ${a.last.slice(0, 4)} · ${a.count}×</span></li>`).join('')}</ol>`)}
      ${panel('Passés une seule fois', `${once.length.toLocaleString('fr')} artistes passés une seule fois`, '<div id="p-aonce"></div>', shuffleBtn('aonce'))}
    </div>`;
    render();
    el.querySelectorAll('[data-shuffle]').forEach(b => b.onclick = () => render(b.dataset.shuffle));
  }

  function relatedSongsBlock(g) {
    // songs that shared shows with this one; closer in the running order = stronger link
    const score = new Map();
    for (const p of g.plays) {
      if (!p.counted) continue;
      const tl = p.show.items.filter(t => t.type === 'track');
      const i = tl.indexOf(p);
      tl.forEach((t, j) => {
        if (t.key === g.key || !t.counted) return;
        const d = Math.abs(i - j);
        const sc = score.get(t.key) || { g: t.song, shows: new Set(), w: 0, next: 0 };
        sc.shows.add(p.show.id); sc.w += d === 1 ? 4 : d === 2 ? 2 : d <= 4 ? 1 : 0.2; if (d === 1) sc.next++;
        score.set(t.key, sc);
      });
    }
    const rel = [...score.values()].map(x => ({ ...x, s: x.shows.size * 5 + x.w })).sort((a, b) => b.s - a.s).slice(0, 10);
    const ak = akey(g.artist);
    const same = [...DB.songs.values()].filter(x => x.key !== g.key && ak && akey(x.artist) === ak).sort((a, b) => b.count - a.count).slice(0, 6);
    if (!rel.length && !same.length) return '';
    return `<div class="discover two">
      ${rel.length ? panel('Souvent passé avec', 'Des titres des mêmes émissions, les plus proches dans l\'ordre de passage d\'abord', `<ol class="mini">${rel.map(r => `<li>${songLink(r.g)}<span class="small">${r.shows.size > 1 ? `${r.shows.size} émissions` : r.next ? 'juste à côté' : 'même émission'}</span></li>`).join('')}</ol>`) : ''}
      ${same.length ? panel(`Autres titres de ${esc(g.artist)}`, '', `<ol class="mini">${same.map(x => `<li>${songLink(x)}<span class="small">${x.count}×</span></li>`).join('')}</ol>`) : ''}
    </div>`;
  }

  function artistTimeline(a) {
    const ys = DB.years.slice().sort();
    const max = Math.max(...Object.values(a.years || { 0: 1 }));
    return `<div class="timeline" aria-label="Passages par année">${ys.map(y => { const n = (a.years || {})[y] || 0; return `<div class="ty" title="${y} : ${n} passage${n > 1 ? 's' : ''}"><i style="height:${n ? Math.max(8, Math.round(n / max * 100)) : 0}%"></i><span>${String(y).slice(2)}</span></div>`; }).join('')}</div>
      <div class="facts" style="margin-top:6px"><span>Premier passage le ${fmtDate(a.first)}</span><span>Dernier passage le ${fmtDate(a.last)}</span></div>`;
  }

  function relatedArtistsBlock(a) {
    // artists sharing shows with this one, with extra weight when played right before/after it
    const shared = new Map(), adj = new Map();
    for (const id of a.shows) {
      const s = DB.showById.get(id);
      const tl = s.items.filter(t => t.type === 'track' && t.counted);
      const here = new Set(tl.map(t => akey(t.artist)));
      for (const k of here) if (k && k !== a.key) shared.set(k, (shared.get(k) || 0) + 1);
      tl.forEach((t, i) => {
        if (akey(t.artist) !== a.key) return;
        for (const n of [tl[i - 1], tl[i + 1]]) { const k = n && akey(n.artist); if (k && k !== a.key) adj.set(k, (adj.get(k) || 0) + 1); }
      });
    }
    const rel = [...shared.entries()].map(([k, n]) => {
      const b = DB.artists.get(k); if (!b || b.count < 2) return null;
      const nb = adj.get(k) || 0;
      return { b, n, nb, s: nb * 3 + n * n / Math.sqrt(a.shows.size * b.shows.size) * 4 + n * 0.3 };
    }).filter(Boolean).filter(x => x.n >= 2 || x.nb >= 1).sort((x, y) => y.s - x.s).slice(0, 14);
    if (!rel.length) return '';
    return `<div class="sec-head"><h2>Artistes proches</h2><span class="count">passés juste à côté ou dans les mêmes émissions</span></div>
      <div class="chips">${rel.map(x => `<a class="chip" href="#/artist/${encodeURIComponent(x.b.key)}">${esc(x.b.name)}<span>${x.nb ? `${x.nb}× juste à côté` : `${x.n} émissions`}</span></a>`).join('')}</div>`;
  }

  // ---------- episode navigation ----------
  function epEntry(season, ep) {
    const se = DB.seasons.get(season); if (!se) return null;
    return se.episodes.find(e => e.n === ep) || null;
  }
  function episodeNav(s) {
    if (!s.season || !DB.seasons.get(s.season)) return '';
    const se = DB.seasons.get(s.season);
    const i = se.episodes.findIndex(e => e.n === s.episode);
    const prevEp = se.episodes[i - 1], nextEp = se.episodes[i + 1];
    const nums = [...DB.seasons.keys()].sort((x, y) => x - y);
    const prevSe = epEntry(nums[nums.indexOf(s.season) - 1], s.episode), nextSe = epEntry(nums[nums.indexOf(s.season) + 1], s.episode);
    const code = (n, e) => `S${String(n).padStart(2, '0')}E${String(e).padStart(2, '0')}`;
    const btn = (e, n, lbl, dir, key) => e
      ? `<a class="nav-b ${dir}" href="#/show/${e.main[0].slug}" data-key="${key}"><span>${lbl}</span><b>${code(n, e.n)}</b><em>${esc(shortName(e.main[0]).slice(0, 38))}</em></a>`
      : `<span class="nav-b ${dir} off"><span>${lbl}</span><b>—</b><em>aucun</em></span>`;
    const pS = nums[nums.indexOf(s.season) - 1], nS = nums[nums.indexOf(s.season) + 1];
    return `<nav class="epnav" aria-label="Navigation entre épisodes">
      ${btn(prevEp, s.season, 'Épisode précédent', 'l', 'ArrowLeft')}
      ${btn(prevSe, pS, `Épisode ${s.episode}, saison précédente`, 'u', 'shift+ArrowLeft')}
      ${btn(nextSe, nS, `Épisode ${s.episode}, saison suivante`, 'd', 'shift+ArrowRight')}
      ${btn(nextEp, s.season, 'Épisode suivant', 'r', 'ArrowRight')}
    </nav>
    <div class="across"><span class="small">L'épisode ${s.episode} dans chaque saison :</span>${nums.map(n => { const e = epEntry(n, s.episode); return e ? `<a class="chip ${n === s.season ? 'on' : ''}" href="#/show/${e.main[0].slug}">S${n}</a>` : `<span class="chip off">S${n}</span>`; }).join('')}<a class="small" href="#/seasons?view=grid&s=${s.season}&e=${s.episode}">Voir dans la grille →</a></div>`;
  }
  addEventListener('keydown', e => {
    if (!location.hash.startsWith('#/show/') || /input|select|textarea/i.test(document.activeElement.tagName) || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const key = (e.shiftKey ? 'shift+' : '') + e.key;
    const a = document.querySelector(`.epnav a[data-key="${key}"]`);
    if (a) { e.preventDefault(); location.hash = a.getAttribute('href'); }
  });

  // ---------- season grid ----------
  function viewToggle(on) {
    return `<div class="seg" role="group" aria-label="Affichage"><a href="#/seasons" class="${on === 'cards' ? 'on' : ''}">Cartes</a><a href="#/seasons?view=grid" class="${on === 'grid' ? 'on' : ''}">Grille</a></div>`;
  }
  function viewSeasonGrid(params) {
    const list = [...DB.seasons.values()].sort((a, b) => b.n - a.n);
    const maxEp = Math.max(...list.map(se => Math.max(...se.episodes.map(e => e.n))));
    const minEp = Math.min(...list.map(se => Math.min(...se.episodes.map(e => e.n))));
    const eps = []; for (let k = minEp; k <= maxEp; k++) eps.push(k);
    const covers = params.get('mode') !== 'compact';
    const maxTr = Math.max(...list.flatMap(se => se.episodes.map(e => e.main.reduce((n, s) => n + s.nTracks, 0))));
    app.innerHTML = `
      <section class="hero"><h1>Saisons</h1><p>Tous les épisodes sur une grille : les saisons en lignes, les numéros d'épisode en colonnes. Faites glisser, défilez ou utilisez les flèches pour vous déplacer.</p>
        <div class="grid-tools">${viewToggle('grid')}
          <div class="seg" role="group" aria-label="Densité"><a href="#/seasons?view=grid" class="${covers ? 'on' : ''}">Pochettes</a><a href="#/seasons?view=grid&mode=compact" class="${covers ? '' : 'on'}">Compact</a></div>
          <div class="pan" role="group" aria-label="Se déplacer dans la grille">
            <button data-pan="left" aria-label="Épisodes précédents">←</button><button data-pan="up" aria-label="Saisons plus récentes">↑</button><button data-pan="down" aria-label="Saisons plus anciennes">↓</button><button data-pan="right" aria-label="Épisodes suivants">→</button>
          </div>
        </div>
        <div class="chips rowjump">${list.map(se => `<button class="chip" data-row="${se.n}">S${se.n}<span>${se.episodes.length}</span></button>`).join('')}</div>
      </section>
      <div class="sgrid-wrap ${covers ? '' : 'compact'}" id="sgw" tabindex="0" aria-label="Grille des saisons">
        <div class="sgrid" style="--cols:${eps.length}">
          <div class="sg-corner">S \\ E</div>
          ${eps.map(k => `<div class="sg-col">${String(k).padStart(2, '0')}</div>`).join('')}
          ${list.map(se => `<a class="sg-row" href="#/season/${se.n}" data-rowhead="${se.n}"><b>S${se.n}</b><span>${seasonYears(se)}</span></a>` + eps.map(k => {
            const e = se.episodes.find(x => x.n === k);
            if (!e) return `<div class="sg-cell empty" data-s="${se.n}" data-e="${k}"></div>`;
            const m = e.main[0], tr = e.main.reduce((n, s) => n + s.nTracks, 0);
            const extra = e.main.length - 1 + e.extra.length;
            const live = e.main.some(s => /\\blive\\b/i.test(s.name));
            return `<a class="sg-cell" href="#/show/${m.slug}" data-s="${se.n}" data-e="${k}" title="${esc(epCode(m) + ' · ' + shortName(m) + ' · ' + fmtDate(m.day) + ' · ' + tr + ' morceaux')}" style="--heat:${(tr / maxTr).toFixed(2)}">
              ${covers && m.cover ? `<img src="${esc(m.cover)}" alt="" loading="lazy" width="300" height="300" onerror="this.remove()">` : ''}
              <span class="sg-code">${se.n}${String(k).padStart(2, '0')}</span>${live ? '<span class="sg-live">LIVE</span>' : ''}${extra ? `<span class="sg-x">+${extra}</span>` : ''}
            </a>`;
          }).join('')).join('')}
        </div>
      </div>
      <p class="small">« +1 » signale une partie supplémentaire ou une version alternative. ${covers ? 'Le mode compact colore chaque épisode selon son nombre de morceaux.' : 'Plus une case est foncée, plus l\'épisode a de morceaux.'}</p>`;
    const w = document.getElementById('sgw');
    // drag to pan
    let drag = null;
    w.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') return; drag = { x: e.clientX, y: e.clientY, l: w.scrollLeft, t: w.scrollTop, moved: false }; });
    addEventListener('pointermove', e => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) { drag.moved = true; w.classList.add('dragging'); } w.scrollLeft = drag.l - dx; w.scrollTop = drag.t - dy; });
    addEventListener('pointerup', () => { if (drag) setTimeout(() => w.classList.remove('dragging'), 0); drag = drag && drag.moved ? (w.dataset.justDragged = 1, null) : null; });
    w.addEventListener('click', e => { if (w.dataset.justDragged) { e.preventDefault(); delete w.dataset.justDragged; } }, true);
    const cell = w.querySelector('.sg-cell, .sg-cell.empty');
    const stepX = () => (w.querySelector('.sg-col')?.offsetWidth || 90) * 3, stepY = () => (w.querySelector('.sg-row')?.offsetHeight || 90);
    const pan = dir => w.scrollBy({ left: dir === 'left' ? -stepX() : dir === 'right' ? stepX() : 0, top: dir === 'up' ? -stepY() : dir === 'down' ? stepY() : 0, behavior: 'smooth' });
    app.querySelectorAll('[data-pan]').forEach(b => b.onclick = () => pan(b.dataset.pan));
    w.addEventListener('keydown', e => { const m = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.key]; if (m) { e.preventDefault(); pan(m); } });
    const goRow = n => { const r = w.querySelector(`[data-rowhead="${n}"]`); if (r) w.scrollTo({ top: r.offsetTop - (w.querySelector('.sg-col')?.offsetHeight || 0), behavior: 'smooth' }); };
    app.querySelectorAll('[data-row]').forEach(b => b.onclick = () => goRow(b.dataset.row));
    // focus a given episode (from a show page)
    const fs = params.get('s'), fe = params.get('e');
    if (fs && fe) {
      const c = w.querySelector(`.sg-cell[data-s="${fs}"][data-e="${fe}"]`);
      if (c) { c.classList.add('focus'); setTimeout(() => { w.scrollTo({ left: c.offsetLeft - w.clientWidth / 2 + c.offsetWidth / 2, top: c.offsetTop - w.clientHeight / 2 + c.offsetHeight / 2 }); }, 30); }
    }
    w.focus({ preventScroll: true });
    scrollTo(0, 0);
  }

  function viewArtists(params) {
    const q0 = params.get('q') || '';
    app.innerHTML = `
      <section class="hero"><h1>Artistes</h1><p>${plural(DB.artists.size, 'artiste')}, classés par nombre de passages.</p></section>
      <div id="adisc"></div>
      <div class="sec-head"><h2>Tous les artistes</h2><span class="count">les plus passés d'abord</span></div>
      <div class="filters"><input id="aq" type="search" placeholder="Filtrer les artistes…" value="${esc(q0)}" aria-label="Filtrer les artistes"></div>
      <div id="res"></div>`;
    drawArtistDiscover(document.getElementById('adisc'));
    const aq = document.getElementById('aq'), res = document.getElementById('res');
    const all = [...DB.artists.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    let limit = 100;
    const draw = () => {
      const q = fold(aq.value.trim());
      const list = q ? all.filter(a => fold(a.name).includes(q)) : all;
      replaceParams('artists', { q: aq.value.trim() });
      res.innerHTML = list.length ? `
        <ul class="list">${list.slice(0, limit).map((a, i) => `<li><a class="row artist-row" href="#/artist/${encodeURIComponent(a.key)}">
          <div><span class="small">${q ? '' : `#${i + 1} `}</span><span class="t">${hl(a.name, q)}</span></div>
          <span class="small hide-sm">${plural(a.songs.size, 'titre')} · ${plural(a.shows.size, 'émission')}</span>
          <span class="badge ${a.count > 1 ? 'hot' : ''}">${a.count}×</span></a></li>`).join('')}</ul>
        ${list.length > limit ? `<button class="more" id="more">Afficher plus (encore ${list.length - limit})</button>` : ''}`
        : `<div class="empty"><b>Aucun artiste trouvé</b></div>`;
      const m = document.getElementById('more');
      if (m) m.onclick = () => { limit += 200; draw(); };
    };
    aq.addEventListener('input', debounce(() => { limit = 100; draw(); }, 120));
    draw();
  }

  function viewArtist(key) {
    const a = DB.artists.get(key);
    const songs = [...DB.songs.values()].filter(g => akey(g.artist) === key).sort((x, y) => y.count - x.count || x.title.localeCompare(y.title));
    if (!songs.length) return notFound('Cet artiste n\'est pas dans les archives.');
    const name = a ? a.name : songs[0].artist;
    app.innerHTML = `
      <a class="back" href="#/artists">← Tous les artistes</a>
      <div class="detail-head nocover"><div>
        <div class="eyebrow">Artiste</div><h1>${esc(name)}</h1>
        <div class="facts"><span>${plural(a ? a.count : 0, 'passage')}</span><span>${plural(songs.length, 'titre')}</span><span>${plural(a ? a.shows.size : 0, 'émission')}</span>
        <a href="#/songs?q=${encodeURIComponent(name)}">Chercher aussi les feats et remixes →</a></div>
      </div></div>
      ${a ? artistTimeline(a) : ''}
      ${a ? relatedArtistsBlock(a) : ''}
      <div class="sec-head"><h2>Titres</h2></div>
      <ul class="list">${songs.map(g => songRow(g, '')).join('')}</ul>`;
    scrollTo(0, 0);
  }

  function notFound(msg) {
    app.innerHTML = `<div class="empty"><b>Introuvable</b>${esc(msg)}<br><br><a href="#/songs">Retour à la recherche</a></div>`;
  }

  // ---------- weekly random show ----------
  // One show drawn by chance every week: weeks roll over on Friday at 00:00,
  // in step with the weekly data update. The draw is seeded, so every visitor
  // sees the same show until the next Friday, without any stored state.
  const FRIDAY_ANCHOR = Date.UTC(2026, 9, 30); // a Friday at 00:00 UTC
  const hashStr = s => { let h = 1779033703; for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; } return h >>> 0; };
  const mulberry32 = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const weekIdx = () => Math.floor((Date.now() - FRIDAY_ANCHOR) / 604800000);
  const randomPool = () => DB.shows.filter(s => s.items.length && !s.version_of && s.counted); // known tracklist, no Music Only duplicates or alternate versions
  function weeklyShow() {
    const pool = randomPool();
    const rnd = mulberry32(hashStr('fabrock-weekly-' + weekIdx()));
    return pool[Math.floor(rnd() * pool.length)];
  }
  function viewRandom(params) {
    const weekly = weeklyShow();
    const rp = params.get('reroll');
    const pick = rp ? DB.showBySlug.get(rp) || DB.legacy.get(+rp) || null : null;
    const s = pick && pick.items.length ? pick : weekly;
    const rerolled = s !== weekly;
    const ws = new Date(FRIDAY_ANCHOR + weekIdx() * 604800000);
    const next = new Date(FRIDAY_ANCHOR + (weekIdx() + 1) * 604800000);
    const dfmt = d => d.toLocaleDateString('fr', { weekday: 'long', day: 'numeric', month: 'long' });
    const head = `
      <section class="hero" style="padding-bottom:0">
        <div class="eyebrow">L'émission de la semaine</div>
        <h1>${rerolled ? 'Votre tirage perso' : 'L\'émission de la semaine'}</h1>
        <p>${rerolled ? 'Tirée au sort rien que pour vous. ' : `Tirée au sort parmi ${plural(randomPool().length, 'émission')} avec tracklist. `}Une nouvelle émission est tirée chaque vendredi à minuit : cette semaine va du ${esc(dfmt(ws))} au ${esc(dfmt(next))}.</p>
        <div class="btns" style="margin-top:16px">
          <button class="btn" id="rnd-again">🎲 Tirer une autre émission</button>
          ${rerolled ? '<a class="btn ghost" href="#/random">↩ Revenir à l\'émission de la semaine</a>' : ''}
          <a class="btn ghost" href="#/shows">Toutes les émissions →</a>
        </div>
      </section>`;
    viewShow(s.slug, params, { back: head });
    document.getElementById('rnd-again').onclick = () => {
      const pool = randomPool(); let c;
      do { c = pool[Math.floor(Math.random() * pool.length)]; } while (c.id === s.id && pool.length > 1);
      location.hash = '#/random?reroll=' + c.slug;
    };
  }

  // ---------- boot ----------
  fetch('data/shows.json', { cache: 'no-cache' })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(raw => {
      DB = build(raw);
      document.getElementById('foot').innerHTML = `Données mises à jour le ${fmtDate(raw.updated)} · ${plural(DB.shows.length, 'émission')} · Tracklists issues de Mixcloud et hearthis · <a href="show/">Liste de toutes les émissions</a>`;
      render();
    })
    .catch(e => {
      app.innerHTML = `<div class="empty"><b>Impossible de charger les données</b>data/shows.json est absent, ou la page a été ouverte sans serveur web (${esc(e.message)}).</div>`;
    });
  addEventListener('hashchange', render);
})();
