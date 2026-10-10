# Coordinate Click Companion

Chrome extension for manual coordinate clicks and automatic grid sweeps triggered by URL and page text.

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
