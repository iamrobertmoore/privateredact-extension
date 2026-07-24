/* Headless test of the AI + TEE-verification plumbing in core.js, with the enclave
 * client, /api/token, /api/attest and the signature check all mocked. Verifies:
 *  - aiDetect returns parsed items + a verification object shaped like the site's
 *  - the delegation-token → enclave → attestation flow is wired correctly
 *  - detect() applies already-fetched AI items into spans
 * Run: node test/ai.test.js */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const RESP = JSON.stringify({
  choices: [{ message: { content: '{"redactions":[{"text":"Jane Doe","category":"name"}]}' } }],
  signature: 'AAAA',
});

let failEnclaveOnce = false; // when set, the next enclave call throws a 401 (single-use token)
const fakeNilai = {
  ready: true,
  AuthType: { DELEGATION_TOKEN: 'DELEGATION_TOKEN' },
  secp256k1: { Signature: { fromDER: () => ({}) }, verify: () => true },
  sha256: () => new Uint8Array(32),
  NilaiOpenAIClient: class {
    constructor() {}
    getDelegationRequest() { return { type: 'DELEGATION_TOKEN_REQUEST', public_key: 'pk' }; }
    updateDelegation() {}
    get chat() {
      return { completions: { create: () => {
        if (failEnclaveOnce) { failEnclaveOnce = false; throw new Error('401 status code (no body)'); }
        return { withResponse: async () => ({ data: JSON.parse(RESP), response: { clone: () => ({ text: async () => RESP }) } }) };
      } } };
    }
  },
};

const calls = [];
const sandboxFetchOk = async (url, opts) => {
  calls.push({ url, method: (opts && opts.method) || 'GET' });
  if (String(url).includes('/api/token')) return { ok: true, json: async () => ({ delegationToken: 'dtok' }) };
  if (String(url).includes('/api/attest')) return { ok: true, json: async () => ({
    attestation: { attestation_verified: true, processor: 'AMD SEV-SNP', measurement_matches_known_build: true, checks: { report_signature_valid: true, debug_disabled: true } },
    enclave_public_key: 'AAAA',
    receipt: { attestation_report_hex: 'deadbeef', enclave_public_key: 'AAAA' },
  }) };
  throw new Error('unexpected fetch ' + url);
};
const sandbox = {
  window: { NilaiClient: fakeNilai }, document: {}, console,
  atob: (b) => Buffer.from(b, 'base64').toString('binary'),
  TextEncoder,
  chrome: { runtime: { getURL: (p) => p } },
  fetch: sandboxFetchOk,
};
sandbox.window.PR_CONFIG = { tokenUrl: 'https://privateredact.app/api/token', attestUrl: 'https://privateredact.app/api/attest', nucBaseUrl: 'https://x/nuc/v1/', model: 'm', clientBundle: '' };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'core.js'), 'utf8') + '\n;this.PR = PR;', sandbox, { filename: 'core.js' });
const PR = sandbox.PR;

let pass = 0, fail = 0;
const ok = (n, c, extra) => { (c ? pass++ : fail++); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`); };

(async () => {
  const { items, verification: v } = await PR.aiDetect('Contact Jane Doe today.', ['name'], '');

  ok('aiDetect parses items', items.length === 1 && items[0].text === 'Jane Doe' && items[0].category === 'name', JSON.stringify(items));
  ok('verification mode = verified', v && v.mode === 'verified', v && v.mode);
  ok('verification path = direct', v && v.path === 'direct');
  ok('tee_verified true (signature check passed)', v && v.tee_verified === true);
  ok('attestation carried through', v && v.attestation && v.attestation.attestation_verified === true);
  ok('receipt carried through (for download)', v && v.receipt && v.receipt.attestation_report_hex === 'deadbeef');
  ok('signature captured', v && v.signature === 'AAAA');

  const hitToken = calls.some((c) => c.url.includes('/api/token') && c.method === 'POST');
  const hitAttest = calls.some((c) => c.url.includes('/api/attest'));
  ok('minted delegation token via POST /api/token', hitToken);
  ok('fetched text-free attestation via /api/attest', hitAttest);

  // detect() applies already-fetched AI items as spans, tagged ai:true
  const { detections } = PR.detect('Contact Jane Doe today.', { ruleKeys: [], aiItems: items });
  const jane = detections.find((d) => d.text === 'Jane Doe');
  ok('detect() applies cached AI item to a span', !!jane && jane.ai === true, JSON.stringify(detections));

  // Graceful degradation: if /api/attest fails, the enclave result already exists,
  // so the AI items must still come back — just marked "unavailable", not discarded.
  sandbox.fetch = async (url) => {
    if (String(url).includes('/api/token')) return { ok: true, json: async () => ({ delegationToken: 'dtok' }) };
    if (String(url).includes('/api/attest')) return { ok: false, status: 403, json: async () => ({ error: 'forbidden' }) };
    throw new Error('unexpected fetch ' + url);
  };
  const deg = await PR.aiDetect('Contact Jane Doe today.', ['name'], '');
  ok('attest failure still returns AI items', deg.items.length === 1 && deg.items[0].text === 'Jane Doe');
  ok('attest failure -> verification mode = unavailable', deg.verification && deg.verification.mode === 'unavailable', deg.verification && deg.verification.mode);
  ok('unavailable carries the reason', deg.verification && /attestation 403/.test(deg.verification.reason || ''), deg.verification && deg.verification.reason);

  // Enclave 401 on the first token (single-use/expired) -> retry with a fresh token recovers.
  sandbox.fetch = sandboxFetchOk; // restore good fetch (attest 200)
  failEnclaveOnce = true;
  const retried = await PR.aiDetect('Contact Jane Doe today.', ['name'], '');
  ok('enclave 401 recovers via fresh-token retry', retried.items.length === 1 && retried.verification.mode === 'verified', retried.verification && retried.verification.mode);
  ok('retry consumed the one-off failure', failEnclaveOnce === false);

  console.log(`\n===== RESULT: ${pass} passed, ${fail} failed =====`);
  process.exit(fail ? 1 : 0);
})();
