# Private Redaction — Chrome extension

Redact sensitive info from **images, screenshots and text**, entirely in your
browser. Free and open source.

**▶ Install from the Chrome Web Store:**
https://chromewebstore.google.com/detail/private-redaction/eldnppgbnlankgbnoblonninllhcpkbm

Part of [Private Redaction](https://privateredact.app) — see the
[extension page](https://privateredact.app/extension) for a walkthrough.

Three entry points:

- **Right-click an image → "Redact this image"** — OCR + detect + black out.
- **Toolbar icon → drag a region of the page** — captures that area (great for
  "screenshot my bank balance but cover the numbers").
- **Right-click selected text → "Redact selected text"** — returns redacted text
  you can copy.

In the workspace you can always **drag on the image to black out anything**, and
click a box to remove it. **Auto-detect** adds boxes over detected sensitive items
using local rules (emails, phone/card/account numbers, etc.) plus the same private
enclave AI the website uses (names, addresses, organisations). A review checklist
lets you tick/untick each detected item, and a verification panel shows the
enclave's hardware attestation with a downloadable receipt.

## Privacy model

Same as the web app: the image/text never leaves your device for the redaction
itself. When you use the AI categories, only the extracted text is sent, straight
from the browser to the sealed Nillion enclave using a short-lived delegation token
minted by `privateredact.app/api/token` (which never sees your content). Local
rules and manual boxes need no network at all. The output is a flattened image, so
the covered pixels are gone, not hidden.

## Install

Most people should install from the **Chrome Web Store** (link above). It also works
in Chromium-based browsers (Edge, Brave).

## Develop (load unpacked)

1. Clone this repo and go to `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. **Load unpacked** → select this `privateredact-extension` folder.
4. Run the engine tests with `node test/engine.test.js` and `node test/ai.test.js`.

See `TESTING.md` for the full manual test pass and `CHROME_STORE_PUBLISHING.md` for
the store listing details.

## How the AI path is authorised

The AI categories call `privateredact.app/api/token` (to mint a delegation token)
and `/api/attest` (for the attestation). The server only accepts these from
allow-listed origins. In production the allow-list is pinned to this published
extension's origin:

```
ALLOWED_ORIGIN = "https://privateredact.app,chrome-extension://eldnppgbnlankgbnoblonninllhcpkbm"
ALLOW_EXTENSION_ORIGINS = false
```

Manual boxes and the local pattern rules run fully client-side and need no network.

## Notes

- OCR accuracy depends on image quality; review the boxes before you download.
- Auto-detect covers whole words; drag a manual box to cover any region precisely.
- Reuses the site's vendored engines (`lib/`): tesseract.js (OCR) and the nilAI
  delegation client.
