# ShellCheck-as-Nix-Test — Plan

Status: **IMPLEMENTED** (2026-10-14)
Date: 2026-10-14

> **Implementation note (2026-10-14):** Delivered as:
>
> - `nix-config/modules/lib/shell.nix` — `constants.shell.mkScript` (writeShellApplication
>   wrapper, tags `_isLintedShell`) + `constants.shell.checkScriptText` (lint raw text) +
>   the `flake.lintedShellScripts` registry option (list of `pkgs -> package` specs).
> - `nix-config/modules/checks/shellcheck.nix` — `perSystem.checks.shellcheck`, Linux-only
>   (`x86_64-linux`), builds every registered spec so ShellCheck runs under `nix flake check`.
> - The technitium-provisioning scripts migrated to `mkScript` and register themselves via
>   an internal `provision._lintScripts` NixOS option, harvested into the registry by
>   `features/technitium-provisioning/shellcheck.nix` from the aedilis config.
>
> Verified: `nix build .#checks.x86_64-linux.shellcheck` lints the 3 provisioning scripts
> and passes; an injected `SC2086` in a real provisioning script fails the gate; the
> `checkScriptText` path fails on bad raw text and passes on clean; `aarch64-darwin` omits
> the check (Linux-scoped). Decisions: O2 — provisioning scripts use `mkScript` (packages);
> O3 — phased (provisioning migrated now, restic/`script =` blocks are a follow-up); O4 —
> explicit registry; O5 — single aggregate check.

> Goal: a **repeatable pattern** to lint this repo's shell scripts with ShellCheck as
> part of the Nix `checks` (so `nix flake check` / CI fails on shell lint regressions),
> running ShellCheck against the **built output script** rather than a loose `.sh` file.
> The pattern should be trivial to apply to every script we author across the repo.

---

## 1. Current State — what already runs ShellCheck, and the gap

Shell scripts in this repo are produced three ways:

| Builder                                       | ShellCheck today?                 | Examples                                                             |
| --------------------------------------------- | --------------------------------- | -------------------------------------------------------------------- |
| `pkgs.writeShellApplication`                  | **Yes** — fails the build on lint | `technitium-provisioning/{token,settings,encrypted-dns,records}.nix` |
| `pkgs.writeShellScript` / `…Bin`              | **No**                            | `services/postgres.nix`, every `restic` `writeShellScriptBin`        |
| systemd `script = ''…''` / inline `ExecStart` | **No**                            | `services/failure-notifs.nix`, `services/ssh-cert-renewer.nix`       |

Key facts:

- **`writeShellApplication` already runs ShellCheck at _build_ time** (its `checkPhase`
  invokes `shellcheck`). So any script written with it is _already_ linted whenever it is
  built — e.g. whenever its host's `toplevel` is evaluated/built. The provisioning
  scripts are therefore already covered during `nix build .#nixosConfigurations.*`.
- **The two other builders are NOT linted.** `writeShellScript`/`writeShellScriptBin`
  do no checking, and systemd `script = ''…''` is turned into a unit `ExecStart` wrapper
  (via `pkgs.writeShellScript` internally) with no ShellCheck.
- There is **no explicit `checks` entry** that forces shell linting. Today lint only
  happens as a side effect of building a derivation that happens to use
  `writeShellApplication`. A plain `nix flake check` runs the `formatting` check but does
  **not** independently guarantee every script is shell-checked.

So the gap is twofold:

1. **Coverage:** scripts not written with `writeShellApplication` escape ShellCheck.
2. **Enforcement:** nothing in `checks` _requires_ the shell-bearing derivations to be
   built, so a lint regression in a script only surfaces if someone builds that exact
   derivation.

---

## 2. Design Goals

1. **Repeatable, low-ceremony helper** — authoring a new linted script should be one
   function call, the same every time, discoverable from a single place.
2. **Lint the built output**, per the request — ShellCheck runs against the realised
   script derivation (the actual text that ships), not a source `.sh`.
3. **Enforced by `nix flake check`** — a dedicated `checks.shellcheck` (per system) that
   fails CI on any lint error, independent of whether a host is built.
