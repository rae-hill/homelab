# Validation Steps

This document describes the validation steps to run after making changes.

## CRITICAL: Git-track new `.nix` files before running Nix checks

Nix flakes evaluate against the **git tree**, not the raw working directory. Any
**newly created** file that is still untracked is **invisible** to flake evaluation —
`import-tree` will not load it, `nix eval`/`nix build`/`nix flake check` will behave as
if the file does not exist. This produces confusing failures: a module you just wrote
appears "missing" (e.g. `error: attribute 'my-new-module' missing`), and no amount of
re-reading the file explains why.

**Before running any Nix check (`nix eval`, `nix build`, `nix flake check`,
`remote-build-*`), stage newly created files:**

```sh
git add <new-files>        # or: git add -A
```

Staging (not committing) is sufficient — `git add` makes the files part of the tree
Nix sees. Modified files that are already tracked do **not** need re-staging for Nix to
see edits, but newly created files **always** do.

> If a Nix evaluation fails with a "missing attribute / file" error for something you
> know exists on disk, **check `git status` first** — an untracked new file is the most
> common cause. Do not fall into a loop of re-editing a correct file; just `git add` it.

## Full Validation

Run these commands from the repo root in order:

```sh
dprint fmt fmt .
nix run .#nixfmt -- $(git ls-files '*.nix' ':!:repos/**')
yarn lint --fix
yarn lint
yarn typecheck
yarn test
```

## Commands

### Format

```sh
dprint fmt fmt .
nix run .#nixfmt -- $(git ls-files '*.nix' ':!:repos/**')
```

`dprint` formats everything except Nix (TypeScript, JSON, Markdown, TOML, YAML, CSS, HTML). Its
plugins and per-language settings (including Markdown: `lineWidth` 100, `textWrap` maintain) live in
`dprint.json`, so `dprint fmt <path>` auto-discovers the config — no need to pass `--plugins`
manually when formatting a single file.
`nixfmt` (RFC style) formats `.nix` files, **excluding the vendored `repos/` subtrees** (read-only
upstream sources — never reformat them). Invoke it via `nix run .#nixfmt` so you always use the
flake-pinned `nixfmt` (exposed as `packages.<system>.nixfmt`) rather than whatever is on `PATH` —
this keeps the version identical across the hook, the devshell, and the editor. These are separate
engines:

- **CLI / pre-commit:** `dprint` runs via the `fmt` devshell command (which excludes `repos/*`);
  `nix run .#nixfmt` is wired into `lint-staged.config.js` with a `repos/` filter so staged `.nix`
  files are formatted on commit, then `nix flake check` runs. Using `nix run .#nixfmt` (not a bare
  `nixfmt`) is important: git hooks run in a minimal shell that does not inherit the devshell PATH.
- **Editor (nixvim):** `conform.nvim` formats `.nix` with the same pinned `nixfmt`, and falls back
  to the dprint LSP for other filetypes. The `<C-f>` keymap (`_G.format_with_dprint_priority`)
  routes through conform first, so editor output matches the CLI.

The pinned `nixfmt` is defined once as `packages.<system>.nixfmt = pkgs.nixfmt` in `flake.nix`; the
devshell, the hook (`.#nixfmt`), and the nixvim config (`features/nixvim/plugins/conform.nix`) all
resolve to that same version so formatting is deterministic everywhere.

### Lint

```sh
yarn lint --fix
yarn lint
```

The first command auto-fixes what it can. The second verifies everything passes.

### Typecheck

```sh
yarn typecheck
```

Runs `tsc` across all packages. This runs topologically, so type errors in early dependencies (e.g. `homelab-services`) may cause cascading errors in downstream packages (`homelab-server`, `homelab-frontend`). Fix errors in the earliest failing package first.

### Test

```sh
yarn test
```

Runs all unit/integration tests across the monorepo. Do NOT run e2e tests (`homelab-e2e-tests`) — those require the backend to be running.

## Targeting a Specific Package

If a check fails, re-run it for the specific package:

```sh
yarn workspace <package-name> <command>
```

Examples:

```sh
yarn workspace homelab-server typecheck
yarn workspace homelab-services-node test
yarn workspace homelab-frontend lint --fix
```

## Targeting a Specific Test

To run a specific test file or test name:

```sh
yarn workspace <package-name> test <args>
```

Examples:

```sh
yarn workspace homelab-server test test/handlers/cert/root.test.ts
yarn workspace homelab-server test --testNamePattern "returns DER"
```

**Important:** Do NOT use `--` to separate args. This version of Yarn passes arguments through directly — using `--` will break the command.
