# Bundled rule specification

Edit the top-level `RULES` array in `extension/default-rules.js`, or append entries using `RULES.push({...})`. Each rule has a stable unique `id` and either a JavaScript `condition()` or `ruleType: 'text'` with `textMatch`.

```js
{
  id: 'click-ready-button',
  name: 'Click the ready button',
  enabled: true,
  urlMatch: 'example.com',
  gridSize: 1,
  step: 10,
  intervalMs: 30,
  visualize: true,
  x: null,
  y: null,
  condition() {
    const button = document.querySelector('button.ready');
    if (!button) return false;
    const rect = button.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  },
}
```

| Field                           | Meaning                                                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                            | Unique stable string; links saved settings to bundled condition code.                                                                                                     |
| `name`                          | Human-readable label in the editor.                                                                                                                                       |
| `enabled`                       | Initial enable/disable state.                                                                                                                                             |
| `urlMatch`                      | Case-insensitive substring of the top-level URL; blank or `*` matches everywhere.                                                                                         |
| `condition()`                   | Synchronous function with DOM and page-global access. Return `false` to retry later, `true` to use saved X/Y, or `{ x, y }` to provide the center. `{ X, Y }` also works. |
| `x`, `y`                        | Nonnegative finite viewport coordinates in CSS pixels, or `null` when the condition supplies coordinates. Required for text rules or a `true` result.                     |
| `gridSize`                      | Integer 1–20; 1 is a single click, larger values give an N×N grid.                                                                                                        |
| `step`                          | Grid spacing, integer 1–100 CSS pixels. Ignored for single clicks.                                                                                                        |
| `intervalMs`                    | Pause between clicks, integer 0–5000 ms. Ignored for single clicks; mouse press duration is separate.                                                                     |
| `visualize`                     | Whether to show click markers.                                                                                                                                            |
| `ruleType: 'text'`, `textMatch` | Use these instead of `condition()` for a case-insensitive page-text rule.                                                                                                 |

Keep rule conditions and any helpers in `default-rules.js`. The build wraps that configuration and the separate evaluator into an injectable function; you do not write the wrapper yourself. Run `npm run build` (or `npm run prepare:rules`) after editing, then reload the extension. Avoid side effects: conditions run on scans, after debugger attachment, and before each click. Errors, promises, and invalid results skip clicking. The grid center resolves after attachment and stays fixed for that sweep.

The loader supplies `ruleType: 'bundled'` and `builtinId` for JavaScript conditions automatically. These should not be written manually. Rules appear in the popup, where users can disable them or edit URL and click settings; bundled conditions remain in source. A user can switch to a custom JavaScript expression, which requires Allow User Scripts.

Fresh installs receive the default settings. Updates and reloads preserve saved settings and removed rules. Changes to a bundled condition apply after extension reload, but keep its `id` stable. Only the focused active tab runs rules, once per page load (or URL change); unsuccessful checks stay eligible for retry without waiting for slow images.