4. **Converge the three builders** onto one linted path where practical, and provide a
   lint shim for the cases that must stay as systemd `script =`.
5. **Dendritic-friendly** — expose the helper + the aggregation through flake-parts
   (`config.constants` / `flake.checks`) so modules opt in declaratively, consistent
   with the rest of the repo.

---

## 3. The Repeatable Pattern — three layers

### Layer A — a shared `mkShellApplication` helper (authoring)

Expose a thin wrapper over `writeShellApplication` as a flake-parts constant, mirroring
how `config.constants.technitiumProvisioning` exposes shared shell helpers today.

```nix
# nix-config/modules/lib/shell.nix  (flake-parts module)
{ ... }:
{
  config.constants.shell = {
    # Drop-in for pkgs.writeShellApplication that (a) guarantees ShellCheck is on and
    # (b) tags the result so the aggregate check can discover it. Returns the usual
    # package; also records the derivation in a well-known passthru attr.
    mkScript =
      pkgs:
      args:
      (pkgs.writeShellApplication (args // {
        # writeShellApplication enables shellcheck by default; make it explicit and
        # non-overridable here. (Also allow per-call `excludeShellChecks` passthrough.)
      })).overrideAttrs (old: {
        passthru = (old.passthru or { }) // { _isLintedShell = true; };
      });
  };
}
```

Benefits:

- One call site style across the repo: `constants.shell.mkScript pkgs { name=…; text=…; }`.
- The `_isLintedShell` passthru lets the aggregate check (Layer C) _find_ every script
  without hand-maintaining a list.
- Because it is still `writeShellApplication`, **ShellCheck already runs on build** — the
  helper's job is standardisation + discoverability, not re-implementing linting.

> Open question O1: do we want `mkScript` to also default `runtimeInputs`, set
> `bashOptions`, or enforce `set -euo pipefail`? Recommend keeping it a 1:1 passthrough
> for now (minimal surprise); revisit if we want house rules.

### Layer B — a `checkShellScript` for raw text / systemd `script =` blocks

Some scripts can't be a package (systemd `script = ''…''`, or `ExecStart` inline). For
those, provide a **pure lint derivation** that takes the script _text_, writes it, and
runs ShellCheck over it — producing an empty `$out` on success, failing the build on lint
errors. This lets us lint the exact text a unit will run.

```nix
config.constants.shell.checkScriptText =
  pkgs:
  { name, text, shell ? "bash", excludeShellChecks ? [ ] }:
  pkgs.runCommand "shellcheck-${name}" { nativeBuildInputs = [ pkgs.shellcheck ]; } ''
    cat > script <<'EOF'
    #!${pkgs.runtimeShell}
    ${text}
    EOF
    shellcheck ${lib.optionalString (excludeShellChecks != []) "-e ${lib.concatStringsSep "," excludeShellChecks}"} \
      --shell=${shell} script
    touch $out
  '';
```

Usage for a systemd unit (lint the same text we hand to `script =`):

```nix
let
  myScript = '' … '';
in {
  systemd.services.foo.script = myScript;
  # register the lint derivation so the aggregate check picks it up:
  constants.shell.registerCheck "foo-script" (constants.shell.checkScriptText pkgs {
    name = "foo-script"; text = myScript;
  });
}
```

> Open question O2: for systemd `script =`, an alternative is to **stop using `script =`
> and instead `ExecStart = mkScript pkgs {…}`** (a real `writeShellApplication`), which
> gets linting for free and keeps one pattern. That is cleaner where the unit doesn't
> rely on systemd's `script`-specific conveniences. Recommend migrating `script =` blocks
> to `ExecStart = lib.getExe (mkScript …)` where feasible, and reserving `checkScriptText`
> for the few that can't move. (The provisioning feature already uses the ExecStart form.)

### Layer C — a `checks.shellcheck` aggregate (enforcement)

Add a per-system flake check that depends on every linted shell derivation, so
`nix flake check` builds them all (and thus runs ShellCheck on all — see §4 for _why a
check is required_: ShellCheck is a build-time `checkPhase`, so only a `checks.*` entry
that depends on the scripts forces it to run under `nix flake check`). Two ways to collect
the set:

