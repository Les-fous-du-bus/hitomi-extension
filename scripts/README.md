# scripts/

## resync-hashes.sh

Keeps `index.json` `sha256` fields in sync with the actual content of every
`src/**/*.js` extension file.

Hitomi refuses to install an extension whose on-disk sha256 does not match the
value declared in `index.json`. Any drift blocks 100% of users until a new
`index.json` is published. This has happened at least twice
(`3ad89ff`, `30494ed`). This script makes the drift impossible to commit.

### Usage

```bash
# Rewrite index.json so every sha256 matches its .js (safe, idempotent).
./scripts/resync-hashes.sh

# CI / pre-commit guard — exit 1 if any hash is stale. Does not modify anything.
./scripts/resync-hashes.sh --check

# Install the local git pre-commit hook (one-time, per clone).
./scripts/resync-hashes.sh --install-hook
```

### What the hook does

On every commit, if any staged file matches `src/**/*.js`:

1. Recompute sha256 for every extension.
2. Patch `index.json` in place.
3. `git add index.json` so the fix lands in the same commit.
4. Run `--check` again as a final guard. If anything is still stale, the
   commit aborts.

The hook lives in `.git/hooks/pre-commit` (not versioned — git design). Every
fresh clone must run `./scripts/resync-hashes.sh --install-hook` once.

### Dependencies

- `bash` (>= 4)
- `python3` (>= 3.6) — stdlib only (`hashlib`, `json`, `pathlib`)

No `jq`, no Node, no pip install.
