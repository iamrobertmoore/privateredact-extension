# Private Redaction extension — first load & test checklist

First time this MV3 extension is loaded in a browser. Work top to bottom; the
finicky bits are called out with **what to watch** and **where it breaks**.

## 0. Before you load

- Run the engine test once (no browser needed): `node test/engine.test.js` → expect
  `16 passed, 0 failed`. This covers the pure detection logic (rules + luhn +
  redactText + ReDoS budget) so you're not debugging regexes in the browser.
- Manual boxes and local-rule auto-detect need **no server**. Only the AI
  categories (names / addresses / orgs) call `/api/token`, which needs
  `ALLOW_EXTENSION_ORIGINS=true` deployed on the site. Test the no-server paths
  first; add AI last.

## 1. Load unpacked

1. `chrome://extensions` → toggle **Developer mode** (top right).
2. **Load unpacked** → select the `privateredact-extension` folder.
3. Confirm it appears with no red **Errors** button. If there is one, open it —
   manifest / CSP / service-worker parse errors show here first.
4. Pin the toolbar icon.

**Two consoles you'll need** (keep both open while testing):
- **Workspace console** — right-click inside the redaction popup window → Inspect.
  This is where `redact.js` / `core.js` / OCR / the token+enclave call log.
- **Service-worker console** — `chrome://extensions` → the extension →
  **Inspect views: service worker**. This is where `background.js` logs (context
  menus, image grab, region capture, `captureVisibleTab`).

## 2. Flow A — right-click an image

Right-click any image on a normal https page → **Redact this image** → the
workspace popup should open with the image on a canvas.

- **Drag on the image** to black a region; **click a box** to remove it. Should
  always work (no OCR/AI).
- **Auto-detect & redact** → first run loads the OCR model (a few seconds), then
  boxes appear over detected items.
- **Download PNG** / **Copy image** → confirm the covered pixels are *gone*, not
  just hidden (open the PNG; the black is flattened in).

**Watch for:**
- *Cross-origin images.* `grabImage` (background.js) first `fetch()`es the src,
  then falls back to drawing the `<img>` to a canvas. For images served without
  CORS headers, the fetch fails **and** the canvas is tainted, so `toDataURL`
  throws → you get the "could not read that image… try the toolbar button" alert.
  Expected on many sites; verify the toolbar region-capture path works there
  instead.
- *Huge images.* The data URL is passed via `chrome.storage.session` (≈10 MB
  quota). A very large source image could exceed it → workspace shows "Nothing to
  redact". If you hit this, the fix is to pass via a blob URL instead of storage.
- *Copy image.* `navigator.clipboard.write([ClipboardItem])` can reject if the
  popup isn't focused → status shows "Copy failed… Use Download instead."

## 3. Flow B — toolbar region capture

Click the toolbar icon on a normal page → a crosshair overlay appears → **drag a
rectangle** → workspace opens with just that region.

**Watch for (the classic dpr bug):**
- The crop math is `sx = crop.x * dpr` … in `redact.js` `initImage`. On a
  HiDPI/Retina display (`devicePixelRatio` = 2), `captureVisibleTab` returns an
  image at 2× while the drag rect is in CSS px — the `* dpr` is meant to reconcile
  them. **Test on both a Retina and an external 1× monitor** and confirm the
  captured region matches what you dragged. If it's offset or half-size, that's
  the dpr path.
- The overlay is removed 90 ms before capture (`setTimeout` in background.js) so
  it isn't in the shot. If you ever see the blue selection box baked into the
  capture, that delay needs raising.
- **Restricted pages** (`chrome://`, the Web Store, PDF viewer) can't be scripted —
  the icon will silently do nothing there. Expected; test on a normal site.

## 4. Flow C — right-click selected text

Select text on a page → right-click → **Redact selected text** → workspace opens
in text mode with Original / Redacted panes.

- Confirm rules fire (emails, phones, cards, etc.) and **Copy redacted text**
  copies the block-character version.
- AI categories (names/addresses/orgs) only fill in once the token path is live
  (section 5). Until then you'll see "AI step unavailable: …" appended to status —
  that's the graceful fallback, not a crash.

## 5. Enable the AI auto-detect (server step)

The AI categories call `https://privateredact.app/api/token`. For the extension's
`chrome-extension://` origin to be allowed:

```
# on the site repo, on your Mac:
netlify env:set ALLOW_EXTENSION_ORIGINS true
netlify deploy --prod   # rebuilds the token fn so the flag takes effect
```

Then in the workspace, tick **Names/Addresses/Orgs** and Auto-detect. Watch the
**workspace console** for the `/api/token` POST (should be 200) and the direct
enclave call. A 4xx from `/api/token` usually means the origin flag isn't live yet.

## 6. If you change engine logic

Re-run `node test/engine.test.js` before reloading the extension — it guards
correctness and the ReDoS budget (every stress probe must stay < 250 ms).
