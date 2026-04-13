#!/usr/bin/env bash
# resync-hashes.sh — Recompute sha256 for every extension .js and patch index.json.
#
# Root cause addressed:
#   Hitomi verifies each extension .js against the sha256 declared in index.json.
#   Any drift = 100% of users blocked on install. Has happened at least twice
#   (commits 3ad89ff fixed a drift, 30494ed reintroduced one).
#
# Modes:
#   ./scripts/resync-hashes.sh           # rewrite index.json in place if needed
#   ./scripts/resync-hashes.sh --check   # exit 1 if any hash is stale (CI / pre-commit)
#   ./scripts/resync-hashes.sh --install-hook   # install .git/hooks/pre-commit
#
# Exit codes:
#   0 = everything in sync (or successfully resynced in write mode)
#   1 = drift detected in --check mode
#   2 = internal error (missing file, bad json, etc.)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
INDEX_JSON="${REPO_ROOT}/index.json"

MODE="write"
if [[ "${1:-}" == "--check" ]]; then
  MODE="check"
elif [[ "${1:-}" == "--install-hook" ]]; then
  HOOK_PATH="${REPO_ROOT}/.git/hooks/pre-commit"
  if [[ ! -d "${REPO_ROOT}/.git/hooks" ]]; then
    echo "error: ${REPO_ROOT}/.git/hooks not found. Run from inside a git clone." >&2
    exit 2
  fi
  cat >"${HOOK_PATH}" <<'HOOK'
#!/usr/bin/env bash
# Auto-installed by scripts/resync-hashes.sh --install-hook
# Rehashes index.json whenever a src/**/*.js change is staged, then re-stages index.json.
set -e
REPO_ROOT="$(git rev-parse --show-toplevel)"
if git diff --cached --name-only | grep -qE '^src/.*\.js$'; then
  echo "[pre-commit] src/*.js change detected — resyncing index.json hashes..."
  "${REPO_ROOT}/scripts/resync-hashes.sh"
  git add "${REPO_ROOT}/index.json"
fi
# Final guard: fail the commit if anything is still stale.
"${REPO_ROOT}/scripts/resync-hashes.sh" --check
HOOK
  chmod +x "${HOOK_PATH}"
  echo "installed: ${HOOK_PATH}"
  exit 0
fi

if [[ ! -f "${INDEX_JSON}" ]]; then
  echo "error: ${INDEX_JSON} not found" >&2
  exit 2
fi

python3 - "${REPO_ROOT}" "${INDEX_JSON}" "${MODE}" <<'PY'
import hashlib
import json
import os
import sys
from pathlib import Path

repo_root = Path(sys.argv[1])
index_path = Path(sys.argv[2])
mode = sys.argv[3]

with index_path.open("r", encoding="utf-8") as f:
    raw = f.read()
    index = json.loads(raw)

extensions = index.get("extensions", [])
if not isinstance(extensions, list):
    print("error: index.json has no 'extensions' array", file=sys.stderr)
    sys.exit(2)

drift = []
for ext in extensions:
    js_rel = ext.get("jsUrl")
    if not js_rel:
        continue
    js_path = repo_root / js_rel
    if not js_path.is_file():
        print(f"error: missing js file {js_rel} referenced by id={ext.get('id')}", file=sys.stderr)
        sys.exit(2)
    with js_path.open("rb") as fb:
        digest = hashlib.sha256(fb.read()).hexdigest()
    declared = ext.get("sha256")
    if declared != digest:
        drift.append((ext.get("id"), js_rel, declared, digest))
        ext["sha256"] = digest

if mode == "check":
    if drift:
        print("DRIFT DETECTED — run ./scripts/resync-hashes.sh to fix:", file=sys.stderr)
        for eid, js_rel, old, new in drift:
            print(f"  {eid} ({js_rel})\n    declared: {old}\n    actual:   {new}", file=sys.stderr)
        sys.exit(1)
    print("OK: all extension hashes match index.json")
    sys.exit(0)

# write mode
if not drift:
    print("OK: no drift — index.json untouched")
    sys.exit(0)

# Preserve 2-space indent + trailing newline to match current file style.
new_raw = json.dumps(index, indent=2, ensure_ascii=False) + "\n"
with index_path.open("w", encoding="utf-8") as f:
    f.write(new_raw)

print(f"RESYNCED {len(drift)} extension(s):")
for eid, js_rel, old, new in drift:
    print(f"  {eid}: {old[:12]}... -> {new[:12]}...")
PY
