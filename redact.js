/* Private Redaction — workspace logic (image + text). */
'use strict';

const CHIPS = [
  { key: 'name', label: 'Names', ai: 'name', on: true },
  { key: 'address', label: 'Addresses', ai: 'address', on: true },
  { key: 'org', label: 'Organisations', ai: 'org', on: false },
  { key: 'email', label: 'Emails', rule: 'email', on: true },
  { key: 'phone', label: 'Phones', rule: 'phone', on: true },
  { key: 'card', label: 'Card numbers', rule: 'card', on: true },
  { key: 'acct', label: 'Account / long numbers', rule: 'acct', on: true },
  { key: 'ssn', label: 'US SSN', rule: 'ssn', on: false },
  { key: 'iban', label: 'IBAN', rule: 'iban', on: true },
  { key: 'date', label: 'Dates', rule: 'date', on: false },
];

// detections: current detection list (each gets an id). disabled: ids the user has
// unticked in the review list. autoBoxes: image boxes tagged with their detection id.
// aiItems/verification: cached AI result + TEE proof, reused across category toggles.
const S = {
  mode: null, canvas: null, ctx: null, base: null,
  boxes: [], autoBoxes: [], detections: [], disabled: new Set(),
  ocr: null, terms: [], text: '', redacted: '', aiItems: null, verification: null,
};

const el = (id) => document.getElementById(id);
function status(m) { el('status').textContent = m || ''; }
function show(id) { el(id).classList.remove('hidden'); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ------------------------------------------------------------ startup */
async function init() {
  let job = null;
  try { const r = await chrome.storage.session.get('pr_job'); job = r.pr_job; await chrome.storage.session.remove('pr_job'); } catch (e) {}
  if (!job) { status('Nothing to redact. Right-click an image or some selected text, or click the toolbar icon to capture a region of a page.'); return; }
  if (job.type === 'text') return initText(job.text);
  return initImage(job);
}

/* ------------------------------------------------- chips + detection */
function buildChipsInto(id) {
  const box = el(id);
  box.innerHTML = '';
  for (const c of CHIPS) {
    const l = document.createElement('label'); l.className = 'chip';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = c.key; cb.checked = !!c.on;
    l.append(cb, document.createTextNode(c.label));
    box.appendChild(l);
  }
}
function selectedKeys(chipsSel) {
  const ruleKeys = [], aiKeys = [];
  document.querySelectorAll(chipsSel + ' input:checked').forEach((cb) => { const c = CHIPS.find((x) => x.key === cb.value); if (!c) return; if (c.ai) aiKeys.push(c.ai); else if (c.rule) ruleKeys.push(c.rule); });
  return { ruleKeys, aiKeys };
}

// Shared driver. Runs rules locally every time; only calls the enclave when AI is
// requested and there's no cached result yet (or forceAi=true). Renders the TEE panel.
// Returns { detections, aiError }.
async function getDetections(text, opts) {
  const { forceAi, chipsSel, instrSel } = opts;
  const { ruleKeys, aiKeys } = selectedKeys(chipsSel);
  const instructions = el(instrSel) ? el(instrSel).value.trim() : '';
  const wantAi = aiKeys.length > 0 || !!instructions;
  let aiError = null;

  if (wantAi && (forceAi || S.aiItems === null)) {
    status(aiKeys.length ? 'Scanning with the private AI in the sealed enclave…' : 'Scanning…');
    try {
      const { items, verification } = await PR.aiDetect(text, aiKeys, instructions);
      S.aiItems = items; S.verification = verification;
    } catch (e) {
      aiError = (e && e.message) ? e.message : String(e);
      S.aiItems = S.aiItems || [];
      S.verification = { mode: 'error', reason: aiError };
    }
  }

  const applyItems = wantAi ? (S.aiItems || []) : [];
  const { detections } = PR.detect(text, { ruleKeys, terms: S.terms, aiItems: applyItems });
  renderVerification(wantAi ? S.verification : null);
  return { detections, aiError };
}

/* ------------------------------------------- review list (check/uncheck) */
function assignIds(dets) { dets.forEach((d, i) => { d.id = 'd' + i; }); return dets; }
function activeSpans() { return S.detections.filter((d) => !S.disabled.has(d.id)).map((d) => ({ start: d.start, end: d.end })); }

// Which verification container the current mode renders into. Image mode shows it
// UNDER the image (so the image stays the focus); text mode uses the top slot.
let verifyTargetId = 'verify';

// reviewCtx tells refreshReview which container to draw into and what to do when an
// item is toggled (image: redraw canvas; text: recompute the redacted text).
let reviewCtx = { id: 'review', onToggle: () => {} };
function refreshReview() { renderReview(reviewCtx.id, reviewCtx.onToggle); }

function renderReview(containerId, onToggle) {
  const wrap = el(containerId);
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!S.detections.length) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');

  const total = S.detections.length, on = total - S.disabled.size;
  const lead = document.createElement('div');
  lead.className = 'review-lead';
  lead.textContent = 'Detected ' + total + ' item' + (total === 1 ? '' : 's') + ' · ' + on + ' will be redacted. Untick anything you want to keep.';
  wrap.appendChild(lead);

  const groups = {};
  for (const d of S.detections) (groups[d.category] = groups[d.category] || []).push(d);
  for (const cat of Object.keys(groups)) {
    const items = groups[cat];
    const g = document.createElement('div'); g.className = 'group';
    const head = document.createElement('div'); head.className = 'group-head';
    head.innerHTML = '<span>' + escapeHtml(cat) + '</span><span class="count">' + items.length + ' found</span>';
    g.appendChild(head);
    const ul = document.createElement('ul'); ul.className = 'items';
    for (const d of items) {
      const li = document.createElement('li');
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !S.disabled.has(d.id);
      cb.addEventListener('change', () => { if (cb.checked) S.disabled.delete(d.id); else S.disabled.add(d.id); onToggle(); });
      const snip = document.createElement('span'); snip.className = 'snippet';
      snip.textContent = d.text.length > 80 ? d.text.slice(0, 80) + '…' : d.text;
      li.append(cb, snip); ul.appendChild(li);
    }
    g.appendChild(ul); wrap.appendChild(g);
  }
}

