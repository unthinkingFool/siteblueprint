// Runs in the PAGE world at document_start: records network calls (shapes only, no secrets)
// and answers requests for page-global library detection.
(() => {
  if (window.__scHook) return;
  window.__scHook = true;
  const SENSITIVE = /^(authorization|cookie|x-api-key|x-auth|proxy-authorization|x-csrf|x-xsrf)/i;
  const send = entry => window.postMessage({ __sc: 1, entry }, '*');

  const shape = (v, d = 0) => {
    if (v === null) return 'null';
    if (Array.isArray(v)) return d > 3 ? 'array' : [`array(${v.length})`, v.length ? shape(v[0], d + 1) : 'empty'];
    if (typeof v === 'object') {
      if (d > 3) return 'object';
      const o = {};
      for (const k of Object.keys(v).slice(0, 30)) o[k] = shape(v[k], d + 1);
      return o;
    }
    return typeof v;
  };
  const safeHeaders = h => {
    const o = {};
    try { h.forEach((val, k) => { o[k] = SENSITIVE.test(k) ? '<redacted>' : String(val).slice(0, 120); }); } catch {}
    return o;
  };
  const bodyShape = b => {
    try {
      if (typeof b === 'string') {
        try {
          const j = JSON.parse(b);
          if (j && typeof j.query === 'string') return { graphql: j.query.slice(0, 300), variables: shape(j.variables || {}) };
          return shape(j);
        } catch { return b ? 'string(' + b.length + ')' : null; }
      }
      if (b instanceof FormData) return { formData: [...b.keys()] };
      if (b instanceof URLSearchParams) return { urlEncoded: [...b.keys()] };
      if (b) return Object.prototype.toString.call(b);
    } catch {}
    return null;
  };

  const of = window.fetch;
  window.fetch = async function (input, init = {}) {
    const t0 = performance.now();
    const req = input instanceof Request ? input : null;
    const entry = {
      kind: 'fetch',
      method: (init.method || (req && req.method) || 'GET').toUpperCase(),
      url: String(req ? req.url : input),
      reqHeaders: safeHeaders(new Headers(init.headers || (req && req.headers) || {})),
      reqBody: bodyShape(init.body),
      t: Date.now()
    };
    try {
      const res = await of.apply(this, arguments);
      entry.status = res.status;
      entry.ms = Math.round(performance.now() - t0);
      entry.resHeaders = safeHeaders(res.headers);
      const ct = res.headers.get('content-type') || '';
      entry.contentType = ct;
      if (/json/.test(ct)) {
        res.clone().text().then(tx => { try { entry.resShape = shape(JSON.parse(tx)); } catch {} entry.size = tx.length; send(entry); }).catch(() => send(entry));
      } else send(entry);
      return res;
    } catch (e) { entry.error = String(e); send(entry); throw e; }
  };

  const xo = XMLHttpRequest.prototype.open, xs = XMLHttpRequest.prototype.send, xh = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (m, u) {
    this.__sc = { kind: 'xhr', method: String(m).toUpperCase(), url: String(u), reqHeaders: {}, t: Date.now() };
    return xo.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    if (this.__sc) this.__sc.reqHeaders[k] = SENSITIVE.test(k) ? '<redacted>' : String(v).slice(0, 120);
    return xh.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const e = this.__sc;
    if (e) {
      e.reqBody = bodyShape(body);
      const t0 = performance.now();
      this.addEventListener('loadend', () => {
        e.status = this.status;
        e.ms = Math.round(performance.now() - t0);
        e.contentType = this.getResponseHeader('content-type') || '';
        e.resHeaders = {};
        (this.getAllResponseHeaders() || '').trim().split(/\r?\n/).forEach(l => {
          const i = l.indexOf(':');
          if (i > 0) { const k = l.slice(0, i).trim(); e.resHeaders[k] = SENSITIVE.test(k) ? '<redacted>' : l.slice(i + 1).trim().slice(0, 120); }
        });
        if (/json/.test(e.contentType) && (this.responseType === '' || this.responseType === 'text')) {
          try { e.resShape = shape(JSON.parse(this.responseText)); } catch {}
        }
        send(e);
      });
    }
    return xs.apply(this, arguments);
  };

  const wrap = (name, kind, method) => {
    const O = window[name];
    if (!O) return;
    window[name] = new Proxy(O, { construct(t, a, nt) { send({ kind, method, url: String(a[0]), t: Date.now() }); return Reflect.construct(t, a, nt); } });
  };
  wrap('WebSocket', 'websocket', 'WS');
  wrap('EventSource', 'sse', 'GET');

  const G = {
    'Next.js': '__NEXT_DATA__', Nuxt: '__NUXT__', React: 'React', ReactDOM: 'ReactDOM', Vue: 'Vue', Angular: 'ng', Remix: '__remixContext', Gatsby: '___gatsby',
    jQuery: 'jQuery', GSAP: 'gsap', ScrollTrigger: 'ScrollTrigger', Lenis: 'Lenis', Locomotive: 'LocomotiveScroll', 'Three.js': 'THREE', Lottie: 'lottie',
    Anime: 'anime', Swiper: 'Swiper', AOS: 'AOS', Webflow: 'Webflow', Alpine: 'Alpine', htmx: 'htmx', PIXI: 'PIXI', p5: 'p5', Barba: 'barba',
    ScrollMagic: 'ScrollMagic', SplitType: 'SplitType', Splitting: 'Splitting', tsParticles: 'tsParticles', Stripe: 'Stripe', Firebase: 'firebase',
    Supabase: 'supabase', Sentry: 'Sentry', Apollo: '__APOLLO_CLIENT__', Shopify: 'Shopify', WordPress: 'wp', GoogleTagManager: 'dataLayer'
  };
  const ver = w => w && (w.version || w.REVISION || (w.fn && w.fn.jquery) || w.VERSION);
  addEventListener('message', e => {
    if (e.source !== window || !e.data || !e.data.__scReq) return;
    const out = {};
    for (const [n, k] of Object.entries(G)) { try { if (k in window) out[n] = ver(window[k]) || true; } catch {} }
    try {
      const nd = window.__NEXT_DATA__;
      if (nd) out.nextData = { page: nd.page, buildId: nd.buildId, router: nd.nextExport ? 'static-export' : (nd.gssp ? 'getServerSideProps' : (nd.gsp ? 'getStaticProps' : 'unknown')), appRouter: !!document.querySelector('script[src*="/_next/static/chunks/app/"]'), pagePropsKeys: nd.props && nd.props.pageProps ? Object.keys(nd.props.pageProps).slice(0, 20) : [] };
    } catch {}
    try { const ks = Object.keys(window); if (ks.some(k => /^webpack(Chunk|Jsonp)/.test(k))) out.Webpack = true; if (window.parcelRequire) out.Parcel = true; if (ks.some(k => /^__vite/.test(k))) out.Vite = true; } catch {}
    window.postMessage({ __scRes: 1, id: e.data.id, globals: out }, '*');
  });
})();
