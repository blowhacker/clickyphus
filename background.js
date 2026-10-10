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

async function clickGrid(tabId, x, y, radius = 1, step = 10, intervalMs = 180, startDelayMs = 0) {
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
  clickGrid(message.tabId, message.x, message.y, radius, message.step ?? 10, message.intervalMs ?? 180)
    .then(sendResponse)
    .catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "CLICK_AT" && message?.type !== "CLICK_GRID") return false;
  sendResponse({ ok: true, queued: true });
  const radius = message.type === "CLICK_AT" ? 0 : (message.radius ?? 1);
  // Give the popup time to close, then start the sweep.
  clickGrid(message.tabId, message.x, message.y, radius, message.step ?? 10, message.intervalMs ?? 180, 600)
    .then(result => console.log("[coordinate-click] popup sweep completed", result))
    .catch(error => console.error("[coordinate-click] popup sweep failed", error));
  return false;
});
