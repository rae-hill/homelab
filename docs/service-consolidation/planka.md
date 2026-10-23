# planka — Service Consolidation Implementation Plan

Status: **PROPOSED** · Host: **augustus** · Concerns: **V O** (Caddy vhost + OIDC client)

Parent: [service-consolidation-plan.md](../service-consolidation-plan.md) · Equivalence rule:
[README.md](./README.md)

> **Operational equivalence is the contract.** Deploying this revision MUST be a theoretical no-op.
> This plan moves _where_ planka's networking config is declared (into a colocated
> `features/planka/` catalog entry read by the generators), not _what_ augustus realizes. The planka
> OIDC client carries two edge-case attributes the generic catalog schema must reproduce
> **verbatim**: `allowInsecureClientDisablePkce = true` and a three-group `claimMaps.roles` map. See
> [schema-completeness note](#schema-completeness-note).

## 1. Current emitted output (verbatim)

Source: `nix-config/modules/services/planka.nix` (module `flake.modules.nixos.planka`), with facts
from `constants.services.planka` (`service-registry.nix`): `subdomain = "planka"`, `port = 1337`,
`clientId = "planka"`, `url = "https://planka.plato-splunk.media"`, `stateDir = "/var/lib/planka"`.

### 1.1 Caddy vhost — `services.caddy.virtualHosts."https://planka.plato-splunk.media".extraConfig`

A plain reverse proxy to the container's loopback port (no TLS gate, no mTLS, no explicit cert —
shares Caddy's managed cert):

```caddy
reverse_proxy localhost:1337
```

Emitted today by:

```nix
services.caddy.virtualHosts."${svc.url}" = {
  extraConfig = ''
    reverse_proxy localhost:${builtins.toString svc.port}
  '';
};
```

### 1.2 OIDC client — `services.kanidm.provision.systems.oauth2.planka`

The full block emitted today (augustus only). Note the two edge cases:
`allowInsecureClientDisablePkce = true` and the three-entry `claimMaps.roles.valuesByGroup`:

```nix
services.kanidm.provision.systems.oauth2."planka" = {
  originUrl = "https://planka.plato-splunk.media/oidc-callback";
  originLanding = "https://planka.plato-splunk.media/";
  displayName = "Planka";

  allowInsecureClientDisablePkce = true;

  basicSecretFile = config.sops.secrets.planka_client_secret.path;

  scopeMaps."planka.access" = [
    "openid"
    "email"
    "profile"
  ];

  claimMaps.roles = {
    joinType = "array";
    valuesByGroup = {
      "planka.admins" = [ "admin" ];
      "planka.project_owner" = [ "project_owner" ];
      "planka.access" = [ "board_user" ];
    };
  };
};
```

The role literals (`admin` / `project_owner` / `board_user`) are the `plankaAdminRole` /
`plankaPORole` / `plankaUserRole` `let`-bindings in the current module, which are **also**
referenced by the container's `OIDC_ADMIN_ROLES` / `OIDC_PROJECT_OWNER_ROLES` /
`OIDC_BOARD_USER_ROLES` environment variables. The catalog entry must preserve the exact string
values so both the Kanidm claim map and the container env stay in lockstep.

### 1.3 Everything else the module emits (stays in `service.nix`, unchanged)

Not networking-contract concerns — these are copied **verbatim** into the feature's `service.nix`
and do not change:

- `virtualisation.oci-containers.containers.planka` — the full container (image
  `ghcr.io/plankanban/planka:2.0.0-rc.4`, `host` network, tmpfs `/app` mount, the patched
  `./patched-start.sh` entrypoint + start-script bind mount, favicons / user-avatars /
  background-images / attachments volume mounts, CA cert mount, all five sops secret/template
  mounts, and the complete `environment` block including `BASE_URL`, `DATABASE_URL`, the `OIDC_*`
  env, etc.).
- `services.postgresql.ensureDatabases = [ "planka" ]` and `services.postgresql.ensureUsers`
  (`planka` with `ensureDBOwnership = true`).
- `users.groups.planka-db-pass.members = [ "planka" "postgres" ]`.
- `services.peesequel.provisionPasswords.planka = config.sops.secrets.planka_db_pass.path`.
- `services.restic.backups.planka` (repo `/mnt/backups/planka`, nightly 23:30, wrapper `restic`
  package).
- `services.failure-notifs.attachServices = [ "podman-planka" "restic-backups-planka" ]`.

## 2. Target feature layout

```
features/planka/
├── catalog.nix    # homelab.catalog.planka = { … }  (vhost + OIDC networking contract)
├── service.nix    # oci-container + postgres ensureDatabases/Users + peesequel
│                  #   provisionPasswords + restic backup + failure-notifs.attachServices
├── oidc.nix       # (optional) planka's scopeMaps + claimMaps.roles, fed INTO the catalog entry
└── complete.nix   # flake.modules.nixos.planka = { imports = [ ./catalog.nix ./service.nix … ]; }
```

- `service.nix` keeps the big container/db/backup definition **verbatim** (§1.3), including
  `failure-notifs` next to the units it names.
- `oidc.nix` is optional — planka's `scopeMaps` + `claimMaps` may live directly in `catalog.nix` or
  be factored into `oidc.nix` and merged into the `oidc` field. Either way the emitted
  `oauth2.planka` block is identical.
- `complete.nix` is what `hosts/augustus.nix` imports (`nixos.planka`); importing it realizes the
  container/backups **and** registers the catalog entry the generators consume.

### 2.1 Catalog entry

```nix
homelab.catalog.planka = {
  subdomain = "planka";                 # -> https://planka.plato-splunk.media
  host = "augustus";
  backend = { kind = "reverseProxy"; port = 1337; };

  tls = {
    ca = null;                          # shares Caddy's managed cert; no security.acme.certs entry
    gate = "oidc";                      # app-gated OIDC; no Caddy-level auth — emits no extra config
  };

  dns.enable = true;                    # emits planka A/AAAA on aedilis -> augustus tailnet IPs

  oidc = {
    enable = true;
    clientId = "planka";
    public = false;                     # basic client -> basicSecretFile
    secretRef = "planka_client_secret"; # -> config.sops.secrets.planka_client_secret.path
    displayName = "Planka";
    callbackPath = "/oidc-callback";    # originUrl  = url + /oidc-callback
    landingPath = "/";                  # originLanding = url + /

    allowInsecureClientDisablePkce = true;  # EDGE CASE — see schema-completeness note

    scopeMaps."planka.access" = [ "openid" "email" "profile" ];

    claimMaps.roles = {
      joinType = "array";
      valuesByGroup = {
        "planka.admins"        = [ "admin" ];
        "planka.project_owner" = [ "project_owner" ];
        "planka.access"        = [ "board_user" ];
      };
    };
  };
};
```

`subdomain`/`host` derive the vhost + DNS; `tls.ca = null` means the Caddy generator emits only the
`reverse_proxy` body with no explicit cert and the ACME generator emits nothing.

### 2.2 Generator output

**Caddy** (`homelab-service-caddy`, nixos, filtered to `host == "augustus"`) renders the vhost body
from `backend.kind == "reverseProxy"` + `port`:

```caddy
reverse_proxy 127.0.0.1:1337
```

> **`localhost → 127.0.0.1` note (approved deviation).** The current module writes
> `reverse_proxy localhost:1337`; the renderer standardizes on **`127.0.0.1`** (operator-approved —
> catalog-and-generators §7.8 #22, a bugfix for a real `localhost` DNS-resolution oddity). These
> resolve identically at runtime, so the raw parity gate (§4) shows **exactly** the one-token
> `localhost → 127.0.0.1` diff — the single approved, reviewed change, applied uniformly across all
> migrated reverse-proxy services.

**OIDC** (`homelab-service-oidc`, nixos, augustus only) reconstructs `oauth2.planka` from the `oidc`
field: `originUrl = url + callbackPath`, `originLanding = url + landingPath`,
`basicSecretFile = config.sops.secrets.<secretRef>.path`, `displayName`,
`allowInsecureClientDisablePkce`, and `scopeMaps` / `claimMaps` passed through verbatim. Output must
equal §1.2 exactly.

## 3. Operational-equivalence argument

- **Vhost.** The catalog + Caddy generator produce the same `reverse_proxy` body to port `1337` on
  augustus, with the approved `localhost → 127.0.0.1` upstream-token substitution (§2.2) as the only
  textual difference. No TLS gate, mTLS, or explicit cert is introduced — `tls.ca = null` keeps the
  managed-cert behavior.
- **OIDC client.** The OIDC generator must reproduce the **exact** `oauth2.planka` attribute set,
  including:
  - `allowInsecureClientDisablePkce = true` (passed through, not dropped or defaulted);
  - `basicSecretFile` pointing at the same `planka_client_secret` sops path;
  - `originUrl`/`originLanding` rebuilt to the identical `/oidc-callback` and `/` URLs;
  - `scopeMaps."planka.access"` = the same three scopes;
  - `claimMaps.roles` with `joinType = "array"` and the identical three-group `valuesByGroup` map
    (`planka.admins → admin`, `planka.project_owner → project_owner`, `planka.access → board_user`).
- **Container, DB, backups, failure-notifs.** Moved verbatim into `service.nix`; byte-identical, so
  the container env (including the `OIDC_*_ROLES` values that mirror the claim map) is unchanged.
- **DNS.** `dns.enable = true` reproduces the existing `planka → augustus` tailnet A/AAAA record
  that `tailnetRewrites` emits today (covered end-to-end by the DNS cutover plan; parity verified
  there).

Net effect on augustus: identical `caddy.virtualHosts`, identical `oauth2.planka`, identical
container/db/backup/failure-notifs config.

## 4. Parity gate

Run **before** the migration (baseline) and **after** (candidate). The OIDC JSON diff MUST be empty;
the vhost `--raw` diff MUST show **only** the approved `localhost → 127.0.0.1` substitution (§2.2):

```sh
# OIDC client — the critical check (must include allowInsecureClientDisablePkce + claimMaps.roles)
nix eval --json \
  .#nixosConfigurations.augustus.config.services.kanidm.provision.systems.oauth2.planka \
  > /tmp/planka-oauth2.BEFORE.json
# … apply migration, git add new files …
nix eval --json \
  .#nixosConfigurations.augustus.config.services.kanidm.provision.systems.oauth2.planka \
  > /tmp/planka-oauth2.AFTER.json
diff /tmp/planka-oauth2.{BEFORE,AFTER}.json

# Caddy vhost extraConfig (raw — catches any whitespace/token drift)
nix eval --raw \
  '.#nixosConfigurations.augustus.config.services.caddy.virtualHosts."https://planka.plato-splunk.media".extraConfig' \
  > /tmp/planka-vhost.BEFORE.conf
# … after …
diff /tmp/planka-vhost.{BEFORE,AFTER}.conf
```

Supplementary (should also be empty), to prove the container/backup move is verbatim:

```sh
nix eval --json .#nixosConfigurations.augustus.config.virtualisation.oci-containers.containers.planka
nix eval --json .#nixosConfigurations.augustus.config.services.restic.backups.planka
nix eval --json .#nixosConfigurations.augustus.config.services.failure-notifs.attachServices
```

> Remember: `git add` the new `features/planka/*.nix` files before any `nix eval` — flake evaluation
> reads the git tree, so untracked new files are invisible (per `.kiro/steering/validation.md`).

## 5. Schema-completeness note

The generic catalog `oidc` schema in the parent plan (§2.1/§2.6) lists
`enable / clientId / public / callbackPath / landingPath / displayName / secretRef / scopeMaps /
claimMaps`. Planka needs **one additional passthrough field** not in that list:

- **`allowInsecureClientDisablePkce` (bool, default `false`).** Must be surfaced as an optional
  catalog `oidc` field and passed straight through to
  `services.kanidm.provision.systems.oauth2.<clientId>.allowInsecureClientDisablePkce`. Without it
  the OIDC generator cannot reproduce planka's client, and the parity gate (§4) would fail on a
  missing attribute. **Flag for the parent plan:** add `allowInsecureClientDisablePkce` to the
  `oidc` submodule as an optional passthrough (defaulting to `false` so no other service's output
  changes).

`claimMaps` is already in the schema as a verbatim passthrough, so planka's `claimMaps.roles` needs
no schema extension — only confirmation that the generator forwards the nested `joinType` +
`valuesByGroup` structure unmodified.

## 6. Migration checklist

- [ ] Confirm the parent catalog `oidc` schema includes the `allowInsecureClientDisablePkce`
      passthrough (§5); if absent, add it to `features/homelab-service/options.nix` first.
- [ ] Create `features/planka/catalog.nix` with the entry from §2.1 (vhost + OIDC contract,
      including the insecure-PKCE flag and the three-group `claimMaps.roles`).
- [ ] Create `features/planka/service.nix` — move the `oci-containers.containers.planka` block,
      `postgresql.ensureDatabases`/`ensureUsers`, `users.groups.planka-db-pass`,
      `peesequel.provisionPasswords.planka`, `restic.backups.planka`, and
      `failure-notifs.attachServices` **verbatim** from today's module.
- [ ] (Optional) Create `features/planka/oidc.nix` for the scope/claim maps; otherwise inline them
      in `catalog.nix`.
- [ ] Create `features/planka/complete.nix` aggregating the sub-modules via `imports`, exposed as
      `flake.modules.nixos.planka`.
- [ ] Confirm the reverse-proxy renderer emits `127.0.0.1:1337` (the approved §2.2 standardization).
- [ ] Delete the old `services/planka.nix` (or reduce it to re-export) once `features/planka` is the
      imported module in `hosts/augustus.nix`.
- [ ] `git add` the new feature files (required for flake eval to see them).
- [ ] Run the parity gate (§4): `oauth2.planka` JSON diff empty; vhost `extraConfig` raw diff = only
      the approved `localhost → 127.0.0.1` line.
- [ ] `nix run .#nixfmt -- $(git ls-files '*.nix' ':!:repos/**')`, then `nix flake check`.
- [ ] `nixos-rebuild build --flake .#augustus`; confirm no change to the planka container, OIDC
      client, DB, or backups in the built toplevel (only the approved upstream-token change).
- [ ] `nix run .#nixfmt -- $(git ls-files '*.nix' ':!:repos/**')`, then `nix flake check`.
- [ ] `nixos-rebuild build --flake .#augustus`; confirm no change to the planka container, OIDC
      client, DB, or backups in the built toplevel.
