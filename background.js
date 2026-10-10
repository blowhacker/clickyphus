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

function pointsAround(x, y, gridSize, step) {
  // For even sizes, the requested point lies between the four central cells.
  // Round resulting coordinates to browser CSS pixels.
  const start = -(gridSize - 1) / 2;
  const points = [];
  for (let iy = 0; iy < gridSize; iy++) {
    for (let ix = 0; ix < gridSize; ix++) {
      const px = Math.round(x + (start + ix) * step);
      const py = Math.round(y + (start + iy) * step);
      if (px >= 0 && py >= 0) points.push({x:px, y:py});
    }
  }
  // Click nearest the requested point first, and expand outward.
  points.sort((a,b) => (a.x-x)**2+(a.y-y)**2 - ((b.x-x)**2+(b.y-y)**2));
  return points;
}

function getGridSize(message) {
  return message.gridSize ?? ((message.radius ?? 1) * 2 + 1);
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

async function clickGrid(tabId, x, y, gridSize = 3, step = 10, intervalMs = 180, startDelayMs = 0, visualize = true) {
  if (!Number.isInteger(tabId) || tabId < 0 ||
      !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 ||
      !Number.isInteger(gridSize) || gridSize < 1 || gridSize > 20 ||
      !Number.isInteger(step) || step < 1 || step > 100 ||
      !Number.isInteger(intervalMs) || intervalMs < 80 || intervalMs > 5000) {
    throw new Error("Invalid tab, coordinates, grid size (1–20), step (1–100), or interval (80–5000ms)");
  }

  return runSerially(tabId, async () => {
    if (startDelayMs) await sleep(startDelayMs);
    const target = { tabId };
    const points = pointsAround(x, y, gridSize, step);
    console.log("[coordinate-click] attaching for sweep", { tabId, x, y, gridSize, step, count: points.length });
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
  const gridSize = message.type === "CLICK_AT" ? 1 : getGridSize(message);
  clickGrid(message.tabId, message.x, message.y, gridSize, message.step ?? 10, message.intervalMs ?? 180, 0, message.visualize !== false)
    .then(sendResponse)
    .catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "CLICK_AT" && message?.type !== "CLICK_GRID") return false;
  sendResponse({ ok: true, queued: true });
  const gridSize = message.type === "CLICK_AT" ? 1 : getGridSize(message);
  // Give the popup time to close, then start the sweep.
  clickGrid(message.tabId, message.x, message.y, gridSize, message.step ?? 10, message.intervalMs ?? 180, 600, message.visualize !== false)
    .then(result => console.log("[coordinate-click] popup sweep completed", result))
    .catch(error => console.error("[coordinate-click] popup sweep failed", error));
  return false;
});


// Automatic rules: each rule runs at most once per top-level page load.
const autoFired = new Map(); // tabId -> Set(ruleId)
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' || changeInfo.url) autoFired.delete(tabId);
});
chrome.tabs.onRemoved.addListener(tabId => autoFired.delete(tabId));

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'AUTO_TEXT_FOUND') return false;
  (async () => {
    const tabId = sender.tab?.id;
    if (!Number.isInteger(tabId)) return;
    const { autoRules = [] } = await chrome.storage.local.get('autoRules');
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) return;
    for (const rule of autoRules) {
      if (!rule.enabled || !rule.urlMatch?.trim() || !rule.textMatch?.trim()) continue;
      if (!tab.url.toLowerCase().includes(rule.urlMatch.toLowerCase())) continue;
      if (rule.textMatch.toLowerCase() !== message.textMatch) continue;
      // Guard synchronously before starting the asynchronous sweep.
      let fired = autoFired.get(tabId);
      if (!fired) { fired = new Set(); autoFired.set(tabId, fired); }
      if (fired.has(rule.id)) continue;
      fired.add(rule.id);
      console.log('[coordinate-click] AUTO MATCH', {tabId, ruleId: rule.id, url: tab.url});
      clickGrid(tabId, rule.x, rule.y, rule.gridSize ?? (rule.radius*2+1),
        rule.step, rule.intervalMs, 0, rule.visualize)
        .then(result => console.log('[coordinate-click] AUTO COMPLETED', rule.id, result.completed))
        .catch(error => console.error('[coordinate-click] AUTO FAILED', rule.id, error));
    }
  })().catch(error => console.warn('[coordinate-click] rule check failed', error));
  return false;
});
