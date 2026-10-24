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
`nix run .#nixfmt` + `nix flake check`.

In an agent/CLI environment this hook misbehaves and interferes with tool-driven commits:

- `lint-staged` **stashes the working tree** (`git stash`) while it runs and restores it
  afterward. If anything in the hook fails or is killed partway through, the stash/restore
  dance can leave changes in an unexpected state. This does not play well with
  non-interactive CLI tool-calls, which cannot intervene in a half-finished stash.
- The `.nix` branch runs `nix run .#nixfmt` and `nix flake check`, which are heavy; in a
  minimal non-interactive shell they can be **SIGKILL'd** (resource/time limits) or error
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
