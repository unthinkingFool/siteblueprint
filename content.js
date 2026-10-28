// Isolated-world content script: collects network log from hook.js and extracts a full "blueprint" of the page.
(() => {
  if (window.__scContent) return;
  window.__scContent = true;

  const LOG = [];
  addEventListener('message', e => {
    if (e.source === window && e.data && e.data.__sc) { LOG.push(e.data.entry); if (LOG.length > 400) LOG.shift(); }
  });

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const cnt = s => { try { return document.querySelectorAll(s).length; } catch { return 0; } };
  const trunc = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'LINK', 'META', 'TEMPLATE', 'HEAD', 'TITLE', 'BR']);
  const sel = el => {
    if (el.id) return '#' + CSS.escape(el.id);
    let s = el.tagName.toLowerCase();
    const c = [...el.classList].slice(0, 3);
    if (c.length) s += '.' + c.map(x => CSS.escape(x)).join('.');
    return s;
  };
  const topN = (m, n = 8) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([value, uses]) => ({ value, uses }));
  const allEls = () => $$('body *').filter(e => !SKIP.has(e.tagName));

  // ---------- stylesheets (incl. cross-origin ones, fetched via the background worker) ----------
  async function loadSheets() {
    const out = [], blocked = [];
    for (const sh of document.styleSheets) {
      try { out.push({ rs: sh.cssRules, href: sh.href }); } catch { if (sh.href) blocked.push(sh.href); }
    }
    for (const href of blocked.slice(0, 10)) {
      try {
        const r = await chrome.runtime.sendMessage({ type: 'FETCH_TEXT', url: href });
        if (r && r.text) { const cs = new CSSStyleSheet(); cs.replaceSync(r.text.slice(0, 600000)); out.push({ rs: cs.cssRules, href }); }
      } catch {}
    }
    try { for (const cs of document.adoptedStyleSheets) out.push({ rs: cs.cssRules, href: 'adopted' }); } catch {}
    return out;
  }

  function analyzeCSS(sheets) {
    const A = { vars: [], keyframes: [], fontFaces: [], hover: [], transitions: [], animations: [], media: new Set(), scrollDriven: [] };
    const walk = (rs, media) => {
      for (const r of rs) {
        const t = r.type;
        if (t === 1) {
          const st = r.style, sl = r.selectorText || '';
          if (/^(:root|html|body|\.dark|\.light|\[data-theme|\[data-mode)/.test(sl)) {
            for (const p of st) if (p.startsWith('--') && A.vars.length < 220) A.vars.push([media ? `@media ${media} ${sl}` : sl, p, trunc(st.getPropertyValue(p), 100)]);
          }
          if (/:(hover|focus-visible|focus|active)/.test(sl) && A.hover.length < 70) A.hover.push({ sel: trunc(sl, 90), css: trunc(st.cssText, 240) });
          const tr = st.getPropertyValue('transition') || st.getPropertyValue('transition-duration');
          if (tr && A.transitions.length < 70) A.transitions.push({ sel: trunc(sl, 90), transition: trunc(tr, 140) });
          const an = st.getPropertyValue('animation') || st.getPropertyValue('animation-name');
          if (an && an !== 'none' && A.animations.length < 50) A.animations.push({ sel: trunc(sl, 90), animation: trunc(an, 160) });
          const tl = st.getPropertyValue('animation-timeline') || st.getPropertyValue('view-timeline') || st.getPropertyValue('scroll-timeline');
          if (tl && A.scrollDriven.length < 20) A.scrollDriven.push({ sel: trunc(sl, 90), timeline: tl, range: st.getPropertyValue('animation-range') });
        } else if (t === 7 && A.keyframes.length < 45) {
          A.keyframes.push({ name: r.name, css: trunc(r.cssText, 800) });
        } else if (t === 5 && A.fontFaces.length < 30) {
          const s = r.style;
          A.fontFaces.push({ family: s.getPropertyValue('font-family'), weight: s.getPropertyValue('font-weight'), style: s.getPropertyValue('font-style'), display: s.getPropertyValue('font-display'), src: trunc(s.getPropertyValue('src'), 200) });
        }
        if (r.cssRules && t !== 7) {
          if (t === 4) { const m = r.conditionText || r.media.mediaText; A.media.add(m); walk(r.cssRules, m); } else walk(r.cssRules, media);
        }
      }
    };
    for (const s of sheets) { try { walk(s.rs, ''); } catch {} }
    const widths = new Set();
    for (const m of A.media) for (const x of m.matchAll(/(min|max)-width:\s*([\d.]+)(px|em|rem)/g)) widths.add(Math.round(parseFloat(x[2]) * (x[3] === 'px' ? 1 : 16)));
    A.breakpoints = [...widths].sort((a, b) => a - b);
    A.prefersDark = [...A.media].some(m => /prefers-color-scheme/.test(m));
    A.reducedMotion = [...A.media].some(m => /prefers-reduced-motion/.test(m));
    delete A.media;
    return A;
  }

  // ---------- design tokens ----------
  function designTokens() {
    const m = { color: {}, bg: {}, font: {}, size: {}, weight: {}, radius: {}, shadow: {}, lh: {}, ls: {}, gap: {}, border: {} };
    const add = (k, v) => { if (v && !['none', 'normal', '0px', 'rgba(0, 0, 0, 0)', 'auto'].includes(v)) m[k][v] = (m[k][v] || 0) + 1; };
    for (const e of allEls().slice(0, 2500)) {
      const s = getComputedStyle(e);
      if ([...e.childNodes].some(c => c.nodeType === 3 && c.textContent.trim())) { add('color', s.color); add('font', s.fontFamily); add('size', s.fontSize); add('weight', s.fontWeight); add('lh', s.lineHeight); add('ls', s.letterSpacing); }
      add('bg', s.backgroundColor); add('radius', s.borderRadius); add('shadow', trunc(s.boxShadow, 120)); add('gap', s.gap);
      if (parseFloat(s.borderTopWidth)) add('border', `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`);
    }
    const b = getComputedStyle(document.body), h = getComputedStyle(document.documentElement);
    return {
      body: { bg: b.backgroundColor !== 'rgba(0, 0, 0, 0)' ? b.backgroundColor : h.backgroundColor, color: b.color, font: b.fontFamily, size: b.fontSize, lineHeight: b.lineHeight, bgImage: trunc(b.backgroundImage, 160) },
      colors: topN(m.color, 10), backgrounds: topN(m.bg, 12), fontFamilies: topN(m.font, 5), fontSizes: topN(m.size, 14), fontWeights: topN(m.weight, 6),
      lineHeights: topN(m.lh, 8), letterSpacings: topN(m.ls, 6), radii: topN(m.radius, 8), shadows: topN(m.shadow, 8), gaps: topN(m.gap, 8), borders: topN(m.border, 6)
    };
  }

  // ---------- layout outline ----------
  const styleOf = (s, hasText) => {
    const o = {}, put = (k, v) => { if (v && !['none', 'normal', 'auto', '0px', 'rgba(0, 0, 0, 0)', 'visible', 'static', '1'].includes(v)) o[k] = v; };
    put('bg', s.backgroundColor); put('bgImg', trunc(s.backgroundImage, 120)); put('pad', s.padding); put('margin', s.margin); put('radius', s.borderRadius);
    put('shadow', trunc(s.boxShadow, 100)); put('maxW', s.maxWidth); put('position', s.position); put('z', s.zIndex); put('opacity', s.opacity);
    put('transform', s.transform); put('filter', s.filter); put('backdrop', s.backdropFilter); put('overflow', s.overflow);
    if (parseFloat(s.borderTopWidth)) o.border = `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`;
    if (/flex|grid/.test(s.display)) {
      o.display = s.display;
      if (s.display.includes('flex')) { o.dir = s.flexDirection; o.justify = s.justifyContent; o.align = s.alignItems; if (s.flexWrap !== 'nowrap') o.wrap = s.flexWrap; } else o.cols = s.gridTemplateColumns;
      if (s.gap !== 'normal') o.gap = s.gap;
    } else if (s.display !== 'block') put('display', s.display);
    if (hasText) { o.color = s.color; o.font = `${s.fontSize}/${s.lineHeight} ${s.fontWeight} ${s.fontFamily.split(',')[0]}`; put('ls', s.letterSpacing); put('textAlign', s.textAlign === 'start' ? '' : s.textAlign); put('textTransform', s.textTransform); }
    return o;
  };

  function outline() {
    const visible = el => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && (r.width > 0 || r.height > 0) && !SKIP.has(el.tagName); };
    const node = (el, d, ctx) => {
      if (ctx.n >= ctx.max) return null;
      ctx.n++;
      const s = getComputedStyle(el), r = el.getBoundingClientRect();
      const own = trunc([...el.childNodes].filter(c => c.nodeType === 3).map(c => c.textContent).join(' '), 100);
      const o = { sel: sel(el), size: [Math.round(r.width), Math.round(r.height)], css: styleOf(s, !!own) };
      if (el.getAttribute('role')) o.role = el.getAttribute('role');
      if (own) o.text = own;
      if (el.tagName === 'A') o.href = el.getAttribute('href');
      if (el.tagName === 'IMG') { o.src = el.currentSrc || el.src; o.alt = trunc(el.alt, 60); }
      if (el.tagName.toLowerCase() === 'svg') { o.svg = el.getAttribute('viewBox'); return o; }
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) { o.type = el.type; o.placeholder = el.placeholder; }
      if (el.tagName === 'VIDEO' || el.tagName === 'CANVAS') return o;
      if (d < 6) {
        const kids = [...el.children].filter(visible);
        const out = [];
        for (const k of kids.slice(0, 14)) { const c = node(k, d + 1, ctx); if (c) out.push(c); }
        if (out.length) o.children = out;
        if (kids.length > 14) o.moreSiblings = kids.length - 14;
      }
      return o;
    };
    let root = document.body, hops = 0;
    while (hops++ < 4) { const kids = [...root.children].filter(visible); if (kids.length === 1 && kids[0].children.length) root = kids[0]; else break; }
    const secs = [...root.children].filter(visible);
    const per = Math.max(14, Math.floor(180 / Math.max(1, secs.length)));
    return secs.slice(0, 30).map(el => node(el, 0, { n: 0, max: per })).filter(Boolean);
  }

  function copyText() {
    return {
      headings: $$('h1,h2,h3,h4').slice(0, 50).map(h => `${h.tagName}: ${trunc(h.textContent, 120)}`),
      paragraphs: $$('p').slice(0, 30).map(p => trunc(p.textContent, 220)),
      ctas: $$('button,[role=button],a[class*=btn],a[class*=button]').slice(0, 30).map(b => trunc(b.textContent, 50)).filter(Boolean),
      nav: $$('nav a,header a').slice(0, 40).map(a => ({ text: trunc(a.textContent, 40), href: a.getAttribute('href') })),
      footer: trunc((document.querySelector('footer') || {}).textContent, 400)
    };
  }

  // ---------- motion ----------
  function computedMotion() {
    const seen = new Map();
    for (const e of allEls().slice(0, 2500)) {
      const s = getComputedStyle(e);
      const tr = s.transitionDuration.split(',').some(d => parseFloat(d) > 0), an = s.animationName !== 'none';
      if (!tr && !an) continue;
      const o = { transition: tr ? { property: s.transitionProperty, duration: s.transitionDuration, easing: s.transitionTimingFunction, delay: s.transitionDelay } : undefined, animation: an ? { name: s.animationName, duration: s.animationDuration, easing: s.animationTimingFunction, iterations: s.animationIterationCount, delay: s.animationDelay, fill: s.animationFillMode, direction: s.animationDirection } : undefined };
      const k = JSON.stringify(o);
      const g = seen.get(k) || { ...o, count: 0, examples: [] };
      g.count++; if (g.examples.length < 3) g.examples.push(sel(e));
      seen.set(k, g);
    }
    return [...seen.values()].sort((a, b) => b.count - a.count).slice(0, 40);
  }

  function runningAnims() {
    const out = new Map();
    try {
      for (const a of document.getAnimations().slice(0, 80)) {
        const ef = a.effect, tg = ef && ef.target;
        let kf = [];
        try { kf = ef.getKeyframes().slice(0, 6).map(k => { const o = {}; for (const [p, v] of Object.entries(k)) if (!['composite', 'computedOffset'].includes(p) && v != null) o[p] = String(v).slice(0, 80); return o; }); } catch {}
        const t = ef && ef.getTiming ? ef.getTiming() : {};
        const item = { type: a.constructor.name, name: a.animationName || a.transitionProperty || a.id || '', target: tg ? sel(tg) : '', duration: t.duration, easing: t.easing, iterations: t.iterations, delay: t.delay, keyframes: kf };
        out.set(JSON.stringify([item.name, item.target, kf]), item);
      }
    } catch {}
    return [...out.values()];
  }

  async function scrollSweep() {
    const log = new Map(), anims = new Map();
    const mo = new MutationObserver(ms => {
      for (const m of ms) {
        const t = m.target;
        if (!(t instanceof Element) || log.size > 120) continue;
        const k = sel(t) + '|' + m.attributeName;
        const cur = m.attributeName === 'style' ? t.getAttribute('style') : String(t.className && t.className.baseVal !== undefined ? t.className.baseVal : t.className);
        const o = log.get(k) || { target: sel(t), attr: m.attributeName, changes: 0, firstBefore: trunc(m.oldValue, 160) };
        o.changes++; o.last = trunc(cur, 160);
        log.set(k, o);
      }
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'], attributeOldValue: true, subtree: true });
    const H = document.documentElement.scrollHeight, step = Math.max(300, innerHeight * 0.7), startY = scrollY;
    for (let y = 0; y < Math.min(H, 30000); y += step) {
      scrollTo({ top: y, behavior: 'instant' });
      await sleep(380);
      for (const a of runningAnims()) anims.set(JSON.stringify([a.name, a.target, a.keyframes]), a);
    }
    scrollTo({ top: startY, behavior: 'instant' });
    await sleep(250);
    mo.disconnect();
    return { pageHeight: H, styleOrClassChangesWhileScrolling: [...log.values()].sort((a, b) => b.changes - a.changes).slice(0, 60), animationsSeenWhileScrolling: [...anims.values()].slice(0, 60) };
  }

  const motionHints = () => ({
    aos: cnt('[data-aos]'), dataScroll: cnt('[data-scroll],[data-scroll-section]'), framerMotion: cnt('[data-framer-appear-id],[data-projection-id]'),
    canvas: cnt('canvas'), video: cnt('video'), lottie: cnt('lottie-player,dotlottie-player,[data-lottie]'), svgSMIL: cnt('animate,animateTransform,animateMotion'),
    svg: cnt('svg'), inlineTransforms: cnt('[style*="transform"]'), inlineOpacity: cnt('[style*="opacity"]'), willChange: cnt('[style*="will-change"]'),
    splitText: cnt('.char,.word,.line,[class*=split]'), marquee: cnt('marquee,[class*=marquee]'), parallax: cnt('[class*=parallax],[data-parallax],[data-speed]'),
    carousel: cnt('[class*=swiper],[class*=slick],[class*=carousel],[class*=embla]'), smoothScrollContainer: cnt('.lenis,[data-lenis-prevent],.locomotive-scroll,[data-scroll-container]'),
    sticky: allEls().slice(0, 1500).filter(e => getComputedStyle(e).position === 'sticky').length, scrollSnap: allEls().slice(0, 600).filter(e => getComputedStyle(e).scrollSnapType !== 'none').length
  });
  const inlineStyleSamples = () => $$('[style*="transform"],[style*="opacity"],[style*="will-change"]').slice(0, 25).map(e => ({ target: sel(e), style: trunc(e.getAttribute('style'), 200) }));

  // ---------- assets, stack, interactions ----------
  function assets() {
    const bg = new Set();
    for (const e of allEls().slice(0, 1500)) { const b = getComputedStyle(e).backgroundImage; if (b.includes('url(') && bg.size < 20) bg.add(trunc(b, 200)); }
    const fonts = new Set();
    try { for (const f of document.fonts) if (f.status === 'loaded') fonts.add(`${f.family} ${f.weight} ${f.style}`); } catch {}
    return {
      images: $$('img').slice(0, 30).map(i => ({ src: i.currentSrc || i.src, alt: trunc(i.alt, 60), w: i.naturalWidth, h: i.naturalHeight, loading: i.loading })),
      backgroundImages: [...bg], inlineSvgCount: cnt('svg'),
      videos: $$('video').slice(0, 6).map(v => ({ src: v.currentSrc, poster: v.poster, autoplay: v.autoplay, loop: v.loop, muted: v.muted })),
      iconLibs: ['[class*="fa-"]:not([class*="fa-bars-x"])', '[class*="lucide"]', '.material-icons,.material-symbols-outlined', '[class^="bi-"]', '[class*="ri-"]', '[class*="feather"]'].filter(s => cnt(s)),
      fontLinks: $$('link[href*="fonts.googleapis"],link[href*="typekit"],link[href*="fonts.bunny"]').map(l => l.href),
      fontsLoaded: [...fonts].slice(0, 24)
    };
  }

  function stackInfo(g) {
    const fw = [], css = [], libs = [], services = [];
    const v = k => (g[k] && g[k] !== true ? ' ' + g[k] : '');
    const sample = allEls().slice(0, 600);
    const tw = sample.filter(e => [...e.classList].some(c => /^(flex|grid|px-\d|py-\d|p-\d|text-(xs|sm|base|lg|xl)|bg-\w+-\d{2,3}|rounded(-\w+)?|(sm|md|lg|xl):.+|gap-\d|items-center|justify-between)$/.test(c))).length;
    if (g['Next.js'] || cnt('#__next')) fw.push('Next.js' + (g.React ? ` (React${v('React')})` : '')); 
    else if (g.Nuxt || cnt('#__nuxt')) fw.push('Nuxt (Vue)');
    else if (g.Remix) fw.push('Remix (React)'); else if (g.Gatsby) fw.push('Gatsby (React)');
    else if (g.React || cnt('[data-reactroot]')) fw.push('React' + v('React'));
    else if (g.Vue || cnt('[data-v-app]')) fw.push('Vue' + v('Vue'));
    else if (cnt('[ng-version]')) fw.push('Angular ' + (document.querySelector('[ng-version]').getAttribute('ng-version')));
    else if (cnt('astro-island,[data-astro-cid]')) fw.push('Astro');
    else if (cnt('[class*="svelte-"]')) fw.push('Svelte');
    if (cnt('[data-wf-page]') || g.Webflow) fw.push('Webflow'); if (cnt('[class*="framer-"]')) fw.push('Framer');
    if (cnt('link[href*="wp-content"],script[src*="wp-content"]')) fw.push('WordPress'); if (g.Shopify) fw.push('Shopify');
    if (tw > sample.length * 0.25) css.push('Tailwind CSS'); if (cnt('[class*="col-md-"],[class*="col-lg-"]') > 3) css.push('Bootstrap');
    if (cnt('[class*="Mui"]')) css.push('Material UI'); if (cnt('[class*="chakra-"]')) css.push('Chakra UI'); if (cnt('[data-radix-popper-content-wrapper],[data-radix-collection-item],[data-state][data-orientation]')) css.push('Radix UI / shadcn-style components');
    for (const k of ['GSAP', 'ScrollTrigger', 'Lenis', 'Locomotive', 'Three.js', 'Lottie', 'Anime', 'Swiper', 'AOS', 'jQuery', 'Alpine', 'htmx', 'PIXI', 'p5', 'Barba', 'ScrollMagic', 'SplitType', 'Splitting', 'tsParticles']) if (g[k]) libs.push(k + v(k));
    if (cnt('[data-framer-appear-id],[data-projection-id]')) libs.push('Framer Motion');
    for (const k of ['Firebase', 'Supabase', 'Stripe', 'Sentry', 'Apollo', 'GoogleTagManager']) if (g[k]) services.push(k);
    const scripts = $$('script[src]').map(s => s.src).slice(0, 60);
    const summary = [...fw, ...css, ...libs].join(' + ') || 'Plain HTML/CSS/JS (no framework detected)';
    return { summary, frameworks: fw, cssFrameworks: css, libs, services, generator: (document.querySelector('meta[name=generator]') || {}).content, scriptHosts: [...new Set(scripts.map(s => { try { return new URL(s).host; } catch { return ''; } }))], scriptSamples: scripts.slice(0, 25).map(s => s.split('/').slice(-2).join('/').slice(0, 80)), nextData: g.nextData };
  }

  const interactions = () => ({
    forms: $$('form').slice(0, 6).map(f => ({ action: f.getAttribute('action'), method: f.method, fields: $$('input,select,textarea', f).slice(0, 15).map(i => ({ type: i.type || i.tagName, name: i.name, placeholder: i.placeholder, required: i.required })) })),
    components: { dialogs: cnt('dialog,[role=dialog]'), tabs: cnt('[role=tab]'), accordions: cnt('details,[aria-expanded]'), menus: cnt('[role=menu],[role=menubar]'), tooltips: cnt('[role=tooltip],[data-tooltip]'), carousels: cnt('[class*=swiper],[class*=slick],[class*=carousel],[class*=embla]') },
    darkModeToggle: cnt('[class*=theme-toggle],[aria-label*="theme" i],[aria-label*="dark" i]') > 0
  });

  const pageMeta = () => {
    const m = n => (document.querySelector(`meta[name="${n}"],meta[property="${n}"]`) || {}).content;
    return { title: document.title, url: location.href, lang: document.documentElement.lang, dir: document.dir, description: m('description'), viewport: m('viewport'), themeColor: m('theme-color'), ogImage: m('og:image'), favicon: (document.querySelector('link[rel~=icon]') || {}).href, manifest: (document.querySelector('link[rel=manifest]') || {}).href, preferredScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' };
  };

  // ---------- backend-observable data ----------
  function netSummary() {
    const groups = new Map();
    const norm = u => {
      try { const x = new URL(u, location.href); return { origin: x.origin, path: x.pathname.replace(/\/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '/:uuid').replace(/\/\d{2,}/g, '/:id').replace(/\/[A-Za-z0-9_-]{22,}/g, '/:token'), q: [...x.searchParams.keys()] }; }
      catch { return { origin: '', path: u, q: [] }; }
    };
    const keepH = h => Object.fromEntries(Object.entries(h || {}).filter(([k]) => /^(cache-control|content-type|server|x-|access-control|etag|vary|retry-after|ratelimit|link|via|cf-|age)/i.test(k)).slice(0, 12));
    for (const e of LOG) {
      const n = norm(e.url), k = `${e.method} ${n.origin}${n.path}`;
      const g = groups.get(k) || { method: e.method, origin: n.origin, path: n.path, kind: e.kind, calls: 0, statuses: {}, queryParams: new Set(), authHeaders: new Set(), requestHeaders: {}, avgMs: 0 };
      g.calls++; g.statuses[e.status || (e.error ? 'failed' : 'n/a')] = (g.statuses[e.status || (e.error ? 'failed' : 'n/a')] || 0) + 1;
      n.q.forEach(x => g.queryParams.add(x));
      for (const [h, val] of Object.entries(e.reqHeaders || {})) { if (val === '<redacted>') g.authHeaders.add(h.toLowerCase()); else if (Object.keys(g.requestHeaders).length < 10) g.requestHeaders[h] = val; }
      if (e.reqBody) g.requestBody = e.reqBody;
      if (e.resShape) g.responseShape = e.resShape;
      if (e.contentType) g.contentType = e.contentType;
      if (e.resHeaders) g.responseHeaders = keepH(e.resHeaders);
      if (e.ms) g.avgMs = Math.round((g.avgMs * (g.calls - 1) + e.ms) / g.calls);
      if (e.size) g.responseBytes = e.size;
      groups.set(k, g);
    }
    return [...groups.values()].map(g => ({ ...g, queryParams: [...g.queryParams], authHeaders: [...g.authHeaders] })).sort((a, b) => b.calls - a.calls).slice(0, 80);
  }

  const thirdParty = () => {
    const o = {};
    for (const r of performance.getEntriesByType('resource')) { let u; try { u = new URL(r.name); } catch { continue; } const t = (o[u.origin] ||= {}); t[r.initiatorType] = (t[r.initiatorType] || 0) + 1; }
    return Object.entries(o).map(([origin, types]) => ({ origin, sameOrigin: origin === location.origin, types })).slice(0, 40);
  };
  async function storageInfo() {
    const o = {};
    try { o.cookieNames = document.cookie.split(';').map(c => c.split('=')[0].trim()).filter(Boolean).slice(0, 30); } catch {}
    try { o.localStorageKeys = Object.keys(localStorage).slice(0, 40); o.sessionStorageKeys = Object.keys(sessionStorage).slice(0, 40); } catch {}
    try { o.indexedDB = (await indexedDB.databases()).map(d => d.name).slice(0, 10); } catch {}
    try { o.cacheStorage = await caches.keys(); } catch {}
    try { o.serviceWorkers = (await navigator.serviceWorker.getRegistrations()).map(r => r.scope); } catch {}
    return o;
  }
  async function docHeaders() {
    try {
      const r = await fetch(location.href, { method: 'HEAD', credentials: 'omit', cache: 'no-store' });
      const h = {}; r.headers.forEach((val, k) => { if (!/^(set-cookie|cookie|authorization)/i.test(k)) h[k] = val.slice(0, 200); });
      return { status: r.status, headers: h };
    } catch (e) { return { error: String(e) }; }
  }
  const getGlobals = () => new Promise(res => {
    const id = Math.random().toString(36).slice(2);
    const h = e => { if (e.source === window && e.data && e.data.__scRes && e.data.id === id) { removeEventListener('message', h); res(e.data.globals); } };
    addEventListener('message', h);
    postMessage({ __scReq: 1, id }, '*');
    setTimeout(() => { removeEventListener('message', h); res({}); }, 800);
  });

  // ---------- full technology inventory (evidence-based, no AI needed) ----------
  function techReport(g, stack, doc, a) {
    const urls = [...new Set([...performance.getEntriesByType('resource').map(r => r.name), ...$$('script[src]').map(s => s.src), ...$$('link[href]').map(l => l.href), ...$$('iframe[src]').map(f => f.src), ...LOG.map(e => e.url)])];
    const hdr = {};
    for (const [k, v] of Object.entries((doc && doc.headers) || {})) hdr[k.toLowerCase()] = String(v);
    let cookies = [];
    try { cookies = document.cookie.split(';').map(c => c.split('=')[0].trim()).filter(Boolean); } catch {}
    const found = new Map();
    const add = (cat, name, ev) => {
      const k = cat + '|' + name;
      if (!found.has(k)) found.set(k, { cat, name, ev: [] });
      const f = found.get(k), e = trunc(ev, 120);
      if (e && f.ev.length < 2 && !f.ev.includes(e)) f.ev.push(e);
    };
    const HS = 'Hosting, CDN & server', SS = 'Server-side (inferred)', FR = 'Frameworks & rendering', UI = 'UI & styling', AN = 'Animation & graphics', JL = 'JavaScript libraries', BT = 'Build tooling', BE = 'Backend services & APIs', CM = 'CMS & e-commerce', AU = 'Authentication', PY = 'Payments', AM = 'Analytics & marketing', MO = 'Monitoring & performance', SM = 'Search & media', ME = 'Maps & embeds', FI = 'Fonts & icons', SE = 'Security & bot protection', PW = 'Protocols & web platform';
    const ORDER = [FR, UI, AN, JL, BT, HS, SS, BE, CM, AU, PY, AM, MO, SM, ME, FI, SE, PW];

    const UR = [
      [HS, 'Vercel', /vercel\.app|\/_vercel\//], [HS, 'Netlify', /netlify\.(app|com)/], [HS, 'Cloudflare Pages / Workers', /pages\.dev|workers\.dev/], [HS, 'GitHub Pages', /github\.io/],
      [HS, 'Firebase Hosting', /\.web\.app|firebaseapp\.com/], [HS, 'AWS CloudFront', /cloudfront\.net/], [HS, 'AWS S3', /s3[.-][\w-]*amazonaws\.com|s3\.amazonaws\.com/], [HS, 'Google Cloud Storage', /storage\.googleapis\.com/],
      [HS, 'Azure (CDN / Static Web Apps / Blob)', /azureedge\.net|azurestaticapps\.net|blob\.core\.windows\.net/], [HS, 'Fastly', /fastly(lb)?\.net/], [HS, 'Akamai', /akamai(hd|edge)?\.net|akamaized\.net/],
      [HS, 'jsDelivr CDN', /cdn\.jsdelivr\.net/], [HS, 'unpkg CDN', /unpkg\.com/], [HS, 'cdnjs CDN', /cdnjs\.cloudflare\.com/], [HS, 'esm.sh CDN', /esm\.sh/], [HS, 'Bunny CDN', /b-cdn\.net/],
      [BT, 'Vite', /\/@vite\/client|\/assets\/index-[\w-]{6,}\.(js|css)/], [BT, 'Webpack', /\/_next\/static\/chunks\/webpack-|\/static\/js\/(main|runtime)[.~][\w.]*\.js/], [BT, 'Turbopack', /turbopack/i], [BT, 'Astro build output', /\/_astro\//],
      [FR, 'Next.js', /\/_next\/static\//], [FR, 'Nuxt', /\/_nuxt\//], [FR, 'SvelteKit', /\/_app\/immutable\//], [FR, 'Gatsby', /\/page-data\/.*page-data\.json/],
      [CM, 'WordPress', /wp-(content|includes|json)/], [CM, 'Shopify', /cdn\.shopify\.com|\/cdn\/shop\//], [CM, 'Wix', /wixstatic\.com|parastorage\.com/], [CM, 'Squarespace', /squarespace(-cdn)?\.com|sqspcdn/],
      [CM, 'Webflow', /website-files\.com|webflow\.(com|io)/], [CM, 'Framer', /framerusercontent\.com|framer\.(com|website)/], [CM, 'Contentful', /ctfassets\.net|contentful\.com/], [CM, 'Sanity', /cdn\.sanity\.io/],
      [CM, 'Prismic', /prismic\.io/], [CM, 'Storyblok', /storyblok\.com/], [CM, 'DatoCMS', /datocms-assets\.com/], [CM, 'Ghost', /\/ghost\/api\//],
      [BE, 'Firebase (Firestore / Realtime DB)', /firebaseio\.com|firestore\.googleapis\.com|firebasestorage\.googleapis\.com/], [BE, 'Supabase', /\.supabase\.(co|in)/], [BE, 'Appwrite', /appwrite/i], [BE, 'Hasura', /hasura/i],
      [BE, 'GraphQL API', /\/graphql(\?|$)/], [BE, 'Convex', /convex\.cloud/], [BE, 'AWS API Gateway / Amplify', /execute-api\.[\w-]+\.amazonaws\.com|amplifyapp\.com/], [BE, 'AWS Lambda function URL', /lambda-url\./],
      [BE, 'Google Cloud Run / Functions', /\.run\.app|cloudfunctions\.net/], [BE, 'Azure App Service / Functions', /azurewebsites\.net/], [BE, 'Heroku', /herokuapp\.com/], [BE, 'Render', /onrender\.com/],
      [BE, 'Railway', /railway\.app/], [BE, 'Fly.io', /\.fly\.dev/], [BE, 'Pusher (realtime)', /pusher(app)?\.com/], [BE, 'Ably (realtime)', /ably(-realtime)?\.com/], [BE, 'Socket.IO', /socket\.io\//], [BE, 'tRPC', /\/api\/trpc\//],
      [AU, 'Auth0', /auth0\.com/], [AU, 'Clerk', /clerk\.(accounts\.dev|com)|clerk-js/], [AU, 'Firebase Auth', /identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com/], [AU, 'Okta', /okta(preview)?\.com/],
      [AU, 'AWS Cognito', /cognito-(idp|identity)\./], [AU, 'Google Sign-In', /accounts\.google\.com\/gsi/], [AU, 'NextAuth / Auth.js', /\/api\/auth\/(session|csrf|providers)/], [AU, 'Stytch', /stytch\.com/],
      [PY, 'Stripe', /js\.stripe\.com|api\.stripe\.com/], [PY, 'PayPal', /paypal(objects)?\.com/], [PY, 'Razorpay', /razorpay\.com/], [PY, 'Square', /squareup\.com|squarecdn\.com/], [PY, 'Paddle', /paddle\.com/],
      [PY, 'Lemon Squeezy', /lemonsqueezy\.com/], [PY, 'Braintree', /braintreegateway\.com|braintree-api/], [PY, 'Adyen', /adyen\.com/], [PY, 'Klarna', /klarna\.com/],
      [AM, 'Google Analytics', /google-analytics\.com|googletagmanager\.com\/gtag/], [AM, 'Google Tag Manager', /googletagmanager\.com\/gtm\.js/], [AM, 'Meta (Facebook) Pixel', /connect\.facebook\.net|facebook\.com\/tr/],
      [AM, 'Hotjar', /hotjar\.com/], [AM, 'Microsoft Clarity', /clarity\.ms/], [AM, 'Mixpanel', /mixpanel\.com/], [AM, 'Segment', /segment\.(com|io)/], [AM, 'Amplitude', /amplitude\.com/], [AM, 'PostHog', /posthog\.com/],
      [AM, 'Plausible', /plausible\.io/], [AM, 'Fathom', /usefathom\.com/], [AM, 'Heap', /heapanalytics\.com/], [AM, 'Intercom', /intercom(cdn)?\.(io|com)/], [AM, 'Crisp chat', /crisp\.chat/], [AM, 'Drift', /drift\.com/],
      [AM, 'HubSpot', /hs-(scripts|analytics|banner)\.net|hubspot\.com|hsforms/], [AM, 'Mailchimp', /mailchimp\.com|chimpstatic\.com/], [AM, 'Klaviyo', /klaviyo\.com/], [AM, 'TikTok Pixel', /analytics\.tiktok\.com/],
      [AM, 'LinkedIn Insight Tag', /snap\.licdn\.com|px\.ads\.linkedin\.com/], [AM, 'X (Twitter) Ads', /static\.ads-twitter\.com/], [AM, 'Vercel Analytics', /\/_vercel\/(insights|speed-insights)/],
      [AM, 'Cloudflare Web Analytics', /cloudflareinsights\.com/], [AM, 'Google Ads / DoubleClick', /doubleclick\.net|googleadservices\.com|googlesyndication\.com/], [AM, 'Zendesk', /zdassets\.com|zendesk\.com/],
      [AM, 'Tawk.to chat', /tawk\.to/], [AM, 'OneTrust consent', /onetrust\.com|cookielaw\.org/], [AM, 'Cookiebot consent', /cookiebot\.com/],
      [MO, 'Sentry', /sentry\.io|sentry-cdn\.com/], [MO, 'Datadog RUM', /datadoghq\.(com|eu)/], [MO, 'LogRocket', /logrocket\.(com|io)|lr-ingest/], [MO, 'New Relic', /newrelic\.com|nr-data\.net/], [MO, 'Bugsnag', /bugsnag\.com/],
      [MO, 'FullStory', /fullstory\.com/], [MO, 'Rollbar', /rollbar\.com/],
      [SM, 'Algolia search', /algolia(net)?\.(net|com)/], [SM, 'Meilisearch', /meilisearch/i], [SM, 'Typesense', /typesense/i], [SM, 'Cloudinary', /res\.cloudinary\.com/], [SM, 'imgix', /imgix\.net/],
      [SM, 'Next.js image optimization', /\/_next\/image\?/], [SM, 'Unsplash images', /images\.unsplash\.com/], [SM, 'Mux video', /mux\.com/], [SM, 'Cloudflare Stream', /videodelivery\.net/], [SM, 'ImageKit', /imagekit\.io/],
      [ME, 'Google Maps', /maps\.googleapis\.com|google\.com\/maps/], [ME, 'Mapbox', /api\.mapbox\.com/], [ME, 'OpenStreetMap tiles', /tile\.openstreetmap\.org/], [ME, 'YouTube embed', /youtube(-nocookie)?\.com\/(embed|iframe_api)|ytimg\.com/],
      [ME, 'Vimeo player', /player\.vimeo\.com/], [ME, 'Calendly', /calendly\.com/], [ME, 'Typeform', /typeform\.com/], [ME, 'Spotify embed', /open\.spotify\.com\/embed/], [ME, 'Disqus comments', /disqus\.com/],
      [FI, 'Google Fonts', /fonts\.(googleapis|gstatic)\.com/], [FI, 'Adobe Fonts (Typekit)', /use\.typekit\.net|p\.typekit\.net/], [FI, 'Bunny Fonts', /fonts\.bunny\.net/], [FI, 'Font Awesome', /fontawesome/i],
      [FI, 'Fontshare', /fontshare\.com/], [FI, 'Material Icons', /material-?icons|material-?symbols/i],
      [SE, 'Google reCAPTCHA', /google\.com\/recaptcha|gstatic\.com\/recaptcha/], [SE, 'hCaptcha', /hcaptcha\.com/], [SE, 'Cloudflare Turnstile', /challenges\.cloudflare\.com/], [SE, 'Cloudflare (/cdn-cgi/ endpoints)', /\/cdn-cgi\//],
      [SE, 'DataDome', /datadome\.co/], [SE, 'HUMAN / PerimeterX', /px-cdn\.net|perimeterx/],
      [AN, 'GSAP', /gsap/i], [AN, 'Lottie', /lottie(files)?/i], [AN, 'Rive', /rive\.app|\.riv(\?|$)/], [AN, 'Spline 3D', /spline\.design|my\.spline/], [AN, 'Three.js', /three(\.module)?(\.min)?\.js/],
      [AN, 'Lenis smooth scroll', /lenis/i], [AN, 'Locomotive Scroll', /locomotive-scroll/], [AN, 'Barba.js page transitions', /barba/i], [AN, 'AOS (Animate On Scroll)', /\/aos(\.min)?\.(js|css)|unpkg\.com\/aos/],
      [AN, 'Anime.js', /anime(\.min)?\.js/], [AN, 'tsParticles / particles.js', /particles(\.min)?\.js|tsparticles/i], [AN, 'Animate.css', /animate(\.min)?\.css/],
      [JL, 'jQuery', /jquery([-.]\d[\d.]*)?(\.min)?\.js/i], [JL, 'Swiper', /swiper/i], [JL, 'Splide', /splide/i], [JL, 'Slick carousel', /slick(\.min)?\.(js|css)/], [JL, 'Lodash', /lodash/i], [JL, 'Moment.js', /moment(\.min)?\.js/],
      [JL, 'Axios', /axios/i], [JL, 'D3', /\/d3(\.v\d+)?(\.min)?\.js/], [JL, 'Chart.js', /chart(\.umd)?(\.min)?\.js/], [JL, 'Alpine.js', /alpine(js)?(\.min)?\.js/], [JL, 'htmx', /htmx/i], [JL, 'Popper', /popper/i],
      [UI, 'Bootstrap', /bootstrap(\.bundle)?(\.min)?\.(js|css)/], [UI, 'Tailwind CSS (CDN)', /cdn\.tailwindcss\.com/], [UI, 'Bulma', /bulma(\.min)?\.css/],
      [PW, 'WebAssembly', /\.wasm(\?|$)/]
    ];
    for (const [cat, name, re] of UR) { const m = urls.find(u => re.test(u)); if (m) add(cat, name, 'request: ' + m); }

    const HR = [
      [HS, 'Cloudflare', 'cf-ray', /./], [HS, 'Cloudflare', 'server', /cloudflare/i], [HS, 'Vercel', 'x-vercel-id', /./], [HS, 'Vercel', 'server', /vercel/i], [HS, 'Netlify', 'x-nf-request-id', /./], [HS, 'Netlify', 'server', /netlify/i],
      [HS, 'AWS CloudFront', 'x-amz-cf-id', /./], [HS, 'AWS CloudFront', 'via', /cloudfront/i], [HS, 'Fastly', 'x-fastly-request-id', /./], [HS, 'Fastly', 'x-served-by', /cache-/i], [HS, 'Akamai', 'server', /akamai/i],
      [HS, 'GitHub Pages', 'server', /github\.com/i], [HS, 'Google Cloud', 'x-cloud-trace-context', /./], [HS, 'Google Frontend', 'server', /google frontend|^gse$|^esf$/i], [HS, 'Azure Front Door', 'x-azure-ref', /./],
      [HS, 'Render', 'x-render-origin-server', /./], [HS, 'Fly.io', 'fly-request-id', /./], [HS, 'Heroku router', 'via', /vegur/i], [HS, 'Varnish cache', 'x-varnish', /./],
      [HS, 'nginx', 'server', /nginx/i], [HS, 'Apache', 'server', /apache/i], [HS, 'Microsoft IIS', 'server', /iis/i], [HS, 'OpenResty', 'server', /openresty/i], [HS, 'LiteSpeed', 'server', /litespeed/i], [HS, 'Caddy', 'server', /caddy/i],
      [HS, 'Envoy proxy', 'server', /envoy/i], [HS, 'Kestrel', 'server', /kestrel/i],
      [SS, 'PHP', 'x-powered-by', /php/i], [SS, 'Express (Node.js)', 'x-powered-by', /express/i], [SS, 'ASP.NET', 'x-powered-by', /asp\.net/i], [SS, 'ASP.NET', 'x-aspnet-version', /./], [SS, 'Next.js server', 'x-powered-by', /next\.js/i],
      [SS, 'Next.js server', 'x-nextjs-cache', /./], [SS, 'Phusion Passenger (Ruby/Node/Python)', 'x-powered-by', /passenger/i], [SS, 'Ruby on Rails (likely)', 'x-runtime', /./],
      [CM, 'WordPress', 'link', /wp-json/], [CM, 'Drupal', 'x-generator', /drupal/i], [CM, 'Shopify', 'x-shopify-stage', /./], [CM, 'Wix', 'x-wix-request-id', /./], [CM, 'Squarespace', 'server', /squarespace/i],
      [SE, 'HSTS (Strict-Transport-Security)', 'strict-transport-security', /./], [SE, 'Content-Security-Policy', 'content-security-policy', /./], [SE, 'X-Frame-Options', 'x-frame-options', /./], [SE, 'Permissions-Policy', 'permissions-policy', /./],
      [PW, 'Brotli compression', 'content-encoding', /br/], [PW, 'gzip compression', 'content-encoding', /gzip/], [PW, 'zstd compression', 'content-encoding', /zstd/], [PW, 'HTTP/3 advertised', 'alt-svc', /h3/]
    ];
    for (const [cat, name, h, re] of HR) if (hdr[h] !== undefined && re.test(hdr[h])) add(cat, name, `header ${h}: ${hdr[h]}`);
    if (hdr.server) add(HS, `Server header: ${hdr.server}`, 'header server');
    if (hdr['x-powered-by']) add(SS, `X-Powered-By: ${hdr['x-powered-by']}`, 'header x-powered-by');

    const CR = [
      [SS, 'PHP', /^PHPSESSID$/], [SS, 'ASP.NET', /^ASP\.NET_SessionId$|^\.AspNetCore/], [SS, 'Java (servlet container)', /^JSESSIONID$/], [SS, 'Laravel (PHP)', /^laravel_session$/], [SS, 'Django (Python)', /^csrftoken$/],
      [SS, 'Node.js Express session', /^connect\.sid$/], [AU, 'NextAuth / Auth.js', /next-auth|authjs/], [AU, 'Supabase Auth', /^sb-.*-auth-token/], [AU, 'Clerk', /^__clerk|^__session/], [CM, 'Shopify', /^_shopify_/], [CM, 'WordPress', /^wordpress_|^wp-settings/],
      [AM, 'Google Analytics', /^_ga(_|$)/], [AM, 'Meta (Facebook) Pixel', /^_fbp$/], [AM, 'Hotjar', /^_hj/], [AM, 'HubSpot', /^hubspotutk$|^__hs/], [PY, 'Stripe', /^__stripe_/]
    ];
    for (const [cat, name, re] of CR) { const m = cookies.find(c => re.test(c)); if (m) add(cat, name, 'cookie: ' + m); }

    const DR = [
      [UI, 'Ant Design', '[class*="ant-"]'], [UI, 'Mantine', '[class*="mantine-"]'], [UI, 'Headless UI', '[id^="headlessui-"]'], [UI, 'Emotion (CSS-in-JS)', 'style[data-emotion]'], [UI, 'styled-components (CSS-in-JS)', 'style[data-styled]'],
      [UI, 'Font Awesome icons', '.fa,.fas,.far,.fab,[class*="fa-"]'], [FI, 'Material Icons', '.material-icons,.material-symbols-outlined'], [FI, 'Lucide icons', '[class*="lucide"]'], [FI, 'Bootstrap Icons', '[class^="bi-"]'],
      [AN, 'Lottie player', 'lottie-player,dotlottie-player,[data-lottie]'], [AN, 'AOS (Animate On Scroll)', '[data-aos]'], [AN, 'Spline viewer', 'spline-viewer'], [AN, 'Google model-viewer (3D)', 'model-viewer'],
      [AN, 'Canvas / WebGL rendering', 'canvas'], [AN, 'SVG SMIL animation', 'animate,animateTransform,animateMotion'], [AN, 'Parallax elements', '[data-parallax],[class*="parallax"]'],
      [SE, 'Google reCAPTCHA', '.g-recaptcha,iframe[src*="recaptcha"]'], [SE, 'hCaptcha', '.h-captcha'], [SE, 'Cloudflare Turnstile', '.cf-turnstile'],
      [ME, 'Google Maps embed', 'iframe[src*="google.com/maps"]'], [ME, 'YouTube embed', 'iframe[src*="youtube"]'], [ME, 'Vimeo embed', 'iframe[src*="vimeo"]'], [ME, 'Leaflet maps', '.leaflet-container'],
      [PW, 'HTML5 video', 'video'], [PW, 'Web Components (custom elements)', 'lottie-player,spline-viewer,model-viewer,[is]']
    ];
    for (const [cat, name, s] of DR) if (cnt(s)) add(cat, name, 'page DOM: ' + s);
    const sample = allEls().slice(0, 800);
    if (sample.filter(e => [...e.classList].some(c => /^[A-Za-z0-9]+_[A-Za-z0-9-]+__[A-Za-z0-9_-]{4,}$/.test(c))).length > 5) add(UI, 'CSS Modules (hashed class names)', 'class names like Component_name__hash');

    // detections from page globals and DOM (stack info)
    const libCat = n => (/^(jQuery|Alpine|htmx|Swiper|Barba)/.test(n) ? JL : AN);
    stack.frameworks.forEach(n => add(FR, n, 'page globals / DOM markers'));
    stack.cssFrameworks.forEach(n => add(UI, n, 'class names / DOM markers'));
    stack.libs.forEach(n => add(libCat(n), n, 'page global (version shown when exposed)'));
    const svc = { Firebase: BE, Supabase: BE, Apollo: BE, Stripe: PY, Sentry: MO, GoogleTagManager: AM };
    stack.services.forEach(n => add(svc[n] || BE, n === 'Apollo' ? 'Apollo Client (GraphQL)' : n, 'page global'));
    for (const k of ['Webpack', 'Parcel', 'Vite']) if (g[k]) add(BT, k, 'page global / chunk registry');
    if (stack.generator) add(CM, `Generator: ${stack.generator}`, 'meta generator tag');
    if (stack.nextData) add(FR, `Next.js ${stack.nextData.appRouter ? 'App Router' : 'Pages Router'}${stack.nextData.router && stack.nextData.router !== 'unknown' ? ' (' + stack.nextData.router + ')' : ''}`, '__NEXT_DATA__ / chunk paths');

    // web platform
    const nav = performance.getEntriesByType('navigation')[0];
    if (nav && nav.nextHopProtocol) add(PW, { h2: 'HTTP/2', h3: 'HTTP/3', 'http/1.1': 'HTTP/1.1' }[nav.nextHopProtocol] || nav.nextHopProtocol, 'navigation timing');
    if (LOG.some(e => e.kind === 'websocket')) add(PW, 'WebSocket', 'WebSocket connection observed');
    if (LOG.some(e => e.kind === 'sse')) add(PW, 'Server-Sent Events', 'EventSource observed');
    if (LOG.some(e => e.reqBody && e.reqBody.graphql)) add(BE, 'GraphQL API', 'GraphQL query in request body');
    if (navigator.serviceWorker && navigator.serviceWorker.controller) add(PW, 'Service Worker (offline / PWA)', 'active service worker');
    if (document.querySelector('link[rel=manifest]')) add(PW, 'Web App Manifest (PWA)', 'link rel=manifest');
    if (g['Three.js'] || cnt('canvas')) add(AN, 'WebGL / Canvas graphics', g['Three.js'] ? 'Three.js global' : 'canvas element');

    const categories = ORDER.map(cat => ({ category: cat, items: [...found.values()].filter(f => f.cat === cat).map(f => ({ name: f.name, evidence: f.ev })) })).filter(c => c.items.length);
    return { total: [...found.values()].length, categories };
  }

  // ---------- main ----------
  async function extract() {
    const sheets = await loadSheets();
    const css = analyzeCSS(sheets);
    const globals = await getGlobals();
    const stack = stackInfo(globals);
    const design = { ...designTokens(), cssVariables: css.vars, fontFaces: css.fontFaces, breakpoints: css.breakpoints, supportsDarkScheme: css.prefersDark, supportsReducedMotion: css.reducedMotion };
    const layout = { outline: outline(), copy: copyText() };
    const motion = { keyframes: css.keyframes, transitionRules: css.transitions, animationRules: css.animations, hoverFocusRules: css.hover, scrollDrivenCss: css.scrollDriven, computedMotion: computedMotion(), hints: motionHints(), inlineStyleSamples: inlineStyleSamples(), libraries: stack.libs };
    motion.runningNow = runningAnims();
    motion.scroll = await scrollSweep();
    const a = assets(), i = interactions(), meta = pageMeta(), doc = await docHeaders();
    const backend = { documentResponse: doc, endpoints: netSummary(), thirdPartyOrigins: thirdParty(), storage: await storageInfo(), realtime: LOG.filter(e => e.kind === 'websocket' || e.kind === 'sse').map(e => ({ kind: e.kind, url: e.url })).slice(0, 10), observedRequests: LOG.length };
    const techStack = techReport(globals, stack, doc, a);
    return { scan: { at: new Date().toISOString(), url: location.href, viewport: [innerWidth, innerHeight] }, meta, stack, techStack, design, layout, assets: a, interactions: i, motion, backend };
  }

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg.type === 'SC_PING') { reply({ ok: true, observed: LOG.length }); return; }
    if (msg.type === 'SC_EXTRACT') { extract().then(reply).catch(e => reply({ error: String(e && e.message || e) })); return true; }
  });
})();
