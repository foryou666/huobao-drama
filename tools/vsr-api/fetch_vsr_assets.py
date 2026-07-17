"""Download VSR models + Windows ffmpeg from GitHub with resume."""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = "foryou666/video-subtitle-remover"
BRANCH = "main"
PREFIXES = (
    "backend/models/",
    "backend/ffmpeg/win_x64/",
)
CHUNK = 1024 * 1024
RETRIES = 8


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "huobao-vsr-setup"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))


def human_mb(n: int) -> str:
    return f"{n / 1024 / 1024:.1f} MB"


def download_one(dest_root: Path, path: str, size: int) -> tuple[str, str | None]:
    url = f"https://raw.githubusercontent.com/{REPO}/{BRANCH}/{path}"
    out = dest_root / path
    out.parent.mkdir(parents=True, exist_ok=True)

    for attempt in range(1, RETRIES + 1):
        existing = out.stat().st_size if out.exists() else 0
        if size and existing >= size:
            return path, None

        headers = {"User-Agent": "huobao-vsr-setup"}
        mode = "wb"
        if existing > 0:
            headers["Range"] = f"bytes={existing}-"
            mode = "ab"

        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=300) as resp:
                total = existing
                with open(out, mode) as fh:
                    while True:
                        block = resp.read(CHUNK)
                        if not block:
                            break
                        fh.write(block)
                        total += len(block)
                if size and total < size:
                    raise urllib.error.URLError(f"incomplete {total}/{size}")
            return path, None
        except Exception as exc:  # noqa: BLE001
            if attempt >= RETRIES:
                return path, str(exc)
            time.sleep(min(30, 2 ** attempt))

    return path, "unknown error"


def main() -> int:
    dest = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "video-subtitle-remover"
    dest.mkdir(parents=True, exist_ok=True)
    print(f"Fetching VSR assets into {dest}")

    tree = fetch_json(f"https://api.github.com/repos/{REPO}/git/trees/{BRANCH}?recursive=1")
    files = [
        item
        for item in tree.get("tree", [])
        if item.get("type") == "blob" and any(item["path"].startswith(p) for p in PREFIXES)
    ]
    total_bytes = sum(int(item.get("size") or 0) for item in files)
    print(f"Files: {len(files)}, total ~{human_mb(total_bytes)}")

    ok = 0
    failed: list[str] = []
    for i, item in enumerate(files, 1):
        path = item["path"]
        size = int(item.get("size") or 0)
        print(f"[{i}/{len(files)}] {path} ({human_mb(size)})")
        got_path, err = download_one(dest, path, size)
        if err:
            failed.append(f"{got_path}: {err}")
            print(f"  FAILED: {err}")
        else:
            ok += 1
            print("  ok")

    print(f"\nDone: {ok}/{len(files)} ok")
    if failed:
        print("Failed:", file=sys.stderr)
        for line in failed:
            print(f"  {line}", file=sys.stderr)
        return 1

    # sanity checks
    checks = [
        dest / "backend/models/sttn-auto/infer_model.pth",
        dest / "backend/ffmpeg/win_x64/fs_manifest.csv",
    ]
    for p in checks:
        if not p.exists():
            print(f"ERROR: missing {p}", file=sys.stderr)
            return 1
    print("SUCCESS: models + ffmpeg downloaded.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
