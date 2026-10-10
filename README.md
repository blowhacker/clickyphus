# Coordinate Click Companion v7

A Chrome Manifest V3 unpacked extension for browser-level coordinate clicks using `chrome.debugger` / `Input.dispatchMouseEvent`.

## Installation

1. Unzip the archive.
2. In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked** and select the extracted folder.
3. Click the toolbar icon to run manual sweeps or add automatic rules.

For manual tests, expand **Test a click or grid sweep** and choose **Pick on page**. Click a point on the crosshair overlay to capture its viewport X/Y coordinates without activating the underlying control. The popup reopens with the selected point and your test settings; if it does not reopen automatically, click the extension icon. Escape cancels. Picking also cancels when you switch tabs or after 60 seconds. Automatic clicks pause during picking. Refresh existing pages after reloading the extension to load the picker script.

## What's new in v7

**Automatic grid sweeps stop when the matching text disappears.** Before each click (and again after the visual crosshair delay), the extension asks the same frame/document that triggered the rule whether it still contains the configured phrase. It stops if the phrase is missing, the frame is gone, or the tab navigates. Already dispatched clicks cannot be undone. The automatic rule still fires at most once per page load, even if stopped early. All sweeps require the active tab in the focused Chrome window and stop when it loses focus. Manual sweeps do not check page text.

## Features

- Grid sizes through **20 × 20 (400 clicks)** with 10px default spacing.
- Multiple saved automatic rules, each matching **both** a top-level tab URL substring and page text substring.
- Per-rule coordinates, grid size, spacing, delay, enable/disable, and visual markers.
- Runs only on the active tab in the focused Chrome window. Switching tabs or focusing a Chrome window rechecks automatic conditions in accessible frames.
- Fires each matching rule once per tab page load. A rule that has already clicked does not fire again on refocus. Each tab's click jobs run sequentially.
- Migrates the previous `autoRule` setting when `autoRules` has not yet been saved.

Even-sized grids have no single centre cell; the supplied coordinate is between the middle four positions. Grid points are visited nearest-centre-first.

## Companion extension API

Update the placeholder main extension ID in `manifest.json` and `background.js` before using external messages.

```js
await chrome.runtime.sendMessage('COMPANION_EXTENSION_ID', {
  type: 'CLICK_GRID', tabId: tab.id,
  x: 313, y: 350, gridSize: 20, step: 10, intervalMs: 180,
  visualize: true
});
```

The previous `radius` parameter remains accepted for compatibility.

## Cautions

400 clicks can activate controls repeatedly; ensure the sweep area is safe. Chrome may display debugger warnings. DOM text detection works in permitted frames and open shadow roots, not closed shadow roots. Clicking does not move the physical OS cursor. The top-level URL condition is a case-insensitive substring match. The extension must have host permission for inspected pages.
