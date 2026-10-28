const DEF = { apiKey: '', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', maxIn: 12000, maxOut: 2500 };
let running = false, cancelled = false;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let progress = {};
const norm = c => ({ ...DEF, ...Object.fromEntries(Object.entries(c || {}).filter(([, v]) => v !== '' && v != null)) });
const base = cfg => String(cfg.baseUrl || DEF.baseUrl).trim().replace(/\/+$/, '');
const setJob = j => chrome.storage.local.set({ job: { ...progress, ...j } });
async function setOut(kind, text) {
  const { outputs = {} } = await chrome.storage.local.get('outputs');
  outputs[kind] = text;
  await chrome.storage.local.set({ outputs });
}

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.runtime.onInstalled.addListener(d => { if (d.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('manual.html') }); });
chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg.type === 'FETCH_TEXT') { fetch(msg.url).then(r => r.text()).then(text => reply({ text })).catch(e => reply({ error: String(e) })); return true; }
  if (msg.type === 'GENERATE') { generate(msg.job); reply({ started: true }); return; }
  if (msg.type === 'CANCEL') { cancelled = true; reply({}); }
  if (msg.type === 'TEST_KEY') { testKey(msg.cfg).then(reply); return true; }
});

function friendly(status, body, url) {
  if (status === 401 || status === 403) return 'Your API key was rejected. Copy it again from the provider, paste it in step 1 and press "Test & save".';
  if (status === 404) return `Not found (404) at ${url || 'the Base URL'}. Check the Base URL and model under Advanced in step 1, or re-select your provider.`;
  if (status === 413 || /too large|reduce your message/i.test(body)) return 'Too much data per request. Open Advanced in step 1 and lower "Max input chars per call" to 6000.';
  if (/per day|TPD/i.test(body)) return 'Your free daily limit is used up. Try again tomorrow or switch provider in step 1.';
  return `The AI provider returned an error (${status}): ${String(body).slice(0, 200)}`;
}
async function pickModel(cfg) {
  const r = await fetch(base(cfg) + '/models', { headers: { Authorization: 'Bearer ' + cfg.apiKey } });
  if (!r.ok) return { status: r.status, body: await r.text(), url: base(cfg) + '/models' };
  const j = await r.json();
  const ids = (j.data || j.models || []).map(m => String(m.id || m.name || '').replace(/^models\//, '')).filter(Boolean);
  const chat = ids.filter(id => !/whisper|tts|speech|guard|embed|orpheus|playai|moderation|transcri|safeguard|image/i.test(id));
  if (chat.includes(String(cfg.model).replace(/^models\//, ''))) return { model: cfg.model };
  for (const p of [/llama-3\.3-70b/, /gpt-oss-120b/, /llama.*70b/, /gpt-oss/, /llama/, /gemini.*flash/, /./]) { const m = chat.find(id => p.test(id)); if (m) return { model: m }; }
  return { status: 404, body: 'No chat models available for this key.', url: base(cfg) + '/models' };
}
async function testKey(c) {
  const cfg = norm(c);
  if (!cfg.apiKey) return { ok: false, error: 'Paste your API key first.' };
  try {
    const p = await pickModel(cfg);
    if (p.status) return { ok: false, error: friendly(p.status, p.body, p.url) };
    cfg.model = p.model;
    const url = base(cfg) + '/chat/completions';
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey }, body: JSON.stringify({ model: cfg.model, max_tokens: 5, messages: [{ role: 'user', content: 'Say OK' }] }) });
    if (res.ok) return { ok: true, model: cfg.model };
    return { ok: false, error: friendly(res.status, await res.text(), url) };
  } catch (e) { return { ok: false, error: 'Could not reach the provider. Check your internet connection and the Base URL.' }; }
}

// ---------- LLM call (OpenAI-compatible: Groq, OpenRouter, Cerebras, Gemini-compat, ...) ----------
async function llm(cfg, system, user, label) {
  for (let attempt = 0; attempt < 7; attempt++) {
    if (cancelled) throw new Error('Cancelled');
    const res = await fetch(base(cfg) + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
      body: JSON.stringify({ model: cfg.model, temperature: 0.2, max_tokens: Number(cfg.maxOut), messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })
    });
    if (res.ok) {
      const j = await res.json();
      return String((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '').replace(/<think>[\s\S]*?<\/think>/g, '');
    }
    const body = await res.text();
    if ((res.status === 429 || res.status >= 500) && !/per day|TPD/i.test(body)) {
      let wait = parseFloat(res.headers.get('retry-after')) || 0;
      const m = /try again in (?:(\d+)m)?\s*([\d.]+)s/i.exec(body);
      if (!wait && m) wait = (m[1] ? +m[1] * 60 : 0) + parseFloat(m[2]);
      wait = Math.min(Math.ceil(wait || 12 + attempt * 8) + 1, 120);
      for (let s = wait; s > 0; s--) {
        if (cancelled) throw new Error('Cancelled');
        await setJob({ running: true, step: `${label} — rate limited, retrying in ${s}s` });
        await sleep(1000);
      }
      continue;
    }
    if (!cfg._picked && (res.status === 404 || (res.status === 400 && /model/i.test(body)))) {
      cfg._picked = true;
      const p = await pickModel(cfg).catch(() => ({}));
      if (p.model && p.model !== cfg.model) {
        cfg.model = p.model;
        const { cfg: old = {} } = await chrome.storage.local.get('cfg');
        await chrome.storage.local.set({ cfg: { ...old, model: p.model } });
        continue;
      }
    }
    throw new Error(friendly(res.status, body, base(cfg) + '/chat/completions'));
  }
  throw new Error('Rate limit kept failing. Lower "Max input chars/call" or try again later.');
}

// ---------- chunking: split big JSON into pieces that fit the free-tier token limits ----------
function split(k, v, max, out) {
  const s = JSON.stringify(v);
  if (s === undefined || s === '{}' || s === '[]') return;
  if (s.length <= max) return out.push([k, v, s.length]);
  if (Array.isArray(v)) {
    let cur = [], len = 2;
    for (const it of v) {
      const l = JSON.stringify(it).length + 1;
      if (l > max) { split(k, it, max, out); continue; }
      if (len + l > max && cur.length) { out.push([k, cur, len]); cur = []; len = 2; }
      cur.push(it); len += l;
    }
    if (cur.length) out.push([k, cur, len]);
  } else if (v && typeof v === 'object') for (const [k2, v2] of Object.entries(v)) split(k + '.' + k2, v2, max, out);
  else out.push([k, String(v).slice(0, max), max]);
}
function chunks(obj, max, limit = 6) {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) split(k, v, max, parts);
  const res = []; let cur = {}, len = 0;
  for (const [k, v, l] of parts) {
    if (len + l > max && Object.keys(cur).length) { res.push(cur); cur = {}; len = 0; }
    cur[k in cur ? `${k}#${Object.keys(cur).length}` : k] = v; len += l + k.length + 4;
  }
  if (Object.keys(cur).length) res.push(cur);
  return res.slice(0, limit);
}

// ---------- prompts ----------
const SYS_FE = 'You are a senior front-end engineer reverse-engineering a website from measured browser data. Write precise, implementation-ready build instructions in Markdown for an AI coding agent. Rules: use only values present in the data (convert rgb() to hex; keep px, ms and cubic-bezier values exact); never invent colors, copy, assets or timings; when something is missing write "UNKNOWN - inspect manually"; be exhaustive, no filler, no preamble, no closing remarks.';
const SYS_BE = 'You are a backend/API technical writer. Using ONLY observed browser data (network calls, response headers, storage key names, tech fingerprints), write accurate documentation. Never guess server internals: label anything inferred as "Inferred" and anything missing as "Not observable". Never output secrets. No preamble, no closing remarks.';
const FE = {
  design: ['DESIGN SYSTEM', 'Produce: a color palette with roles (hex), the typography scale (families, sizes, weights, line-heights, letter-spacing), spacing/radius/shadow/border tokens, a ready-to-paste :root CSS variables block (include dark-theme overrides if present), font loading (@font-face / Google Fonts links), and breakpoints with responsive notes.'],
  layout: ['PAGE STRUCTURE & CONTENT', 'Produce a top-to-bottom spec of every section and component: semantic tag, layout (exact flex/grid values), sizes, spacing, colors and typography used, the EXACT copy text, links, images (src/alt/size), icons, forms and interactive components (nav, modals, tabs, accordions, carousels) with their states. Keep the order of the page.'],
  motion: ['ANIMATIONS & INTERACTIONS', 'Produce: every @keyframes (full code), transition specs per selector (property, duration, easing, delay), hover/focus/active effects, scroll-triggered effects (what changes, start and end styles, trigger point), JS-driven motion and the library behind it (GSAP/ScrollTrigger/Lenis/Framer Motion/Lottie/Three.js...) with how to reproduce it, canvas/video/SVG animation, the page-load sequence with stagger order, smooth scrolling, and prefers-reduced-motion handling. Include runnable code snippets in the target stack.']
};

function planFrontend(bp, cfg) {
  const data = {
    design: { design: bp.design, fontsLoaded: bp.assets.fontsLoaded, fontLinks: bp.assets.fontLinks, themeColor: bp.meta.themeColor, preferredScheme: bp.meta.preferredScheme },
    layout: { meta: bp.meta, layout: bp.layout, assets: { images: bp.assets.images, backgroundImages: bp.assets.backgroundImages, videos: bp.assets.videos, iconLibs: bp.assets.iconLibs }, interactions: bp.interactions },
    motion: { motion: bp.motion }
  };
  const plan = [];
  for (const key of ['design', 'layout', 'motion']) {
    const cs = chunks(data[key], cfg.maxIn);
    cs.forEach((c, i) => plan.push({ section: key, label: `${FE[key][0]} (${i + 1}/${cs.length})`, system: SYS_FE, instruction: `Section: ${FE[key][0]}${cs.length > 1 ? ` — part ${i + 1} of ${cs.length}; cover only what this part's data contains, do not repeat generic intro text` : ''}.\n${FE[key][1]}\nTarget stack (match the original exactly): ${bp.stack.summary}.`, data: c }));
  }
  return plan;
}
function planBackend(bp, cfg) {
  const b = bp.backend, plan = [];
  const infra = chunks({ stack: bp.stack, documentResponse: b.documentResponse, thirdPartyOrigins: b.thirdPartyOrigins, storage: b.storage, realtime: b.realtime, pageUrl: bp.meta.url }, cfg.maxIn, 2);
  infra.forEach((c, i) => plan.push({ section: 'infra', label: `Architecture & security (${i + 1}/${infra.length})`, system: SYS_BE, instruction: 'Write: (1) Overview and observed architecture: hosting/CDN/server fingerprints from headers, rendering approach (SSR/SPA/SSG) from the stack, third-party services; (2) Authentication and session mechanism as observed (cookie names, storage keys, auth header names - never values); (3) Security headers (CSP, HSTS, CORS, etc.) and what they imply; (4) Realtime channels; (5) Caching headers; (6) What is Not observable.', data: c }));
  const eps = chunks({ endpoints: b.endpoints }, cfg.maxIn, 6);
  eps.forEach((c, i) => plan.push({ section: 'api', label: `API reference (${i + 1}/${eps.length})`, system: SYS_BE, instruction: 'Write an API reference for these endpoints. For each: method + path, base URL, purpose (inferred from name/shape - label as Inferred), query params, non-sensitive request headers, request body schema as a table, response schema as a table, status codes seen, auth requirement, a placeholder-value example request/response, and call frequency/latency. Group related endpoints. For GraphQL, document operations and variables. Skip endpoints that are only static assets or analytics beacons, but list them in one line.', data: c }));
  return plan;
}

const FE_CATS = ['Frameworks & rendering', 'UI & styling', 'Animation & graphics', 'JavaScript libraries', 'Build tooling', 'Fonts & icons', 'CMS & e-commerce', 'Search & media', 'Maps & embeds'];
const BE_CATS = ['Hosting, CDN & server', 'Server-side (inferred)', 'Backend services & APIs', 'CMS & e-commerce', 'Authentication', 'Payments', 'Analytics & marketing', 'Monitoring & performance', 'Search & media', 'Security & bot protection', 'Protocols & web platform'];
const techList = (bp, cats) => ((bp.techStack && bp.techStack.categories) || []).filter(c => cats.includes(c.category)).map(c => `- **${c.category}:** ${c.items.map(i => i.name).join(', ')}`).join('\n');

function assemble(kind, bp, R, partial) {
  const j = k => (R[k] || []).join('\n\n');
  const head = partial ? '> ⏳ Generation in progress — partial output.\n\n' : '';
  if (kind === 'frontend') {
    return `${head}# MASTER PROMPT — Rebuild "${bp.meta.title}" (${bp.meta.url}) pixel-perfect, with every animation

## Role & goal
You are an expert front-end engineer. Rebuild the website specified below as a pixel-perfect, fully animated clone of its frontend. Match visuals, exact copy, layout at every breakpoint, and all motion.

## Required stack (identical to the original)
${bp.stack.summary}

### Full technology inventory (detected on the original site)
${techList(bp, FE_CATS) || '_none detected_'}
${bp.stack.nextData ? `\nNext.js details observed: ${JSON.stringify(bp.stack.nextData)}\n` : ''}
## Build rules
- Build sections in the order given. Never simplify, skip or substitute animations or easing curves.
- Use the exact colors, sizes, durations, delays and easings listed. Where a value is marked UNKNOWN, inspect and match visually.
- Be responsive at the listed breakpoints and honor prefers-reduced-motion.
- Keep original asset URLs where provided; otherwise use neutral placeholders of the same dimensions.
- Output complete, runnable project files (not fragments), then verify against the acceptance checklist.

# 1. DESIGN SYSTEM
${j('design')}

# 2. PAGE STRUCTURE & CONTENT
${j('layout')}

# 3. ANIMATIONS & INTERACTIONS
${j('motion')}

## Acceptance checklist
- Fonts, colors and spacing match the design tokens above.
- Every section exists in the same order with identical copy.
- Every keyframe, transition, hover state and scroll-triggered effect is implemented with the listed timing.
- Page-load sequence and smooth-scroll behavior match.
- Layout holds at each listed breakpoint; no console errors.
`;
  }
  const eps = bp.backend.endpoints;
  const table = eps.length
    ? ['| Method | Endpoint | Calls | Status | Content-Type |', '|---|---|---|---|---|', ...eps.map(e => `| ${e.method} | ${e.origin}${e.path}${e.queryParams.length ? '?' + e.queryParams.join('&') : ''} | ${e.calls} | ${Object.keys(e.statuses).join(', ')} | ${e.contentType || ''} |`)].join('\n')
    : '_No fetch/XHR calls were recorded. Re-scan with "Reload page first" enabled and interact with the site (log in, search, navigate) before scanning._';
  return `${head}# Backend documentation — ${bp.meta.title}
Source: ${bp.meta.url} · scanned ${bp.scan.at} · ${bp.backend.observedRequests} requests observed

> Reverse-documented from browser-observable data only (network calls, headers, storage key names, tech fingerprints). Server code, databases and private logic cannot be observed.

${j('infra')}

## Technology inventory (observed)
${techList(bp, BE_CATS) || '_none detected_'}

## Endpoint index
${table}

## API reference
${j('api') || '_Nothing to document._'}

## Limits of this document
- Only calls made during the scan are listed; endpoints behind other user actions or logins may be missing.
- Request/response schemas are inferred from one observed sample per endpoint (shapes, not values).
- Header values for authorization, cookies and API keys are redacted by the extension.
`;
}

async function generate(kind) {
  if (running) return;
  running = true; cancelled = false; progress = {};
  try {
    const { cfg: c, blueprint: bp } = await chrome.storage.local.get(['cfg', 'blueprint']);
    const cfg = norm(c);
    if (!bp) throw new Error('Scan a page first (step 2).');
    if (!cfg.apiKey) throw new Error('Add your free API key first (step 1).');
    const kinds = kind === 'both' ? ['frontend', 'backend'] : [kind];
    const plans = kinds.map(k => (k === 'frontend' ? planFrontend(bp, cfg) : planBackend(bp, cfg)));
    const total = plans.reduce((n, p) => n + p.length, 0);
    let done = 0;
    for (let ki = 0; ki < kinds.length; ki++) {
      const k = kinds[ki], plan = plans[ki], R = {};
      await setOut(k, '');
      for (let i = 0; i < plan.length; i++) {
        const t = plan[i], label = `${k === 'frontend' ? 'Master prompt' : 'Backend docs'} · ${t.label}`;
        progress = { kind: k, done, total };
        await setJob({ running: true, step: label });
        const text = await llm(cfg, t.system, `${t.instruction}\n\nMEASURED DATA (JSON):\n${JSON.stringify(t.data)}`, label);
        (R[t.section] ||= []).push(text.trim());
        done++;
        await setOut(k, assemble(k, bp, R, i < plan.length - 1));
      }
    }
    progress = { kind: kind === 'both' ? 'frontend' : kind, done: total, total };
    await setJob({ running: false, finished: Date.now() });
  } catch (e) {
    await setJob({ running: false, error: String(e.message || e) });
  } finally { running = false; }
}