/* ------------------------------------------------------------- image */
function loadImage(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('could not load the image')); i.src = src; }); }

async function initImage(job) {
  show('imageMode');
  verifyTargetId = 'verifyImg'; // image mode: TEE panel renders under the image
  buildChipsInto('chips');
  bindImageButtons();
  status('Loading image…');
  let img;
  try { img = await loadImage(job.dataUrl); } catch (e) { status(e.message); return; }

  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
  if (job.crop) { const d = job.crop.dpr || 1; sx = Math.round(job.crop.x * d); sy = Math.round(job.crop.y * d); sw = Math.round(job.crop.w * d); sh = Math.round(job.crop.h * d); }
  sw = Math.max(1, Math.min(sw, img.naturalWidth - sx)); sh = Math.max(1, Math.min(sh, img.naturalHeight - sy));

  const canvas = document.createElement('canvas');
  canvas.width = sw; canvas.height = sh;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  S.canvas = canvas; S.ctx = ctx; S.base = ctx.getImageData(0, 0, sw, sh);
  el('canvasWrap').appendChild(canvas);
  wireCanvas();
  render();
  status('Drag on the image to black out anything, or use Auto-detect. Click a box to remove it.');
}

function render() {
  const { ctx, base } = S;
  ctx.putImageData(base, 0, 0);
  ctx.fillStyle = '#000';
  for (const b of S.boxes) ctx.fillRect(b.x, b.y, b.w, b.h);                       // manual
  for (const b of S.autoBoxes) if (!S.disabled.has(b.id)) ctx.fillRect(b.x, b.y, b.w, b.h); // detected + still ticked
}

function offscreenFromBase() {
  const c = document.createElement('canvas'); c.width = S.canvas.width; c.height = S.canvas.height;
  c.getContext('2d').putImageData(S.base, 0, 0); return c;
}

function inside(px, py, b) { return px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h; }

function wireCanvas() {
  const c = S.canvas;
  let sx = 0, sy = 0, drawing = false, moved = false;
  const xy = (e) => { const r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }; };
  c.addEventListener('mousedown', (e) => { const p = xy(e); sx = p.x; sy = p.y; drawing = true; moved = false; });
  c.addEventListener('mousemove', (e) => {
    if (!drawing) return;
    moved = true; const p = xy(e);
    render();
    S.ctx.fillStyle = 'rgba(0,0,0,0.8)';
    S.ctx.fillRect(Math.min(sx, p.x), Math.min(sy, p.y), Math.abs(p.x - sx), Math.abs(p.y - sy));
  });
  window.addEventListener('mouseup', (e) => {
    if (!drawing) return;
    drawing = false; const p = xy(e);
    const x = Math.min(sx, p.x), y = Math.min(sy, p.y), w = Math.abs(p.x - sx), h = Math.abs(p.y - sy);
    if (moved && w > 3 && h > 3) { S.boxes.push({ x, y, w, h }); render(); return; }       // drag = add manual box
    for (let i = S.boxes.length - 1; i >= 0; i--) { if (inside(sx, sy, S.boxes[i])) { S.boxes.splice(i, 1); render(); return; } } // click manual box = remove it
    for (const b of S.autoBoxes) { if (!S.disabled.has(b.id) && inside(sx, sy, b)) { S.disabled.add(b.id); refreshReview(); render(); return; } } // click detected box = untick it in the list
    render();
  });
}

