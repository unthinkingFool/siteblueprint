const $ = id => document.getElementById(id);
const PRESETS = {
  groq: { name: 'Groq (free, recommended)', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', keyUrl: 'https://console.groq.com/keys', maxIn: 12000 },
  openrouter: { name: 'OpenRouter (free models)', baseUrl: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free', keyUrl: 'https://openrouter.ai/keys', maxIn: 12000 },
  cerebras: { name: 'Cerebras (free tier)', baseUrl: 'https://api.cerebras.ai/v1', model: 'llama-3.3-70b', keyUrl: 'https://cloud.cerebras.ai/', maxIn: 12000 },
  gemini: { name: 'Google Gemini (free tier)', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash', keyUrl: 'https://aistudio.google.com/apikey', maxIn: 24000 },
  custom: { name: 'Other (OpenAI-compatible)', baseUrl: '', model: '', keyUrl: '', maxIn: 12000 }
};
const HINTS = {
  frontend: 'Paste this into Claude, ChatGPT, Cursor, Bolt, Lovable or v0 and ask it to build the project.',
  backend: 'Give this to your backend developer or AI as a spec for the API the site uses.',
  tech: 'Every technology found on this site, with the evidence behind each one. Ready right after the scan, no AI needed.',
  raw: 'The raw scan data. Keep it if you want to feed your own AI.'
};
let tab = 'frontend', store = {}, editing = false, lastFinished = 0;

const status = (t, err) => { $('status').textContent = t || ''; $('status').className = err ? 'err' : ''; };
const kb = n => (n / 1024).toFixed(1) + ' KB';
const cfgNow = () => ({
  provider: $('provider').value, apiKey: $('apiKey').value.trim(),
  baseUrl: $('baseUrl').value.trim(), model: $('model').value.trim(),
  maxIn: +$('maxIn').value || 12000, maxOut: +$('maxOut').value || 2500
});
const verified = () => !!(store.cfg && store.cfg.apiKey && store.cfg.verified);
const tabsQ = () => chrome.tabs.query({ active: true, currentWindow: true }).then(r => r[0]);

function fillPreset(p) {
  const pr = PRESETS[p];
  if (p !== 'custom') { $('baseUrl').value = pr.baseUrl; $('model').value = pr.model; $('maxIn').value = pr.maxIn; }
}
function renderSteps() {
  const ok = verified(), busy = !!(store.job && store.job.running), bp = store.blueprint;
  $('s1body').hidden = ok && !editing;
  $('change').hidden = !(ok && !editing);
  $('s1badge').hidden = !ok;
  if (ok) $('s1badge').textContent = '✓ Connected · ' + (PRESETS[store.cfg.provider] || PRESETS.custom).name.split(' (')[0];
  for (const id of ['s2', 's3']) $(id).classList.toggle('locked', !ok);
  $('scan').disabled = !ok || busy;
  $('all').disabled = !ok || busy;
  $('genFe').disabled = $('genBe').disabled = !ok || !bp || busy;
}
function techMd(bp) {
  const t = bp.techStack;
  if (!t) return '';
  const L = [`# Tech stack: ${bp.meta.title}`, bp.meta.url, '', `${t.total} technologies detected in ${t.categories.length} categories. Found from page code, network requests, response headers and cookies. Versions show when the site exposes them.`, ''];
  for (const c of t.categories) {
    L.push(`## ${c.category}`);
    for (const i of c.items) { L.push(`- ${i.name}`); i.evidence.forEach(e => L.push(`    - evidence: ${e}`)); }
    L.push('');
  }
  L.push('Not detectable from a browser: databases, internal services and the exact server language unless the site reveals them. Items marked "inferred" or "likely" are best guesses from headers and cookies.');
  return L.join('\n');
}
function render() {
  const bp = store.blueprint, o = store.outputs || {};
  let text = '';
  if (tab === 'raw') text = bp ? JSON.stringify(bp, null, 2) : '';
  else if (tab === 'tech') text = bp ? techMd(bp) : '';
  else text = o[tab] || '';
  $('out').textContent = text || (bp ? 'Nothing here yet. Press "Scan and make everything" or the buttons in step 3.' : 'Nothing here yet. Connect a key, open a website and press "Scan and make everything".');
  $('size').textContent = text ? kb(new Blob([text]).size) : '';
  $('tabHint').textContent = HINTS[tab];
  $('copy').disabled = $('dl').disabled = !text;
  renderSteps();
}
function showJob(j) {
  const run = !!(j && j.running);
  $('cancel').hidden = !run;
  $('bar').hidden = !run;
  if (run) {
    $('bar').max = j.total || 1; $('bar').value = j.done || 0;
    status(`${j.step || 'Working…'}${j.total ? `  (${j.done || 0}/${j.total} done)` : ''}`);
  } else if (j && j.error) status(j.error, true);
  else if (j && j.finished && j.finished !== lastFinished) {
    lastFinished = j.finished;
    status('Done. Copy or download your result below.');
    setTab(j.kind || 'frontend');
  }
}
function setTab(t) {
  tab = t;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  render();
}
async function showPage() {
  const t = await tabsQ();
  $('page').textContent = t && /^https?:/.test(t.url || '') ? 'Current page: ' + new URL(t.url).host : 'Current page: open a normal website (not a browser page)';
}

async function init() {
  for (const [k, v] of Object.entries(PRESETS)) $('provider').add(new Option(v.name, k));
  store = await chrome.storage.local.get(['cfg', 'blueprint', 'outputs', 'job']);
  const c = store.cfg || {};
  $('provider').value = c.provider || 'groq';
  fillPreset($('provider').value);
  if (c.baseUrl) $('baseUrl').value = c.baseUrl;
  if (c.model) $('model').value = c.model;
  if (c.maxIn) $('maxIn').value = c.maxIn;
  $('maxOut').value = c.maxOut || 2500;
  $('apiKey').value = c.apiKey || '';
  lastFinished = (store.job && store.job.finished) || 0;
  render(); showPage();
  if (store.job && store.job.running) showJob(store.job);
}
chrome.storage.onChanged.addListener(ch => {
  for (const [k, v] of Object.entries(ch)) store[k] = v.newValue;
  if (ch.job) showJob(store.job);
  render();
});
chrome.tabs.onActivated.addListener(showPage);
chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === 'complete') showPage(); });

