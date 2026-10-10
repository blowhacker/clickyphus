# Coordinate Click Companion

Minimal unpacked Manifest V3 Chrome extension that clicks viewport coordinates via the Chrome DevTools Protocol (`Input.dispatchMouseEvent`). It works at the browser input layer, so ordinary DOM, open/closed shadow DOM, and cross-origin nested iframes do not require traversal.

## Install from GitHub

1. Download this repository as a ZIP and extract it, or `git clone` it.
2. Navigate to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and choose the folder containing `manifest.json`.
5. Open an ordinary webpage, click the extension icon, enter X/Y and press **Click**.

Coordinates are **CSS pixels relative to the visible tab viewport**, not screen or full-document coordinates. The popup takes focus, but the debugger command targets the selected tab. Browser internal pages and some protected surfaces are not supported.

## Allow your main extension to call it

1. Find the **main extension ID** in `chrome://extensions`.
2. Replace `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` in **both** `manifest.json` and `background.js` with that ID.
3. Reload the companion extension in `chrome://extensions`.
4. Find the **companion extension ID** in `chrome://extensions` and use it in your main extension's background/service worker:

```js
const COMPANION_ID = "REPLACE_WITH_COMPANION_EXTENSION_ID";

async function remoteClick(tabId, x, y) {
  const result = await chrome.runtime.sendMessage(COMPANION_ID, {
    type: "CLICK_AT", tabId, x, y
  });
  if (!result?.ok) throw new Error(result?.error || "Click failed");
  return result;
}

// Example, from the main extension's service worker:
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
await remoteClick(tab.id, 623, 400);
```

Your main extension needs the appropriate ability to identify its target tab (`activeTab` or `tabs` depending on its design), **not** `debugger` permission. The main extension's service worker is the simplest place to coordinate calls. If calling from a content script, relay to the main extension's service worker first.

## Security and operational notes

- The companion explicitly allows only the configured main extension ID for external messages. Do **not** use an open wildcard external access policy.
- `debugger` is powerful: install only code you trust. The permission warning and Chrome debugging notification still apply even for a manually installed extension.
- Do not grant arbitrary websites access to this API. The manifest contains no `externally_connectable.matches` for web pages.
- Concurrent clicks to the same tab are queued. Each call attaches, presses, releases, and detaches. Another debugger using that tab can cause attachment to fail.
- Returned `ok: true` indicates mouse events were dispatched, **not** that the website performed the intended action.
- This does not automate Chrome UI outside the content viewport. The tab may reject inputs while navigating or not be in a suitable state.
- For stable IDs across machines, Chrome unpacked-extension IDs may change with extension key/path. Update both IDs after installation if needed.


## Troubleshooting popup clicks

The popup now closes before mouse input is dispatched (~500 ms later). Clicks do not physically move the operating-system cursor. Check `chrome://extensions` → this extension → **Service worker** → Inspect for `[coordinate-click]` logs and errors. Note that a queued result only confirms the request was accepted, not that the click succeeded. Avoid testing on `chrome://` pages or while the target page has DevTools attached (debugger conflicts can occur).
