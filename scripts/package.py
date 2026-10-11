#!/usr/bin/env python3
"""Package the loadable extension without repository or development files."""

import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


def main():
    root = Path(__file__).resolve().parent.parent
    extension = root / "extension"
    manifest = json.loads((extension / "manifest.json").read_text())
    output = root / "dist" / f"clickyphus-{manifest['version']}.zip"
    output.parent.mkdir(exist_ok=True)
    with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
        for path in sorted(extension.rglob("*")):
            relative = path.relative_to(extension)
            if path.is_file() and not any(part.startswith(".") for part in relative.parts):
                archive.write(path, relative.as_posix())
    print(output)


if __name__ == "__main__":
    main()
