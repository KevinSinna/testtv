// ==UserScript==
// @name         TamilGun - Style Netflix (grille + fiche film)
// @namespace    local.netflix.style
// @version      5.4
// @description  Grille Netflix + Lecture en théâtre plein écran (sans play custom)
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
  const FAV_KEY = 'tgn_favs';
  const TOI_BASE = 'https://timesofindia.indiatimes.com';
  const TOI_LIST = TOI_BASE + '/entertainment/tamil/movie-reviews';
  const CACHE_DAYS = 7;
  const AD = /ads?[._\-\/]|doubleclick|googlesyndication|adservice|banner|popunder|popads/i;
  const UI_IDS = new Set(['tgp-bar', 'tgp-hero', 'tgp-stage', 'tgp-toggle']);

  const SOURCE_SELECTOR = [
    '[class*="server" i]', '[id*="server" i]',
    '[class*="source" i]', '[id*="source" i]',
    '[class*="serveur" i]', '[id*="serveur" i]',
    '[class*="tabs" i]', '[id*="tabs" i]',
    '[class*="player-option" i]', '[class*="playeroption" i]',
    '[class*="dooplay_player" i]'
  ].join(',');

  const PLAYER_SHELL_SELECTOR = [
    '[class*="player" i]', '[id*="player" i]',
    '[class*="embed" i]', '[id*="embed" i]',
    '[class*="video" i]', '[id*="video" i]'
  ].join(',');

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  let enabled = store.get(ON_KEY, true);
  let applied = false;
  let opened = false;
  let bar = null;
  let hero = null;
  let stage = null;
  let sourcesBox = null;
  let playerWrap = null;
  let goBtn = null;
  let stopBtn = null;
  let favBtn = null;
  let filmHref = location.href.split('#')[0];
  let toi = null;
  let toiRequested = false;
  let restorers = [];
  let suppressing = false;
  let adTimer = null;

  const style = document.createElement('style');
  style.textContent = `
    [data-tgp-hide]{display:none!important}
    html.tgp-on,body.tgp-on{background:#0b0b0b!important;color:#fff!important;min-height:100%!important}
    body.tgp-on{margin:0!important}
    /* Ne jamais masquer la grille Netflix ni notre UI fiche */
    body.tgp-on > *:not(#tgp-bar):not(#tgp-hero):not(#tgp-stage):not(#tgp-toggle):not(#tgn-root):not(#tgn-toggle){display:none!important}
    body.tgp-on #tgn-root{display:none!important} /* grille off seulement en mode fiche confirmé */

    #tgp-bar{display:flex;align-items:center;gap:10px;padding:10px 12px;padding-top:calc(10px + env(safe-area-inset-top));
      background:#000;color:#fff;font-family:-apple-system,Helvetica,Arial,sans-serif;
      position:sticky;top:0;z-index:2147483000}
    #tgp-bar b{flex:1;color:#e50914;font-size:16px;letter-spacing:1px}
    #tgp-bar button{padding:8px 12px;border-radius:6px;border:1px solid #555;background:#222;color:#fff;font-size:14px;cursor:pointer}

    #tgp-hero{position:relative;display:flex;gap:14px;padding:18px 12px 22px;color:#fff;
      font-family:-apple-system,Helvetica,Arial,sans-serif;background-color:#111;
      background-size:cover;background-position:center top;z-index:2147482990}
    #tgp-hero img.tgp-poster{width:120px;aspect-ratio:2/3;object-fit:cover;border-radius:8px;flex:none;background:#333;
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
    #tgp-hero .tgp-go,#tgp-hero .tgp-stop{padding:12px 24px;border-radius:6px;border:none;font-size:16px;font-weight:700;cursor:pointer}
    #tgp-hero .tgp-go{background:#fff;color:#000}
    #tgp-hero .tgp-stop{display:none;background:#333;color:#fff;border:1px solid #666}
    #tgp-hero .tgp-fav{padding:10px 14px;border-radius:6px;border:1px solid #555;background:#222;color:#fff;
      font-size:16px;cursor:pointer}
    #tgp-hero .tgp-fav.on{color:#e50914;border-color:#e50914}
    #tgp-hero a.tgp-more{color:#ddd;font-size:13px}

    /* Mode Lecture = théâtre fixe plein écran (tout le bloc vidéo visible) */
    body.tgp-watching{overflow:hidden!important;height:100%!important;touch-action:none}
    html.tgp-watching{overflow:hidden!important;height:100%!important}
    body.tgp-watching #tgp-hero{display:none!important}
    body.tgp-watching #tgp-bar{
      position:fixed!important;top:0;left:0;right:0;z-index:2147483010!important}
    body.tgp-watching #tgp-bar .tgp-watch-stop{display:inline-block!important}
    body.tgp-watching #tgp-toggle{display:none!important}
    #tgp-bar .tgp-watch-stop{display:none}

    #tgp-stage{display:none;flex-direction:column;gap:0;width:100%;background:#000;
      pointer-events:auto}
    body.tgp-watching #tgp-stage{
      display:flex!important;position:fixed!important;left:0;right:0;bottom:0;
      top:56px;top:calc(52px + env(safe-area-inset-top));
      z-index:2147483005!important;max-width:none!important;margin:0!important;
      padding:0!important;min-height:0!important;height:auto!important}
    #tgp-sources{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;padding:8px 10px;background:#0f0f0f;
      flex:0 0 auto;max-height:64px;overflow:auto;z-index:3}
    #tgp-sources:empty{display:none}
    #tgp-sources .tgp-keeper{display:contents!important;padding:0!important;border:none!important;background:transparent!important}
    #tgp-sources a,#tgp-sources button,#tgp-sources li,#tgp-sources [role="tab"],#tgp-sources [role="button"]{
      color:#fff!important;background:#222!important;border:1px solid #555!important;border-radius:999px!important;
      padding:8px 14px!important;list-style:none!important;font-size:14px!important;text-decoration:none!important;
      cursor:pointer!important;pointer-events:auto!important;display:inline-flex!important;align-items:center}
    #tgp-sources .active,#tgp-sources .current,#tgp-sources .selected,#tgp-sources [aria-selected="true"],
    #tgp-sources a:hover,#tgp-sources button:hover{background:#e50914!important;border-color:#e50914!important}

    #tgp-player-wrap{position:relative;flex:1 1 auto;width:100%;min-height:0;height:100%;
      background:#000;overflow:hidden;pointer-events:auto!important;z-index:1}
    #tgp-player-wrap > *:not(iframe):not(video){
      position:absolute!important;inset:0!important;display:block!important;width:100%!important;height:100%!important;
      max-width:none!important;max-height:none!important;margin:0!important;float:none!important;
      background:#000!important;border:none!important;box-shadow:none!important;overflow:hidden!important}
    #tgp-player-wrap > iframe,#tgp-player-wrap > video,
    #tgp-player-wrap iframe.tgp-player,video.tgp-player,#tgp-player-wrap iframe,#tgp-player-wrap video{
      position:absolute!important;inset:0!important;display:block!important;width:100%!important;height:100%!important;
      max-height:none!important;border:0!important;background:#000!important;pointer-events:auto!important;z-index:2!important}
    #tgp-player-wrap a[data-tgp-ad],#tgp-player-wrap iframe[data-tgp-ad],#tgp-player-wrap [data-tgp-ad]{
      display:none!important;pointer-events:none!important;visibility:hidden!important;width:0!important;height:0!important}
    #tgp-player-wrap a[target="_blank"]{pointer-events:none!important;display:none!important}
    #tgp-player-wrap a[data-tgp-play],#tgp-player-wrap button,#tgp-player-wrap [class*="play" i],
    #tgp-player-wrap [id*="play" i],#tgp-player-wrap .jw-icon,#tgp-player-wrap .vjs-big-play-button{
      pointer-events:auto!important;cursor:pointer!important;z-index:5!important}

    #tgp-toggle{position:fixed;left:14px;bottom:calc(14px + env(safe-area-inset-bottom));z-index:2147483001;
      width:48px;height:48px;border-radius:50%;border:none;background:#e50914;color:#fff;font-size:20px;
      box-shadow:0 4px 14px #0008;cursor:pointer}

    @media (max-width:700px){
      #tgp-hero .tgp-go{font-size:17px;padding:14px 26px;min-height:48px}
    }
  `;
  document.head.appendChild(style);

  const area = el => { const r = el.getBoundingClientRect(); return r.width * r.height; };
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const meta = n => {
    const e = document.querySelector('meta[property="' + n + '"],meta[name="' + n + '"]');
    return e ? clean(e.content) : '';
  };
  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
  const isUi = el => el && (UI_IDS.has(el.id) || (el.closest && el.closest('#tgp-bar,#tgp-hero,#tgp-stage,#tgp-toggle')));

  function findPlayerMedia(root, opts) {
    const allowHidden = !!(opts && opts.allowHidden);
    const scope = root || document;
    const list = [...scope.querySelectorAll('video, iframe')].filter(el => {
      if (el.closest('#tgp-bar, #tgp-hero, #tgn-root')) return false;
      const src = el.src || el.getAttribute('src') || el.dataset.src || '';
      if (AD.test(src)) return false;
      if (el.tagName === 'VIDEO') {
        const r = el.getBoundingClientRect();
        return allowHidden || (r.width >= 160 && r.height >= 90) || el.readyState > 0;
      }
      if (!src && !el.dataset.src) return false;
      const r = el.getBoundingClientRect();
      if (r.width >= 280 && r.height >= 150) return true;
      // hors écran seulement après détection page film (re-adopt source)
      return allowHidden && !!(src || el.dataset.src);
    });
    list.sort((a, b) => area(b) - area(a));
    return list[0] || null;
  }

  function findPlayerShell(media) {
    if (!media) {
      const guess = [...document.querySelectorAll(PLAYER_SHELL_SELECTOR)].find(el =>
        !isUi(el) && el.querySelector('iframe, video, [class*="play" i], button'));
      return guess || null;
    }
    let el = media.closest(PLAYER_SHELL_SELECTOR) || media.parentElement;
    // remonter un peu pour garder overlays play, sans prendre tout le body
    while (el && el.parentElement && el.parentElement !== document.body) {
      const p = el.parentElement;
      if (isUi(p)) break;
      const onlyPlayerish = p.children.length <= 3 || /player|embed|video|media/i.test(p.className + ' ' + p.id);
      if (!onlyPlayerish) break;
      if (p.querySelectorAll('iframe, video').length > 2) break;
      el = p;
    }
    return el;
  }

  function collectSources(playerShell) {
    const keepers = [];
    document.querySelectorAll(SOURCE_SELECTOR).forEach(el => {
      if (isUi(el)) return;
      if (playerShell && (playerShell === el || playerShell.contains(el) || el.contains(playerShell))) return;
      if ((el.textContent || '').length > 800) return;
      if (!el.querySelector('a, button, li, [role="tab"], [role="button"]')) return;
      // éviter les énormes wrappers : préférer le nœud le plus bas
      if (keepers.some(k => k.contains(el))) return;
      keepers.push(el);
    });
    return keepers.filter(el => !keepers.some(o => o !== el && el.contains(o)));
  }

  function gridIsActive() {
    const root = document.getElementById('tgn-root');
    if (!root || root.classList.contains('tgn-hidden')) return false;
    return !!root.querySelector('.tgn-card');
  }

  function isMoviePage() {
    // Ne pas voler la page liste : sélecteurs "tabs/server/player" trop larges = faux positifs → écran vide
    if (gridIsActive()) return false;
    if (/video|article/i.test(meta('og:type'))) return true;
    return !!findPlayerMedia(document, { allowHidden: false });
  }

  function adopt(el, target) {
    if (!el || !target || el.parentElement === target) return;
    const marker = document.createComment('tgp-slot');
    el.parentNode.insertBefore(marker, el);
    restorers.push({ el, marker });
    target.appendChild(el);
  }

  function restoreAdopted() {
    restorers.slice().reverse().forEach(({ el, marker }) => {
      try {
        if (marker.parentNode) marker.parentNode.insertBefore(el, marker);
        if (marker.parentNode) marker.remove();
      } catch (e) {}
    });
    restorers = [];
  }

  function getInfo() {
    const h1 = document.querySelector('h1');
    const title = clean(h1 && h1.textContent) || meta('og:title') || clean(document.title);

    let poster = meta('og:image') || meta('twitter:image');
    if (!poster) {
      const imgs = [...document.querySelectorAll('img')].filter(i =>
        !isUi(i) && !i.closest('header, nav, footer') &&
        !/logo|banner|avatar|icon|sprite/i.test(i.src || '') &&
        (i.naturalHeight || i.height) > (i.naturalWidth || i.width));
      imgs.sort((a, b) => area(b) - area(a));
      if (imgs[0]) poster = imgs[0].dataset.src || imgs[0].currentSrc || imgs[0].src;
    }

    let summary = meta('og:description') || meta('description');
    if (!summary) {
      const ps = [...document.querySelectorAll('p')].filter(p =>
        !isUi(p) && !p.closest('header, nav, footer, #comments, .comments, .comment'));
      ps.sort((a, b) => b.textContent.length - a.textContent.length);
      const best = ps.find(p => { const n = clean(p.textContent).length; return n >= 60 && n <= 1500; });
      summary = best ? clean(best.textContent) : '';
    }
    return { title, poster, summary };
  }

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

  function favsMap() { return store.get(FAV_KEY, {}); }

  function syncFavBtn() {
    if (!favBtn) return;
    const on = !!favsMap()[filmHref];
    favBtn.classList.toggle('on', on);
    favBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    favBtn.textContent = on ? '♥ Dans ma liste' : '♡ Ma liste';
  }

  function isExternalOrAdUrl(href) {
    if (!href) return false;
    const raw = String(href).trim();
    // # / javascript: = souvent le vrai bouton play du site, pas une pub
    if (raw === '#' || raw.startsWith('#') || raw.toLowerCase().startsWith('javascript:')) return false;
    try {
      const u = new URL(raw, location.href);
      if (AD.test(u.href)) return true;
      if (/doubleclick|googlesynd|popads|propeller|adsterra|exoclick|clickadu|ouo\.io|bit\.ly|tinyurl|redirect|popup|popunder/i.test(u.href)) return true;
      if (u.origin !== location.origin) return true;
    } catch (e) { return true; }
    return false;
  }

  function looksLikePlayControl(el) {
    if (!el || el.nodeType !== 1) return false;
    const s = ((el.className || '') + ' ' + (el.id || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.title || '')).toLowerCase();
    return /play|jw-icon|vjs-big|poster|btn-play|start/i.test(s);
  }

  function scrubPlayerAds(root) {
    if (!root) return;
    const main = findPlayerMedia(root, { allowHidden: true });

    root.querySelectorAll('iframe').forEach(f => {
      if (f === main || f.classList.contains('tgp-player')) return;
      const src = f.src || f.getAttribute('src') || f.dataset.src || '';
      if (!src || AD.test(src) || isExternalOrAdUrl(src)) {
        f.setAttribute('data-tgp-ad', '1');
      }
    });

    root.querySelectorAll('a[href]').forEach(a => {
      if (a.closest('#tgp-sources')) return;
      if (looksLikePlayControl(a)) {
        a.setAttribute('data-tgp-play', '1');
        a.removeAttribute('data-tgp-ad');
        return;
      }
      // pubs = nouvel onglet ou URL externe / ad network
      if (a.target === '_blank' || isExternalOrAdUrl(a.getAttribute('href'))) {
        a.setAttribute('data-tgp-ad', '1');
        a.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); }, true);
      }
    });

    root.querySelectorAll('div, span, section, aside').forEach(el => {
      if (el.id === 'tgp-player-wrap') return;
      if (main && (el === main || el.contains(main))) return;
      if (looksLikePlayControl(el)) return;
      const st = window.getComputedStyle(el);
      if (!/fixed|absolute/i.test(st.position)) return;
      const r = el.getBoundingClientRect();
      if (r.width < 80 || r.height < 80) return;
      const hasAdLink = [...el.querySelectorAll('a[href], a[data-tgp-ad], iframe')].some(n =>
        n.hasAttribute('data-tgp-ad') ||
        (n.tagName === 'A' && (n.target === '_blank' || isExternalOrAdUrl(n.getAttribute('href') || ''))) ||
        (n.tagName === 'IFRAME' && n !== main));
      if (hasAdLink) el.setAttribute('data-tgp-ad', '1');
    });
  }

  function bindAdClickGuard() {
    if (!stage || stage.dataset.tgpGuard === '1') return;
    stage.dataset.tgpGuard = '1';
    stage.addEventListener('click', e => {
      const a = e.target.closest('a');
      if (!a || a.closest('#tgp-sources')) return;
      if (a.hasAttribute('data-tgp-play') || looksLikePlayControl(a)) return;
      if (a.hasAttribute('data-tgp-ad') || a.target === '_blank' || isExternalOrAdUrl(a.getAttribute('href') || a.href)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
  }

  function startAdScrub() {
    stopAdScrub();
    const run = () => { if (playerWrap) scrubPlayerAds(playerWrap); };
    run();
    adTimer = setInterval(run, 1200);
  }

  function stopAdScrub() {
    if (adTimer) { clearInterval(adTimer); adTimer = null; }
  }

  function setWatching(on) {
    opened = !!on;
    document.body.classList.toggle('tgp-watching', opened);
    document.documentElement.classList.toggle('tgp-watching', opened);
    document.documentElement.classList.toggle('tgp-on', document.body.classList.contains('tgp-on'));
    if (opened && stage) {
      window.scrollTo(0, 0);
      bindAdClickGuard();
      scrubPlayerAds(playerWrap);
      startAdScrub();
      const h = (bar && bar.offsetHeight) || 56;
      stage.style.top = h + 'px';
      const media = findPlayerMedia(playerWrap, { allowHidden: true });
      if (media) {
        try { media.focus({ preventScroll: true }); } catch (e) {}
      }
    } else {
      stopAdScrub();
      if (stage) stage.style.top = '';
      document.documentElement.classList.remove('tgp-watching');
    }
  }

  function buildChrome(info) {
    bar = document.createElement('div');
    bar.id = 'tgp-bar';
    const back = document.createElement('button');
    back.type = 'button';
    back.textContent = '←';
    back.title = 'Retour';
    back.onclick = () => history.back();
    const logo = document.createElement('b');
    logo.textContent = 'FILMS';
    const exit = document.createElement('button');
    exit.type = 'button';
    exit.textContent = 'Page complète';
    exit.onclick = () => setEnabled(false);
    const watchStop = document.createElement('button');
    watchStop.type = 'button';
    watchStop.className = 'tgp-watch-stop';
    watchStop.textContent = '✕ Fermer le lecteur';
    watchStop.onclick = () => setWatching(false);
    bar.append(back, logo, watchStop, exit);

    hero = document.createElement('div');
    hero.id = 'tgp-hero';
    if (info.poster) {
      hero.style.backgroundImage =
        'linear-gradient(rgba(11,11,11,.82),#0b0b0b),url("' + info.poster.replace(/"/g, '%22') + '")';
      const img = document.createElement('img');
      img.className = 'tgp-poster';
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

    goBtn = document.createElement('button');
    goBtn.type = 'button';
    goBtn.className = 'tgp-go';
    goBtn.textContent = '▶ Lecture';
    goBtn.onclick = () => setWatching(true);

    stopBtn = document.createElement('button');
    stopBtn.type = 'button';
    stopBtn.className = 'tgp-stop';
    stopBtn.textContent = '✕ Fermer le lecteur';
    stopBtn.onclick = () => setWatching(false);

    favBtn = document.createElement('button');
    favBtn.type = 'button';
    favBtn.className = 'tgp-fav';
    favBtn.onclick = () => {
      const favs = favsMap();
      if (favs[filmHref]) delete favs[filmHref]; else favs[filmHref] = 1;
      store.set(FAV_KEY, favs);
      syncFavBtn();
    };
    syncFavBtn();

    actions.append(goBtn, stopBtn, favBtn);
    box.appendChild(actions);
    hero.appendChild(box);

    document.body.insertBefore(stage, document.body.firstChild);
    document.body.insertBefore(hero, document.body.firstChild);
    document.body.insertBefore(bar, document.body.firstChild);

    applyToi();
    requestToi(info.title);
    if (opened) setWatching(true);
  }

  function buildStage(shell, sources) {
    stage = document.createElement('div');
    stage.id = 'tgp-stage';

    sourcesBox = document.createElement('div');
    sourcesBox.id = 'tgp-sources';
    sources.forEach(el => {
      el.classList.add('tgp-keeper');
      adopt(el, sourcesBox);
    });

    playerWrap = document.createElement('div');
    playerWrap.id = 'tgp-player-wrap';

    if (shell) {
      adopt(shell, playerWrap);
      const media = findPlayerMedia(shell, { allowHidden: true }) ||
        (shell.matches && shell.matches('iframe,video') ? shell : null);
      if (media) media.classList.add('tgp-player');
      scrubPlayerAds(playerWrap);
    }

    stage.append(sourcesBox, playerWrap);
    bindAdClickGuard();
  }

  function clear() {
    suppressing = true;
    opened = false;
    stopAdScrub();
    restoreAdopted();
    document.querySelectorAll('[data-tgp-hide]').forEach(e => e.removeAttribute('data-tgp-hide'));
    document.querySelectorAll('.tgp-player,.tgp-keeper').forEach(e =>
      e.classList.remove('tgp-player', 'tgp-keeper'));
    document.body.classList.remove('tgp-on', 'tgp-watching');
    document.documentElement.classList.remove('tgp-on', 'tgp-watching');
    if (bar) { bar.remove(); bar = null; }
    if (hero) { hero.remove(); hero = null; }
    if (stage) { stage.remove(); stage = null; }
    sourcesBox = null;
    playerWrap = null;
    goBtn = null;
    stopBtn = null;
    favBtn = null;
    applied = false;
    suppressing = false;
  }

  function releaseChild(el) {
    const idx = restorers.findIndex(r => r.el === el);
    if (idx < 0) return;
    const { marker } = restorers[idx];
    try {
      if (marker.parentNode) marker.parentNode.insertBefore(el, marker);
      if (marker.parentNode) marker.remove();
    } catch (e) {}
    restorers.splice(idx, 1);
  }

  function softRefresh() {
    if (!stage || !playerWrap) return;
    const outside = [...document.querySelectorAll('video, iframe')].find(el => {
      if (stage.contains(el) || isUi(el)) return false;
      const src = el.src || el.getAttribute('src') || el.dataset.src || '';
      if (AD.test(src)) return false;
      return el.tagName === 'VIDEO' || !!src;
    });
    if (outside) {
      const shell = findPlayerShell(outside);
      if (shell && !stage.contains(shell)) {
        [...playerWrap.children].forEach(releaseChild);
        adopt(shell, playerWrap);
        outside.classList.add('tgp-player');
        scrubPlayerAds(playerWrap);
      }
    }
    collectSources(playerWrap.firstElementChild).forEach(el => {
      if (!sourcesBox.contains(el)) {
        el.classList.add('tgp-keeper');
        adopt(el, sourcesBox);
      }
    });
    if (opened) scrubPlayerAds(playerWrap);
  }

  function isolate() {
    if (gridIsActive()) return false;

    // Exiger un vrai média visible — sinon on laisse la page intacte (observer réessaie)
    const media = findPlayerMedia(document, { allowHidden: false });
    if (!media) return false;

    const shell = findPlayerShell(media);
    const sources = collectSources(shell);
    const targetShell = shell || media;

    // Refuser d'adopter un monstre DOM (sinon page vide / cassée)
    const links = targetShell.querySelectorAll('a[href]').length;
    const imgs = targetShell.querySelectorAll('img').length;
    if (links > 40 || imgs > 25 || targetShell === document.body) return false;

    suppressing = true;
    const wasOpened = opened;
    try {
      if (applied) {
        restoreAdopted();
        if (bar) bar.remove();
        if (hero) hero.remove();
        if (stage) stage.remove();
        bar = hero = stage = null;
      }

      filmHref = location.href.split('#')[0];
      toiRequested = false;
      toi = null;

      buildStage(targetShell, sources);
      buildChrome(getInfo());

      [...document.body.children].forEach(child => {
        if (!UI_IDS.has(child.id) && child.id !== 'tgn-root' && child.id !== 'tgn-toggle') {
          child.setAttribute('data-tgp-hide', '1');
        }
      });

      document.body.classList.add('tgp-on');
      document.documentElement.classList.add('tgp-on');
      applied = true;
      opened = wasOpened;
      if (opened) setWatching(true);
      return true;
    } catch (err) {
      try { clear(); } catch (e) {}
      return false;
    } finally {
      suppressing = false;
    }
  }

  const toggle = document.createElement('button');
  toggle.id = 'tgp-toggle';
  toggle.type = 'button';
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

  function update() {
    if (suppressing) return;
    if (!enabled) { clear(); return; }
    if (gridIsActive()) {
      if (applied) clear();
      toggle.style.display = 'none';
      return;
    }
    const movie = isMoviePage() || (applied && !!document.getElementById('tgp-stage'));
    toggle.style.display = movie && !opened ? 'block' : 'none';
    if (!movie) { clear(); return; }
    if (applied && document.getElementById('tgp-bar') && document.getElementById('tgp-stage')) {
      softRefresh();
      return;
    }
    // UI manquante / cassée → reconstruire, sinon clear déjà fait si échec
    if (applied) clear();
    isolate();
  }

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!opened) return;
    e.preventDefault();
    setWatching(false);
  }, true);

  const ours = n => n.nodeType === 1 && (UI_IDS.has(n.id) || (n.closest && n.closest('#tgp-bar,#tgp-hero,#tgp-stage,#tgp-toggle')));
  let timer = null;
  new MutationObserver(muts => {
    if (suppressing) return;
    const relevant = muts.some(m => {
      if (m.target.closest && m.target.closest('#tgp-bar, #tgp-hero, #tgp-stage')) return false;
      const nodes = [...m.addedNodes, ...m.removedNodes];
      if (!nodes.length) return true;
      return !nodes.every(ours);
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
    #tgp-sources a:focus,#tgp-sources button:focus,#tgp-sources [role="tab"]:focus,
    #tgp-player-wrap a:focus,#tgp-player-wrap button:focus,
    .tgp-keeper a:focus,.tgp-keeper button:focus{
      outline:4px solid #fff!important;outline-offset:2px;border-radius:6px}
    .tgn-card:focus{transform:scale(1.08);z-index:3;box-shadow:0 10px 30px #000}
    @media (min-width:1000px){
      #tgn-grid{grid-template-columns:repeat(auto-fill,minmax(190px,1fr))!important;gap:18px!important}
      .tgn-title{font-size:15px!important}
      .tgn-btn,#tgn-search{font-size:18px!important}
      #tgn-pages a,#tgn-pages span{font-size:18px!important}
      body:not(.tgp-watching) #tgp-hero h2{font-size:30px!important}
      body:not(.tgp-watching) #tgp-hero p{font-size:17px!important}
      body:not(.tgp-watching) #tgp-hero img.tgp-poster{width:200px!important}
      #tgp-hero .tgp-go{font-size:20px!important;padding:14px 30px!important}
    }`;
  document.head.appendChild(style);

  const SELECTOR = [
    '#tgn-root:not(.tgn-hidden) a[href]', '#tgn-root:not(.tgn-hidden) button', '#tgn-root:not(.tgn-hidden) input',
    '#tgp-bar button', '#tgp-hero button', '#tgp-hero a[href]',
    'body.tgp-watching #tgp-sources a', 'body.tgp-watching #tgp-sources button',
    'body.tgp-watching #tgp-sources [role="tab"]', 'body.tgp-watching #tgp-sources [role="button"]',
    'body.tgp-watching #tgp-player-wrap a', 'body.tgp-watching #tgp-player-wrap button'
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
    const target = document.querySelector('body.tgp-watching #tgp-sources a, body.tgp-watching #tgp-sources button') ||
                   document.querySelector('#tgp-hero .tgp-go') ||
                   document.querySelector('#tgn-root:not(.tgn-hidden) .tgn-card');
    if (target) target.focus();
  }, 1500);
})();
