---
name: validation
description: Validation and check commands for this monorepo: dprint fmt, nixfmt, yarn lint/typecheck/test, shellcheck gate, nix build/eval/flake check, targeting a specific workspace or test, and the critical rule to git add new .nix files before Nix evaluation. Use before committing, after making changes, when running any nix check, or when formatting/linting/typechecking/testing fails.
---

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
yarn lint --fix
yarn lint
yarn typecheck
yarn test
nix build .#checks.x86_64-linux.shellcheck    # ShellCheck gate for shell scripts
```

Formatting is **not** in this list — the opencode harness auto-formats every file it
writes or edits (see Format below).

## Commands

### ShellCheck (shell scripts)

```sh
nix build .#checks.x86_64-linux.shellcheck
# (also runs as part of `nix flake check`)
```

Shell scripts authored with `pkgs.writeShellApplication` are ShellCheck-linted in their build
`checkPhase` — but that only fires when the derivation is **built**, and a bare `nix flake check`
only _evaluates_ NixOS configs without building their scripts. The `checks.shellcheck` gate
(`nix-config/modules/checks/shellcheck.nix`) depends on every registered script so `nix flake check`
actually builds them and runs ShellCheck. It is **Linux-only** (`x86_64-linux`) because ShellCheck's
`checkPhase` is skipped where its compiler isn't bootstrappable (e.g. aarch64-darwin).

**Authoring a linted shell script:** use the shared helper instead of `pkgs.writeShellApplication`
directly, and register the resulting package so the gate covers it:

```nix
# in a flake-parts NixOS module that captures the top-level config (e.g. `{ config, ... }@topLevel`):
let
  myScript = topLevel.config.constants.shell.mkScript pkgs {
    name = "my-script";
    runtimeInputs = [ pkgs.curl pkgs.jq ];
    text = '' … '';
  };
in {
  # ... use `lib.getExe myScript` as an ExecStart, and register it for the gate:
  # (how to register depends on the feature; e.g. an internal `_lintScripts` list the
  #  feature harvests into `flake.lintedShellScripts`).
}
```

For raw script **text** that can't be a package (systemd `script = ''…''`, inline `ExecStart`
shell), lint it with `config.constants.shell.checkScriptText pkgs { name; text; }` and add the
resulting derivation to `flake.lintedShellScripts`. See `nix-config/modules/lib/shell.nix` for both
helpers and the registry option, and `docs/shellcheck-nix-test-plan.md` for the design.

### Format

**Agents do not run formatters.** The opencode harness automatically formats every file it
writes or edits, via the formatter configured in `nix-config/modules/home/jacob-nixos.nix` →
`programs.opencode.settings.formatter`:

- **dprint** with store-pinned wasm plugins (same set/versions as the devshell `fmt` command and
  `dprint.json`) for TypeScript/JavaScript, JSON, Markdown, TOML, CSS, HTML/XML/Vue/Svelte/Astro,
  and YAML. Per-language settings (Markdown `lineWidth` 100 + `textWrap` maintain, ASI
  TypeScript, etc.) come from `dprint.json`, which dprint auto-discovers in the project root.
  The prettier/oxfmt/biome builtins are disabled so dprint always wins for those languages.
- **Pinned nixfmt** (RFC style, `packages.<system>.nixfmt` from `flake.nix`) for `.nix` — the
  same version used by the pre-commit hook, devshell, and nixvim conform config, so formatting
  is deterministic everywhere.

Never reformat the vendored `repos/` submodules (read-only upstream sources; excluded via
`dprint.json` and the hook's `repos/` filter).

Manual/bulk fallback for files the harness did not touch (e.g. repo-wide reformat, human runs):

```sh
fmt [paths]                                            # devshell dprint + Nix-store plugins
nix run .#nixfmt -- $(git ls-files '*.nix' ':!:repos/**')
```

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