$('provider').onchange = () => fillPreset($('provider').value);
$('eye').onclick = () => { const p = $('apiKey').type === 'password'; $('apiKey').type = p ? 'text' : 'password'; $('eye').textContent = p ? 'Hide' : 'Show'; };
$('getKey').onclick = () => { const u = PRESETS[$('provider').value].keyUrl; if (u) chrome.tabs.create({ url: u }); else status('Enter your provider details under Advanced.'); };
$('change').onclick = () => { editing = true; renderSteps(); };
$('manual').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('manual.html') });
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => setTab(b.dataset.tab));

$('saveCfg').onclick = async () => {
  const cfg = cfgNow();
  const pr = PRESETS[cfg.provider];
  if (!cfg.baseUrl) { cfg.baseUrl = pr.baseUrl; $('baseUrl').value = pr.baseUrl; }
  if (!cfg.model) { cfg.model = pr.model; $('model').value = pr.model; }
  if (!cfg.apiKey) return status('Paste your API key first. Press "Get a free key" if you do not have one.', true);
  status('Testing your key…');
  $('saveCfg').disabled = true;
  const r = await chrome.runtime.sendMessage({ type: 'TEST_KEY', cfg });
  $('saveCfg').disabled = false;
  if (r.ok && r.model) { cfg.model = r.model; $('model').value = r.model; }
  await chrome.storage.local.set({ cfg: { ...cfg, verified: !!r.ok } });
  if (r.ok) { editing = false; status(`Key works and is saved (model: ${cfg.model}). Now open a website and go to step 2.`); }
  else status(r.error, true);
};

const reloadAndWait = id => new Promise(res => {
  const f = (tid, info) => { if (tid === id && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(f); setTimeout(res, 2000); } };
  chrome.tabs.onUpdated.addListener(f);
  chrome.tabs.reload(id);
});
async function ensureContent(id) {
  try { await chrome.tabs.sendMessage(id, { type: 'SC_PING' }); }
  catch {
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ['hook.js'], world: 'MAIN' });
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content.js'] });
  }
}
async function doScan() {
  const t = await tabsQ();
  if (!t || !/^https?:/.test(t.url || '')) { status('Open the website you want to scan in this tab first. Browser pages (chrome://) and the Web Store cannot be scanned.', true); return false; }
  $('scan').disabled = $('all').disabled = true;
  try {
    if ($('reload').checked) { status('Reloading the page…'); await reloadAndWait(t.id); }
    await ensureContent(t.id);
    status('Scanning… the page will scroll by itself. Please wait about 20 to 40 seconds.');
    const bp = await chrome.tabs.sendMessage(t.id, { type: 'SC_EXTRACT' });
    if (!bp || bp.error) throw new Error((bp && bp.error) || 'The page did not answer. Refresh it and try again.');
    await chrome.storage.local.set({ blueprint: bp, outputs: {} });
    status(`Scan complete. Detected: ${bp.stack.summary}.`);
    return true;
  } catch (e) { status(String(e.message || e), true); return false; }
  finally { renderSteps(); }
}
async function start(job) {
  await chrome.storage.local.remove('job');
  chrome.runtime.sendMessage({ type: 'GENERATE', job });
  if (job !== 'both') setTab(job === 'backend' ? 'backend' : 'frontend');
}
$('scan').onclick = async () => { if (await doScan()) setTab('tech'); };
$('all').onclick = async () => { if (await doScan()) { setTab('tech'); start('both'); } };
$('genFe').onclick = () => start('frontend');
$('genBe').onclick = () => start('backend');
$('cancel').onclick = () => chrome.runtime.sendMessage({ type: 'CANCEL' });

$('copy').onclick = async () => { await navigator.clipboard.writeText($('out').textContent); $('copy').textContent = 'Copied ✓'; setTimeout(() => ($('copy').textContent = 'Copy'), 1600); };
$('dl').onclick = () => {
  const names = { frontend: 'master-prompt.md', backend: 'backend-docs.md', tech: 'tech-stack.md', raw: 'scan.json' };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([$('out').textContent], { type: 'text/plain' }));
  a.download = names[tab]; a.click(); URL.revokeObjectURL(a.href);
};
init();
