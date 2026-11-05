# AGENTS.md

Guidance for AI agents working in this repo (TypeScript/Yarn-workspaces monorepo under
`packages/` + NixOS config under `nix-config/`). Deeper, task-specific guides live in
`.opencode/skills/` and load on demand (see index at the bottom).

## Path Resolution & Navigation

### TypeScript Packages

When the user refers to a package by name in a TypeScript/frontend/backend/test context, resolve to `./packages/<package-name>/src/...`.

| User says                                              | Resolves to                                       |
| ------------------------------------------------------ | ------------------------------------------------- |
| `homelab-frontend/dir/foo.ts`                          | `./packages/homelab-frontend/src/dir/foo.ts`      |
| `homelab-api/dir/foo.ts`                               | `./packages/homelab-api/src/dir/foo.ts`           |
| `homelab-server/dir/foo.ts`                            | `./packages/homelab-server/src/dir/foo.ts`        |
| `homelab-services/dir/foo.ts`                          | `./packages/homelab-services/src/dir/foo.ts`      |
| `homelab-services-node/dir/foo.ts`                     | `./packages/homelab-services-node/src/dir/foo.ts` |
| `shared/dir/foo.ts`                                    | `./packages/shared/src/dir/foo.ts`                |
| `homelab-shared/dir/foo.ts` (legacy name for `shared`) | `./packages/shared/src/dir/foo.ts`                |
| `homelab-data/dir/foo.ts`                              | `./packages/homelab-data/src/dir/foo.ts`          |
| `homelab-e2e-tests/dir/foo.ts`                         | `./packages/homelab-e2e-tests/src/dir/foo.ts`     |

### Nix Packages & Config

When the user says "the Nix package for X," resolve to the appropriate feature module:

| User says                   | Resolves to                                                     |
| --------------------------- | --------------------------------------------------------------- |
| Nix package for homelab-api | `./nix-config/modules/features/homelab-api/package.nix`         |
| Nix package for homelab-ui  | `./nix-config/modules/features/homelab-ui/package.nix`          |
| homelab-api systemd service | `./nix-config/modules/features/homelab-api/systemd-service.nix` |
| homelab-api kanidm config   | `./nix-config/modules/features/homelab-api/kanidm.nix`          |
| homelab-api caddy config    | `./nix-config/modules/features/homelab-api/caddy.nix`           |
| homelab-ui caddy config     | `./nix-config/modules/features/homelab-ui/caddy.nix`            |

### Nix Config Quick Reference

```
nix-config/
├── modules/
│   ├── features/
│   │   ├── homelab-api/        # API package, systemd, caddy, kanidm, secret-provisioner
│   │   ├── homelab-ui/         # UI package, caddy
│   │   └── nixvim/             # Neovim config (keymaps, plugins, colorscheme)
│   ├── services/               # System services (caddy, kanidm, postgres, step-ca, etc.)
│   ├── programs/               # User programs (zsh, git, vscode, nvidia, etc.)
│   ├── hosts/                  # Host entry points (praeconinus, augustus, cicero, nixos, mini)
│   ├── home/                   # Home-manager configs per user/host
│   ├── _private/               # Per-host private config (hardware, users, sops, security)
│   │   ├── praeconinus/
│   │   ├── augustus/
│   │   ├── cicero/
│   │   ├── nixos/
│   │   └── mini/
│   ├── constants.nix           # Shared constants (ports, URLs, etc.)
│   ├── service-registry.nix    # Service registry
│   ├── nix-settings.nix        # Nix daemon settings
│   └── darwin-base.nix         # macOS base config
└── secrets/                    # SOPS-encrypted secrets per host
```

### NixOS Package & Module Reference

Vendored nixpkgs subtrees provide browsable NixOS module source for determining available options:

