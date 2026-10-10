# Coordinate Click Companion v0.5

An unpacked Chrome Manifest V3 extension for manual or automatic viewport-coordinate clicks using CDP (`chrome.debugger`).

## Install
1. Unzip. Go to `chrome://extensions`, turn on Developer mode, and choose **Load unpacked**.
2. Select the `coordinate-click-companion-v5` directory.
3. Open the toolbar popup. The top form runs manual clicks; the lower form saves an automatic rule.

## Auto rule
Set **Page URL contains** (substring of the *top-level tab URL*) and **Page text contains** (case-insensitive substring found in any permitted frame). Configure X/Y (viewport coordinates), grid size, step and delay; enable the rule and save.

When both conditions match, the grid fires **once per tab page load**. Reloading the page rearms the rule. Turning the rule off prevents future automatic sweeps. A matched cross-origin frame can report its text because its own extension content script scans it; the background service worker performs the actual CDP click in the tab viewport. For best results use a distinctive URL and text phrase.

## Permissions/privacy
`debugger` dispatches input; `storage` persists the rule; `tabs` reads the top-level URL. Broad `<all_urls>` host access injects a page text watcher into webpages, including cross-origin frames where permitted. Text stays in the page; the watcher sends only the configured search phrase and match signal. Restricted Chrome pages and some sandboxed frames are excluded. Open shadow roots are scanned, closed roots are not. Embedded cross-origin content may require matching host access; not every special frame is injectable.

**Important:** Auto clicks can trigger actions multiple times (9/25/49 clicks) and can interact with sensitive controls. Start with single click or a safe test page. Disabling auto rule stops new automatic sweeps, but not one already in progress. CDP doesn't move the OS cursor; the optional visual marker displays click coordinates.

## Companion API
Change placeholder main extension ID in `manifest.json` and `background.js`, reload, then send `CLICK_GRID` or `CLICK_AT` requests as before.

## Debugging
`chrome://extensions` → Service worker → Inspect. Filter console for `[coordinate-click] AUTO RULE MATCHED` / `AUTO SWEEP DONE`.
