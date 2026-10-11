# Coordinate Click Companion

Chrome extension for manual coordinate clicks and automatic grid sweeps triggered by URL and page text or JavaScript expressions.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the components, rule evaluation, click execution, and storage flows.

## Development

Load `extension/` via **chrome://extensions → Developer mode → Load unpacked**.
After changes, reload the extension and refresh open pages.

```sh
npm ci
npm run check   # Lint and check formatting
npm run format  # Apply formatting
```

## Packaging

```sh
npm run build
```

Creates `dist/coordinate-click-companion-<version>.zip` with only extension files.
Packaging can also run directly with `python3 scripts/package.py`, without npm.

## JavaScript expression rules

Choose **JavaScript expression** as the rule type, optionally enter a URL match and enter an expression such as `document.querySelector('button.ready') !== null`, then save. Expressions run in the top-level page and can access `document`, `window`, and page variables. Return `true` to use saved coordinates, `{ x, y }` to override the grid center, or `false` to skip clicks. Coordinates must be finite nonnegative numbers; uppercase `{ X, Y }` is also accepted. Expressions and function bodies with `return` are supported. Invalid results, promises, and errors prevent clicks. Use condition expressions without side effects because they are evaluated repeatedly (about every 2.5 seconds, on page mutations and focus, and before each click). As with text rules, only the focused active tab runs, once per page load.

Leave **URL contains** blank, or enter `*`, to match all supported pages. Other values match a case-insensitive URL substring; wildcard patterns such as `*.example.com` are not supported.

For a computed position, you can also use code with `return`:

```js
const button = document.querySelector('button.ready');
if (!button) return false;
const rect = button.getBoundingClientRect();
return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
```

The returned coordinates set the grid center at the start of the sweep. Grid size, spacing, and delay still use the rule settings. The condition is rechecked before clicks, but later coordinate results do not move the grid mid-sweep.