| User says                                       | Resolves to                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| NixOS module for `services.X` (stable 26.05)    | `./repos/nixpkgs-26.05/nixos/modules/services/...`                     |
| NixOS module for `services.X` (unstable/master) | `./repos/nixpkgs-unstable/nixos/modules/services/...`                  |
| Nix package derivation for X (stable)           | `./repos/nixpkgs-26.05/pkgs/by-name/<two-letter-prefix>/<name>/...`    |
| Nix package derivation for X (unstable)         | `./repos/nixpkgs-unstable/pkgs/by-name/<two-letter-prefix>/<name>/...` |
| home-manager module for `programs.X`            | `./repos/home-manager/modules/programs/<name>.nix`                     |

To find available NixOS service options, read the module source directly from the vendored repos:

- **Service modules:** `repos/nixpkgs-26.05/nixos/modules/services/<category>/<service>.nix`
- **Prometheus exporters:** `repos/nixpkgs-26.05/nixos/modules/services/monitoring/prometheus/exporters/<name>.nix`
- **Package derivations:** `repos/nixpkgs-26.05/pkgs/by-name/<prefix>/<name>/package.nix`
- **home-manager modules:** `repos/home-manager/modules/programs/<name>.nix` (subtree tracks
  `release-26.05`, matching the flake's home-manager input; prefer it over reading
  `/nix/store/*-home-manager-source`)

When options differ between branches, prefer the branch matching the host's nixpkgs input:

- Augustus, cicero, praeconinus, nixos → `nixpkgs` (nixos-26.05)
- Packages from `pkgs-unstable` overlay → `nixpkgs-unstable`

Never edit or reformat anything under `./repos/` (read-only vendored subtrees). For the subtree
refresh workflow — including pinning app subtrees to the tag nixpkgs 26.05 actually builds — see
the `effect-services` skill → "Keeping Vendored Subtrees Up To Date".

### Vendored App Source — Prefer Over Web Docs

`./repos/` also vendors **upstream application source**, pinned to the exact tags nixpkgs builds.
When investigating how vendored software actually behaves (CLI flags, API semantics, validation
logic, error paths), **read the source** instead of looking up web documentation — docs frequently
describe a different version than the one deployed, and sometimes lie outright. Fall back to web
docs only for upstreams not vendored here or for tutorial-style material, and corroborate against
the pinned tag's source before trusting them.

