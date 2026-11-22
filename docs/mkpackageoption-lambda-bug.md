# The `services.homelab-api.pkg` Lambda Bug — How a Broken Option Declaration Hid for Months

Status: **FIXED 2026-11-20** (found 2026-11-19 during the cover-letter work, CL-T8).
Location: `nix-config/modules/homelab/homelab-api/systemd-service.nix` → `options.services.homelab-api.pkg`.
Severity: latent — any host-config evaluation that _reads_ the option threw; nothing read it
until the fix, so no deployment ever broke.

## The bug

```nix
# nix-config/modules/homelab/homelab-api/systemd-service.nix (pre-existing)
let
  pkg = inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.homelab-api;
in {
  options.services.homelab-api = {
    pkg = lib.mkPackageOption "homelab-api" {          # ← BROKEN
      description = "The homelab-api package to use";
      default = pkg;
    };
    ...
  };
}
```

Forcing the option (e.g. `config.services.homelab-api.pkg` anywhere in a host config) fails the
**entire host evaluation** with:

```
error: An option declaration for `services.homelab-api.pkg' has type
`lambda' rather than an attribute set.
Did you mean to define this outside of `options'?
```

## Why it's a lambda

`lib.mkPackageOption` (nixpkgs-26.05 `lib/options.nix:308`) is a **three-argument curried
function**:

```nix
mkPackageOption =
  pkgs: name:                       # 1: the package SET to look the package up in
  { nullable ? false,               # 2: package name — String or [String] attr path
    default ? name,                 # 3: options attrset
    example ? null,
    extraDescription ? "",
    pkgsText ? "pkgs",
  }: ...
```

Its type signature, from the nixpkgs docs:

```
mkPackageOption :: Pkgs -> (String | [String]) -> { nullable?, default?, example?, ... } -> Option
```

The broken call passes only **two** arguments:

| Param   | Expected                  | Actually received                               |
| ------- | ------------------------- | ----------------------------------------------- |
| `pkgs`  | a package set (`pkgs`)    | the string `"homelab-api"`                      |
| `name`  | a package name (`String`) | `{ description = ...; default = pkg; }`         |
| 3rd arg | the options attrset       | **missing → the result is the awaiting lambda** |

So `lib.mkPackageOption "homelab-api" {...}` evaluates to `λ{ nullable ? false, ... }: ...` — a
function. The module system requires every option declaration to be an attrset (with `type`,
`default`, etc.) and throws the error above when it isn't (nixpkgs-26.05 `lib/modules.nix:796`).

Note the call was wrong twice over: even fully applied, `name` must be a string (it got an
attrset), `description` is not a valid argument name (it's `extraDescription`), and
`attrByPath` would look up the "package" inside the _string_ `"homelab-api"`. The lambda error
just fires first.

## Why nothing ever noticed: lazy evaluation

Nix is lazy **per attribute**. The module system processes an option's declaration only when
something forces that option — reading its value (`config.services.homelab-api.pkg`), its
metadata, or building the options manual. In this module:

- The unit/env template uses the **let-binding** `pkg` (and `${cfg.package}`-style references
  never existed) — the option was never read.
- `nix build .#homelab-api` builds the _package_, not any host config — modules aren't involved.
- `nix flake check` / host `toplevel.drvPath` evals force `config.system.build.toplevel`, whose
  dependency graph never touches this option.

So the broken declaration sat inert: a landmine that only arms when someone reads the option.
It was found exactly that way — the cover-letter wiring wanted
`config.services.homelab-api.pkg` for a default path and detonated the whole augustus eval.
(The workaround shipped first: `nix-config/system-configs/augustus/programs.nix` referenced
`inputs.self.packages.${system}.homelab-api` directly. Since the fix it reads the option again —
`config.services.homelab-api.pkg`.)

## The correct declaration

The package comes from **this flake's outputs**, not from `pkgs` — so `mkPackageOption` (which
exists to resolve names _inside a package set_) is the wrong tool entirely. A plain option is
right (shipped 2026-11-20, verbatim):

```nix
pkg = lib.mkOption {
  type = lib.types.package;
  default = pkg;   # the let-binding above (inputs.self.packages.${system}.homelab-api)
  defaultText = "inputs.self.packages.<system>.homelab-api";
  description = "The homelab-api package to use.";
};
```

The fix also made the option _consumed_ so it can never go latent again: the unit's
`ExecStart` is now `${cfg.pkg}/bin/homelab-api` (was the let-binding), so every deploy of an
enabled host forces the declaration, and hosts can actually override the package.

If the package genuinely lived in `pkgs`, the correct `mkPackageOption` form would be:

```nix
pkg = lib.mkPackageOption pkgs "homelab-api" { };
# or with options:
pkg = lib.mkPackageOption pkgs [ "python3Packages" "pytorch" ] {
  nullable = true;
  extraDescription = "...";
};
```

## Lessons

1. **Lazy evaluation hides declaration-time type errors.** A malformed option declaration is
   not caught at module-load time; it is caught at first _read_. Option declarations deserve
   the same review scrutiny as code that runs.
2. **Curried Nix functions fail as lambdas, not as errors.** Passing too few arguments to a
   curried lib function yields a function value that "looks fine" until the module system (or
   a consumer) inspects it. If an error ever says `has type 'lambda'`, the first suspicion is
   a partially-applied function.
3. **A flake check should force option declarations.** Cheap regression guard for this class:
   ```sh
   nix eval '.#nixosConfigurations.augustus.options.services.homelab-api.pkg.type.name'
   ```
   IMPLEMENTED as `nix-config/checks/option-decls.nix` (check `option-decls`, x86_64-linux,
   runs as part of `nix flake check`): it walks every host's `options` tree with
   `lib.collect lib.isOption` — the predicate forces `_type` on every node, which makes the
   module system merge each option's declarations (where a malformed one throws) — and
   additionally forces every option's `type.name`. `nix flake check` alone does NOT catch it —
   nothing forces unused options.
4. **Audit call sites when adding a second consumer.** The bug became visible only when a
   second reference to the package appeared; `grep -rn mkPackageOption nix-config/` shows this
   is the only call site, so the blast radius is exactly this one option.

## Cross-references

- `docs/cover-letter-generator/05-nix-and-deployment.md` §B — where the workaround lived (NOTE
  updated when the option was fixed).
- `nix-config/system-configs/augustus/programs.nix` — `typstAssetsDir`, now reads the fixed
  option (`config.services.homelab-api.pkg`).
- `nix-config/checks/option-decls.nix` — the flake-check regression guard (lesson 3).
- Companion doc on the other CL-T8 nix discovery: `docs/native-addon-rpath-hazard.md`.