// Rebuilds the detected boxes from the current chip selection. Manual boxes are kept.
// forceAi=true re-queries the enclave; toggles pass false to reuse the cached result.
async function autodetect(forceAi) {
  try {
    if (!S.ocr) { status('Reading text from the image with on-device OCR (first run loads the model)…'); S.ocr = await PR.ocrCanvas(offscreenFromBase()); }
    const { detections, aiError } = await getDetections(S.ocr.text, { forceAi, chipsSel: '#chips', instrSel: 'instructions' });
    assignIds(detections);
    S.detections = detections; S.disabled = new Set();
    S.autoBoxes = [];
    for (const d of detections) {
      for (const w of S.ocr.words) {
        if (Math.max(d.start, w.start) < Math.min(d.end, w.end)) {
          const { x0, y0, x1, y1 } = w.bbox;
          const padY = Math.max(2, (y1 - y0) * 0.18), padX = Math.max(2, (y1 - y0) * 0.12);
          S.autoBoxes.push({ id: d.id, x: x0 - padX, y: y0 - padY, w: (x1 - x0) + 2 * padX, h: (y1 - y0) + 2 * padY });
        }
      }
    }
    reviewCtx = { id: 'reviewImg', onToggle: () => render() };
    refreshReview();
    render();
    const n = detections.length;
    status(n + ' item' + (n === 1 ? '' : 's') + ' detected and blacked out' + (aiError ? ' · AI step unavailable: ' + aiError : '') + '. Untick any below to keep them, click a box to remove it, or drag to add more.');
  } catch (e) { status('Auto-detect failed: ' + (e && e.message ? e.message : e)); }
}

function bindImageButtons() {
  el('autodetect').addEventListener('click', () => autodetect(true));
  el('clearAuto').addEventListener('click', () => { S.detections = []; S.autoBoxes = []; S.disabled = new Set(); refreshReview(); render(); renderVerification(null); status('Cleared detected items. Your manual boxes are kept.'); });
  el('addTerm').addEventListener('click', () => { const t = el('term').value.trim(); if (t && !S.terms.includes(t)) S.terms.push(t); el('term').value = ''; autodetect(false); });
  // Toggling a category re-runs detection over the cached OCR + cached AI result —
  // no re-OCR and no new enclave call. Only re-runs once we've detected at least once.
  el('chips').addEventListener('change', () => { if (S.ocr) autodetect(false); });
  el('download').addEventListener('click', () => { render(); S.canvas.toBlob((b) => { const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = 'redacted.png'; a.click(); setTimeout(() => URL.revokeObjectURL(u), 1500); }, 'image/png'); });
  el('copyImg').addEventListener('click', () => { render(); S.canvas.toBlob(async (b) => { try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); status('Copied the redacted image to your clipboard.'); } catch (e) { status('Copy failed (' + e.message + '). Use Download instead.'); } }, 'image/png'); });
}