| Question about                                                                      | Resolves to                                                                                 |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| step-ca server behavior (provisioners, ACME challenges, attestation, policy, renew) | `./repos/step-ca/` (smallstep/certificates, tag `v0.29.0` = nixpkgs-26.05)                  |
| step CLI behavior (flags, issuance/renewal flows, KMS/attestation handling)         | `./repos/step-cli/` (smallstep/cli, tag `v0.30.2` = nixpkgs-26.05)                          |
| go.step.sm/crypto (KMS drivers, YubiKey PIV, pemutil, x509util)                     | `./repos/crypto/` (tag `v0.77.1` = step-cli's go.mod pin; step-ca v0.29.0 pins v0.74.0)     |
| Kanidm server/CLI behavior                                                          | `./repos/kanidm/`                                                                           |
| puppeteer / headless chrome printing (`page.pdf`, launch args, `waitForSelector`)   | `./repos/puppeteer/` (tag `puppeteer-core-v25.16.0` = the npm pin in homelab-services-node) |
| Technitium DNS behavior                                                             | `./repos/technitium-dnsserver/`                                                             |

If a needed upstream is not vendored yet, add it as a subtree (see the `effect-services` skill →
"Adding a New Vendored Subtree") pinned to the tag nixpkgs builds, rather than relying on web
lookups.

### Hosts

| Name        | Role                                                                              |
| ----------- | --------------------------------------------------------------------------------- |
| augustus    | Primary server; runs homelab-api, homelab-ui, IDM (Kanidm), failure notifications |
| nixos       | Primary workstation                                                               |
| praeconinus | Public-facing server; hosts a restricted version of homelab-api/ui                |
| cicero      | Exclusively hosts the certificate authority (step-ca)                             |
| mini        | Mac Mini (nix-darwin); currently only hosts Jellyfin                              |

## Validation

Full details in the `validation` skill. Summary:

**CRITICAL:** Nix flakes evaluate against the **git tree**, not the working directory.
`git add` any newly created `.nix` files before running `nix eval` / `nix build` /
`nix flake check` — otherwise they are invisible to flake evaluation. If a Nix evaluation
reports a "missing attribute / file" for something that exists on disk, check `git status`
before re-editing.

**Formatting is automatic.** The opencode harness formats every file it writes or edits —
dprint for TS/JS/JSON/Markdown/TOML/CSS/HTML/YAML/Astro, pinned nixfmt for `.nix`
(`nix-config/modules/home/jacob-nixos.nix` → `programs.opencode.settings.formatter`).
Do not run formatters manually. Bulk/non-harness fallback: `fmt [paths]` (devshell) and
`nix run .#nixfmt -- <file>` — never against `repos/`.

Run from the repo root after making changes:

```sh
yarn lint --fix
yarn lint
yarn typecheck
yarn test
nix build .#checks.x86_64-linux.shellcheck    # ShellCheck gate for shell scripts
```

e2e tests (`homelab-e2e-tests`): use the devshell `e2e` command (wraps `scripts/e2e.sh`) —
it bootstraps the machine-local fixtures (`scripts/stage-e2e-secrets.mjs`), builds the
rolldown bundle, starts its own server on :54328, runs the suite, and kills the server
afterwards. Args pass through to vitest as test-file filters (`e2e src/resume` runs just
the resume tests; no args = full suite). Server logs land in `.e2e-log-dump.txt`. Do NOT
hand-roll backend servers for e2e. The live resume-print success test only runs where
`CHROME_EXECUTABLE` is set (devshell provides it; CI skips it).
To target a specific package or test: `yarn workspace <package-name> <command> <args>`
(do NOT use `--` to separate args).

## Harness (opencode)

Global opencode config lives in home-manager: `nix-config/modules/home/jacob-nixos.nix` →
`programs.opencode` (V2 schema; opencode from `pkgs-unstable`; theme via `cli.json`).
Permission policy (ordered rules, last match wins):

- `edit` allowed in the project; external directories ask, except `~/git/*` (allowed)
- `shell` asks by default; the allowlist covers read-only inspection, `cp`/`mv`/`mkdir`/
  `touch`/`ln`, git inspection + `git add` + `git commit --no-verify`, and nix/yarn/dprint
  tooling
- `sops`/`sudo` shell commands are denied; `webfetch` asks; plain `git commit`/`git push`,
  `rm`, and anything else not allowlisted asks

If an action is asked/denied, surface it to the user — do not try to route around it.

## Commits

When an agent makes a commit in this repo, it **must** use `--no-verify`:

```sh
git commit --no-verify -m "..."
```

- The husky pre-commit hook (lint-staged) stashes the working tree and runs heavy checks that
  misbehave in non-interactive agent shells; it can leave the tree in a bad state or get killed
  midway. Agents run the validation steps (above) themselves, so the hook is redundant.
- `--no-verify` is **not** a license to skip checks — run validation first, then commit.
- Do not disable or edit the husky hook itself; human commits still rely on it.
- Usual guardrails apply: only commit when asked, stage specific files, don't push to `main`
  unless permitted, flag secret-bearing files.

## Skill Index (detailed, loads on demand)

| Skill                 | Use when                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `validation`          | Running checks, fixing lint/type/test failures, doing anything with Nix evaluation                                         |
| `adding-endpoints`    | Adding/modifying homelab-api endpoints, handlers, schemas, tests                                                           |
| `adding-client-certs` | Adding step-ca client-cert uses: hand-coded provisioners, UUID extension, serial→user maps, sops secrets, issuance/renewal |
| `effect-services`     | Writing Effect services/layers, using vendored `./repos/` references                                                       |
| `frontend`            | Editing `packages/homelab-frontend` (Astro, SolidJS, nanostores)                                                           |
| `nix-hashes`          | `yarn.lock` changed or "fetchYarnDeps hash is out of date" build error                                                     |
| `nix-services`        | systemd services, OCI containers, or failure-notifs in `nix-config/`                                                       |
| `port-assignments`    | Adding/changing ports, firewall rules, or `service-registry.nix`                                                           |
