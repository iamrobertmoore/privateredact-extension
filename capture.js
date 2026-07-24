/* Injected on demand: draw a selection rectangle over the page, report it. */
(() => {
  if (window.__prCaptureActive) return;
  window.__prCaptureActive = true;

  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:2147483646;cursor:crosshair;background:rgba(8,11,20,0.30);';
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;border:2px solid #6E97FF;background:rgba(110,151,255,0.15);display:none;z-index:2147483647;pointer-events:none;';
  const hint = document.createElement('div');
  hint.textContent = 'Drag to select the area to redact · Esc to cancel';
  hint.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);background:#0E1626;color:#E8EDF7;font:13px system-ui,sans-serif;padding:8px 14px;border-radius:8px;z-index:2147483647;border:1px solid #6E97FF;pointer-events:none;';
  document.documentElement.append(ov, box, hint);

  let sx = 0, sy = 0, drawing = false;
  const cleanup = () => { ov.remove(); box.remove(); hint.remove(); window.__prCaptureActive = false; document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); cleanup(); } };
  document.addEventListener('keydown', onKey, true);

  ov.addEventListener('mousedown', (e) => { drawing = true; sx = e.clientX; sy = e.clientY; box.style.display = 'block'; box.style.left = sx + 'px'; box.style.top = sy + 'px'; box.style.width = '0'; box.style.height = '0'; });
  ov.addEventListener('mousemove', (e) => {
    if (!drawing) return;
    const x = Math.min(sx, e.clientX), y = Math.min(sy, e.clientY), w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
    box.style.left = x + 'px'; box.style.top = y + 'px'; box.style.width = w + 'px'; box.style.height = h + 'px';
  });
  ov.addEventListener('mouseup', (e) => {
    if (!drawing) return;
    drawing = false;
    const x = Math.min(sx, e.clientX), y = Math.min(sy, e.clientY), w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
    cleanup();
    if (w > 4 && h > 4) chrome.runtime.sendMessage({ type: 'PR_REGION', rect: { x, y, w, h, dpr: window.devicePixelRatio || 1 } });
  });
})();
