# Path Resolution & Navigation

## TypeScript Packages

When the user refers to a package by name in a TypeScript/frontend/backend/test context, resolve to `./packages/<package-name>/src/...`.

| User says                          | Resolves to                                       |
| ---------------------------------- | ------------------------------------------------- |
| `homelab-frontend/dir/foo.ts`      | `./packages/homelab-frontend/src/dir/foo.ts`      |
| `homelab-api/dir/foo.ts`           | `./packages/homelab-api/src/dir/foo.ts`           |
| `homelab-server/dir/foo.ts`        | `./packages/homelab-server/src/dir/foo.ts`        |
| `homelab-services/dir/foo.ts`      | `./packages/homelab-services/src/dir/foo.ts`      |
| `homelab-services-node/dir/foo.ts` | `./packages/homelab-services-node/src/dir/foo.ts` |
| `homelab-shared/dir/foo.ts`        | `./packages/homelab-shared/src/dir/foo.ts`        |
| `homelab-data/dir/foo.ts`          | `./packages/homelab-data/src/dir/foo.ts`          |
| `homelab-e2e-tests/dir/foo.ts`     | `./packages/homelab-e2e-tests/src/dir/foo.ts`     |

## Nix Packages & Config

When the user says "the Nix package for X," resolve to the appropriate feature module:

| User says                   | Resolves to                                                     |
| --------------------------- | --------------------------------------------------------------- |
| Nix package for homelab-api | `./nix-config/modules/features/homelab-api/package.nix`         |
| Nix package for homelab-ui  | `./nix-config/modules/features/homelab-ui/package.nix`          |
| homelab-api systemd service | `./nix-config/modules/features/homelab-api/systemd-service.nix` |
| homelab-api kanidm config   | `./nix-config/modules/features/homelab-api/kanidm.nix`          |
| homelab-api caddy config    | `./nix-config/modules/features/homelab-api/caddy.nix`           |
| homelab-ui caddy config     | `./nix-config/modules/features/homelab-ui/caddy.nix`            |

## Nix Config Quick Reference

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

## NixOS Package & Module Reference

Vendored nixpkgs subtrees provide browsable NixOS module source for determining available options:

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

```sh
git subtree pull --prefix=repos/nixpkgs-26.05 https://github.com/NixOS/nixpkgs.git nixos-26.05 --squash
git subtree pull --prefix=repos/nixpkgs-unstable https://github.com/NixOS/nixpkgs.git nixos-unstable --squash
```

## Hosts

| Name        | Role                                                                              |
| ----------- | --------------------------------------------------------------------------------- |
| augustus    | Primary server; runs homelab-api, homelab-ui, IDM (Kanidm), failure notifications |
| nixos       | Primary workstation                                                               |
| praeconinus | Public-facing server; hosts a restricted version of homelab-api/ui                |
| cicero      | Exclusively hosts the certificate authority (step-ca)                             |
| mini        | Mac Mini (nix-darwin); currently only hosts Jellyfin                              |
