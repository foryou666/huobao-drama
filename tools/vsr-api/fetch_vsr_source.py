"""Fetch VSR source files from GitHub (skips large binaries/models)."""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

REPO = "foryou666/video-subtitle-remover"
BRANCH = "main"
MAX_SIZE = 3 * 1024 * 1024  # 3 MB
SKIP_PREFIXES = (
    "backend/ffmpeg/",
    "backend/models/",
    "design/",
    "test/",
)
SKIP_SUFFIXES = (
    ".exe",
    ".pth",
    ".pt",
    ".pdiparams",
    ".mp4",
    ".gif",
    ".dmg",
    ".pdf",
    ".png",
    ".PNG",
    ".ico",
)


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "huobao-vsr-setup"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def should_fetch(path: str, size: int) -> bool:
    if size > MAX_SIZE:
        return False
    if any(path.startswith(p) for p in SKIP_PREFIXES):
        return False
    if any(path.endswith(s) for s in SKIP_SUFFIXES):
        return False
    return True


def download_file(dest_root: Path, path: str) -> tuple[str, str | None]:
    url = f"https://raw.githubusercontent.com/{REPO}/{BRANCH}/{path}"
    out = dest_root / path
    out.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "huobao-vsr-setup"})
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            out.write_bytes(resp.read())
        return path, None
    except urllib.error.URLError as exc:
        return path, str(exc)


def main() -> int:
    dest = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "video-subtitle-remover"
    dest.mkdir(parents=True, exist_ok=True)
    print(f"Fetching VSR source into {dest}")

    tree = fetch_json(f"https://api.github.com/repos/{REPO}/git/trees/{BRANCH}?recursive=1")
    files = [item for item in tree.get("tree", []) if item.get("type") == "blob" and should_fetch(item["path"], item.get("size", 0))]
    print(f"Downloading {len(files)} source files (skipping models/ffmpeg/assets)...")

    ok = 0
    failed: list[str] = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(download_file, dest, item["path"]): item["path"] for item in files}
        for i, fut in enumerate(as_completed(futures), 1):
            path, err = fut.result()
            if err:
                failed.append(f"{path}: {err}")
            else:
                ok += 1
            if i % 50 == 0 or i == len(files):
                print(f"  {i}/{len(files)}")

    main_py = dest / "backend" / "main.py"
    print(f"Done: {ok} ok, {len(failed)} failed")
    if not main_py.exists():
        print("ERROR: backend/main.py missing", file=sys.stderr)
        return 1
    if failed:
        print("Some files failed (usually non-critical):", file=sys.stderr)
        for line in failed[:10]:
            print(f"  {line}", file=sys.stderr)
    print("SUCCESS: VSR source skeleton ready.")
    print("NOTE: Models + ffmpeg still required — use official prebuilt package for full runs.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
