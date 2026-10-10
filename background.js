// Replace the ID below (and the matching manifest.json ID) with your main extension's ID.
const ALLOWED_EXTENSION_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const queues = new Map();

function runSerially(tabId, task) {
  const prior = queues.get(tabId) || Promise.resolve();
  const current = prior.catch(() => {}).then(task);
  queues.set(tabId, current);
  current.finally(() => {
    if (queues.get(tabId) === current) queues.delete(tabId);
  }).catch(() => {});
  return current;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function clickAt(tabId, x, y, delayMs = 0) {
  if (!Number.isInteger(tabId) || tabId < 0 ||
      !Number.isFinite(x) || !Number.isFinite(y) ||
      x < 0 || y < 0) {
    throw new Error("Expected {tabId: positive integer, x: nonnegative number, y: nonnegative number}");
  }

  return runSerially(tabId, async () => {
    if (delayMs) await sleep(delayMs);
    const target = { tabId };
    console.log("[coordinate-click] attaching", { tabId, x, y });
    await chrome.debugger.attach(target, "1.3");
    try {
      const dispatch = (type) => chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
        type, x, y, button: "left", clickCount: 1
      });
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await dispatch("mousePressed");
      await sleep(80);
      await dispatch("mouseReleased");
      console.log("[coordinate-click] dispatched", { tabId, x, y });
      return { ok: true, tabId, x, y };
    } finally {
      try {
        await chrome.debugger.detach(target);
      } catch (error) {
        console.warn("[coordinate-click] detach failed", error);
      }
    }
  });
}

// Main extension -> companion extension. Do not accept requests from arbitrary extensions.
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (sender.id !== ALLOWED_EXTENSION_ID) {
    sendResponse({ ok: false, error: "Unauthorized extension" });
    return false;
  }
  if (message?.type !== "CLICK_AT") {
    sendResponse({ ok: false, error: "Unknown request" });
    return false;
  }
  clickAt(message.tabId, message.x, message.y)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

// Local popup interface, useful for verifying the extension independently.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "CLICK_AT") return false;
  // Popup sends a queued command and closes itself. Click after it closes.
  sendResponse({ ok: true, queued: true });
  clickAt(message.tabId, message.x, message.y, 500)
    .then(result => console.log("[coordinate-click] popup click result", result))
    .catch(error => console.error("[coordinate-click] popup click failed", error));
  return false;
});