**C1 — explicit registry (simple, deterministic).** A flake-parts option
`flake.lintedShellScripts` (list, or attrs keyed by name) that `mkScript`/`checkScriptText`
call sites append to. The check `symlinkJoin`s / references them:

```nix
# aggregation module
perSystem = { pkgs, config, ... }: {
  checks.shellcheck = pkgs.runCommand "shellcheck-all" {
    nativeBuildInputs = config.lintedShellScripts.${system} or [ ];
  } "touch $out";   # building the inputs IS the check (writeShellApplication lint runs)
};
```

**C2 — harvest from NixOS configs (maximal coverage, more magic).** Walk each
`nixosConfigurations.<host>.config` for derivations with the `_isLintedShell` passthru (or
all `systemd.services.*.serviceConfig.ExecStart` that resolve to our helper) and depend on
them. More automatic but more fragile and slow.

Recommend **C1** (explicit registry) for v1: predictable, fast, and the registry doubles
as documentation of "what scripts exist." A host-level build already covers the
`writeShellApplication` scripts; the registry's job is to make `nix flake check` cover
them _without_ building whole hosts, plus pull in the `checkScriptText` lints.

**Scope the check to Linux.** Define `checks.shellcheck` only on `x86_64-linux` (not
`aarch64-darwin`), because ShellCheck's `checkPhase` is skipped where its compiler isn't
bootstrappable (§4 platform note) — a darwin "pass" could be a silent no-op. Guard with
`lib.optionalAttrs (system == "x86_64-linux")` (or `pkgs.stdenv.isLinux`) around the
`checks.shellcheck` definition.

---

## 4. How `writeShellApplication`'s built-in ShellCheck works (grounding)

`pkgs.writeShellApplication` (nixpkgs 26.05,
`pkgs/build-support/trivial-builders/default.nix`) builds the script via `writeTextFile`
and sets a **`checkPhase`** that runs, against the generated `$target` script:

- `stdenv.shellDryRun "$target"` — a `bash -n` syntax check, then
- `shellcheck-minimal … "$target"` — the actual ShellCheck (honouring
  `excludeShellChecks` → `--exclude`, and `extraShellCheckFlags`).

It also writes `set -o errexit -o nounset -o pipefail` (from `bashOptions`) and the
`runtimeInputs` PATH. If ShellCheck reports anything, **the derivation build fails**.

Confirmed attrs available on 26.05 for our helper: `excludeShellChecks`,
`extraShellCheckFlags`, `bashOptions`, `derivationArgs`, `passthru`, `checkPhase`,
`inheritPath`, `runtimeEnv`.

### CRITICAL: this is a _build-time_ check, not an _eval-time_ check

The ShellCheck lives in `checkPhase`, so it only runs when the **derivation is actually
built**. It does **not** run during pure evaluation. This has a direct consequence for
`nix flake check`:

- `nix flake check` **evaluates** all flake outputs and **builds** everything under
  `checks.*` (and whatever those checks depend on). It does **not** automatically build
  `nixosConfigurations.<host>.config.system.build.toplevel` — it only evaluates the
  configs. Evaluation ≠ building the script derivations, so the scripts' `checkPhase`
  (and therefore ShellCheck) **never fires** on a bare `nix flake check` today.
- Our `writeShellApplication` scripts only get ShellCheck'd when something **builds**
  them — e.g. `nix build .#nixosConfigurations.aedilis.…toplevel`, or a deploy.

**This is the whole reason Layer C (`checks.shellcheck`) is necessary, not optional.** The
aggregate check exists specifically to _depend on_ the script derivations so that
`nix flake check` builds them — which runs each `checkPhase` → ShellCheck. Without a
`checks.*` entry referencing them, the linting is defined but never exercised by
`nix flake check`/CI. (Building a `writeShellApplication` derivation is cheap — a
`writeTextFile` + a fast `checkPhase` — so the aggregate is quick; it does not need to
build whole hosts.)

