# Publishing Private Redaction to the Chrome Web Store

Everything you need to get the extension listed. Copy blocks below are written to
paste straight into the Developer Dashboard. Sources for the current (2026) rules are
at the bottom.

---

## 0. What's ready vs. what only you can do

**Done for you (in this repo / the site):**
- `manifest.json` bumped to `1.0.0`, `homepage_url` added.
- Legal footer (Terms · Privacy · Source) added to the workspace.
- Privacy policy page created at `privacy.html` on the site, linked in the footer.
- Store listing copy, single-purpose statement, permission justifications, and data
  disclosures written (below).
- Promo images generated: `store-assets/promo-small-440x280.png` (required) and
  `store-assets/promo-marquee-1400x560.png` (optional, for featuring).
- A clean upload zip: `store-assets/private-redaction-v1.0.0.zip` (dev files excluded).

**Only you can do (needs your Google account / your browser / a card):**
1. Register + verify a Chrome Web Store developer account (one-time **$5** fee).
2. **Deploy `privacy.html`** to the live site (so the policy URL resolves).
3. Capture **screenshots** of the running extension (shot list in §4).
4. Fill the dashboard fields (paste from below), upload the zip + images, submit.
5. After approval: tighten the server origin allow-list to your extension's ID (§8).

---

## 1. One-time developer account setup

- Go to the Chrome Web Store Developer Dashboard and register. There is a **one-time
  US$5 registration fee**.
- You'll need to **verify your identity** and a **contact email** (Google now
  requires this before you can publish). Verification can take a little time, so do
  this first.
- Optional but worth it: set your **publisher display name** to something trustworthy
  (e.g. your name or "Private Redaction"), and later add `privateredact.app` as a
  **verified official URL** (it's already verified in Google Search Console per the
  project setup), which shows a verified link under your listing.

---

## 2. Package the extension

The upload is a zip whose **root contains `manifest.json`** (not a parent folder).
A ready-made one is already at `store-assets/private-redaction-v1.0.0.zip`, excluding
`test/`, markdown docs, and any dev cruft. To regenerate it yourself (bump the version
in the filename each release):

```bash
cd ~/n8n/privateredact-extension
zip -r store-assets/private-redaction-v1.0.0.zip . \
  -x "test/*" "*.md" "store-assets/*" ".*" "*/.*"
```

(Housekeeping: my sandbox left two stray files in `store-assets/` it couldn't delete —
`ziPZHhPC` and a 0-byte `private-redaction-store.zip`. Safe to remove.)

Keep the version in `manifest.json` incrementing on every future upload.

---

## 3. Store listing copy (paste-ready)

**Name**
```
Private Redaction
```

**Summary** (short description, max 132 chars)
```
Black out sensitive info in images, screenshots and text, privately in your browser, with a verifiable private-AI assist.
```

**Category:** `Privacy & Security` (best fit; `Tools` is the fallback if you prefer).

**Language:** English.

**Detailed description**
```
Private Redaction black-outs sensitive information in images, screenshots and text, right in your browser. Nothing is uploaded to redact it: your image or text is opened and the redacted result is produced on your own device.

Three ways to use it:
• Right-click an image and choose "Redact this image".
• Click the toolbar icon and drag to capture any region of a page (for example, screenshot a balance but cover the numbers).
• Right-click selected text and choose "Redact selected text".

In the workspace you can always drag on the image to black out anything, and click a box to remove it. Auto-detect adds redactions over things it finds using built-in pattern rules (emails, phone / card / account numbers, IBANs, and more) that run entirely on your device. Review every detection in a checklist and untick anything you want to keep.

Optional private-AI assist:
For fuzzy categories like names, addresses and organisations, Private Redaction can call a private AI that runs inside a sealed Nillion enclave (AMD SEV-SNP secure hardware). Only the extracted text is sent, straight from your browser to the enclave, using a short-lived token minted from a public key. Our own servers never receive your text on that path, and you get a verifiable hardware-attestation receipt for each run.

Private by design:
• Redaction and OCR run on your device.
• Manual redaction and the local rules need no network at all.
• The AI step sends only extracted text, direct to the sealed enclave, and it isn't stored.
• The output is a flattened image: the covered pixels are gone, not hidden.

Automated redaction can miss things or cover too much, so always review the result before you rely on it or share it. Private Redaction is a free, open-source, experimental tool. Learn more and read the source at privateredact.app.
```

