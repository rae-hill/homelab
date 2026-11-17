# Path Resolution & Navigation

## TypeScript Packages

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

## Nix Packages & Config

When the user says "the Nix package for X," resolve to the appropriate service module:

| User says                   | Resolves to                                                    |
| --------------------------- | -------------------------------------------------------------- |
| Nix package for homelab-api | `./nix-config/modules/homelab/homelab-api/package.nix`         |
| Nix package for homelab-ui  | `./nix-config/modules/homelab/homelab-ui/package.nix`          |
| homelab-api systemd service | `./nix-config/modules/homelab/homelab-api/systemd-service.nix` |

## Nix Config Quick Reference

```
nix-config/
├── constants.nix               # Shared constants (ports, URLs, etc.)
├── service-registry.nix        # Service registry
├── lib/                        # Shared Nix helpers (shell.nix)
├── checks/                     # Flake checks (shellcheck.nix)
├── modules/
│   ├── ai/                     # AI modules (ai-opencode/, ai-openclaw/, ai-openwebui/,
│   │                           #   ai-ollama, ai-wyoming)
│   ├── apps/                   # App modules (apps-habitsync/, apps-home-assistant/,
│   │                           #   apps-it-tools/, apps-jellyfin/, apps-minecraft,
│   │                           #   apps-planka/)
│   ├── data/                   # Data modules (data-postgres/)
│   ├── desktop/                # Desktop modules (GNOME, nvidia, firefox, uxplay, git,
│   │                           #   restic, virtualization, homebrew)
│   ├── editors/                # Editors (editors-nixvim/, editors-vscode.nix)
│   ├── games/                  # Gaming modules (steam, mangohud, complete set)
│   ├── homelab/                # Homelab core (homelab-api/, homelab-ui/, homelab-catalog/,
│   │                           #   homelab-resume-site/, homelab-failure-notifs,
│   │                           #   homelab-ssh-cert-renewer)
│   ├── identity/               # Identity (identity-kanidm/, identity-step-ca, identity-acme,
│   │                           #   identity-kanidm-client, identity-kanidm-posix)
│   ├── networking/             # Networking (networking-caddy, networking-technitium/,
│   │                           #   networking-radius/, networking-unpoller)
│   ├── observability/          # Observability (observability-{alloy,grafana,loki,
│   │                           #   prometheus,tempo})
│   ├── provisioners/           # Provisioners (provisioners-technitium/,
│   │                           #   provisioners-client-cert/)
│   ├── shell/                  # Shell modules (zsh, starship, ssh incl. the openssh
│   │                           #   daemon module, complete set)
│   ├── system/                 # System modules (system-base, boot, networking
│   │                           #   (+forwarding/-dns-host), security, locale, fonts,
│   │                           #   podman, programs, cifs, audio)
│   ├── themes/                 # Themes (themes-catppuccin.nix)
│   └── users/                  # User accounts (users-human.nix: jacob/rae/admin
│                               #   aggregate; users-system.nix: service users,
│                               #   imported by their service modules)
├── home-configs/               # Home-manager configs per user/host
│   ├── jacob-nixos.nix
│   ├── jacob-augustus.nix
│   ├── jacob-cicero.nix
│   └── rae/                    # default.nix + complete/git/shell/sops.nix
├── system-configs/             # Per-host entry points (aedilis, augustus, cicero, mini,
│                               #   nixos, praeconinus)
│   └── <host>/                 # default.nix + hardware/filesystems/security/system/
│                               #   programs.nix (flake-parts host-<host>-* modules,
│                               #   imported by default.nix) + sops.nix (plain module;
│                               #   users live in modules/users/). aedilis also has
│                               #   technitium.nix; cicero also has observability/
└── secrets/                    # SOPS-encrypted secrets — transitional home of
                               #   multi-consumer files (secrets/<host>/<service>.yaml);
                               #   single-consumer files live module-local in
                               #   modules/**/secrets/<host>.yaml. All declared via
                               #   sops.secrets.<name>.sopsFile in the consuming
                               #   module (docs/secretspec-migration-plan.md)
```

## NixOS Package & Module Reference

Vendored nixpkgs submodules provide browsable NixOS module source for determining available options:

| User says                                       | Resolves to                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| NixOS module for `services.X` (stable 26.05)    | `./repos/nixpkgs-26.05/nixos/modules/services/...`                     |
| NixOS module for `services.X` (unstable/master) | `./repos/nixpkgs-unstable/nixos/modules/services/...`                  |
| Nix package derivation for X (stable)           | `./repos/nixpkgs-26.05/pkgs/by-name/<two-letter-prefix>/<name>/...`    |
| Nix package derivation for X (unstable)         | `./repos/nixpkgs-unstable/pkgs/by-name/<two-letter-prefix>/<name>/...` |

### Browsing NixOS Options

To find available NixOS service options, read the module source directly from the vendored repos:

- **Service modules:** `repos/nixpkgs-26.05/nixos/modules/services/<category>/<service>.nix`
- **Prometheus exporters:** `repos/nixpkgs-26.05/nixos/modules/services/monitoring/prometheus/exporters/<name>.nix`
- **Package derivations:** `repos/nixpkgs-26.05/pkgs/by-name/<prefix>/<name>/package.nix`

When options differ between branches, prefer the branch matching the host's nixpkgs input:

- Augustus, cicero, praeconinus, nixos → `nixpkgs` (nixos-26.05)
- Packages from `pkgs-unstable` overlay → `nixpkgs-unstable`

### Updating Vendored Nixpkgs

The nixpkgs submodules are pinned to the exact revs recorded in `flake.lock` — re-point the
submodule whenever `nix flake update` moves the input:

```sh
rev=$(jq -r '.nodes["nixpkgs-unstable"].locked.rev' flake.lock)
git -C repos/nixpkgs-unstable fetch --depth 1 origin "$rev"
git -C repos/nixpkgs-unstable checkout FETCH_HEAD
git add repos/nixpkgs-unstable
```

> These submodules go stale (not auto-refreshed). For the full update workflow —
> including pinning app submodules (e.g. `repos/kanidm`) to the **tag** nixpkgs
> 26.05 actually builds and corroborating the version skew — see
> `.kiro/steering/effect-services.md` → "Keeping Vendored Submodules Up To Date".

## Hosts

| Name        | Role                                                                              |
| ----------- | --------------------------------------------------------------------------------- |
| augustus    | Primary server; runs homelab-api, homelab-ui, IDM (Kanidm), failure notifications |
| nixos       | Primary workstation                                                               |
| praeconinus | Public-facing server; hosts a restricted version of homelab-api/ui                |
| cicero      | Exclusively hosts the certificate authority (step-ca)                             |
| mini        | Mac Mini (nix-darwin); currently only hosts Jellyfin                              |
