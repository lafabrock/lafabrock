(() => {
  'use strict';
  const app = document.getElementById('app');
  const root = document.documentElement;

  // ---------- theme ----------
  root.dataset.theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.getElementById('theme').addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  });

  // ---------- helpers ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = u => { try { const x = new URL(u); return x.protocol === 'https:' && /(^|\.)(mixcloud\.com|hearthis\.at|hearthis\.app)$/.test(x.hostname) ? x.href : ''; } catch { return ''; } };
  const fold = s => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const norm = s => {
    let x = fold(s);
    x = x.replace(/[([][^)\]]*[)\]]/g, ' ');
    x = x.replace(/\s(feat\.?|ft\.?|featuring)\s.*$/, ' ');
    x = x.replace(/\s-\s.*(remaster|version|edit|mix|live|explicit).*$/, ' ');
    x = x.replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/^the\s/, '');
    return x;
  };
  const fmtDate = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
  const label = t => t.artist ? `${t.artist} – ${t.title}` : t.title;
  const hl = (text, q) => {
    const s = esc(text);
    if (!q) return s;
    const f = fold(text), i = f.indexOf(q);
    if (i < 0) return s;
    return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
  };
  const plural = (n, w) => `${n.toLocaleString('en')} ${w}${n === 1 ? '' : 's'}`;
  const searchIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

  // ---------- data ----------
  let DB;
  function build(raw) {
    const shows = raw.shows;
    const showById = new Map();
    const tracks = [];
    const songs = new Map();   // key -> {key, artist, title, plays:[], count}
    const artists = new Map(); // akey -> {key, name, count, shows:Set}
    for (const s of shows) {
      showById.set(s.id, s);
      s.year = +s.date.slice(0, 4);
      s.items = s.tracks.map((t, i) => ({ type: t[0], artist: t[1], title: t[2], ts: t[3], pos: i + 1, show: s, counted: s.counted && t[4] !== 0 }));
      s.links = (s.links || (s.url ? [{ site: 'Mixcloud', url: s.url }] : [])).map(l => ({ ...l, url: safeUrl(l.url), stream: l.stream ? safeUrl(l.stream) : '' })).filter(l => l.url);
      s.cover = s.cover && /^https:\/\//.test(s.cover) ? s.cover : '';
      s.platform = s.account === 'hearthis' ? (s.version_of ? 'alternate' : 'hearthis') : 'mixcloud';
      const tl = s.items.filter(t => t.type === 'track');
      s.nTracks = tl.length;
      tl.forEach((t, i) => {
        t.prev = tl[i - 1] || null; t.next = tl[i + 1] || null;
        t.key = norm(t.artist) + '|' + norm(t.title);
        t.search = fold(t.artist + ' ' + t.title);
        let g = songs.get(t.key);
        if (!g) { g = { key: t.key, artist: t.artist, title: t.title, plays: [], count: 0 }; songs.set(t.key, g); }
        g.plays.push(t);
        if (t.counted) g.count++;
        t.song = g;
        tracks.push(t);
        const ak = norm(t.artist);
        if (ak && t.counted) {
          let a = artists.get(ak);
          if (!a) { a = { key: ak, name: t.artist, count: 0, shows: new Set(), songs: new Set() }; artists.set(ak, a); }
          a.count++; a.shows.add(s.id); a.songs.add(t.key);
        }
      });
    }
    for (const g of songs.values()) g.search = fold(g.artist + ' ' + g.title);
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
      const ak = norm(t.artist), a = artists.get(ak);
      if (!a || !t.counted) continue;
      a.first = !a.first || t.show.date < a.first ? t.show.date : a.first;
      a.last = !a.last || t.show.date > a.last ? t.show.date : a.last;
      a.years = a.years || {}; a.years[t.show.year] = (a.years[t.show.year] || 0) + 1;
    }
    return { raw, shows, showById, tracks, songs, artists, years, cats, seasons };
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
  function render() {
    if (!DB) return;
    const { parts, params } = parse();
    const [p0, p1] = parts;
    if (p0 === 'show' && p1) { setTab('shows'); return viewShow(+p1, params); }
    if (p0 === 'song' && p1) { setTab('songs'); return viewSong(p1); }
    if (p0 === 'artist' && p1) { setTab('artists'); return viewArtist(p1); }
    if (p0 === 'season' && p1) { setTab('seasons'); return viewSeason(+p1); }
    if (p0 === 'seasons') { setTab('seasons'); return viewSeasons(params); }
    if (p0 === 'songs') { setTab('songs'); return viewSongs(params); }
    if (p0 === 'shows') { setTab('shows'); return viewShows(params); }
    if (p0 === 'artists') { setTab('artists'); return viewArtists(params); }
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

  // ---------- local files (your own computer only) ----------
  // Reads a folder such as D:\LA FABROCK laid out as sNN\SSEE[_name]\ with full mixes inside
  // and SSEE_xprt\NNN - Title - Artist.mp3 for single songs. Files never leave the computer.
  const AUDIO = /\.(mp3|wav|m4a|aac|flac|ogg|aif|aiff)$/i;
  const Local = (() => {
    const eps = new Map();
    let state = 'off', root = null, nFiles = 0;
    const supported = 'showDirectoryPicker' in window || (matchMedia('(pointer: fine)').matches && 'webkitdirectory' in document.createElement('input'));
    const idb = (mode, fn) => new Promise((ok, ko) => {
      const r = indexedDB.open('lafabrock', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('h');
      r.onerror = () => ko(r.error);
      r.onsuccess = () => { try { const tx = r.result.transaction('h', mode); const q = fn(tx.objectStore('h')); tx.oncomplete = () => ok(q && q.result); tx.onerror = () => ko(tx.error); } catch (e) { ko(e); } };
    });
    const epKey = (se, ep) => se * 1000 + ep;
    function addFile(folder, sub, name, size, get) {
      const m = folder.match(/^(\d{2})(\d{2})(?:\D|$)/);
      if (!m || !AUDIO.test(name)) return;
      const k = epKey(+m[1], +m[2]);
      let e = eps.get(k); if (!e) { e = { folder, mixes: [], tracks: [] }; eps.set(k, e); }
      nFiles++;
      if (sub && /xprt/i.test(sub)) {
        const base = name.replace(AUDIO, '');
        const parts = base.split(' - ');
        const n = parseInt(parts[0], 10);
        const artist = parts.length > 2 ? parts[parts.length - 1].trim() : '';
        const title = (parts.length > 2 ? parts.slice(1, -1) : parts.slice(1)).join(' - ').trim();
        e.tracks.push({ n: isNaN(n) ? null : n, title, artist, key: norm(artist) + '|' + norm(title), nt: norm(title), name, get });
      } else if (!sub) e.mixes.push({ name, size, get });
    }
    async function walk(dir) {
      eps.clear(); nFiles = 0;
      for await (const [sn, sh] of dir.entries()) {
        if (sh.kind !== 'directory' || !/^s\d{1,2}$/i.test(sn)) continue;
        for await (const [en, eh] of sh.entries()) {
          if (eh.kind !== 'directory') continue;
          for await (const [fn, fh] of eh.entries()) {
            if (fh.kind === 'file') { const f = await fh.getFile(); addFile(en, '', fn, f.size, () => fh.getFile()); }
            else if (/xprt/i.test(fn)) for await (const [tn, th] of fh.entries()) if (th.kind === 'file') addFile(en, fn, tn, 0, () => th.getFile());
          }
        }
      }
      for (const e of eps.values()) {
        const code = e.folder.slice(0, 4);
        // main mix first: "1402.mp3", then live, then the rest by size
        e.mixes.sort((x, y) => (y.name.toLowerCase().startsWith(code + '.') - x.name.toLowerCase().startsWith(code + '.')) || (y.size - x.size));
        e.tracks.sort((x, y) => (x.n ?? 999) - (y.n ?? 999));
      }
      state = 'ready';
    }
    function fromFileList(files) {
      eps.clear(); nFiles = 0;
      for (const f of files) {
        const p = (f.webkitRelativePath || '').split('/');
        const si = p.findIndex(x => /^s\d{1,2}$/i.test(x));
        if (si < 0 || p.length < si + 3) continue;
        const folder = p[si + 1], rest = p.slice(si + 2);
        if (rest.length === 1) addFile(folder, '', rest[0], f.size, async () => f);
        else if (rest.length === 2) addFile(folder, rest[0], rest[1], f.size, async () => f);
      }
      for (const e of eps.values()) { const code = e.folder.slice(0, 4); e.mixes.sort((x, y) => (y.name.toLowerCase().startsWith(code + '.') - x.name.toLowerCase().startsWith(code + '.')) || (y.size - x.size)); e.tracks.sort((x, y) => (x.n ?? 999) - (y.n ?? 999)); }
      state = 'ready';
    }
    async function connect() {
      try {
        if ('showDirectoryPicker' in window) {
          if (root && state === 'permission') {
            if (await root.requestPermission({ mode: 'read' }) !== 'granted') return;
          } else {
            root = await window.showDirectoryPicker({ id: 'lafabrock', mode: 'read' });
            idb('readwrite', st => st.put(root, 'root')).catch(() => {});
          }
          setBtn('Reading folder…'); await walk(root);
        } else {
          const inp = document.createElement('input'); inp.type = 'file'; inp.webkitdirectory = true; inp.multiple = true;
          await new Promise(ok => { inp.onchange = ok; inp.click(); });
          if (!inp.files.length) return;
          fromFileList(inp.files);
        }
        setBtn(); render();
      } catch (e) { if (e && e.name !== 'AbortError') alert('Could not read the folder: ' + e.message); setBtn(); }
    }
    async function restore() {
      if (!('showDirectoryPicker' in window)) return;
      try {
        root = await idb('readonly', st => st.get('root'));
        if (!root) return;
        if (await root.queryPermission({ mode: 'read' }) === 'granted') { await walk(root); render(); }
        else state = 'permission';
      } catch (e) { root = null; }
      setBtn();
    }
    function setBtn(t) {
      const b = document.getElementById('localbtn'); if (!b) return;
      b.hidden = !supported;
      const lbl = b.querySelector('span');
      if (t) { lbl.textContent = t; return; }
      b.classList.toggle('on', state === 'ready');
      lbl.textContent = state === 'ready' ? 'Local files on' : state === 'permission' ? 'Reconnect local files' : 'Local files';
      b.title = state === 'ready' ? `${eps.size} episodes and ${nFiles.toLocaleString('en')} audio files found on this computer. Click to pick another folder.` : 'Play mixes and songs from your own folder (e.g. D:\\LA FABROCK). Files stay on this computer.';
    }
    const forShow = s => (state === 'ready' && s && s.season != null) ? eps.get(epKey(s.season, s.episode)) || null : null;
    function trackFile(s, t) {
      const e = forShow(s); if (!e || !e.tracks.length) return null;
      const exact = e.tracks.find(x => x.key === t.key);
      if (exact) return exact;
      const pos = s.items.filter(x => x.type === 'track').indexOf(t) + 1;
      const nt = norm(t.title);
      return e.tracks.find(x => x.nt && nt && (x.nt === nt || (x.n === pos && (x.nt.slice(0, 6) === nt.slice(0, 6))))) || null;
    }
    return { connect, restore, setBtn, forShow, trackFile, get ready() { return state === 'ready'; }, get supported() { return supported; } };
  })();
  const localSources = s => { const e = Local.forShow(s); return e ? e.mixes.map(m => ({ site: 'Local', label: m.name, get: m.get })) : []; };
  const sources = s => [...localSources(s).slice(0, 1), ...s.links.filter(l => l.site === 'Mixcloud' || (l.site === 'hearthis' && l.stream))];
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
            <div class="eyebrow">Now playing<span id="pl-now"></span></div>
            <a class="pl-name" href="#/show/${show.id}">${esc(show.name)}</a>
          </div>
          <div class="pl-src" role="group" aria-label="Source">${srcs.map(l => `<button data-src="${esc(l.site)}" class="${l.site === (src && src.site) ? 'on' : ''}" ${l.label ? `title="${esc(l.label)}"` : ''}>${l.site === 'Local' ? 'This computer' : esc(l.site)}</button>`).join('')}</div>
          <div class="pl-slot" id="pl-slot"></div>
          <button class="pl-close" aria-label="Close player" title="Close">×</button>
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
      if (audio) { audio.pause(); if (audio.dataset.blob) URL.revokeObjectURL(audio.src); audio.src = ''; audio = null; }
      widget = null;
    }
    function close() { stop(); show = src = null; bar.hidden = true; bar.innerHTML = ''; document.body.classList.remove('has-player'); markShow(); }
    function track(pos) {
      // highlight the song currently playing on the show page
      if (!show || (src && src.site === 'Song')) return;
      const rows = [...document.querySelectorAll('#app tr[data-sec]')].filter(r => r.dataset.sec !== '');
      if (!rows.length || location.hash.indexOf('#/show/' + show.id) !== 0) return;
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
      if (src.site === 'hearthis' || src.site === 'Local') {
        audio = new Audio(); audio.controls = true; audio.preload = 'auto';
        if (src.site === 'Local') {
          try { const f = await src.get(); audio.src = URL.createObjectURL(f); audio.dataset.blob = 1; msg('Playing ' + src.label + ' from this computer.'); }
          catch (e) { msg('Could not open the local file. Reconnect the folder with the Local files button.'); return; }
        } else audio.src = src.stream;
        slot.appendChild(audio);
        const go = () => { if (sec) audio.currentTime = sec; };
        audio.addEventListener('loadedmetadata', go, { once: true });
        audio.addEventListener('timeupdate', () => track(audio.currentTime));
        audio.play().catch(() => msg('Press play to start.'));
        if (src.site === 'hearthis' && show.links[0].site !== 'hearthis' && sec) msg('Timestamps come from the Mixcloud tracklist, so on hearthis they can be a few seconds off.');
      } else {
        const ifr = document.createElement('iframe');
        ifr.title = 'Mixcloud player'; ifr.allow = 'autoplay; encrypted-media'; ifr.height = 60; ifr.width = '100%'; ifr.frameBorder = 0;
        ifr.src = `https://player-widget.mixcloud.com/widget/iframe/?hide_cover=1&mini=1&autoplay=1&feed=${encodeURIComponent(feedOf(src.url))}`;
        slot.appendChild(ifr);
        msg('Loading Mixcloud…');
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
            msg('Jumping to ' + fmtTs(sec) + '…');
            for (let i = 0; i < 20; i++) { // wait until playback has actually started
              const paused = await timeout(w.getIsPaused(), 1500);
              if (paused === false) break;
              await new Promise(r => setTimeout(r, 500));
            }
            await seek(sec);
          }
        } catch (e) { msg('Mixcloud player could not load. Use the Listen on Mixcloud button instead.'); }
      }
    }
    async function seek(sec) {
      if (audio) {
        if (audio.readyState >= 1) audio.currentTime = sec; else audio.addEventListener('loadedmetadata', () => { audio.currentTime = sec; }, { once: true });
        audio.play().catch(() => msg('Press play to start.'));
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
          msg(ht ? 'Mixcloud did not allow jumping here, switching to hearthis…' : 'Mixcloud did not allow jumping to this moment. Use the progress bar in the player.');
          if (ht) setTimeout(() => open(show, sec, ht), 900);
        } else msg('');
      } catch (e) { msg('Could not jump to this moment.'); }
    }
    function markShow() { if (show) track(audio ? audio.currentTime : 0); }
    async function playFile(s, f, label) {
      // a single song from the xprt folder
      stop(); show = s; src = { site: 'Song', label };
      bar.hidden = false; document.body.classList.add('has-player');
      chrome();
      bar.querySelector('.pl-src').innerHTML = '<button class="on">Local song</button>';
      document.getElementById('pl-now').textContent = ' · ' + label;
      audio = new Audio(); audio.controls = true;
      try { audio.src = URL.createObjectURL(await f.get()); audio.dataset.blob = 1; } catch (e) { msg('Could not open the local file. Reconnect the folder with the Local files button.'); return; }
      document.getElementById('pl-slot').appendChild(audio);
      audio.play().catch(() => msg('Press play to start.'));
      msg('From ' + f.name);
    }
    return { open, seek, close, markShow, playFile };
  })();

  // ---------- views ----------
  function viewSongs(params) {
    const q0 = params.get('q') || '';
    const nShows = DB.shows.length, nTracks = DB.tracks.length, nSongs = DB.songs.size;
    app.innerHTML = `
      <section class="hero">
        <h1>Have I already played it?</h1>
        <p>Search every tracklist since 2012, see which shows a song was in and what played around it.</p>
        <div class="stats">
          <div class="stat"><b>${nShows.toLocaleString('en')}</b><span>Shows</span></div>
          <div class="stat"><b>${nTracks.toLocaleString('en')}</b><span>Tracks played</span></div>
          <div class="stat"><b>${nSongs.toLocaleString('en')}</b><span>Different songs</span></div>
          <div class="stat"><b>${DB.years[DB.years.length - 1]}–${DB.years[0]}</b><span>On air</span></div>
        </div>
        <div class="search">${searchIcon}<input id="q" type="search" placeholder="Artist or song title, e.g. Gorillaz, lady, daft…" value="${esc(q0)}" autocomplete="off" aria-label="Search songs and artists"></div>
        <p class="hint">Not case or accent sensitive. Plays in “Music Only” duplicate uploads are listed but not counted.</p>
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
        title = 'Most played songs';
        if (!res.dataset.disc) { res.insertAdjacentHTML('beforebegin', '<div id="disc"></div>'); res.dataset.disc = 1; drawSongDiscover(document.getElementById('disc')); }
        document.getElementById('disc').hidden = false;
      } else {
        const dz = document.getElementById('disc'); if (dz) dz.hidden = true;
        const words = q.split(/\s+/);
        list = [...DB.songs.values()].filter(g => words.every(w => g.search.includes(w)))
          .sort((a, b) => b.count - a.count || a.artist.localeCompare(b.artist));
        title = list.length ? `${plural(list.length, 'song')} matching “${esc(input.value.trim())}”` : '';
      }
      if (q && !list.length) {
        res.innerHTML = `<div class="empty"><b>Never played</b>Nothing in the archive matches “${esc(input.value.trim())}”.</div>`;
        return;
      }
      const shown = list.slice(0, limit);
      const qh = q.split(/\s+/)[0];
      res.innerHTML = `
        <div class="sec-head"><h2>${title}</h2>${q ? `<span class="count">${plural(list.reduce((n, g) => n + g.count, 0), 'play')}</span>` : ''}</div>
        <ul class="list">${shown.map(g => songRow(g, qh)).join('')}</ul>
        ${list.length > limit ? `<button class="more" id="more">Show more (${list.length - limit} left)</button>` : ''}`;
      const m = document.getElementById('more');
      if (m) m.onclick = () => { limit += 100; draw(); };
    };
    input.addEventListener('input', debounce(() => { limit = 60; replaceParams('songs', { q: input.value.trim() }); draw(); }, 120));
    draw();
    if (!q0) input.focus({ preventScroll: true });
  }

  function songRow(g, q) {
    const dates = g.plays.map(p => p.show.date).sort();
    const span = dates.length > 1 ? `${fmtDate(dates[0])} → ${fmtDate(dates[dates.length - 1])}` : fmtDate(dates[0]);
    return `<li><a class="row song-row" href="#/song/${encodeURIComponent(g.key)}">
      <div><div><span class="t">${hl(g.title, q)}</span> <span class="a">· ${hl(g.artist || 'Unknown artist', q)}</span></div>
      <div class="meta">${span}</div></div>
      <span class="badge ${g.count > 1 ? 'hot' : ''}" title="Times played">${g.count}×</span></a></li>`;
  }

  function bindSongLocal() {
    app.querySelectorAll('[data-lshow]').forEach(b => b.onclick = () => {
      const s = DB.showById.get(+b.dataset.lshow), t = s.items.find(x => x.pos === +b.dataset.lpos), f = Local.trackFile(s, t);
      if (f) Player.playFile(s, f, label(t));
    });
  }
  function localBlock(s) {
    const e = Local.forShow(s);
    if (!e) return Local.supported && s.season != null && !Local.ready ? `<p class="small local-hint">On your computer? Use <b>Local files</b> at the top to play this episode from your own folder.</p>` : '';
    const n = s.items.filter(t => t.type === 'track' && Local.trackFile(s, t)).length;
    return `<div class="localbox"><div><b>On this computer</b> <span class="small">folder ${esc(e.folder)} · ${plural(e.mixes.length, 'mix file')}${e.tracks.length ? ` · ${n} of ${s.nTracks} songs matched in the xprt folder` : ''}</span></div>
      <div class="btns">${e.mixes.map((m, i) => `<button class="btn ${i ? 'ghost' : ''}" data-lmix="${i}">▶ ${esc(m.name)}${m.size ? ` <span class="small">${Math.round(m.size / 1048576)} MB</span>` : ''}</button>`).join('')}</div></div>`;
  }
  function localTrackBtn(s, t) {
    const f = Local.trackFile(s, t);
    return f ? `<button class="lt" data-lpos="${t.pos}" title="Play the song file: ${esc(f.name)}">♪ file</button>` : '';
  }
  function bindLocal(s) {
    const e = Local.forShow(s); if (!e) return;
    app.querySelectorAll('[data-lmix]').forEach(b => b.onclick = () => { const m = e.mixes[+b.dataset.lmix]; Player.open(s, 0, { site: 'Local', label: m.name, get: m.get }); });
    app.querySelectorAll('.tracks [data-lpos]').forEach(b => b.onclick = () => { const t = s.items.find(x => x.pos === +b.dataset.lpos); const f = Local.trackFile(s, t); if (f) Player.playFile(s, f, label(t)); });
  }

  function viewSong(key) {
    const g = DB.songs.get(key);
    if (!g) return notFound('This song is not in the archive.');
    const plays = [...g.plays].sort((a, b) => b.show.date.localeCompare(a.show.date));
    const ak = norm(g.artist);
    app.innerHTML = `
      <a class="back" href="javascript:history.back()">← Back</a>
      <div class="detail-head nocover"><div>
        <div class="eyebrow">Song</div>
        <h1>${esc(g.title)}</h1>
        <div class="facts">
          ${g.artist ? `<a href="#/artist/${encodeURIComponent(ak)}">${esc(g.artist)}</a>` : '<span>Unknown artist</span>'}
          <span>Played ${plural(g.count, 'time')}</span>
          <span>First: ${fmtDate(plays[plays.length - 1].show.date)}</span>
          <span>Last: ${fmtDate(plays[0].show.date)}</span>
        </div></div></div>
      ${relatedSongsBlock(g)}
      <div class="sec-head"><h2>Every play</h2><span class="count">with what came before and after</span></div>
      <div class="list">${plays.map(p => `
        <div class="play">
          <div class="d">${fmtDate(p.show.date)}</div>
          <div class="n">
            <a href="#/show/${p.show.id}">${esc(p.show.name)}</a>
            <div class="small">Track ${p.show.items.filter(x => x.type === 'track').indexOf(p) + 1} of ${p.show.nTracks}${p.ts ? ` · at ${jumpable(p.show, p) ? `<a href="#/show/${p.show.id}?t=${tsSec(p.ts)}">▶ ${esc(p.ts)}</a>` : esc(p.ts)}` : ''}${p.counted ? '' : (p.show.version_of ? ' · alternate version, already counted in the original show' : ' · Music Only duplicate (not counted)')}${p.artist !== g.artist || p.title !== g.title ? ` · listed as “${esc(label(p))}”` : ''}</div>
            <div class="ctx">
              <span>Before</span>${p.prev ? `<a href="#/song/${encodeURIComponent(p.prev.key)}">${esc(label(p.prev))}</a>` : '<em class="small">Opening track</em>'}
              <span>After</span>${p.next ? `<a href="#/song/${encodeURIComponent(p.next.key)}">${esc(label(p.next))}</a>` : '<em class="small">Closing track</em>'}
            </div>
          </div>
          ${p.show.links.length || Local.trackFile(p.show, p) ? `<div class="listen-col">${Local.trackFile(p.show, p) ? `<button class="listen lt" data-lshow="${p.show.id}" data-lpos="${p.pos}">▶ Local file</button>` : ''}${p.show.links.map(l => `<a class="listen" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.site)} ↗</a>`).join('')}</div>` : '<span></span>'}
        </div>`).join('')}</div>`;
    bindSongLocal();
    scrollTo(0, 0);
  }

  function viewShows(params) {
    const st = { q: params.get('q') || '', cat: params.get('cat') || '', year: params.get('year') || '', p: params.get('p') || '' };
    app.innerHTML = `
      <section class="hero"><h1>All shows</h1><p>${plural(DB.shows.length, 'show')} from Mixcloud (lafabrock and Radio 666) and hearthis.</p></section>
      <div class="filters">
        <input id="fq" type="search" placeholder="Filter by show name or guest…" value="${esc(st.q)}" aria-label="Filter shows">
        <select id="fc" aria-label="Category"><option value="">All categories</option>${DB.cats.map(c => `<option ${c === st.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <select id="fp" aria-label="Platform"><option value="">All platforms</option><option value="mixcloud" ${st.p === 'mixcloud' ? 'selected' : ''}>Mixcloud</option><option value="hearthis-any" ${st.p === 'hearthis-any' ? 'selected' : ''}>Also on hearthis</option><option value="hearthis" ${st.p === 'hearthis' ? 'selected' : ''}>Only on hearthis</option><option value="alternate" ${st.p === 'alternate' ? 'selected' : ''}>Alternate versions</option></select>
        <select id="fy" aria-label="Year"><option value="">All years</option>${DB.years.map(y => `<option ${String(y) === st.year ? 'selected' : ''}>${y}</option>`).join('')}</select>
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
        <div class="sec-head"><h2>${plural(list.length, 'show')}</h2><span class="count">newest first</span></div>
        <ul class="list">${list.map(s => `<li><a class="row show-row" href="#/show/${s.id}">
          <span class="d">${fmtDate(s.date)}</span>
          <div><div class="n">${hl(s.name, q)}</div><div class="c">${platformTag(s)}${esc(s.category)}${s.duration ? ` · ${s.duration} min` : ''}${s.plays != null ? ` · ${s.plays.toLocaleString('en')} plays` : ''}</div></div>
          <span class="badge" title="Tracks">${s.nTracks || '—'}</span></a></li>`).join('')}</ul>`
        : `<div class="empty"><b>No show found</b>Try another filter.</div>`;
    };
    fq.addEventListener('input', debounce(draw, 120));
    fc.addEventListener('change', draw); fy.addEventListener('change', draw); fp.addEventListener('change', draw);
    draw();
  }

  function viewShow(id, params) {
    const s = DB.showById.get(id);
    if (!s) return notFound('This show is not in the archive.');
    const idx = DB.shows.indexOf(s);
    const prev = DB.shows[idx - 1], next = DB.shows[idx + 1];
    let n = 0;
    app.innerHTML = `
      <a class="back" href="#/shows">← All shows</a>
      <div class="detail-head ${s.cover ? '' : 'nocover'}">
        ${s.cover ? `<img class="cover" src="${esc(s.cover)}" alt="" width="160" height="160" loading="lazy" onerror="this.remove();this.parentElement&&this.parentElement.classList.add('nocover')">` : ''}
        <div>
          <div class="eyebrow">${esc(s.category)}${s.season ? ` · Season ${s.season}, episode ${s.episode}` : ''}</div>
          <h1>${esc(s.name)}</h1>
          <div class="facts">
            <span>${fmtDate(s.date)}</span>
            ${s.duration ? `<span>${s.duration} min</span>` : ''}
            <span>${plural(s.nTracks, 'track')}</span>
            ${s.plays != null ? `<span>${s.plays.toLocaleString('en')} plays${s.account === 'hearthis' ? ' on hearthis' : ' on Mixcloud'}${s.favorites != null ? ` · ${s.favorites} favorites` : ''}</span>` : ''}
            ${s.links.filter(l => l.site === 'hearthis' && s.account !== 'hearthis').map(l => `<span>${(l.plays || 0).toLocaleString('en')} plays on hearthis</span>`).join('')}
            <span>Tracklist: ${esc(s.source)}</span>
          </div>
          <div class="btns">${s.links.map((l, i) => `<a class="btn ${i ? 'ghost' : ''}" href="${esc(l.url)}" target="_blank" rel="noopener">Listen on ${esc(l.site)} ↗</a>`).join('')}</div>
        </div>
      </div>
      ${episodeNav(s)}
      ${versionBlock(s)}
      ${s.description ? `<div class="desc">${esc(s.description)}</div>` : ''}
      ${s.tags.length ? `<div class="tags">${s.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
      ${commentsBlock(s)}
      ${localBlock(s)}
      ${playable(s) ? `<div class="listen-here"><button class="btn" data-play="0">▶ Play this show here</button>${hasTs(s) ? `<span class="small">Click a song to jump straight to it in the mix.</span>` : `<span class="small">No timestamps in this tracklist, so songs can't be jumped to.</span>`}</div>` : ''}
      <div class="sec-head"><h2>Tracklist</h2><span class="count">× = times this song was played across all shows</span></div>
      ${s.items.length ? `<table class="tracks"><thead><tr><th>#</th><th class="time">Time</th><th>Song</th><th class="r">Plays</th></tr></thead><tbody>
        ${s.items.map(t => t.type === 'track'
          ? `<tr data-sec="${tsSec(t.ts) ?? ''}"><td class="num">${++n}</td><td class="time">${jumpable(s, t) ? `<button class="jump" data-play="${tsSec(t.ts)}" aria-label="Play from ${esc(t.ts)}">▶ ${esc(t.ts)}</button>` : esc(t.ts)}</td>
              <td>${jumpable(s, t) ? `<button class="songjump" data-play="${tsSec(t.ts)}" title="Play from ${esc(t.ts)}">` : `<a href="#/song/${encodeURIComponent(t.key)}">`}<span class="tt">${esc(t.title)}</span><br><span class="ta">${esc(t.artist)}</span>${jumpable(s, t) ? '</button>' : '</a>'}</td>
              <td class="r">${localTrackBtn(s, t)}<a class="badge ${t.song.count > 1 ? 'hot' : ''}" href="#/song/${encodeURIComponent(t.key)}" title="${t.counted ? 'Times played: see every play' : 'Already counted in the original show'}">${t.song.count}×</a></td></tr>`
          : `<tr class="seg" data-sec="${tsSec(t.ts) ?? ''}"><td class="num"></td><td class="time">${jumpable(s, t) ? `<button class="jump" data-play="${tsSec(t.ts)}">▶ ${esc(t.ts)}</button>` : esc(t.ts)}</td><td colspan="2">${esc(t.title)}</td></tr>`).join('')}
        </tbody></table>` : `<div class="empty"><b>No tracklist</b>${s.version_of ? 'This version has no tracklist of its own. See the original show above.' : 'Add it to data/manual_shows.json and run the update script.'}</div>`}
      <div class="sec-head">
        ${prev ? `<a class="back" href="#/show/${prev.id}">← ${esc(prev.name.slice(0, 48))}</a>` : '<span></span>'}
        ${next ? `<a class="back" href="#/show/${next.id}">${esc(next.name.slice(0, 48))} →</a>` : ''}
      </div>`;
    app.querySelectorAll('[data-play]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); Player.open(s, +b.dataset.play || 0); }));
    bindLocal(s);
    Player.markShow();
    const tp = params && params.get('t'); const t0 = tp && /^\d+$/.test(tp) ? +tp : tsSec(tp || '');
    if (t0 != null && playable(s)) {
      const row = [...app.querySelectorAll('tr[data-sec]')].find(r => r.dataset.sec === String(t0));
      if (row) { row.classList.add('cued'); setTimeout(() => row.scrollIntoView({ block: 'center' }), 50); }
      const lh = app.querySelector('.listen-here');
      if (lh) lh.insertAdjacentHTML('afterbegin', `<button class="btn" data-cue>▶ Play from ${fmtTs(t0)}</button>`);
      app.querySelector('[data-cue]')?.addEventListener('click', () => Player.open(s, t0));
      app.querySelector('[data-play="0"]')?.classList.add('ghost');
    } else scrollTo(0, 0);
  }

  function platformTag(s) {
    if (s.platform === 'alternate') return '<span class="ptag alt">Alt. version</span>';
    if (s.platform === 'hearthis') return '<span class="ptag ht">hearthis only</span>';
    return s.links.some(l => l.site === 'hearthis') ? '<span class="ptag">+ hearthis</span>' : '';
  }
  function versionBlock(s) {
    const orig = (s.version_of || []).map(id => DB.showById.get(id)).filter(Boolean);
    const alts = (s.versions || []).map(id => DB.showById.get(id)).filter(Boolean);
    if (!orig.length && !alts.length) return '';
    let h = '<div class="version">';
    if (orig.length) h += `<div><b>Alternate version.</b> ${esc(s.version_note || '')}</div><div class="small">Original: ${orig.map(o => `<a href="#/show/${o.id}">${esc(o.name)}</a>`).join(' + ')}. Songs also in the original are not counted twice.</div>`;
    if (alts.length) h += `<div><b>Other version${alts.length > 1 ? 's' : ''} on hearthis:</b> ${alts.map(o => `<a href="#/show/${o.id}">${esc(o.name)}</a> <span class="small">(${esc(o.version_note || '')})</span>`).join(' · ')}</div>`;
    return h + '</div>';
  }
  function commentsBlock(s) {
    const cs = s.links.flatMap(l => (l.comments || []).map(c => ({ ...c, site: l.site })));
    if (!cs.length) return '';
    return `<div class="sec-head"><h2>Comments on hearthis</h2><span class="count">${cs.length}</span></div><ul class="comments">${cs.map(c => `<li><b>${esc(c.user)}</b> ${esc(c.text)}</li>`).join('')}</ul>`;
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
    return `<a class="card" href="#/show/${s.id}">
      ${s.cover ? `<img src="${esc(s.cover)}" alt="" loading="lazy" width="300" height="300" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ph'}))">` : '<div class="ph"></div>'}
      <div class="card-b">
        <div class="eyebrow">${epCode(s) || esc(s.category)}</div>
        <div class="card-t">${esc(shortName(s))}</div>
        <div class="small">${fmtDate(s.date)} · ${plural(s.nTracks, 'track')}</div>
        <div class="card-p">${s.links.map(l => `<span class="ptag ${l.site === 'hearthis' ? 'ht' : ''}">${esc(l.site)}</span>`).join('')}</div>
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
          <div class="eyebrow">Latest show · ${fmtDate(latest.date)}</div>
          <h1>${esc(shortName(latest))}</h1>
          <div class="facts">${latest.season ? `<a href="#/season/${latest.season}">Season ${latest.season}, episode ${latest.episode}</a>` : `<span>${esc(latest.category)}</span>`}${latest.duration ? `<span>${latest.duration} min</span>` : ''}<span>${plural(latest.nTracks, 'track')}</span></div>
          ${desc ? `<div class="feature-desc">${esc(desc)}</div>` : ''}
          <div class="btns">${latest.links.map((l, i) => `<a class="btn ${i ? 'ghost' : ''}" href="${esc(l.url)}" target="_blank" rel="noopener">Listen on ${esc(l.site)} ↗</a>`).join('')}<a class="btn ghost" href="#/show/${latest.id}">Full tracklist</a></div>
        </div>
        ${tl.length ? `<ol class="feature-tl">${tl.slice(0, 8).map(t => `<li><a href="#/song/${encodeURIComponent(t.key)}"><span class="tt">${esc(t.title)}</span> <span class="ta">${esc(t.artist)}</span></a></li>`).join('')}${tl.length > 8 ? `<li class="more-li"><a href="#/show/${latest.id}">+ ${tl.length - 8} more</a></li>` : ''}</ol>` : ''}
      </section>

      <form class="search home-search" id="hs">${searchIcon}<input id="hq" type="search" placeholder="Have I already played it? Search a song or artist…" aria-label="Search songs"></form>

      <div class="sec-head"><h2>Latest shows</h2><a class="count" href="#/shows">All ${DB.shows.length} shows →</a></div>
      <div class="cards">${recent.map(showCard).join('')}</div>

      <div class="sec-head"><h2>Seasons</h2><a class="count" href="#/seasons">Overview →</a></div>
      <div class="season-strip">${seasonsList.map(se => `<a href="#/season/${se.n}" class="chip"><b>S${se.n}</b><span>${se.episodes.length} ep.</span></a>`).join('')}</div>`;
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
      <section class="hero"><h1>Seasons</h1><p>${list.length} seasons and ${totalEps} episodes on Radio 666, from ${list[list.length - 1].first.slice(0, 4)} to today. Parts and alternate versions are grouped under their episode.</p>
        ${viewToggle('cards')}</section>
      <div class="seasons">${list.map(se => {
        const latest = se.episodes[se.episodes.length - 1];
        return `<a class="season" href="#/season/${se.n}">
          <div class="season-n"><span>Season</span><b>${se.n}</b></div>
          <div class="season-b">
            <div class="season-y">${seasonYears(se)}</div>
            <div class="season-c"><b>${se.episodes.length}</b> episode${se.episodes.length === 1 ? '' : 's'}${se.live ? ` · ${se.live} live` : ''} · ${se.tracks.toLocaleString('en')} tracks</div>
            <div class="bar"><i style="width:${Math.round(se.episodes.length / max * 100)}%"></i></div>
            <div class="small season-last">Latest: ${esc(shortName(latest.main[0]))}</div>
          </div></a>`;
      }).join('')}</div>`;
    scrollTo(0, 0);
  }
  function viewSeason(n) {
    const se = DB.seasons.get(n);
    if (!se) return notFound('This season is not in the archive.');
    const nums = [...DB.seasons.keys()].sort((a, b) => a - b);
    const i = nums.indexOf(n), prev = nums[i - 1], next = nums[i + 1];
    const missing = [];
    const maxEp = Math.max(...se.episodes.map(e => e.n));
    const have = new Set(se.episodes.map(e => e.n));
    for (let k = 1; k <= maxEp; k++) if (!have.has(k)) missing.push(k);
    app.innerHTML = `
      <a class="back" href="#/seasons">← All seasons</a>
      <div class="detail-head nocover"><div>
        <div class="eyebrow">Season ${n} · ${seasonYears(se)}</div>
        <h1>Season ${n}</h1>
        <div class="facts"><span>${plural(se.episodes.length, 'episode')}</span>${se.live ? `<span>${se.live} live</span>` : ''}<span>${se.tracks.toLocaleString('en')} tracks</span><span>${fmtDate(se.first)} → ${fmtDate(se.last)}</span></div>
        ${missing.length ? `<p class="small">Not in the archive: episode${missing.length > 1 ? 's' : ''} ${missing.join(', ')}.</p>` : ''}
      </div></div>
      <ul class="list">${se.episodes.map(e => {
        const m = e.main[0];
        const allTracks = e.main.reduce((k, s) => k + s.nTracks, 0);
        const others = [...e.main.slice(1), ...e.extra];
        return `<li class="ep">
          <a class="ep-n" href="#/show/${m.id}">${String(e.n).padStart(2, '0')}</a>
          <div class="ep-b">
            <a class="ep-t" href="#/show/${m.id}">${esc(shortName(m))}</a>
            <div class="small">${fmtDate(m.date)}${m.duration ? ` · ${e.main.reduce((k, s) => k + (s.duration || 0), 0)} min` : ''} · ${plural(allTracks, 'track')}${e.main.length > 1 ? ` · ${e.main.length} parts` : ''}</div>
            ${others.length ? `<div class="ep-v">${others.map(s => `<a href="#/show/${s.id}">${s.version_of ? 'Alt. version' : s.counted ? 'Part' : 'Music Only'}: ${esc(shortName(s).slice(0, 50))}</a>`).join('')}</div>` : ''}
          </div>
          <div class="ep-l">${[...new Map(e.main.flatMap(s => s.links).map(l => [l.site, l])).values()].map(l => `<span class="ptag ${l.site === 'hearthis' ? 'ht' : ''}">${esc(l.site)}</span>`).join('')}</div>
        </li>`;
      }).join('')}</ul>
      <div class="sec-head">
        ${prev ? `<a class="back" href="#/season/${prev}">← Season ${prev}</a>` : '<span></span>'}
        ${next ? `<a class="back" href="#/season/${next}">Season ${next} →</a>` : ''}
      </div>`;
    scrollTo(0, 0);
  }


  // ---------- shared helpers for discovery ----------
  const sample = (arr, n) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); };
  const yearsAgo = d => Math.floor((Date.now() - new Date(d)) / 31557600000);
  const mainShows = () => DB.shows.filter(s => !s.version_of && s.counted).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const songLink = g => `<a href="#/song/${encodeURIComponent(g.key)}"><span class="tt">${esc(g.title)}</span> <span class="ta">${esc(g.artist || '')}</span></a>`;
  const artistLink = a => `<a href="#/artist/${encodeURIComponent(a.key)}">${esc(a.name)}</a>`;
  const shuffleBtn = id => `<button class="shuffle" data-shuffle="${id}" aria-label="Shuffle">↻ Shuffle</button>`;
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
          <a class="pick" href="#/song/${encodeURIComponent(g.key)}"><span class="pick-t">${esc(g.title)}</span><span class="pick-a">${esc(g.artist || 'Unknown artist')}</span></a>
          <div class="facts"><span>Played ${plural(g.count, 'time')}</span><span>First in ${esc(shortName(firstPlay.show).slice(0, 60))}</span><span>${fmtDate(g.first)}</span></div>`;
      }
      if (!which || which === 'once') {
        el.querySelector('#p-once').innerHTML = `<ol class="mini">${sample(once, 7).map(g => `<li>${songLink(g)}<span class="small">${g.first.slice(0, 4)}</span></li>`).join('')}</ol>`;
      }
    };
    el.innerHTML = `<div class="discover">
      ${panel('Random pick', 'A song from the archive, picked by chance', '<div id="p-rand"></div>', shuffleBtn('rand'))}
      ${panel('Recently played', `From the last ${recentShows.length} shows`, `<ol class="mini">${recent.slice(0, 7).map(r => `<li>${songLink(r.g)}<a class="small" href="#/show/${r.s.id}">${epCode(r.s) || fmtDate(r.s.date)}</a></li>`).join('')}</ol>`)}
      ${panel('Played only once', `${once.length.toLocaleString('en')} songs played a single time, at least 3 years ago`, '<div id="p-once"></div>', shuffleBtn('once'))}
      ${panel('Longest wait between two plays', 'Songs that came back after years', `<ol class="mini">${gaps.slice(0, 7).map(g => `<li>${songLink(g)}<span class="small">${Math.round(g.gap / 365.25)} yrs</span></li>`).join('')}</ol>`)}
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
    for (const s of recentShows) for (const t of s.items) { if (t.type !== 'track') continue; const a = DB.artists.get(norm(t.artist)); if (a && !seen.has(a.key)) { seen.add(a.key); recent.push(a); } }
    const render = which => {
      if (!which || which === 'arand') {
        const a = sample(multi, 1)[0];
        const top = [...DB.songs.values()].filter(g => norm(g.artist) === a.key).sort((x, y) => y.count - x.count)[0];
        el.querySelector('#p-arand').innerHTML = `
          <a class="pick" href="#/artist/${encodeURIComponent(a.key)}"><span class="pick-t">${esc(a.name)}</span><span class="pick-a">${top ? 'Most played: ' + esc(top.title) : ''}</span></a>
          <div class="facts"><span>${plural(a.count, 'play')}</span><span>${plural(a.songs.size, 'song')}</span><span>${a.first.slice(0, 4)}–${a.last.slice(0, 4)}</span></div>`;
      }
      if (!which || which === 'aonce') {
        el.querySelector('#p-aonce').innerHTML = `<div class="chips">${sample(once, 14).map(a => `<a class="chip" href="#/artist/${encodeURIComponent(a.key)}">${esc(a.name)}</a>`).join('')}</div>`;
      }
    };
    el.innerHTML = `<div class="discover">
      ${panel('Random pick', 'An artist you played at least 3 times', '<div id="p-arand"></div>', shuffleBtn('arand'))}
      ${panel('Recently played', `Artists from the last ${recentShows.length} shows`, `<div class="chips">${recent.slice(0, 18).map(a => `<a class="chip" href="#/artist/${encodeURIComponent(a.key)}">${esc(a.name)}<span>${a.count}×</span></a>`).join('')}</div>`)}
      ${panel('Due a comeback', 'Played 4+ times, but not for a long while', `<ol class="mini">${comeback.map(a => `<li>${artistLink(a)}<span class="small">last ${a.last.slice(0, 4)} · ${a.count}×</span></li>`).join('')}</ol>`)}
      ${panel('Played just once', `${once.length.toLocaleString('en')} artists with a single play`, '<div id="p-aonce"></div>', shuffleBtn('aonce'))}
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
    const ak = norm(g.artist);
    const same = [...DB.songs.values()].filter(x => x.key !== g.key && ak && norm(x.artist) === ak).sort((a, b) => b.count - a.count).slice(0, 6);
    if (!rel.length && !same.length) return '';
    return `<div class="discover two">
      ${rel.length ? panel('Often played with', 'Songs from the same shows, closest in the running order first', `<ol class="mini">${rel.map(r => `<li>${songLink(r.g)}<span class="small">${r.shows.size > 1 ? `${r.shows.size} shows` : r.next ? 'next to it' : 'same show'}</span></li>`).join('')}</ol>`) : ''}
      ${same.length ? panel(`More from ${esc(g.artist)}`, '', `<ol class="mini">${same.map(x => `<li>${songLink(x)}<span class="small">${x.count}×</span></li>`).join('')}</ol>`) : ''}
    </div>`;
  }

  function artistTimeline(a) {
    const ys = DB.years.slice().sort();
    const max = Math.max(...Object.values(a.years || { 0: 1 }));
    return `<div class="timeline" aria-label="Plays per year">${ys.map(y => { const n = (a.years || {})[y] || 0; return `<div class="ty" title="${y}: ${n} play${n === 1 ? '' : 's'}"><i style="height:${n ? Math.max(8, Math.round(n / max * 100)) : 0}%"></i><span>${String(y).slice(2)}</span></div>`; }).join('')}</div>
      <div class="facts" style="margin-top:6px"><span>First played ${fmtDate(a.first)}</span><span>Last played ${fmtDate(a.last)}</span></div>`;
  }

  function relatedArtistsBlock(a) {
    // artists sharing shows with this one, with extra weight when played right before/after it
    const shared = new Map(), adj = new Map();
    for (const id of a.shows) {
      const s = DB.showById.get(id);
      const tl = s.items.filter(t => t.type === 'track' && t.counted);
      const here = new Set(tl.map(t => norm(t.artist)));
      for (const k of here) if (k && k !== a.key) shared.set(k, (shared.get(k) || 0) + 1);
      tl.forEach((t, i) => {
        if (norm(t.artist) !== a.key) return;
        for (const n of [tl[i - 1], tl[i + 1]]) { const k = n && norm(n.artist); if (k && k !== a.key) adj.set(k, (adj.get(k) || 0) + 1); }
      });
    }
    const rel = [...shared.entries()].map(([k, n]) => {
      const b = DB.artists.get(k); if (!b || b.count < 2) return null;
      const nb = adj.get(k) || 0;
      return { b, n, nb, s: nb * 3 + n * n / Math.sqrt(a.shows.size * b.shows.size) * 4 + n * 0.3 };
    }).filter(Boolean).filter(x => x.n >= 2 || x.nb >= 1).sort((x, y) => y.s - x.s).slice(0, 14);
    if (!rel.length) return '';
    return `<div class="sec-head"><h2>Related artists</h2><span class="count">played next to or in the same shows</span></div>
      <div class="chips">${rel.map(x => `<a class="chip" href="#/artist/${encodeURIComponent(x.b.key)}">${esc(x.b.name)}<span>${x.nb ? `${x.nb}× next to` : `${x.n} shows`}</span></a>`).join('')}</div>`;
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
      ? `<a class="nav-b ${dir}" href="#/show/${e.main[0].id}" data-key="${key}"><span>${lbl}</span><b>${code(n, e.n)}</b><em>${esc(shortName(e.main[0]).slice(0, 38))}</em></a>`
      : `<span class="nav-b ${dir} off"><span>${lbl}</span><b>—</b><em>none</em></span>`;
    const pS = nums[nums.indexOf(s.season) - 1], nS = nums[nums.indexOf(s.season) + 1];
    return `<nav class="epnav" aria-label="Episode navigation">
      ${btn(prevEp, s.season, 'Previous episode', 'l', 'ArrowLeft')}
      ${btn(prevSe, pS, `Episode ${s.episode}, previous season`, 'u', 'shift+ArrowLeft')}
      ${btn(nextSe, nS, `Episode ${s.episode}, next season`, 'd', 'shift+ArrowRight')}
      ${btn(nextEp, s.season, 'Next episode', 'r', 'ArrowRight')}
    </nav>
    <div class="across"><span class="small">Episode ${s.episode} in every season:</span>${nums.map(n => { const e = epEntry(n, s.episode); return e ? `<a class="chip ${n === s.season ? 'on' : ''}" href="#/show/${e.main[0].id}">S${n}</a>` : `<span class="chip off">S${n}</span>`; }).join('')}<a class="small" href="#/seasons?view=grid&s=${s.season}&e=${s.episode}">Open in grid →</a></div>`;
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
    return `<div class="seg" role="group" aria-label="View"><a href="#/seasons" class="${on === 'cards' ? 'on' : ''}">Cards</a><a href="#/seasons?view=grid" class="${on === 'grid' ? 'on' : ''}">Grid</a></div>`;
  }
  function viewSeasonGrid(params) {
    const list = [...DB.seasons.values()].sort((a, b) => b.n - a.n);
    const maxEp = Math.max(...list.map(se => Math.max(...se.episodes.map(e => e.n))));
    const minEp = Math.min(...list.map(se => Math.min(...se.episodes.map(e => e.n))));
    const eps = []; for (let k = minEp; k <= maxEp; k++) eps.push(k);
    const covers = params.get('mode') !== 'compact';
    const maxTr = Math.max(...list.flatMap(se => se.episodes.map(e => e.main.reduce((n, s) => n + s.nTracks, 0))));
    app.innerHTML = `
      <section class="hero"><h1>Seasons</h1><p>Every episode on one grid: seasons are rows, episode numbers are columns. Drag, scroll or use the arrows to move around.</p>
        <div class="grid-tools">${viewToggle('grid')}
          <div class="seg" role="group" aria-label="Density"><a href="#/seasons?view=grid" class="${covers ? 'on' : ''}">Covers</a><a href="#/seasons?view=grid&mode=compact" class="${covers ? '' : 'on'}">Compact</a></div>
          <div class="pan" role="group" aria-label="Move around the grid">
            <button data-pan="left" aria-label="Previous episodes">←</button><button data-pan="up" aria-label="Newer seasons">↑</button><button data-pan="down" aria-label="Older seasons">↓</button><button data-pan="right" aria-label="Next episodes">→</button>
          </div>
        </div>
        <div class="chips rowjump">${list.map(se => `<button class="chip" data-row="${se.n}">S${se.n}<span>${se.episodes.length}</span></button>`).join('')}</div>
      </section>
      <div class="sgrid-wrap ${covers ? '' : 'compact'}" id="sgw" tabindex="0" aria-label="Season grid">
        <div class="sgrid" style="--cols:${eps.length}">
          <div class="sg-corner">S \\ E</div>
          ${eps.map(k => `<div class="sg-col">${String(k).padStart(2, '0')}</div>`).join('')}
          ${list.map(se => `<a class="sg-row" href="#/season/${se.n}" data-rowhead="${se.n}"><b>S${se.n}</b><span>${seasonYears(se)}</span></a>` + eps.map(k => {
            const e = se.episodes.find(x => x.n === k);
            if (!e) return `<div class="sg-cell empty" data-s="${se.n}" data-e="${k}"></div>`;
            const m = e.main[0], tr = e.main.reduce((n, s) => n + s.nTracks, 0);
            const extra = e.main.length - 1 + e.extra.length;
            const live = e.main.some(s => /\\blive\\b/i.test(s.name));
            return `<a class="sg-cell" href="#/show/${m.id}" data-s="${se.n}" data-e="${k}" title="${esc(epCode(m) + ' · ' + shortName(m) + ' · ' + fmtDate(m.date) + ' · ' + tr + ' tracks')}" style="--heat:${(tr / maxTr).toFixed(2)}">
              ${covers && m.cover ? `<img src="${esc(m.cover)}" alt="" loading="lazy" width="300" height="300" onerror="this.remove()">` : ''}
              <span class="sg-code">${se.n}${String(k).padStart(2, '0')}</span>${live ? '<span class="sg-live">LIVE</span>' : ''}${extra ? `<span class="sg-x">+${extra}</span>` : ''}
            </a>`;
          }).join('')).join('')}
        </div>
      </div>
      <p class="small">“+1” marks an extra part or alternate version. ${covers ? 'Compact mode shades each episode by its number of tracks.' : 'Darker cells have more tracks.'}</p>`;
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
      <section class="hero"><h1>Artists</h1><p>${plural(DB.artists.size, 'artist')}, ranked by number of plays.</p></section>
      <div id="adisc"></div>
      <div class="sec-head"><h2>All artists</h2><span class="count">most played first</span></div>
      <div class="filters"><input id="aq" type="search" placeholder="Filter artists…" value="${esc(q0)}" aria-label="Filter artists"></div>
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
          <span class="small hide-sm">${plural(a.songs.size, 'song')} · ${plural(a.shows.size, 'show')}</span>
          <span class="badge ${a.count > 1 ? 'hot' : ''}">${a.count}×</span></a></li>`).join('')}</ul>
        ${list.length > limit ? `<button class="more" id="more">Show more (${list.length - limit} left)</button>` : ''}`
        : `<div class="empty"><b>No artist found</b></div>`;
      const m = document.getElementById('more');
      if (m) m.onclick = () => { limit += 200; draw(); };
    };
    aq.addEventListener('input', debounce(() => { limit = 100; draw(); }, 120));
    draw();
  }

  function viewArtist(key) {
    const a = DB.artists.get(key);
    const songs = [...DB.songs.values()].filter(g => norm(g.artist) === key).sort((x, y) => y.count - x.count || x.title.localeCompare(y.title));
    if (!songs.length) return notFound('This artist is not in the archive.');
    const name = a ? a.name : songs[0].artist;
    app.innerHTML = `
      <a class="back" href="#/artists">← All artists</a>
      <div class="detail-head nocover"><div>
        <div class="eyebrow">Artist</div><h1>${esc(name)}</h1>
        <div class="facts"><span>${plural(a ? a.count : 0, 'play')}</span><span>${plural(songs.length, 'song')}</span><span>${plural(a ? a.shows.size : 0, 'show')}</span>
        <a href="#/songs?q=${encodeURIComponent(name)}">Search features and remixes too →</a></div>
      </div></div>
      ${a ? artistTimeline(a) : ''}
      ${a ? relatedArtistsBlock(a) : ''}
      <div class="sec-head"><h2>Songs</h2></div>
      <ul class="list">${songs.map(g => songRow(g, '')).join('')}</ul>`;
    scrollTo(0, 0);
  }

  function notFound(msg) {
    app.innerHTML = `<div class="empty"><b>Not found</b>${esc(msg)}<br><br><a href="#/songs">Back to search</a></div>`;
  }

  // ---------- boot ----------
  fetch('data/shows.json', { cache: 'no-cache' })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(raw => {
      DB = build(raw);
      Local.setBtn(); Local.restore();
      document.getElementById('localbtn').onclick = () => Local.connect();
      document.getElementById('foot').innerHTML = `Data updated ${fmtDate(raw.updated)} · ${plural(DB.shows.length, 'show')} · Tracklists from Mixcloud and hearthis. Private archive.`;
      render();
    })
    .catch(e => {
      app.innerHTML = `<div class="empty"><b>Could not load the data</b>data/shows.json is missing or the page was opened without a web server (${esc(e.message)}).</div>`;
    });
  addEventListener('hashchange', render);
})();