**Homepage URL:** `https://privateredact.app`
**Support URL:** `https://github.com/iamrobertmoore/privateredact/issues`

---

## 4. Graphic assets

| Asset | Size | Status |
|---|---|---|
| Store icon | 128×128 PNG | ✅ `icons/icon128.png` |
| Small promo tile (required) | 440×280 PNG | ✅ `store-assets/promo-small-440x280.png` |
| Marquee promo tile (optional) | 1400×560 PNG | ✅ `store-assets/promo-marquee-1400x560.png` |
| Screenshots (≥1 required, up to 5) | 1280×800 PNG | ⛔ **you capture — see below** |
| Promo video (optional) | YouTube link | optional |

**Screenshots you need to capture** (use a demo document with FAKE personal data, never
real PII). Aim for 1280×800; the workspace popup is ~1040×860, so either screenshot at
that size and place it on a 1280×800 canvas, or grab the window and send them to me and
I'll frame them to spec. Suggested shots:

1. **Image auto-detect** — an image with black redaction boxes, the review checklist,
   and the green "Private · Verified" panel visible.
2. **Text mode** — Original vs Redacted side by side, with the review toggles.
3. **The right-click entry** — the context menu showing "Redact this image".
4. **Region capture** — the blue drag-to-select overlay on a page.
5. **Verification detail** — the expanded attestation panel with the "download receipt"
   link.

---

## 5. Privacy practices tab (paste-ready)

**Single purpose**
```
Private Redaction lets the user black out (redact) sensitive information in images, screenshots and selected text, entirely within the browser. Redaction and OCR happen on the user's device. An optional, user-initiated step sends only extracted text to a sealed Nillion enclave to suggest what to redact; no document content is sent to the developer.
```

**Permission justifications** (one per permission the dashboard lists)

- **contextMenus**
```
Adds the right-click menu items "Redact this image" and "Redact selected text", which are the extension's main entry points.
```
- **activeTab**
```
Used only when the user clicks the toolbar button, to access the current tab so the user can drag-select a region of the page to redact. No access to other tabs or background browsing.
```
- **scripting**
```
Injects the drag-to-select overlay and reads the bytes of the image the user chose, only in response to a user action (a click or menu selection). It does not run on pages by itself.
```
- **storage**
```
Uses chrome.storage.session to pass the captured image or text to the redaction workspace page within the browser. It is transient and local; no data is sent anywhere.
```
- **clipboardWrite**
```
Lets the user copy the redacted image or text to their clipboard.
```
- **Host permission — https://privateredact.app/**
```
For the optional AI detection only: the extension calls /api/token to mint a short-lived delegation token and /api/attest to fetch the enclave's hardware attestation. No document content is sent to these endpoints.
```
- **Host permission — https://api.nilai.nillion.network/**
```
For the optional AI detection only: the extension sends the extracted text directly to the sealed Nillion enclave to identify sensitive content. Used only when the user enables the AI categories.
```

**Remote code:** select **"No, I am not using remote code."**
(All scripts, including the OCR engine and the enclave client, are packaged inside the
extension. Manifest V3 CSP; nothing is fetched-and-executed at runtime.)