/* -------------------------------------------------------------- text */
function initText(text) {
  show('textMode');
  verifyTargetId = 'verifyText'; // text mode: TEE panel renders under the redacted panes
  S.text = text;
  el('origText').textContent = text;
  buildChipsInto('chipsText');
  el('detectText').addEventListener('click', () => runText(true));
  el('chipsText').addEventListener('change', () => runText(false));
  el('addTermText').addEventListener('click', () => { const t = el('termText').value.trim(); if (t && !S.terms.includes(t)) S.terms.push(t); el('termText').value = ''; runText(false); });
  el('copyText').addEventListener('click', async () => { try { await navigator.clipboard.writeText(S.redacted || ''); status('Copied redacted text to your clipboard.'); } catch (e) { status('Copy failed: ' + e.message); } });
  el('copyText').disabled = true; // nothing to copy until a redaction has actually been applied
  runText(true);
}
function applyTextRedaction() {
  const spans = activeSpans();
  S.redacted = PR.redactText(S.text, spans);
  el('redText').textContent = S.redacted;
  el('copyText').disabled = spans.length === 0; // only copyable once something is redacted
}
async function runText(forceAi) {
  status('Scanning…');
  const { detections, aiError } = await getDetections(S.text, { forceAi, chipsSel: '#chipsText', instrSel: 'instrText' });
  assignIds(detections);
  S.detections = detections; S.disabled = new Set();
  reviewCtx = { id: 'reviewText', onToggle: applyTextRedaction };
  refreshReview();
  applyTextRedaction();
  const n = detections.length;
  status(n + ' item' + (n === 1 ? '' : 's') + ' redacted' + (aiError ? ' · AI step unavailable: ' + aiError : '') + '. Untick any below to keep them, or add a term.');
}

/* ------------------------------------------------ TEE verification UI */
const LEARN_MORE = 'https://docs.nillion.com/build/private-llms/overview';

