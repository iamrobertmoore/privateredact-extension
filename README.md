# Private Redaction — Chrome extension (MVP)

Redact sensitive info from **images, screenshots and text**, entirely in your
browser. Three entry points:

- **Right-click an image → "Redact this image"** — OCR + detect + black out.
- **Toolbar icon → drag a region of the page** — captures that area (great for
  "screenshot my bank balance but cover the numbers").
- **Right-click selected text → "Redact selected text"** — returns redacted text
  you can copy.

In the workspace you can always **drag on the image to black out anything**, and
click a box to remove it. **Auto-detect** adds boxes over detected sensitive items
using local rules (emails, phone/card/account numbers, etc.) plus the same private
enclave AI the website uses (names, addresses, organisations).

## Privacy model

Same as the web app: the image/text never leaves your device for the redaction
itself. When you use the AI categories, only the extracted text is sent, straight
from the browser to the sealed Nillion enclave using a short-lived delegation token
minted by `privateredact.app/api/token` (which never sees your content). Local
rules and manual boxes need no network at all.

## Load it (unpacked)

1. Go to `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. **Load unpacked** → select this `privateredact-extension` folder.
4. Pin the icon if you like. Try right-clicking an image, or click the icon and
   drag a region.

## One server-side step for the AI auto-detect

The AI categories call `/api/token`. For the extension's origin to be allowed, on
the site's Netlify:

```
netlify env:set ALLOW_EXTENSION_ORIGINS true
# then redeploy so the rebuilt token function + flag take effect:
netlify deploy --prod
```

Until that's deployed, **manual boxes and local-rule auto-detect still work** (they
run fully client-side); only the AI categories (names/addresses/orgs) need it. For
production you can later pin the extension's ID and allow just that origin instead
of all `chrome-extension://` origins.

## Status / limitations (MVP)

- OCR accuracy depends on image quality; review before you download.
- Auto-detect covers whole words; manual boxes cover any region.
- Not yet on the Chrome Web Store (load unpacked for now).
- Reuses the site's vendored engines (`lib/`): tesseract.js (OCR) and the nilAI
  delegation client.
