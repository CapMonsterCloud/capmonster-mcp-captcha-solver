#!/usr/bin/env python3
"""Check that the agent documents shipped in each package are byte-identical to
the single source in capmonster_agent/.

    python scripts/verify_skill_sync.py --wheel dist/*.whl --npm capmonster-mcp-*.tgz
    python scripts/verify_skill_sync.py ... --site-url https://docs.capmonster.cloud/SKILL.md

--site-url (the copy on the docs site, task Б5) is optional: pass it once the
docs site publishes SKILL.md.
"""

import argparse
import hashlib
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIR = ROOT / "capmonster_agent"
FILES = ("SKILL.md", "INSTRUCTIONS.md", "prompts.json")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def from_wheel(path: Path, name: str) -> bytes:
    with zipfile.ZipFile(path) as zf:
        return zf.read(f"capmonster_mcp/agent/{name}")


def from_npm(path: Path, name: str) -> bytes:
    with tarfile.open(path) as tf:
        member = tf.extractfile(f"package/dist/agent/{name}")
        if member is None:
            raise KeyError(name)
        return member.read()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--wheel", type=Path, required=True)
    ap.add_argument("--npm", type=Path, required=True)
    ap.add_argument("--site-url", help="published copy of SKILL.md on the docs site")
    args = ap.parse_args()

    failures = []
    for name in FILES:
        expected = sha256((SOURCE_DIR / name).read_bytes())
        copies = {"wheel": from_wheel, "npm": from_npm}
        for label, reader in copies.items():
            path = args.wheel if label == "wheel" else args.npm
            try:
                actual = sha256(reader(path, name))
            except KeyError:
                failures.append(f"{name}: missing in {label} package {path}")
                continue
            status = "ok" if actual == expected else "MISMATCH"
            print(f"{name:16} {label:6} {status}  {actual[:12]}")
            if actual != expected:
                failures.append(f"{name}: {label} copy differs from source")

    if args.site_url:
        with urllib.request.urlopen(args.site_url) as resp:  # noqa: S310
            actual = sha256(resp.read())
        expected = sha256((SOURCE_DIR / "SKILL.md").read_bytes())
        status = "ok" if actual == expected else "MISMATCH"
        print(f"{'SKILL.md':16} {'site':6} {status}  {actual[:12]}")
        if actual != expected:
            failures.append("SKILL.md: docs-site copy differs from source")

    for message in failures:
        print(f"::error::{message}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