function downloadReceipt(v) {
  const att = v.attestation || {};
  const r = v.receipt || {};
  const receipt = {
    tool: 'Private Redaction (extension)',
    what_this_is: 'Attestation evidence for the AMD SEV-SNP enclave that performed the AI detection. It proves the enclave is genuine and running the expected build, is verifiable independently against AMD, and reveals nothing about your document.',
    delivery: v.path === 'direct'
      ? 'direct: the extracted text was sent from your browser straight to the enclave and did not pass through the tool operator’s server (which only minted a short-lived delegation token from a public key).'
      : 'relay: the text was sent via the tool operator’s stateless verifier function, which forwarded it to the enclave.',
    response_signature: v.signature || null,
    response_signature_verified_in_browser: !!v.tee_verified,
    verified_at: r.verified_at || new Date().toISOString(),
    endpoint: r.endpoint || null,
    processor: att.processor || null,
    runtime: att.nilcc_version || null,
    measurement: att.measurement || null,
    measurement_matches_known_build: att.measurement_matches_known_build,
    checks: att.checks || null,
    enclave_public_key: r.enclave_public_key || null,
    attestation_report_hex: r.attestation_report_hex || null,
    environment: r.environment || null,
    how_to_verify: 'This is an AMD SEV-SNP attestation report. Verify its certificate chain against AMD KDS (kdsintf.amd.com) and check the launch measurement. The verifier used here is open source: https://github.com/iamrobertmoore/privateredact (see server/nilai-verifier).',
  };
  const blob = new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'privateredact-attestation-receipt.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function renderVerification(v) {
  const box = el(verifyTargetId);
  if (!box) return;
  if (!v) { box.className = 'verify hidden'; box.innerHTML = ''; return; }

  const shield = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 2.5l7 3v5.2c0 4.4-3 8.2-7 9.8-4-1.6-7-5.4-7-9.8V5.5l7-3z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8.6 12.2l2.3 2.3 4.4-4.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const tickSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const crossSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M7 7l10 10M17 7L7 17" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
  const tick = (ok) => '<span class="tick' + (ok ? '' : ' no') + '">' + (ok ? tickSvg : crossSvg) + '</span>';

  if (v.mode === 'verified') {
    const att = v.attestation || {};
    const direct = v.path === 'direct';
    const sig = !!v.tee_verified;
    const attOk = !!att.attestation_verified;
    const full = direct ? attOk : (sig && attOk);
    box.className = 'verify ' + (full ? 'ok' : 'warn');

    const vcheck = (ok, title, sub) => '<div class="vcheck">' + tick(ok) + '<div><div class="ct">' + title + '</div><div class="cs">' + sub + '</div></div></div>';

    let html = '<div class="vtop"><div class="vseal' + (full ? '' : ' warn') + '">' + shield + '</div><div>';
    html += '<p class="vbadge">' + (full ? (direct ? 'Private · Verified' : 'TEE attestation · Verified') : 'Verification · Incomplete') + '</p>';
    html += '<div class="vhead">' + (full
      ? (direct
        ? 'Your text went straight to the sealed enclave — and we can prove that enclave is genuine.'
        : 'Your text was handled privately, and we can prove it.')
      : 'We could only partly verify this run.') + '</div>';
    html += '<p class="vsub">' + (full
      ? (direct
        ? 'The extracted text was sent from your browser directly to sealed hardware that not even Nillion, its cloud host, or we can see into — it never passed through our servers. We independently checked that enclave’s hardware attestation and it passed. A receipt you can verify yourself is below.'
        : 'The AI that read your text ran inside sealed hardware that not even Nillion or its cloud host can see into. We checked its hardware attestation and it passed. The details, and a receipt you can verify yourself, are below.')
      : 'Some of the privacy checks didn’t pass this time. See the details below, and treat this result with caution.') + '</p>';
    html += '</div></div>';

    const buildPinned = att.measurement_matches_known_build === true;
    html += '<div class="vchecks">';
    if (direct) {
      html += vcheck(true, 'Sent straight to the sealed enclave', 'Your text went from your browser directly to the enclave. It never passed through our servers — we only ever handled a public key.');
    } else {
      html += vcheck(sig, 'The result came from the sealed hardware', 'The response was cryptographically signed inside the enclave.');
    }
    html += vcheck(attOk, 'The hardware is genuine and unmodified', buildPinned
      ? 'Its attestation is valid and its launch fingerprint matches the build we expect.'
      : 'Its attestation is valid. The exact build fingerprint isn’t pinned for this runtime version yet.');
    html += '</div>';

    const checks = att.checks || {};
    const labels = {
      ark_self_signed: 'AMD root self-signed',
      ask_signed_by_ark: 'ASK signed by ARK',
      vcek_signed_by_ask: 'VCEK signed by ASK',
      report_signature_valid: 'Report signature valid',
      vcek_tcb_matches_report: 'TCB matches report',
      tls_session_bound: 'Bound to this session',
      debug_disabled: 'Debug mode off',
    };
    const kv = (k, val) => '<div class="kv"><span class="k">' + k + '</span><span class="v">' + val + '</span></div>';
    let rows = '';
    rows += kv('Delivery', direct ? '<span class="ok">browser → enclave (direct)</span>' : 'via verifier (server relay)');
    if (att.processor) rows += kv('Processor', escapeHtml(att.processor));
    if (att.nilcc_version) rows += kv('Runtime', escapeHtml(att.nilcc_version));
    rows += kv('Known build', att.measurement_matches_known_build === true
      ? '<span class="ok">✓ yes</span>'
      : (att.measurement_matches_known_build === false ? 'no (mismatch)' : 'not pinned for this runtime'));
    for (const k of Object.keys(labels)) if (k in checks) rows += kv(labels[k], checks[k] ? '<span class="ok">✓</span>' : '✗');
    if (att.measurement) rows += kv('Measurement', escapeHtml(String(att.measurement).slice(0, 24)) + '…');
    if (v.signature) rows += kv('Response signature', v.tee_verified
      ? '<span class="ok">✓ verified in your browser</span>'
      : escapeHtml(String(v.signature).slice(0, 24)) + '… (captured)');
    if (v.receipt && v.receipt.attestation_report_hex) rows += kv('Independent proof', '<a href="#" id="dl-receipt">download receipt ↓</a>');
    rows += kv('Learn more', '<a href="' + LEARN_MORE + '" target="_blank" rel="noopener">how this works ↗</a>');
    if (att.error) rows += kv('Attestation error', escapeHtml(att.error));

    html += '<details><summary><span class="chev">›</span> Technical detail</summary><div class="kvgrid">' + rows + '</div></details>';
    box.innerHTML = html;
    const dl = el('dl-receipt');
    if (dl) dl.addEventListener('click', (e) => { e.preventDefault(); downloadReceipt(v); });
    return;
  }

  box.className = 'verify warn';
  const msgs = {
    error: 'The AI scan didn’t complete this time' + (v.reason ? ' (' + escapeHtml(v.reason) + ')' : '') + '. Only the built-in pattern rules were applied.',
    unavailable: 'Your text was scanned by Nillion’s private AI, but we couldn’t reach the checker that confirms the sealed-hardware proof, so this run isn’t independently verified.' + (v.reason ? ' (' + escapeHtml(v.reason) + ')' : ''),
    direct: 'Your text was scanned by Nillion’s private AI, but the sealed-hardware proof isn’t independently confirmed here.',
  };
  box.innerHTML = '<div class="vtop"><div class="vseal warn">' + shield + '</div><div><p class="vbadge">Not independently verified</p><div class="vhead">We couldn’t confirm the privacy proof this time.</div><p class="vsub">' + (msgs[v.mode] || '') + '</p></div></div>';
}

document.addEventListener('DOMContentLoaded', init);
