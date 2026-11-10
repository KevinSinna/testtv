// ==UserScript==
// @name         TamilGun - Style Netflix (grille + fiche film)
// @namespace    local.netflix.style
// @version      4.1
// @description  Grille + fiche film; Lecture ouvre le lecteur en plein écran
// @match        https://tamilgun.now/*
// @run-at       document-idle
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @connect      timesofindia.indiatimes.com
// ==/UserScript==

// ================= PARTIE 1 : GRILLE (pages de liste) =================

(function () {
  'use strict';

  const FAV_KEY = 'tgn_favs';
  const ON_KEY = 'tgn_on';
  const MIN_ITEMS = 6; // nombre minimum de films pour activer la vue grille

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  let favs = store.get(FAV_KEY, {});
  let enabled = store.get(ON_KEY, true);
  let query = '';
  let onlyFavs = false;
  let sortAZ = false;
  let items = [];

  // ---------- Styles ----------
  const css = `
  #tgn-root{position:fixed;inset:0;z-index:2147483000;background:#141414;color:#fff;
    font-family:-apple-system,Helvetica,Arial,sans-serif;overflow-y:auto;-webkit-overflow-scrolling:touch;
    padding-top:env(safe-area-inset-top);}
  #tgn-root.tgn-hidden{display:none}
  #tgn-bar{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;gap:8px;align-items:center;
    padding:10px 12px;background:linear-gradient(#000e,#000a);backdrop-filter:blur(8px)}
  #tgn-logo{color:#e50914;font-weight:800;font-size:20px;letter-spacing:1px;margin-right:4px}
  #tgn-search{flex:1;min-width:140px;padding:9px 12px;border-radius:6px;border:1px solid #444;
    background:#222;color:#fff;font-size:16px;outline:none}
  .tgn-btn{padding:8px 12px;border-radius:6px;border:1px solid #555;background:#222;color:#fff;font-size:14px}
  .tgn-btn.on{background:#e50914;border-color:#e50914}
  #tgn-count{font-size:12px;color:#aaa;padding:4px 14px}
  #tgn-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;padding:10px 12px 90px}
  @media(min-width:700px){#tgn-grid{grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:14px}}
  .tgn-card{position:relative;border-radius:6px;overflow:hidden;background:#222;display:block;
    color:#fff;text-decoration:none;transition:transform .2s,box-shadow .2s}
  .tgn-card:hover{transform:scale(1.06);z-index:1;box-shadow:0 8px 24px #000c}
  .tgn-card img{display:block;width:100%;aspect-ratio:2/3;object-fit:cover;background:#333}
  .tgn-title{position:absolute;left:0;right:0;bottom:0;padding:26px 8px 8px;font-size:12px;line-height:1.25;
    background:linear-gradient(transparent,#000d);display:-webkit-box;-webkit-line-clamp:3;
    -webkit-box-orient:vertical;overflow:hidden}
  .tgn-fav{position:absolute;top:6px;right:6px;width:32px;height:32px;border-radius:50%;border:none;
    background:#000a;color:#fff;font-size:17px;line-height:32px;text-align:center;padding:0}
  .tgn-fav.on{color:#e50914}
  #tgn-toggle{position:fixed;right:14px;bottom:calc(14px + env(safe-area-inset-bottom));z-index:2147483001;
    width:48px;height:48px;border-radius:50%;border:none;background:#e50914;color:#fff;font-size:22px;
    box-shadow:0 4px 14px #0008}
  .tgn-empty{padding:40px 16px;color:#aaa;text-align:center;grid-column:1/-1}
  #tgn-pages{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;align-items:center;
    padding:6px 12px calc(90px + env(safe-area-inset-bottom))}
  #tgn-pages:empty{display:none}
  #tgn-pages a,#tgn-pages span{min-width:40px;padding:10px 12px;border-radius:6px;border:1px solid #555;
    background:#222;color:#fff;font-size:15px;text-align:center;text-decoration:none;box-sizing:border-box}
  #tgn-pages .cur{background:#e50914;border-color:#e50914;font-weight:700}
  #tgn-pages .dots{border:none;background:none;min-width:0;padding:10px 2px;color:#aaa}
  #tgn-prev,#tgn-next{text-decoration:none;font-size:18px;line-height:1}
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // ---------- Extraction des films ----------
  function collect() {
    const map = new Map();
    document.querySelectorAll('a[href] img').forEach(img => {
      if (img.closest('#tgn-root')) return;
      if (img.closest('header, nav, footer')) return;
      const a = img.closest('a');
      if (!a) return;

      let url;
      try { url = new URL(a.href, location.href); } catch (e) { return; }
      if (url.origin !== location.origin) return;
      if (url.pathname === '/' || url.href === location.href) return;

      const src = img.dataset.src || img.dataset.lazySrc || img.dataset.original ||
                  img.currentSrc || img.src;
      if (!src || src.startsWith('data:')) return;
      if (/logo|banner|avatar|icon|sprite/i.test(src)) return;

      const box = a.closest('article, li, .post, .item, .movie, .thumb') || a.parentElement;
      const heading = box && box.querySelector('h1,h2,h3,h4,h5,.title');
      const title = (img.alt || a.title || (heading && heading.textContent) || a.textContent || '')
        .replace(/\s+/g, ' ').trim() || url.pathname.split('/').filter(Boolean).pop();

      if (!map.has(url.href)) map.set(url.href, { href: url.href, img: src, title });
    });
    return [...map.values()];
  }

  // ---------- Interface ----------
  const root = document.createElement('div');
  root.id = 'tgn-root';
  root.innerHTML = `
    <div id="tgn-bar">
      <span id="tgn-logo">FILMS</span>
      <input id="tgn-search" type="search" placeholder="Rechercher un film…" autocomplete="off">
      <button class="tgn-btn" id="tgn-favs">♥ Ma liste</button>
      <button class="tgn-btn" id="tgn-sort">A–Z</button>
      <a class="tgn-btn" id="tgn-prev" style="display:none" aria-label="Page précédente">‹</a>
      <a class="tgn-btn" id="tgn-next" style="display:none" aria-label="Page suivante">›</a>
    </div>
    <div id="tgn-count"></div>
    <div id="tgn-grid"></div>
    <div id="tgn-pages"></div>`;
  document.body.appendChild(root);

  const toggle = document.createElement('button');
  toggle.id = 'tgn-toggle';
  toggle.textContent = '🎬';
  toggle.title = 'Basculer vue Netflix / site original';
  document.body.appendChild(toggle);

  const grid = root.querySelector('#tgn-grid');
  const count = root.querySelector('#tgn-count');
  const searchEl = root.querySelector('#tgn-search');
  const favBtn = root.querySelector('#tgn-favs');
  const sortBtn = root.querySelector('#tgn-sort');
  const pagesEl = root.querySelector('#tgn-pages');
  const prevTop = root.querySelector('#tgn-prev');
  const nextTop = root.querySelector('#tgn-next');

  function esc(s) {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function render() {
    let list = items.slice();
    if (onlyFavs) list = list.filter(i => favs[i.href]);
    if (query) {
      const q = query.toLowerCase();
      list = list.filter(i => i.title.toLowerCase().includes(q));
    }
    if (sortAZ) list.sort((a, b) => a.title.localeCompare(b.title));

    count.textContent = list.length + ' film' + (list.length > 1 ? 's' : '');
    if (!list.length) {
      grid.innerHTML = '<div class="tgn-empty">Aucun film trouvé.</div>';
      return;
    }
    grid.innerHTML = list.map(i => `
      <a class="tgn-card" href="${esc(i.href)}">
        <img loading="lazy" src="${esc(i.img)}" alt="${esc(i.title)}">
        <button class="tgn-fav ${favs[i.href] ? 'on' : ''}" data-href="${esc(i.href)}" aria-label="Favori">♥</button>
        <div class="tgn-title">${esc(i.title)}</div>
      </a>`).join('');
  }

  grid.addEventListener('click', e => {
    const b = e.target.closest('.tgn-fav');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    const h = b.dataset.href;
    if (favs[h]) delete favs[h]; else favs[h] = 1;
    store.set(FAV_KEY, favs);
    b.classList.toggle('on', !!favs[h]);
    if (onlyFavs) render();
  });

  searchEl.addEventListener('input', () => { query = searchEl.value.trim(); render(); });
  favBtn.addEventListener('click', () => { onlyFavs = !onlyFavs; favBtn.classList.toggle('on', onlyFavs); render(); });
  sortBtn.addEventListener('click', () => { sortAZ = !sortAZ; sortBtn.classList.toggle('on', sortAZ); render(); });

  function applyVisibility() {
    const show = enabled && items.length >= MIN_ITEMS;
    root.classList.toggle('tgn-hidden', !show);
    document.documentElement.style.overflow = show ? 'hidden' : '';
    toggle.style.display = items.length >= MIN_ITEMS ? 'block' : 'none';
  }

  toggle.addEventListener('click', () => {
    enabled = !enabled;
    store.set(ON_KEY, enabled);
    applyVisibility();
  });

  // ---------- Pagination du site ----------
  function curPage() {
    const m = location.pathname.match(/\/page\/(\d+)/i) ||
              location.search.match(/[?&](?:paged?|p)=(\d+)/i);
    return m ? parseInt(m[1], 10) : 1;
  }

  function collectPages() {
    const sel = [
      'a[rel="next"]', 'a[rel="prev"]',
      '[class*="pagin" i] a', '[class*="page-numbers" i]',
      '.wp-pagenavi a', 'a.next', 'a.prev',
      'a.nextpostslink', 'a.previouspostslink',
      'nav a[href*="/page/"]'
    ].join(',');
    const map = new Map();
    document.querySelectorAll(sel).forEach(a => {
      if (!a.href || a.closest('#tgn-root')) return;
      let u;
      try { u = new URL(a.href, location.href); } catch (e) { return; }
      if (u.origin !== location.origin) return;
      if (u.href === location.href) return;
      if (map.has(u.href)) return;
      map.set(u.href, {
        href: u.href,
        text: (a.textContent || '').replace(/\s+/g, ' ').trim(),
        rel: (a.getAttribute('rel') || '').toLowerCase(),
        cls: String(a.className || '').toLowerCase()
      });
    });

    const links = [...map.values()];
    const cur = curPage();
    const isNum = l => /^\d+$/.test(l.text);
    const nums = links.filter(isNum).map(l => ({ n: parseInt(l.text, 10), href: l.href }));

    let next = links.find(l => l.rel.includes('next') || /\bnext/.test(l.cls) || /next|suivant|›|»|→/i.test(l.text) && !isNum(l));
    let prev = links.find(l => l.rel.includes('prev') || /\bprev/.test(l.cls) || /prev|préc|prec|‹|«|←/i.test(l.text) && !isNum(l));
    if (!next) { const n = nums.find(x => x.n === cur + 1); if (n) next = { href: n.href }; }
    if (!prev) { const p = nums.find(x => x.n === cur - 1); if (p) prev = { href: p.href }; }

    return { cur, nums, next, prev };
  }

  function renderPages() {
    const { cur, nums, next, prev } = collectPages();

    prevTop.style.display = prev ? '' : 'none';
    nextTop.style.display = next ? '' : 'none';
    if (prev) prevTop.href = prev.href;
    if (next) nextTop.href = next.href;

    if (!prev && !next && !nums.length) { pagesEl.innerHTML = ''; return; }

    // numéros : première, dernière, et ceux autour de la page courante
    const all = new Map(nums.map(x => [x.n, x.href]));
    all.set(cur, null);
    const keys = [...all.keys()].sort((a, b) => a - b);
    const first = keys[0], last = keys[keys.length - 1];
    const shown = keys.filter(n => n === first || n === last || Math.abs(n - cur) <= 2);

    let html = prev ? `<a href="${esc(prev.href)}">‹ Précédent</a>` : '';
    let lastN = null;
    shown.forEach(n => {
      if (lastN !== null && n - lastN > 1) html += '<span class="dots">…</span>';
      html += n === cur
        ? `<span class="cur">${n}</span>`
        : `<a href="${esc(all.get(n))}">${n}</a>`;
      lastN = n;
    });
    html += next ? `<a href="${esc(next.href)}">Suivant ›</a>` : '';
    pagesEl.innerHTML = html;
  }

  // ---------- Rafraîchissement (pagination / chargement infini) ----------
  let timer = null;
  function hasPlayer() {
    const t = document.querySelector('meta[property="og:type"]');
    if (t && /video|article/i.test(t.content)) return true;
    if (document.querySelector('video')) return true;
    return [...document.querySelectorAll('iframe')].some(f => {
      const r = f.getBoundingClientRect();
      return r.width >= 280 && r.height >= 150;
    });
  }

  function refresh() {
    if (hasPlayer()) {
      // page de film : on laisse la place au mode cinéma
      items = [];
      applyVisibility();
      return;
    }
    const found = collect();
    if (found.length !== items.length) {
      items = found;
      render();
    }
    renderPages();
    applyVisibility();
  }

  new MutationObserver(muts => {
    if (muts.every(m => root.contains(m.target) || m.target === toggle)) return;
    clearTimeout(timer);
    timer = setTimeout(refresh, 400);
  }).observe(document.body, { childList: true, subtree: true });

  refresh();
})();

// ================= PARTIE 2 : FICHE FILM (pages de film) =================

(function () {
  'use strict';

  const ON_KEY = 'tgp_on';
  const TOI_BASE = 'https://timesofindia.indiatimes.com';
  const TOI_LIST = TOI_BASE + '/entertainment/tamil/movie-reviews';
  const CACHE_DAYS = 7;
  const AD = /ads?[._\-\/]|doubleclick|googlesyndication|adservice|banner|popunder|popads/i;

  // Boutons / onglets de choix de source (ceux du site)
  const SOURCE_SELECTOR = [
    '[class*="server" i]', '[id*="server" i]',
    '[class*="source" i]', '[id*="source" i]',
    '[class*="serveur" i]', '[id*="serveur" i]',
    '[class*="tabs" i]', '[id*="tabs" i]',
    '[class*="player-option" i]', '[class*="playeroption" i]',
    '[class*="dooplay_player" i]'
  ].join(',');

  // Conteneurs du lecteur (si le lecteur se charge après un clic)
  const PLAYER_SELECTOR = [
    '[class*="player" i]', '[id*="player" i]', '[class*="embed" i]', '[id*="embed" i]'
  ].join(',');

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  let enabled = store.get(ON_KEY, true);
  let applied = false;
  let opened = false;      // le lecteur est-il déplié ?
  let bar = null;
  let hero = null;
  let closedEl = null;     // bloc du site (lecteur + sources) replié tant qu'on n'a pas cliqué Lecture
  let toi = null;          // note + résumé Times of India
  let toiRequested = false;

  // ---------- Styles ----------
  const style = document.createElement('style');
  style.textContent = `
    [data-tgp-hide]{display:none!important}
    .tgp-closed{display:none!important}
    body.tgp-on{background:#0b0b0b!important;color:#fff!important}
    .tgp-path{width:100%!important;max-width:none!important;float:none!important;
      margin-left:0!important;margin-right:0!important;padding-left:0!important;padding-right:0!important;
      background:transparent!important;border:none!important;box-shadow:none!important;position:static!important}
    iframe.tgp-player,video.tgp-player{display:block!important;width:100%!important;
      height:56.25vw!important;max-height:70vh!important;background:#000!important;border:0!important}
    .tgp-keeper{display:flex!important;flex-wrap:wrap;gap:8px;justify-content:center;padding:12px!important}
    .tgp-keeper a,.tgp-keeper button,.tgp-keeper li{color:#fff!important;background:#222!important;
      border:1px solid #555!important;border-radius:6px!important;padding:8px 12px!important;
      list-style:none!important;font-size:14px!important;text-decoration:none!important}
    .tgp-keeper .active,.tgp-keeper .current,.tgp-keeper .selected,.tgp-keeper [aria-selected="true"]{
      background:#e50914!important;border-color:#e50914!important}

    #tgp-bar{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#000;color:#fff;
      font-family:-apple-system,Helvetica,Arial,sans-serif;position:sticky;top:0;z-index:2147483000}
    #tgp-bar b{flex:1;color:#e50914;font-size:16px;letter-spacing:1px}
    #tgp-bar button{padding:7px 12px;border-radius:6px;border:1px solid #555;background:#222;color:#fff;font-size:14px}
    #tgp-bar .tgp-fs-close{display:none}

    #tgp-hero{position:relative;display:flex;gap:14px;padding:18px 12px 22px;color:#fff;
      font-family:-apple-system,Helvetica,Arial,sans-serif;background-color:#111;
      background-size:cover;background-position:center top}
    #tgp-hero img{width:120px;aspect-ratio:2/3;object-fit:cover;border-radius:8px;flex:none;background:#333;
      box-shadow:0 6px 18px #000a}
    #tgp-hero .tgp-info{flex:1;min-width:0}
    #tgp-hero h2{margin:0 0 8px;font-size:20px;line-height:1.2;color:#fff}
    #tgp-hero .tgp-rate{display:inline-block;margin-bottom:8px;padding:3px 8px;border-radius:4px;
      background:#f5c518;color:#000;font-size:13px;font-weight:700}
    #tgp-hero .tgp-src{margin-left:8px;font-size:11px;color:#bbb}
    #tgp-hero p{margin:0 0 12px;font-size:13px;line-height:1.5;color:#ddd;display:-webkit-box;
      -webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden}
    #tgp-hero p.open{-webkit-line-clamp:unset;display:block}
    #tgp-hero .tgp-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
    #tgp-hero .tgp-go{padding:10px 22px;border-radius:6px;border:none;background:#fff;color:#000;
      font-size:16px;font-weight:700}
    #tgp-hero a.tgp-more{color:#ddd;font-size:13px}

    /* Plein écran au clic Lecture — sans changer le DOM du player */
    body.tgp-watching{overflow:hidden!important}
    body.tgp-watching #tgp-hero{display:none!important}
    body.tgp-watching #tgp-toggle{display:none!important}
    body.tgp-watching #tgp-bar{position:fixed!important;top:0;left:0;right:0;z-index:2147483010!important}
    body.tgp-watching #tgp-bar .tgp-fs-close{display:inline-block!important}
    body.tgp-watching .tgp-theater,
    body.tgp-watching .tgp-path.tgp-theater{
      position:fixed!important;top:52px!important;top:calc(48px + env(safe-area-inset-top))!important;
      left:0!important;right:0!important;bottom:0!important;z-index:2147483005!important;
      width:100%!important;max-width:none!important;height:auto!important;margin:0!important;padding:0!important;
      background:#000!important;overflow:auto!important;float:none!important;display:block!important}
    body.tgp-watching .tgp-theater iframe.tgp-player,
    body.tgp-watching .tgp-theater video.tgp-player,
    body.tgp-watching iframe.tgp-player,
    body.tgp-watching video.tgp-player{
      width:100%!important;height:calc(100dvh - 52px)!important;height:calc(100dvh - 48px - env(safe-area-inset-top))!important;
      max-height:none!important;min-height:60vh!important;background:#000!important;border:0!important}

    #tgp-toggle{position:fixed;left:14px;bottom:calc(14px + env(safe-area-inset-bottom));z-index:2147483001;
      width:48px;height:48px;border-radius:50%;border:none;background:#e50914;color:#fff;font-size:20px;
      box-shadow:0 4px 14px #0008}
  `;
  document.head.appendChild(style);

  // ---------- Utilitaires ----------
  const area = el => { const r = el.getBoundingClientRect(); return r.width * r.height; };
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const meta = n => {
    const e = document.querySelector('meta[property="' + n + '"],meta[name="' + n + '"]');
    return e ? clean(e.content) : '';
  };
  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();

  function findPlayer() {
    const list = [...document.querySelectorAll('video, iframe')].filter(el => {
      if (el.closest('#tgp-bar, #tgp-hero')) return false;
      const src = el.src || el.dataset.src || '';
      const r = el.getBoundingClientRect();
      return !AD.test(src) && r.width >= 280 && r.height >= 150;
    });
    list.sort((a, b) => area(b) - area(a));
    return list[0] || null;
  }

  function isMoviePage() {
    return !!findPlayer() || /video|article/i.test(meta('og:type'));
  }

  // ---------- Infos du film : affiche, titre, résumé ----------
  function getInfo() {
    const h1 = document.querySelector('h1');
    const title = clean(h1 && h1.textContent) || meta('og:title') || clean(document.title);

    let poster = meta('og:image') || meta('twitter:image');
    if (!poster) {
      const imgs = [...document.querySelectorAll('img')].filter(i =>
        !i.closest('header, nav, footer, #tgp-bar, #tgp-hero') &&
        !/logo|banner|avatar|icon|sprite/i.test(i.src || '') &&
        (i.naturalHeight || i.height) > (i.naturalWidth || i.width));
      imgs.sort((a, b) => area(b) - area(a));
      if (imgs[0]) poster = imgs[0].dataset.src || imgs[0].currentSrc || imgs[0].src;
    }

    let summary = meta('og:description') || meta('description');
    if (!summary) {
      const ps = [...document.querySelectorAll('p')].filter(p =>
        !p.closest('header, nav, footer, #comments, .comments, .comment, #tgp-hero'));
      ps.sort((a, b) => b.textContent.length - a.textContent.length);
      const best = ps.find(p => { const n = clean(p.textContent).length; return n >= 60 && n <= 1500; });
      summary = best ? clean(best.textContent) : '';
    }
    return { title, poster, summary };
  }

  // ---------- Note + résumé Times of India (récupérés depuis ton navigateur) ----------
  function gmGet(url) {
    return new Promise((resolve, reject) => {
      const fn = (typeof GM !== 'undefined' && GM.xmlHttpRequest) ||
                 (typeof GM_xmlhttpRequest !== 'undefined' && GM_xmlhttpRequest);
      if (!fn) return reject(new Error('GM indisponible'));
      fn({
        method: 'GET', url, timeout: 15000,
        onload: r => resolve(r.responseText || ''),
        onerror: reject, ontimeout: reject
      });
    });
  }

  function cleanTitle(t) {
    let s = (t || '').replace(/\(.*?\)|\[.*?\]/g, ' ').split(/\s[-–|:]\s/)[0];
    s = s.replace(/\b(19|20)\d{2}\b/g, ' ')
      .replace(/\b(tamil|telugu|hindi|movie|film|full|watch|online|hd|hdrip|dvdrip|download|free|web|dl|tamilgun|1080p|720p|480p|new|latest)\b/gi, ' ');
    return norm(s);
  }

  function parseReview(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    let rating = null, best = 5, snippet = '';

    // 1) données structurées (schema.org Review)
    doc.querySelectorAll('script[type="application/ld+json"]').forEach(sc => {
      if (rating !== null) return;
      try {
        const walk = o => {
          if (!o || typeof o !== 'object' || rating !== null) return;
          if (Array.isArray(o)) return o.forEach(walk);
          if (o.reviewRating && o.reviewRating.ratingValue !== undefined) {
            rating = parseFloat(o.reviewRating.ratingValue);
            best = parseFloat(o.reviewRating.bestRating) || 5;
            snippet = clean(o.description || o.reviewBody || '');
            return;
          }
          Object.values(o).forEach(walk);
        };
        walk(JSON.parse(sc.textContent));
      } catch (e) {}
    });

    // 2) repli : motif « 3.5/5 » dans le texte
    if (rating === null || isNaN(rating)) {
      rating = null;
      const m = (doc.body ? doc.body.textContent : '').match(/(\d(?:\.\d)?)\s*\/\s*5\b/);
      if (m) { rating = parseFloat(m[1]); best = 5; }
    }

    if (!snippet) {
      const d = doc.querySelector('meta[property="og:description"],meta[name="description"]');
      snippet = d ? clean(d.content) : '';
    }
    if (snippet.length > 260) snippet = snippet.slice(0, 257).replace(/\s+\S*$/, '') + '…';
    return { rating, best, snippet };
  }

  async function fetchToi(rawTitle) {
    const q = cleanTitle(rawTitle);
    if (q.length < 2) return null;

    const key = 'tgp_toi_' + q;
    const cached = store.get(key, null);
    if (cached && Date.now() - cached.t < CACHE_DAYS * 864e5) return cached.d;

    const listHtml = await gmGet(TOI_LIST);
    const listDoc = new DOMParser().parseFromString(listHtml, 'text/html');
    const link = [...listDoc.querySelectorAll('a[href]')].find(a =>
      /movie-?reviews/i.test(a.getAttribute('href')) && norm(a.textContent).includes(q));
    if (!link) { store.set(key, { t: Date.now(), d: null }); return null; }

    const url = new URL(link.getAttribute('href'), TOI_BASE).href;
    const data = parseReview(await gmGet(url));
    data.url = url;
    store.set(key, { t: Date.now(), d: data });
    return data;
  }

  function requestToi(title) {
    if (toiRequested) return;
    toiRequested = true;
    fetchToi(title).then(d => { toi = d; applyToi(); }).catch(() => {});
  }

  function applyToi() {
    if (!hero || !toi) return;
    const info = hero.querySelector('.tgp-info');
    if (!info) return;

    if (toi.rating !== null && toi.rating !== undefined && !hero.querySelector('.tgp-rate')) {
      const r = document.createElement('div');
      const badge = document.createElement('span');
      badge.className = 'tgp-rate';
      badge.textContent = '★ ' + toi.rating + '/' + toi.best;
      const src = document.createElement('span');
      src.className = 'tgp-src';
      src.textContent = 'Times of India';
      r.append(badge, src);
      info.insertBefore(r, info.querySelector('h2').nextSibling);
    }

    if (toi.snippet) {
      let p = hero.querySelector('p');
      if (!p) {
        p = document.createElement('p');
        p.onclick = () => p.classList.toggle('open');
        info.insertBefore(p, info.querySelector('.tgp-actions'));
      }
      p.textContent = toi.snippet;
    }

    if (toi.url && !hero.querySelector('.tgp-more')) {
      const a = document.createElement('a');
      a.className = 'tgp-more';
      a.href = toi.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'Lire la critique';
      hero.querySelector('.tgp-actions').appendChild(a);
    }
  }

  function setFullscreen(on) {
    opened = !!on;
    document.body.classList.toggle('tgp-watching', opened);
    if (closedEl) {
      closedEl.classList.toggle('tgp-closed', !opened);
      closedEl.classList.toggle('tgp-theater', opened);
    }
    if (opened) {
      const h = (bar && bar.offsetHeight) || 52;
      if (closedEl) closedEl.style.top = h + 'px';
      window.scrollTo(0, 0);
    } else if (closedEl) {
      closedEl.style.top = '';
    }
  }

  // ---------- Barre + fiche film ----------
  function buildTop() {
    bar = document.createElement('div');
    bar.id = 'tgp-bar';
    const back = document.createElement('button');
    back.textContent = '←';
    back.onclick = () => history.back();
    const logo = document.createElement('b');
    logo.textContent = 'FILMS';
    const fsClose = document.createElement('button');
    fsClose.className = 'tgp-fs-close';
    fsClose.textContent = '✕ Fermer';
    fsClose.onclick = () => setFullscreen(false);
    const exit = document.createElement('button');
    exit.textContent = 'Page complète';
    exit.onclick = () => setEnabled(false);
    bar.append(back, logo, fsClose, exit);

    const info = getInfo();
    hero = document.createElement('div');
    hero.id = 'tgp-hero';
    if (info.poster) {
      hero.style.backgroundImage =
        'linear-gradient(rgba(11,11,11,.8),#0b0b0b),url("' + info.poster.replace(/"/g, '%22') + '")';
      const img = document.createElement('img');
      img.src = info.poster;
      img.alt = info.title;
      hero.appendChild(img);
    } else {
      hero.style.background = 'linear-gradient(#1c1c1c,#0b0b0b)';
    }

    const box = document.createElement('div');
    box.className = 'tgp-info';
    const h2 = document.createElement('h2');
    h2.textContent = info.title;
    box.appendChild(h2);

    if (info.summary) {
      const p = document.createElement('p');
      p.textContent = info.summary;
      p.onclick = () => p.classList.toggle('open');
      box.appendChild(p);
    }

    const actions = document.createElement('div');
    actions.className = 'tgp-actions';
    if (closedEl) {
      const go = document.createElement('button');
      go.className = 'tgp-go';
      go.textContent = '▶ Lecture';
      go.onclick = () => setFullscreen(true);
      actions.appendChild(go);
    }
    box.appendChild(actions);
    hero.appendChild(box);

    document.body.insertBefore(hero, document.body.firstChild);
    document.body.insertBefore(bar, document.body.firstChild);

    applyToi();
    requestToi(info.title);
    if (opened) setFullscreen(true);
  }

  // ---------- Isoler / restaurer ----------
  function clear() {
    opened = false;
    document.body.classList.remove('tgp-watching');
    document.querySelectorAll('[data-tgp-hide]').forEach(e => e.removeAttribute('data-tgp-hide'));
    document.querySelectorAll('.tgp-path,.tgp-player,.tgp-keeper,.tgp-closed,.tgp-theater').forEach(e => {
      e.classList.remove('tgp-path', 'tgp-player', 'tgp-keeper', 'tgp-closed', 'tgp-theater');
      if (e.style) e.style.top = '';
    });
    document.body.classList.remove('tgp-on');
    if (bar) { bar.remove(); bar = null; }
    if (hero) { hero.remove(); hero = null; }
    closedEl = null;
    applied = false;
  }

  function isolate() {
    clear();
    const player = findPlayer();

    const keepers = new Set();
    const addKeepers = (selector, needsControls) => {
      document.querySelectorAll(selector).forEach(el => {
        if (el.closest('#tgp-bar, #tgp-hero')) return;
        if (player && el.contains(player)) return;
        if ((el.textContent || '').length > 800) return;
        if (needsControls && !el.querySelector('a, button, li')) return;
        keepers.add(el);
      });
    };
    addKeepers(SOURCE_SELECTOR, true);
    if (!player) addKeepers(PLAYER_SELECTOR, false);

    if (!player && !keepers.size) return false; // rien à isoler : la page reste intacte

    // chemin à conserver : lecteur + sources + leurs parents
    const path = new Set();
    if (player) for (let e = player; e && e !== document.body; e = e.parentElement) path.add(e);
    keepers.forEach(k => {
      for (let e = k; e && e !== document.body; e = e.parentElement) path.add(e);
    });

    const keepSet = new Set(path);
    if (player) keepSet.add(player);

    // masquer ce qui n'est pas sur le chemin (sans toucher à l'intérieur du lecteur / des sources)
    keepSet.forEach(el => {
      if (keepers.has(el) || el === player) return;
      [...el.children].forEach(child => {
        if (!keepSet.has(child)) child.setAttribute('data-tgp-hide', '1');
      });
    });
    [...document.body.children].forEach(child => {
      if (!keepSet.has(child) && child.id !== 'tgp-toggle') child.setAttribute('data-tgp-hide', '1');
    });

    path.forEach(el => { if (!keepers.has(el)) el.classList.add('tgp-path'); });
    keepers.forEach(el => el.classList.add('tgp-keeper'));
    if (player) player.classList.add('tgp-player');

    // bloc du site (lecteur + sources) replié jusqu'au clic sur Lecture
    closedEl = [...path, ...keepers].find(el => el.parentElement === document.body) || null;
    if (closedEl && !opened) closedEl.classList.add('tgp-closed');

    document.body.classList.add('tgp-on');
    buildTop();
    applied = true;
    return true;
  }

  // ---------- Activer / désactiver ----------
  const toggle = document.createElement('button');
  toggle.id = 'tgp-toggle';
  toggle.textContent = '⛶';
  toggle.title = 'Fiche film / page complète';
  toggle.style.display = 'none';
  document.body.appendChild(toggle);

  function setEnabled(v) {
    enabled = v;
    store.set(ON_KEY, v);
    update();
  }
  toggle.addEventListener('click', () => setEnabled(!enabled));

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && opened) {
      e.preventDefault();
      setFullscreen(false);
    }
  }, true);

  function update() {
    const movie = applied || isMoviePage();
    toggle.style.display = movie && !opened ? 'block' : 'none';
    if (enabled && movie) isolate(); else clear();
  }

  // Re-appliquer quand la page change de source, sans réagir à nos propres ajouts
  const ours = n => n.nodeType === 1 && (n.id === 'tgp-bar' || n.id === 'tgp-hero' || n.id === 'tgp-toggle');
  let timer = null;
  new MutationObserver(muts => {
    const relevant = muts.some(m => {
      if (m.target.closest && m.target.closest('#tgp-bar, #tgp-hero')) return false;
      const nodes = [...m.addedNodes, ...m.removedNodes];
      return !(nodes.length && nodes.every(ours));
    });
    if (!relevant) return;
    clearTimeout(timer);
    timer = setTimeout(update, 500);
  }).observe(document.body, { childList: true, subtree: true });

  update();
})();

// ================= PARTIE 3 : NAVIGATION À LA TÉLÉCOMMANDE (flèches + OK) =================
(function () {
  'use strict';

  const style = document.createElement('style');
  style.textContent = `
    #tgn-root a:focus,#tgn-root button:focus,#tgn-root input:focus,
    #tgp-bar button:focus,#tgp-hero button:focus,#tgp-hero a:focus,
    .tgp-keeper a:focus,.tgp-keeper button:focus{
      outline:4px solid #fff!important;outline-offset:2px;border-radius:6px}
    .tgn-card:focus{transform:scale(1.08);z-index:3;box-shadow:0 10px 30px #000}
    @media (min-width:1000px){
      #tgn-grid{grid-template-columns:repeat(auto-fill,minmax(190px,1fr))!important;gap:18px!important}
      .tgn-title{font-size:15px!important}
      .tgn-btn,#tgn-search{font-size:18px!important}
      #tgn-pages a,#tgn-pages span{font-size:18px!important}
      #tgp-hero h2{font-size:30px!important}
      #tgp-hero p{font-size:17px!important}
      #tgp-hero img{width:200px!important}
      #tgp-hero .tgp-go{font-size:20px!important;padding:14px 30px!important}
    }`;
  document.head.appendChild(style);

  const SELECTOR = [
    '#tgn-root:not(.tgn-hidden) a[href]', '#tgn-root:not(.tgn-hidden) button', '#tgn-root:not(.tgn-hidden) input',
    '#tgp-bar button', '#tgp-hero button', '#tgp-hero a[href]',
    '.tgp-keeper a', '.tgp-keeper button'
  ].join(',');

  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const center = r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  const focusables = () => [...document.querySelectorAll(SELECTOR)].filter(visible);

  function move(dir) {
    const els = focusables();
    if (!els.length) return false;
    const cur = document.activeElement;
    if (!els.includes(cur)) {
      const first = els.find(e => e.classList.contains('tgn-card') || e.classList.contains('tgp-go')) || els[0];
      first.focus();
      return true;
    }
    const c = center(cur.getBoundingClientRect());
    let best = null, bestScore = Infinity;
    els.forEach(e => {
      if (e === cur) return;
      const p = center(e.getBoundingClientRect());
      const dx = p.x - c.x, dy = p.y - c.y;
      let ok, prim, sec;
      if (dir === 'ArrowRight') { ok = dx > 5; prim = dx; sec = Math.abs(dy); }
      else if (dir === 'ArrowLeft') { ok = dx < -5; prim = -dx; sec = Math.abs(dy); }
      else if (dir === 'ArrowDown') { ok = dy > 5; prim = dy; sec = Math.abs(dx); }
      else { ok = dy < -5; prim = -dy; sec = Math.abs(dx); }
      if (!ok) return;
      const score = prim + sec * 2.5;
      if (score < bestScore) { bestScore = score; best = e; }
    });
    if (!best) return false;
    best.focus({ preventScroll: true });
    best.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return true;
  }

  document.addEventListener('keydown', e => {
    if (!/^Arrow(Up|Down|Left|Right)$/.test(e.key)) return;
    const t = e.target;
    const typing = t && t.tagName === 'INPUT' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight');
    if (typing) return;
    if (move(e.key)) e.preventDefault();
  }, true);

  // Focus de départ : premier film de la grille, ou bouton Lecture
  setTimeout(() => {
    const a = document.activeElement;
    if (a && a !== document.body && a !== document.documentElement) return;
    const target = document.querySelector('#tgp-hero .tgp-go') ||
                   document.querySelector('#tgn-root:not(.tgn-hidden) .tgn-card');
    if (target) target.focus();
  }, 1500);
})();