> **Platform note:** ShellCheck's `checkPhase` is guarded by
> `shellcheck-minimal.compiler.bootstrapAvailable` (GHC isn't bootstrappable everywhere).
> On platforms without it, the ShellCheck step is silently skipped. To guarantee linting
> actually runs, **scope `checks.shellcheck` to Linux** (`x86_64-linux`) rather than the
> `aarch64-darwin` builder, where shellcheck may be unavailable/skipped. See §3 Layer C.

---

## 5. File / Module Layout

```
nix-config/modules/
├── lib/
│   └── shell.nix              # NEW flake-parts module: constants.shell.{mkScript,checkScriptText}
│                              #   + flake-parts option `lintedShellScripts` registry
└── checks/
    └── shellcheck.nix         # NEW: perSystem checks.shellcheck aggregating the registry
```

(Keep `lib/` and `checks/` as new top-level module dirs under `modules/`, auto-imported by
`import-tree`. Name files without a leading `_` so they load.)

Consumers:

- New scripts: `constants.shell.mkScript pkgs { name; runtimeInputs; text; }`.
- Migrate existing `writeShellScriptBin "restic"` blocks (8 of them, all the restic
  wrappers) to `mkScript` so they get linted — or leave as a follow-up (O3).
- systemd `script =` blocks (`failure-notifs.nix`, `ssh-cert-renewer.nix`): either migrate
  to `ExecStart = lib.getExe (mkScript …)` or register a `checkScriptText` lint.

---

## 6. Validation (how we prove it works)

1. `nix flake check` builds `checks.shellcheck` → all registered scripts build → every
   `writeShellApplication`/`mkScript` runs ShellCheck; every `checkScriptText` runs
   ShellCheck on the unit text. A deliberate `SC2086` (unquoted `$var`) in a test script
   must fail the check.
2. Confirm `nix build .#checks.<system>.shellcheck` fails on an intentional lint error and
   passes once fixed.
3. Add the check to the repo's validation steps (`.kiro/steering/validation.md`) so it's
   part of "full validation" (e.g. `nix flake check` or `nix build .#checks.*.shellcheck`).
4. No behaviour change to any host; this is purely additive tooling.

---

## 7. Open Questions / Decisions

- **O1 — `mkScript` house rules:** 1:1 passthrough (recommended) vs. enforce
  `set -euo pipefail`/default `runtimeInputs`. `writeShellApplication` already sets the
  strict `bashOptions`, so passthrough already gives us strict mode.
- **O2 — systemd `script =`:** migrate to `ExecStart = lib.getExe (mkScript …)` (one
  pattern, free linting — recommended where feasible) vs. keep `script =` + a
  `checkScriptText` lint. Likely a mix; `restic` wrappers and provisioners want packages,
  a couple of tiny units may stay `script =`.
- **O3 — scope of first cut:** (a) land the helpers + the `checks.shellcheck` aggregate +
  migrate the already-`writeShellApplication` provisioning scripts into the registry
  (proves the pattern), then (b) migrate the `writeShellScriptBin`/`script =` scripts in a
  follow-up. Recommended: do (a) now, (b) incrementally.
- **O4 — collection strategy:** explicit registry (C1, recommended) vs. harvest from NixOS
  configs (C2). C1 for v1.
- **O5 — check granularity:** one aggregate `checks.shellcheck` (recommended) vs.
  per-script checks (`checks.shellcheck-<name>`) for finer CI signal. Aggregate is simpler;
  per-script is noisier but pinpoints failures. Could do aggregate now, split later.

---

## 8. Implementation Order (once decisions confirmed)

1. `nix-config/modules/lib/shell.nix` — `constants.shell.mkScript` + `checkScriptText` +
   the `lintedShellScripts` flake-parts registry option.
2. `nix-config/modules/checks/shellcheck.nix` — `perSystem.checks.shellcheck` aggregating
   the registry.
3. Prove it: add a throwaway script with a known lint, confirm `nix flake check` fails,
   fix it, confirm it passes. Remove the throwaway.
4. Migrate the technitium-provisioning scripts to `mkScript` + register them (reference
   implementation of the pattern).
5. Update `.kiro/steering/validation.md` to include the shellcheck check in full
   validation, and add a short "authoring a linted script" note (the `mkScript` pattern).
6. (Follow-up) migrate `writeShellScriptBin` restic wrappers + systemd `script =` blocks.
