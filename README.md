# Coordinate Click Companion

Chrome extension for manual coordinate clicks and automatic grid sweeps triggered by URL and page text or JavaScript expressions.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the components, rule evaluation, click execution, and storage flows.

## Development

Load `extension/` via **chrome://extensions → Developer mode → Load unpacked**.
After changes, reload the extension and refresh open pages.

```sh
npm ci
npm test        # Rule evaluation and click-coordinate regression checks
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

To use computed coordinates, save the automatic rule and let it trigger on the focused page. The manual **Run manual click** button uses the manual X / Y fields and does not evaluate automatic rules. The popup's expandable **Last click** section shows the execution source (JS rule, text rule, or manual), resolved grid center, first click position, and version that executed it. The current loaded version also appears in the footer. The background worker's `resolved sweep center` log shows the actual center selected after evaluating a rule.

For grid size **1 × 1**, spacing and delay are disabled and ignored. Larger grids require valid spacing and delay values.

Grid delay accepts whole numbers from 0 to 5000 ms, including 30 ms. This pause is added after releasing the mouse button; each click also includes an 80 ms button hold, and visual markers add time when enabled.

## Editing rules

Only the selected rule type's condition fields are shown. Switching between page text and JavaScript keeps both inputs, and JS rules label saved coordinates as fallback values. New rules start with a single click; select a larger pattern to reveal spacing and pause controls. Grid sizes from 1 to 20 are available.

Use the shared **Save changes** button to apply edits, enable/disable changes, and removals. The footer tracks unsaved changes, and validation points to the affected field. Removing a rule can be undone before saving. Ordinary unsaved edits are discarded when the popup closes; coordinate picking preserves a draft so editing can continue afterward.
