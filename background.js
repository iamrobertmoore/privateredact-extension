/* Private Redaction — background service worker (MV3).
 * Wires the three entry points (right-click image, right-click selection, toolbar
 * region capture), gathers the content, and opens the redaction workspace. No
 * document/image data is sent anywhere from here. */
'use strict';

const REDACT_PAGE = 'redact.html';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'pr-image', title: 'Redact this image', contexts: ['image'] });
    chrome.contextMenus.create({ id: 'pr-selection', title: 'Redact selected text', contexts: ['selection'] });
  });
});

async function openWorkspace(job) {
  await chrome.storage.session.set({ pr_job: job });
  await chrome.windows.create({ url: chrome.runtime.getURL(REDACT_PAGE), type: 'popup', width: 1040, height: 860 });
}

// Runs in the page (isolated world) to read an image's bytes as a data URL.
async function grabImage(srcUrl) {
  const toDataURL = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
  try { const r = await fetch(srcUrl); if (r.ok) return { ok: true, dataUrl: await toDataURL(await r.blob()) }; } catch (e) {}
  try {
    const img = [...document.images].find((i) => i.currentSrc === srcUrl || i.src === srcUrl);
    if (img && img.naturalWidth) {
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return { ok: true, dataUrl: c.toDataURL('image/png') };
    }
  } catch (e) {}
  return { ok: false, error: 'could not read that image (it may be protected). Try the toolbar button to capture a region instead.' };
}

function alertInTab(tabId, message) {
  chrome.scripting.executeScript({ target: { tabId }, func: (m) => window.alert('Private Redaction: ' + m), args: [message] }).catch(() => {});
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'pr-selection' && info.selectionText) {
    await openWorkspace({ type: 'text', text: info.selectionText });
    return;
  }
  if (info.menuItemId === 'pr-image' && info.srcUrl && tab && tab.id != null) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: grabImage, args: [info.srcUrl] });
      if (result && result.ok) await openWorkspace({ type: 'image', dataUrl: result.dataUrl });
      else alertInTab(tab.id, (result && result.error) || 'could not read that image');
    } catch (e) { alertInTab(tab.id, 'could not read that image: ' + e.message); }
  }
});

// Toolbar icon -> inject the region-select overlay.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || tab.id == null) return;
  try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['capture.js'] }); }
  catch (e) { /* restricted pages (chrome://, web store, PDFs) can't be scripted */ }
});

// capture.js reports the selected rectangle -> screenshot the tab and crop later.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === 'PR_REGION' && sender.tab) {
    (async () => {
      await new Promise((r) => setTimeout(r, 90)); // let the overlay clear before capture
      const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' });
      await openWorkspace({ type: 'image', dataUrl, crop: msg.rect });
    })();
  }
  return false;
});
