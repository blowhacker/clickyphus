// Replace this ID and the matching manifest ID with your main extension's ID.
const ALLOWED_EXTENSION_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const queues = new Map();
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function runSerially(tabId, task) {
  const prior = queues.get(tabId) || Promise.resolve();
  const current = prior.catch(() => {}).then(task);
  queues.set(tabId, current);
  current.finally(() => {
    if (queues.get(tabId) === current) queues.delete(tabId);
  }).catch(() => {});
  return current;
}

function pointsAround(x, y, radius, step) {
  const points = [{ x, y }]; // Center first
  for (let ring = 1; ring <= radius; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const px = x + dx * step, py = y + dy * step;
        if (px >= 0 && py >= 0) points.push({ x: px, y: py });
      }
    }
  }
  return points;
}

// Overlay lives in the top-level document, above nested cross-origin frames.
// pointer-events:none prevents the marker itself from swallowing clicks.
async function showMarker(target, x, y, index, total) {
  const source = `(() => {
    const id = '__coordinate_click_visualizer__';
    let host = document.getElementById(id);
    if (!host) {
      host = document.createElement('div');
      host.id = id;
      host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;overflow:hidden';
      (document.documentElement || document.body).appendChild(host);
    }
    const dot = document.createElement('div');
    dot.style.cssText = 'position:absolute;left:${x}px;top:${y}px;transform:translate(-50%,-50%);width:24px;height:24px;border:3px solid #ff214f;border-radius:50%;background:rgba(255,33,79,.22);box-shadow:0 0 0 2px white,0 0 12px #ff214f;box-sizing:border-box';
    const h = document.createElement('div');
    h.style.cssText = 'position:absolute;left:${x-16}px;top:${y}px;width:32px;border-top:1px solid #ff214f';
    const v = document.createElement('div');
    v.style.cssText = 'position:absolute;left:${x}px;top:${y-16}px;height:32px;border-left:1px solid #ff214f';
    const label = document.createElement('div');
    label.textContent = '${index}/${total} (${x},${y})';
    label.style.cssText = 'position:absolute;left:${x+18}px;top:${y+13}px;background:#151515;color:#fff;border:1px solid #ff214f;padding:3px 6px;border-radius:4px;white-space:nowrap;font:12px monospace';
    host.replaceChildren(dot,h,v,label);
    clearTimeout(window.__coordinateClickMarkerTimer);
    window.__coordinateClickMarkerTimer = setTimeout(() => host.remove(), 1600);
  })()`;
  try {
    await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
      expression: source, returnByValue: true
    });
  } catch (error) {
    console.warn('[coordinate-click] overlay unavailable:', error.message);
  }
}

async function clickGrid(tabId, x, y, radius = 1, step = 10, intervalMs = 180, startDelayMs = 0, visualize = true) {
  if (!Number.isInteger(tabId) || tabId < 0 ||
      !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 ||
      !Number.isInteger(radius) || radius < 0 || radius > 4 ||
      !Number.isInteger(step) || step < 1 || step > 100 ||
      !Number.isInteger(intervalMs) || intervalMs < 80 || intervalMs > 5000) {
    throw new Error("Invalid tab, coordinates, radius (0–4), step (1–100), or interval (80–5000ms)");
  }

  return runSerially(tabId, async () => {
    if (startDelayMs) await sleep(startDelayMs);
    const target = { tabId };
    const points = pointsAround(x, y, radius, step);
    console.log("[coordinate-click] attaching for sweep", { tabId, x, y, radius, step, points });
    await chrome.debugger.attach(target, "1.3");
    let completed = 0;
    try {
      for (const pt of points) {
        if (visualize) {
          await showMarker(target, pt.x, pt.y, completed + 1, points.length);
          await sleep(120); // Let the crosshair become visible before clicking
        }
        const move = { type: "mouseMoved", x: pt.x, y: pt.y };
        const press = { type: "mousePressed", x: pt.x, y: pt.y, button: "left", buttons: 1, clickCount: 1 };
        const release = { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", buttons: 0, clickCount: 1 };
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", move);
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", press);
        await sleep(80);
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", release);
        completed++;
        console.log(`[coordinate-click] ${completed}/${points.length}`, pt);
        if (completed < points.length) await sleep(intervalMs);
      }
      return { ok: true, tabId, completed, points };
    } catch (error) {
      console.error("[coordinate-click] sweep interrupted", { completed, error });
      throw error;
    } finally {
      try { await chrome.debugger.detach(target); }
      catch (error) { console.warn("[coordinate-click] detach failed", error); }
    }
  });
}

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (sender.id !== ALLOWED_EXTENSION_ID) {
    sendResponse({ ok: false, error: "Unauthorized extension" });
    return false;
  }
  if (message?.type !== "CLICK_AT" && message?.type !== "CLICK_GRID") {
    sendResponse({ ok: false, error: "Unknown request" });
    return false;
  }
  const radius = message.type === "CLICK_AT" ? 0 : (message.radius ?? 1);
  clickGrid(message.tabId, message.x, message.y, radius, message.step ?? 10, message.intervalMs ?? 180, 0, message.visualize !== false)
    .then(sendResponse)
    .catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "CLICK_AT" && message?.type !== "CLICK_GRID") return false;
  sendResponse({ ok: true, queued: true });
  const radius = message.type === "CLICK_AT" ? 0 : (message.radius ?? 1);
  // Give the popup time to close, then start the sweep.
  clickGrid(message.tabId, message.x, message.y, radius, message.step ?? 10, message.intervalMs ?? 180, 600, message.visualize !== false)
    .then(result => console.log("[coordinate-click] popup sweep completed", result))
    .catch(error => console.error("[coordinate-click] popup sweep failed", error));
  return false;
});


// ----- Automatic conditional sweep: one rule, URL AND page text -----
// Watcher reports are emitted separately from each permitted frame, including
// cross-origin frames. Tab URL is the top-level page URL, not the frame URL.
const autoFired = new Map(); // tabId -> true, reset on top-level navigation

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' || changeInfo.url) autoFired.delete(tabId);
});
chrome.tabs.onRemoved.addListener(tabId => autoFired.delete(tabId));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'AUTO_TEXT_FOUND') return false;
  (async () => {
    const tabId = sender.tab?.id;
    if (!Number.isInteger(tabId) || autoFired.has(tabId)) return;
    const { autoRule } = await chrome.storage.local.get('autoRule');
    if (!autoRule?.enabled || !autoRule.urlMatch?.trim() || !autoRule.textMatch?.trim()) return;
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url?.toLowerCase().includes(autoRule.urlMatch.toLowerCase())) return;
    // The message contains no user page content; verify only that the reporter
    // matched the currently saved phrase. Content scripts are extension-owned.
    if (message.textMatch !== autoRule.textMatch.toLowerCase()) return;
    if (autoFired.has(tabId)) return;
    autoFired.set(tabId, true); // mark before async work to prevent duplicate sweeps
    console.log('[coordinate-click] AUTO RULE MATCHED', { tabId, url: tab.url, frameId: sender.frameId });
    try {
      await clickGrid(tabId, autoRule.x, autoRule.y, autoRule.radius, autoRule.step,
        autoRule.intervalMs, 0, autoRule.visualize);
      console.log('[coordinate-click] AUTO SWEEP DONE', { tabId });
    } catch (error) {
      console.error('[coordinate-click] AUTO SWEEP FAILED', error);
      // Keep once-per-load guard even if the page rejects a click; no retry storm.
    }
  })().catch(error => console.warn('[coordinate-click] rule check failed', error));
  return false;
});
