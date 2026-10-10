# Validation Steps

This document describes the validation steps to run after making changes.

## Full Validation

Run these commands from the repo root in order:

```sh
dprint fmt fmt .
nixfmt $(git ls-files '*.nix')
yarn lint --fix
yarn lint
yarn typecheck
yarn test
```

## Commands

### Format

```sh
dprint fmt fmt .
nixfmt $(git ls-files '*.nix')
```

`dprint` formats everything except Nix (TypeScript, JSON, Markdown, TOML, YAML, CSS, HTML).
`nixfmt` (RFC style, `pkgs.nixfmt`) formats `.nix` files. These are separate engines:

- **CLI / pre-commit:** `dprint` runs via the `fmt` devshell command; `nixfmt` is wired into
  `lint-staged.config.js` so staged `.nix` files are formatted on commit, then `nix flake check`
  runs.
- **Editor (nixvim):** `conform.nvim` formats `.nix` with the same `nixfmt`, and falls back to the
  dprint LSP for other filetypes. The `<C-f>` keymap (`_G.format_with_dprint_priority`) routes
  through conform first, so editor output matches the CLI.

Keep `nixfmt` and `dprint` versions aligned between the devshell (`flake.nix` packages) and the
nixvim config (`features/nixvim/plugins/conform.nix`) so formatting is deterministic everywhere.

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
