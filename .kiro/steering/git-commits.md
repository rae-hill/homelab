# Making Commits (agents)

## Always commit with `--no-verify`

When an agent makes a commit in this repo, it **must** pass `--no-verify`:

```sh
git commit --no-verify -m "..."
```

### Why

This repo has a **husky `pre-commit` hook** wired to `lint-staged` (see
`lint-staged.config.js` and `.husky/pre-commit`). The hook runs formatters, ESLint,
`yarn test:staged`, `yarn lint`, `yarn typecheck`, and — for `.nix` files —
`nix run .#nixfmt`. `nix flake check --no-build` runs from `.husky/pre-push`
instead: inside lint-staged's stash/restore window it would evaluate the flake
against transient worktree states (see `docs/nix-store-poisoning/README.md`).

In an agent/CLI environment this hook misbehaves and interferes with tool-driven commits:

- `lint-staged` **stashes the working tree** (`git stash`) while it runs and restores it
  afterward. If anything in the hook fails or is killed partway through, the stash/restore
  dance can leave changes in an unexpected state. This does not play well with
  non-interactive CLI tool-calls, which cannot intervene in a half-finished stash.
- The `.nix` branch runs `nix run .#nixfmt`, which is heavy; in a minimal
  non-interactive shell it can be **SIGKILL'd** (resource/time limits) or error
  (`dprint fmt .` → `Is a directory`), aborting the commit midway.

Because an **agent always runs its own checks** before committing (see
`.kiro/steering/validation.md` — `dprint fmt`, `nixfmt`, `yarn lint`, `yarn typecheck`,
`yarn test`, `nix flake check`), the hook is redundant for agent commits. Bypassing it with
`--no-verify` avoids the git-stash weirdness without skipping validation.

### Rules

- **Run the validation steps yourself first** (per `.kiro/steering/validation.md`), then
  commit with `--no-verify`. `--no-verify` is **not** a license to skip checks — it only
  skips the _redundant, misbehaving_ hook.
- Do not disable or edit the husky hook itself — human commits still rely on it. Only the
  agent's own commits bypass it via the flag.
- All the usual commit/push guardrails still apply (no committing unless asked, stage
  specific files, don't push to `main` unless permitted, flag secret-bearing files).

## Shared-repo safety: `main`, worktrees, and concurrent agents

Multiple agents work this repo at once from opencode worktrees
(`~/.local/share/opencode/worktree/*`) while the human works in the primary checkout.
Local `main` history has been destroyed twice (2026-11-22): once by an agent that rewound
`main` while debugging instead of diagnosing, once by
`git fetch --unshallow --update-head-ok` force-syncing the CHECKED-OUT `main` back to a
stale `origin/main` (nothing had been pushed, so the remote was ~20 commits behind).

### Rules

- **Push after landing on `main`** (with permission — ask). An unpushed `main` is the
  hazard: the remote becomes an anchor that drags history backwards on any
  force-updating fetch, unshallow, or fresh clone.
- **Never force-update a branch another worktree has checked out**: no
  `--update-head-ok`, no `+refs/heads/main:refs/heads/main` fetch refspecs, no
  `git branch -f main` / `git update-ref refs/heads/main` from a linked worktree.
  Plain `git fetch --unshallow` is safe (remote-tracking refs only).
- **Rewinding is not debugging.** Never `git reset` shared `main` to an older commit to
  test a hypothesis — use `git bisect`, `git stash`, or a disposable
  `git worktree add --detach <dir> <rev>`. Any `reset` on `main` needs the owner's
  explicit permission.
- **Commits you don't recognize are someone else's work.** Assume other agents have
  landed commits since you last looked; re-read `git log` / `git status` before any
  history operation.

### Recovery playbook (when `main` looks rewound or files are mysteriously staged)

1. **Don't commit the blob, don't clean, don't reset yet.** Inspect first:
   `git reflog show main` + `git reflog` — the lost tip is virtually always still there.
2. **Compare disk to candidate commits by TREE HASH**, not by eyeball:
   ```sh
   GIT_INDEX_FILE=/tmp/idx git read-tree --empty   # throwaway index
   GIT_INDEX_FILE=/tmp/idx git add -A
   GIT_INDEX_FILE=/tmp/idx git write-tree          # compare vs `git rev-parse <commit>^{tree}`
   ```
3. **Snapshot before surgery** so nothing becomes unreachable:
   `git branch backup-main-<date> <lost-tip>` and/or
   `git tag pre-restore-snapshot-<date> $(git commit-tree <tree> -p HEAD -m "snapshot")`.
4. If disk == a known-good commit's tree: `git reset --hard <good-commit>` restores full
   history and changes nothing on disk. If commits must be replayed, `git rebase --onto`
   in a scratch worktree keeps the dirty main checkout untouched.
5. Re-validate after restoring (flake check, host evals, lint/test) — and then PUSH.
