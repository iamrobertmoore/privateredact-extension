/* Private Redaction — shared engine (extension).
 * Detection rules + private-enclave AI (delegation, direct to nilAI) + OCR.
 * No document/image ever leaves the browser; only extracted text goes straight
 * to the sealed enclave using a short-lived delegation token minted server-side.
 */
'use strict';

const PR = (() => {
  const CFG = () => window.PR_CONFIG;

  /* ---------------------------------------------------------- rule set */
  const RULES = {
    email: { label: 'Email addresses', re: () => /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}\b/g }, // bounded to avoid O(n^2) backtracking on long non-email runs
    phone: { label: 'Phone numbers', re: () => /(?:\+?\d{1,3}[\s.\-]?)?(?:\(\d{2,4}\)[\s.\-]?|\d{2,4}[\s.\-]?)\d{3,4}[\s.\-]?\d{3,4}/g, min: 7 },
    ssn:   { label: 'US SSN', re: () => /\b\d{3}-\d{2}-\d{4}\b/g },
    card:  { label: 'Card numbers', re: () => /\b(?:\d[ \-]?){13,19}\b/g, luhn: true },
    acct:  { label: 'Account / long numbers', re: () => /\b\d[\d \-]{6,}\d\b/g, min: 8 },
    iban:  { label: 'IBAN', re: () => /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g },
    ip:    { label: 'IP addresses', re: () => /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
    date:  { label: 'Dates', re: () => /\b(?:\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2})\b/g },
  };
  const AI_CATEGORIES = { name: 'People’s names', address: 'Postal addresses', org: 'Organisation and company names' };

  /* ---------------------------------------------------------- helpers */
  function luhnValid(str) {
    const d = str.replace(/[^\d]/g, '');
    if (d.length < 13 || d.length > 19) return false;
    let sum = 0, alt = false;
    for (let i = d.length - 1; i >= 0; i--) { let n = +d[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; }
    return sum % 10 === 0;
  }
  function findAll(text, term) {
    const spans = [];
    if (!term) return spans;
    let i = 0;
    while ((i = text.indexOf(term, i)) !== -1) { spans.push({ start: i, end: i + term.length }); i += term.length; }
    if (!spans.length) {
      const lc = text.toLowerCase(), lt = term.toLowerCase();
      let j = 0;
      while ((j = lc.indexOf(lt, j)) !== -1) { spans.push({ start: j, end: j + term.length }); j += term.length; }
    }
    return spans;
  }
  function parseJsonLoose(s) {
    if (!s) return null;
    let t = String(s).trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    try { return JSON.parse(t); } catch (e) {}
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a !== -1 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) {} }
    return null;
  }
  function extractResponseText(data) {
    if (!data) return '';
    if (typeof data.output_text === 'string') return data.output_text;
    if (data.choices && data.choices[0] && data.choices[0].message) return data.choices[0].message.content || '';
    if (Array.isArray(data.output)) for (const it of data.output) if (it && it.type === 'message' && Array.isArray(it.content)) { const t = it.content.find((c) => c.type === 'output_text' || c.type === 'text'); if (t && t.text) return t.text; }
    return typeof data === 'string' ? data : '';
  }

  /* ----------------------------------------- TEE attestation + signature */
  function b64ToBytes(b64) {
    const bin = atob(String(b64).trim().replace(/^"|"$/g, ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToHex(u8) { let h = ''; for (let i = 0; i < u8.length; i++) h += u8[i].toString(16).padStart(2, '0'); return h; }
  // Best-effort in-browser check that the raw enclave response was signed by the
  // enclave's public key (secp256k1). Any uncertainty returns false — we never fake a pass.
  function verifyEnclaveResponseSignature(rawText, pkB64) {
    try {
      const NC = window.NilaiClient;
      if (!NC || !NC.secp256k1 || !NC.sha256 || !rawText || !pkB64) return false;
      const obj = JSON.parse(rawText);
      const s = obj.signature;
      if (!s) return false;
      let pre = rawText.replace('"signature":"' + s + '"', '"signature":""');
      for (const f of ['created_at', 'created', 'temperature', 'top_p']) {
        pre = pre.replace(new RegExp('("' + f + '":)(-?\\d+)([,}\\]])'), '$1$2.0$3');
      }
      const msgHash = NC.sha256(new TextEncoder().encode(pre));
      const pub = b64ToBytes(pkB64);
      const sig = NC.secp256k1.Signature.fromDER(bytesToHex(b64ToBytes(s)));
      return NC.secp256k1.verify(sig, msgHash, pub, { lowS: false });
    } catch (e) { return false; }
  }
  // Text-free attestation proof (AMD SEV-SNP). Never receives the document.
  // POST (not GET): Chrome omits the Origin header on cross-origin GETs, so the
  // server's origin allow-list would 403 the extension; a POST sends Origin:
  // chrome-extension://<id>, exactly like the token call, so it's allowed.
  async function fetchAttestation() {
    const C = CFG();
    if (!C.attestUrl) return { attestation: { attestation_verified: false, error: 'no attestation endpoint' }, receipt: null, enclave_public_key: null };
    const r = await fetch(C.attestUrl, { method: 'POST' });
    if (!r.ok) throw new Error('attestation ' + r.status);
    return r.json();
  }

  /* -------------------------------------------- private enclave (nilAI) */
  let _nilaiPromise = null;
  function loadNilai() {
    if (window.NilaiClient && window.NilaiClient.ready) return Promise.resolve(window.NilaiClient);
    if (_nilaiPromise) return _nilaiPromise;
    _nilaiPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = CFG().clientBundle; s.async = true;
      s.onload = () => (window.NilaiClient && window.NilaiClient.ready ? resolve(window.NilaiClient) : reject(new Error('enclave client did not initialise')));
      s.onerror = () => reject(new Error('failed to load the enclave client'));
      document.head.appendChild(s);
    });
    return _nilaiPromise;
  }
  function buildAiInput(text, aiKeys, instructions) {
    const cats = (aiKeys || []).map((k) => AI_CATEGORIES[k]).filter(Boolean);
    const doc = text.length > 15000 ? text.slice(0, 15000) : text;
    const parts = ['You are a document redaction assistant. Find sensitive text that should be redacted from the DOCUMENT below.'];
    if (cats.length) parts.push('Redact these kinds of information: ' + cats.join(', ') + '.');
    if (instructions) parts.push('Also follow these instructions: ' + instructions);
    parts.push('Return ONLY a JSON object of the form {"redactions":[{"text":"<snippet copied verbatim from the document>","category":"<short label>"}]}. Copy each snippet exactly as it appears in the document. If nothing is sensitive, return {"redactions":[]}.');
    parts.push('DOCUMENT:\n' + doc);
    return parts.join('\n\n');
  }
  // One attempt: mint a fresh single-use delegation token (our server never sees
  // `input`) and call the enclave directly. Returns { text, signature, raw }.
  async function runEnclaveOnce(input, NC, C) {
    const client = new NC.NilaiOpenAIClient({ baseURL: C.nucBaseUrl, authType: NC.AuthType.DELEGATION_TOKEN, maxRetries: 0 });
    const delegationRequest = client.getDelegationRequest();
    const tr = await fetch(C.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delegationRequest }) });
    if (!tr.ok) { let d = ''; try { const e = await tr.json(); if (e && e.error) d = ': ' + e.error; } catch (_) {} throw new Error('token ' + tr.status + d); }
    const { delegationToken, error } = await tr.json();
    if (error || !delegationToken) throw new Error(error || 'no delegation token returned');
    client.updateDelegation(delegationToken);
    const call = client.chat.completions.create({ model: C.model, messages: [{ role: 'user', content: input }] });
    let parsed, raw = null;
    if (call && typeof call.withResponse === 'function') {
      const wr = await call.withResponse();
      parsed = wr.data;
      try { raw = await wr.response.clone().text(); } catch (_) {}
    } else { parsed = await call; }
    return { text: extractResponseText(parsed), signature: (parsed && parsed.signature) || null, raw };
  }

  // Calls the enclave directly and returns { text, verification } where verification
  // carries the (text-free) AMD SEV-SNP attestation + the in-browser signature check.
  async function aiCallDirect(input) {
    const C = CFG();
    const NC = await loadNilai();
    // Delegation tokens are single-use and short-lived (≈20s), so a transient error
    // or an internal client retry can present a consumed/expired token and 401. Mint
    // a completely fresh token and try once more before giving up.
    let res;
    try { res = await runEnclaveOnce(input, NC, C); }
    catch (e1) { res = await runEnclaveOnce(input, NC, C); }
    const { text, signature, raw } = res;
    // The enclave already produced the result above; the attestation is a separate
    // (text-free) proof. If it can't be fetched, keep the redactions but mark the run
    // as not independently verified rather than discarding the AI result.
    let verification;
    try {
      const att = await fetchAttestation();
      const pk = att.enclave_public_key || (att.receipt && att.receipt.enclave_public_key) || null;
      const teeVerified = raw ? verifyEnclaveResponseSignature(raw, pk) : false;
      verification = { mode: 'verified', path: 'direct', tee_verified: teeVerified, attestation: att.attestation, signature, receipt: att.receipt };
    } catch (e) {
      verification = { mode: 'unavailable', path: 'direct', tee_verified: false, signature, reason: (e && e.message) ? e.message : String(e) };
    }
    return { text, verification };
  }

  // Runs the AI categories/instructions against the enclave and returns the raw
  // redaction items plus the verification, so the UI can cache items and re-filter
  // on category toggles without re-calling the enclave.
  async function aiDetect(text, aiKeys, instructions) {
    const { text: out, verification } = await aiCallDirect(buildAiInput(text, aiKeys, instructions));
    const parsed = parseJsonLoose(out);
    const arr = (parsed && parsed.redactions) || [];
    const items = arr.filter((r) => r && r.text).map((r) => ({ text: String(r.text), category: String(r.category || 'Sensitive') }));
    return { items, verification };
  }

  /* -------------------------------------------------------------- OCR */
  let _tessPromise = null;
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (_tessPromise) return _tessPromise;
    _tessPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = CFG().tess.main; s.async = true;
      s.onload = () => (window.Tesseract ? resolve(window.Tesseract) : reject(new Error('OCR engine did not initialise')));
      s.onerror = () => reject(new Error('failed to load the OCR engine'));
      document.head.appendChild(s);
    });
    return _tessPromise;
  }
  async function withOcrWorker(fn) {
    const T = await loadTesseract();
    const g = (p) => (chrome.runtime ? chrome.runtime.getURL(p) : p);
    const worker = await T.createWorker('eng', 1, {
      workerPath: g('lib/tesseract/worker.min.js'),
      corePath: g('lib/tesseract/tesseract-core-simd-lstm.wasm.js'),
      langPath: g('lib/tesseract/'),
      gzip: false,
      workerBlobURL: false,
    });
    try { return await fn(worker); } finally { try { await worker.terminate(); } catch (_) {} }
  }
  async function recognizeWords(worker, canvas) {
    const { data } = await worker.recognize(canvas, {}, { blocks: true });
    const words = [];
    const push = (w) => { if (w && typeof w.text === 'string' && w.text.trim() && w.bbox) words.push({ text: w.text, bbox: w.bbox }); };
    if (Array.isArray(data.blocks)) for (const b of data.blocks) for (const p of (b.paragraphs || [])) for (const l of (p.lines || [])) for (const w of (l.words || [])) push(w);
    if (!words.length && Array.isArray(data.words)) data.words.forEach(push);
    return words;
  }
  // OCR a canvas -> { words:[{text,bbox,start,end}], text }
  async function ocrCanvas(canvas) {
    const words = await withOcrWorker((w) => recognizeWords(w, canvas));
    let text = '';
    words.forEach((w, k) => { const start = text.length; w.start = start; w.end = start + w.text.length; text += w.text + (k < words.length - 1 ? ' ' : ''); });
    return { words, text };
  }

  /* ------------------------------------------------------ detection */
  // Rules + custom terms + already-fetched AI items (see aiDetect). No network here,
  // so the UI can re-run this on every category toggle without re-calling the enclave.
  // Returns { detections:[{start,end,text,category,ai?}] }
  function detect(text, opts) {
    const { ruleKeys = [], terms = [], aiItems = [] } = opts || {};
    const found = [];
    for (const key of ruleKeys) {
      const R = RULES[key]; if (!R) continue;
      const re = R.re(); let m;
      while ((m = re.exec(text)) !== null) {
        const s = m.index, e = s + m[0].length;
        if (re.lastIndex === m.index) re.lastIndex++;
        if (R.min && m[0].replace(/\D/g, '').length < R.min) continue;
        if (R.luhn && !luhnValid(m[0])) continue;
        found.push({ start: s, end: e, text: text.slice(s, e), category: R.label });
      }
    }
    for (const t of terms) for (const sp of findAll(text, t)) found.push({ start: sp.start, end: sp.end, text: text.slice(sp.start, sp.end), category: 'Custom term' });
    for (const it of aiItems) if (it && it.text) for (const sp of findAll(text, String(it.text))) found.push({ start: sp.start, end: sp.end, text: text.slice(sp.start, sp.end), category: String(it.category || 'Sensitive'), ai: true });
    found.sort((a, b) => a.start - b.start || a.end - b.end);
    const seen = new Set(), out = [];
    for (const d of found) { const k = d.start + ':' + d.end; if (seen.has(k)) continue; seen.add(k); out.push(d); }
    return { detections: out };
  }

  // Redact plain text: replace each span with block characters.
  function redactText(text, spans) {
    const active = spans.slice().sort((a, b) => a.start - b.start);
    let out = '', idx = 0;
    for (const s of active) { if (s.start < idx) continue; out += text.slice(idx, s.start) + '█'.repeat(Math.max(3, s.end - s.start)); idx = s.end; }
    return out + text.slice(idx);
  }

  return { RULES, AI_CATEGORIES, luhnValid, findAll, detect, aiDetect, ocrCanvas, redactText, aiCallDirect, fetchAttestation };
})();