**Data use — disclosure + certification** (review these against the live checkboxes)
- Data types: disclose **"Website content"** — the images/text the user points the tool
  at. When the user turns on the AI categories, extracted text is transmitted (by the
  user's action) directly to the Nillion enclave to perform the redaction detection.
  Do **not** tick the other categories as "collected": the extension is not designed to
  harvest PII, authentication info, location, browsing history, etc., and it sends
  nothing to the developer.
- Certify all three standard statements (they are all true here):
  1. You do **not** sell or transfer user data to third parties outside the approved
     use cases (the enclave processing is the disclosed feature, not a sale).
  2. You do **not** use or transfer user data for purposes unrelated to the single
     purpose.
  3. You do **not** use or transfer user data to determine creditworthiness or for
     lending.

**Privacy policy URL**
```
https://privateredact.app/privacy.html
```
(Deploy the site first so this resolves — see §7.)

---

## 6. Distribution & visibility

- **Visibility:** Public (or Unlisted first if you want to soft-launch and share the
  link before it's searchable).
- **Regions:** All regions (default).
- **Pricing:** Free.
- **Mature content:** No.

---

## 7. Deploy the policy, then submit

The privacy policy must resolve at a public URL before you submit. It's a new file in
the site repo (`privacy.html`, linked from the footer). Ship it with the site's normal
flow:

```bash
cd ~/n8n/nillion-redact
git add privacy.html index.html
git commit -m "Add privacy policy page; link it in the footer"
git push origin main
netlify deploy --prod
```
Confirm `https://privateredact.app/privacy.html` loads, then in the dashboard: upload
the zip, fill every field above, add the images + screenshots, and **Submit for
review**.

**Review:** Chrome reviews MV3 extensions automatically and by hand. Because you use
host permissions and handle user content, expect anywhere from a few hours to a few
business days. Extensions that clearly justify permissions and declare "no remote code"
(both done above) review faster. You'll get an email on approval or if changes are
requested.

---

## 8. After approval — harden the origin allow-list (recommended)

Right now the server accepts token/attestation requests from **any** `chrome-extension://`
origin (`ALLOW_EXTENSION_ORIGINS=true`). Once published you know your permanent
extension **ID** (shown in the dashboard). Lock the server to just your extension:

```bash
cd ~/n8n/nillion-redact
netlify env:set ALLOWED_ORIGIN "https://privateredact.app,chrome-extension://<your-extension-id>"
netlify env:set ALLOW_EXTENSION_ORIGINS false
netlify deploy --prod
```
The extension already sends its `chrome-extension://<id>` origin on the token and
attestation POSTs, so it keeps working while every other extension is now refused.
(Optional: pin the ID for local unpacked dev too by adding the extension's public `key`
to `manifest.json` — not required for the store build, since Google assigns the ID.)

---

## 9. Promote it (separate job)

- Add a **"Get the Chrome extension"** button on privateredact.app linking to the store
  listing once the URL exists.
- Optional launch note (LinkedIn / Show HN): "browser-side redaction + a verifiable
  private-AI assist, now a Chrome extension."

---

## 10. Legal, recap

- **Privacy policy:** `privacy.html` (site) — required by the Chrome Web Store and now
  linked from both the site footer and the extension workspace footer.
- **Terms of Use:** existing `terms.html` — the extension footer links to it too.
- **In-product disclaimer:** the workspace now carries "Automated tool, always check the
  result… provided as is," mirroring the site.
These cover the store's privacy-policy requirement and the "as is / review the output"
disclaimers you had on the site.

---

### Sources (current as of July 2026)
- Chrome Web Store program policy updates (2026): https://developer.chrome.com/blog/cws-policy-updates-2026
- Privacy policy requirements: https://developer.chrome.com/docs/webstore/program-policies/privacy
- Fill out the privacy fields (single purpose, permissions, data use): https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- Complete your listing information: https://developer.chrome.com/docs/webstore/cws-dashboard-listing
- Supplying images (sizes): https://developer.chrome.com/docs/webstore/images
- Review process: https://developer.chrome.com/docs/webstore/review-process
