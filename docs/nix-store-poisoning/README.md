# Nix store source-path poisoning (discovered Nov 2026)

## What this is

`poisoned-paths.txt` lists 132 Nix store paths — every one a fetcher-created
flake-source ingestion (suffix `-source`) — that were internally inconsistent:
the narHash registered in the Nix store database did not match the hash of the
bytes actually on disk. `mismatch-details.tsv` carries the per-path evidence
(registered hash, actual hash, registration time, NAR size). Together they
occupied ~127.7 GB; 55 of the trees were >1 GB (ingestions from before the
`repos/` subtree→submodule conversion shrank the flake source from ~2 GB to
~9.8 MB).

## How it was found

A deploy to augustus failed during `nix-copy-closure` (Nov 10, 2026):

```
error: hash mismatch importing path '/nix/store/g05ibq9v1g37b97bp4z52fyhdm1kj8pn-source';
         specified: sha256:0vc7s24yala7qq698h2paszf8zwlskavq8747xqjf7bdrvdx891n
         got:       sha256:114p84r5jagxisiiahgyp2j29sizx2jhrapxyl2zknzxjlvh86wh
```

The remote was right to reject the stream: its bytes hash to the "got" value,
not the "specified" one. Neither hash appears anywhere in the repo — they are
runtime NAR content hashes of the ingested flake source, not commit hashes and
not checked-in yarn hashes.

A subsequent full-store content sweep (225,573 paths / 523.5 GB, Nov 12, 2026)
found 131 more paths in the same state — **all** fetcher-created `-source`
paths, with zero mismatches among build outputs, derivations, or binaries, no
missing or unreadable paths, and a clean DB-level `nix-store --verify`.

## Timeline (registration times of the 132)

| Period                   | Count | Notes                                          |
| ------------------------ | ----- | ---------------------------------------------- |
| Dec 1, 2024              | 1     | Oldest instance; bug class predates Nix 2.34.9 |
| Oct 13, 2026             | 2     |                                                |
| Oct 29 – Nov 2, 2026     | 10    |                                                |
| Nov 8, 2026              | 2     |                                                |
| Nov 9, 2026, 09:55–15:57 | 62    | Heavy agent edit+eval day                      |
| Nov 10, 2026             | 34    | Merge day; includes `g05ibq9v…` (17:11:01)     |
| Nov 11, 2026             | 21    | Subtree→submodule conversion session           |

Every ingestion created after the Nov 12 workstation reboot verifies clean.

## Probable mechanism (hypothesis, not proven)

Nix fetcher-side misregistration: a stale narHash (from the dirty-tree fetcher
cache, `~/.cache/nix/fetcher-cache-v4.sqlite`) registered against freshly
dumped content when the worktree mutated faster than the cache fingerprint
noticed. Aggravator: the lint-staged pre-commit hook ran `nix flake check
--no-build` and `nix run .#nixfmt` **inside lint-staged's stash/restore
window**, so commits routinely evaluated transient worktree states.

Forensics on the original path: registered Nov 10 at 17:11:01 — 69 s _before_
the merge commit it purported to snapshot (17:12:10). Its contents were a
transient mid-hook state (`flake.lock` pre-restore, the kanidm gitlink file
dropped), while the registered hash matched neither the transient nor the
committed state.

Ruled out:

- **Disk/filesystem corruption** — damage is path-type selective; build outputs
  written the same afternoon all verify.
- **Crash / page-cache loss** — spans 11 months; again selective to fetcher
  ingestions.
- **NAR/hash format drift** — re-hashing locally reproduces the remote's
  verdict exactly (e.g. `114p84r5…` for `g05ibq9v…`).

Nix version at discovery: **2.34.9** (nix-daemon, single-user store on ext4/nvme).

## Remediation taken

- Delete all 132 paths: `sudo nix-store --delete --ignore-liveness <path>`
  (per-path, so a stray GC root can't abort the batch; GC roots from old
  devshell processes — `/proc/<pid>/environ` → `devshell-env` — must be
  released first by closing those shells; `--ignore-liveness` bypasses
  referrer-liveness but **not** GC roots).
- Clear `~/.cache/nix/fetcher-cache-v4.sqlite*` for the user **and** root
  (deploys evaluate under `sudo`).
- `repos/` vendored subtrees → shallow submodules (commit `3c51155793`): flake
  source ingestion 2 GB → 9.8 MB, shrinking both the race window and the blast
  radius ~200×.
- `nix flake check --no-build` moved from lint-staged (pre-commit, stash
  window) to `.husky/pre-push` (committed tree; runs only when the pushed
  range touches `.nix`/`flake.lock`).

## If it recurs

Symptom: `hash mismatch importing path '…-source'` during copy/deploy.

Diagnose a single path:

```sh
nix path-info --json <path> | jq -r 'to_entries[0].value.narHash'  # registered
nix hash path <path>                                               # actual
```

Fix: delete the path, clear `fetcher-cache-v4.sqlite*` (user + root), re-run.

## Re-running the full sweep

```sh
nix path-info --json --all |
  jq -r 'to_entries[] | select(.value.narHash != null) | [.key, .value.narHash] | @tsv' |
  while IFS="$(printf '\t')" read -r p h; do
    [ -e "$p" ] || { echo "MISSING $p"; continue; }
    got=$(nix hash path "$p" 2>/dev/null) || { echo "UNREADABLE $p"; continue; }
    [ "$got" = "$h" ] || echo "MISMATCH $p registered=$h actual=$got"
  done
```

(523 GB store took ~17 min with 4-way parallelism via `xargs -P4`.)
