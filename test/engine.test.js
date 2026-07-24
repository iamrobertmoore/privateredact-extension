/* Headless test + stress harness for core.js's detection engine.
 * Run: node test/engine.test.js   (exits non-zero on any failure)
 *
 * Shims the browser globals core.js references, loads the PR engine, then checks
 * detection correctness and guards against ReDoS / slow regexes. No network, no
 * OCR, no AI are exercised — this covers the pure client-side detection logic. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = {
  window: {}, document: { createElement: () => ({}), head: { appendChild() {} } },
  chrome: { runtime: { getURL: (p) => p } },
  fetch: async () => { throw new Error('network disabled in harness'); },
  console,
};
sandbox.window.PR_CONFIG = { model: 'x', clientBundle: '', nucBaseUrl: '', tokenUrl: '', tess: {} };
vm.createContext(sandbox);
const src = fs.readFileSync(path.join(__dirname, '..', 'core.js'), 'utf8') + '\n;this.PR = PR;';
vm.runInContext(src, sandbox, { filename: 'core.js' });
const PR = sandbox.PR;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { (cond ? pass++ : fail++); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };

const ALLRULES = ['email', 'phone', 'ssn', 'card', 'acct', 'iban', 'ip', 'date'];
async function det(text, opts = {}) { return PR.detect(text, { ruleKeys: ALLRULES, ...opts }); }
const cats = (r) => r.detections.map((d) => d.category);
const texts = (r) => r.detections.map((d) => d.text);
const has = (r, cat) => cats(r).includes(cat);

(async () => {
  console.log('===== CORRECTNESS =====');

  ok('email basic', has(await det('reach me at jane.doe@example.co.uk please'), 'Email addresses'));
  ok('email plus/sub', has(await det('john+tag@sub.domain.io'), 'Email addresses'));

  let r = await det('call +44 20 7946 0958 today');
  ok('phone intl', has(r, 'Phone numbers'), JSON.stringify(texts(r)));
  ok('phone short NOT matched (<7 digits)', !has(await det('code 123 456'), 'Phone numbers'));

  ok('ssn', has(await det('SSN 123-45-6789 on file'), 'US SSN'));

  ok('card valid luhn matched', has(await det('card 4242 4242 4242 4242 expires'), 'Card numbers'));
  ok('card invalid luhn rejected', !has(await det('card 4242 4242 4242 4241 expires'), 'Card numbers'));

  ok('iban', has(await det('IBAN GB82WEST12345698765432 end'), 'IBAN'));
  ok('ip', has(await det('server 192.168.1.254 down'), 'IP addresses'));
  ok('date', has(await det('due 03/11/2025 sharp'), 'Dates'));

  r = await det('acct 12345678 ref');
  ok('acct span detected (any label, all rules on)', texts(r).includes('12345678'), JSON.stringify(cats(r)));
  ok('acct labelled correctly (acct rule only)', has(await PR.detect('acct 12345678 ref', { ruleKeys: ['acct'] }), 'Account / long numbers'));

  ok('custom term', has(await PR.detect('Project Bluebird is secret', { ruleKeys: [], terms: ['Bluebird'] }), 'Custom term'));

  {
    const t = 'email a@b.com now';
    const red = PR.redactText(t, (await PR.detect(t, { ruleKeys: ['email'] })).detections);
    ok('redactText blocks email + keeps context', red.startsWith('email ') && red.endsWith(' now') && red.includes('█'), JSON.stringify(red));
  }
  {
    const t = 'x 4242 4242 4242 4242 y a@b.com';
    const red = PR.redactText(t, (await det(t)).detections);
    ok('redactText handles multiple/overlapping spans', typeof red === 'string' && red.includes('█'));
  }

  ok('no false positives on plain prose', (await det('The quick brown fox jumps over the lazy dog near the river bank.')).detections.length === 0);

  // Review flow: unticking a detection (add its id to `disabled`) must exclude it
  // from the redacted output, while the rest stay redacted. This is what the
  // workspace's per-item checkboxes drive via activeSpans() -> redactText().
  {
    const t = 'Email a@b.com and call 415 555 0132 today';
    const all = (await det(t)).detections;
    all.forEach((d, i) => { d.id = 'd' + i; });
    const emailDet = all.find((d) => d.text.includes('a@b.com'));
    const disabled = new Set([emailDet.id]); // untick the email
    const active = all.filter((d) => !disabled.has(d.id)).map((d) => ({ start: d.start, end: d.end }));
    const red = PR.redactText(t, active);
    ok('unticked item is NOT redacted', red.includes('a@b.com'), JSON.stringify(red));
    ok('remaining items are still redacted', red.includes('█') && all.length > 1);
  }

  console.log('\n===== PERFORMANCE / ReDoS (each must stay fast) =====');
  const BUDGET_MS = 250;
  const time = async (name, text, opts) => {
    const t0 = process.hrtime.bigint();
    const rr = await det(text, opts);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const slow = ms > BUDGET_MS;
    console.log(`${ms.toFixed(1).padStart(8)} ms  n=${String(rr.detections.length).padStart(6)}  ${name}${slow ? '  <-- OVER BUDGET' : ''}`);
    if (slow) { fail++; }
    return ms;
  };

  const block = 'Contact jane.doe@example.com or +1 415 555 0132. SSN 123-45-6789. ' +
                'Card 4242 4242 4242 4242. IBAN GB82WEST12345698765432. IP 10.0.0.1 on 03/11/2025. ';
  await time('realistic doc x2000 (~135KB)', block.repeat(2000));
  await time('50k digits, no boundary', '5'.repeat(50000));
  await time('"1234 5678 " x5000', '1234 5678 '.repeat(5000));
  await time('"12-34-56-" x8000 (dash ReDoS probe)', '12-34-56-'.repeat(8000));
  await time('near-card then break x2000', '4242 4242 4242 424x '.repeat(2000));
  await time('"1.2.3." x9000 (dot ReDoS probe)', '1.2.3.'.repeat(9000));
  await time('long alpha run x1 (email ReDoS probe)', 'a'.repeat(70000));

  console.log(`\n===== RESULT: ${pass} passed, ${fail} failed =====`);
  process.exit(fail ? 1 : 0);
})();
