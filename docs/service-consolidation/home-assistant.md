# home-assistant — Service Consolidation Implementation Plan

Status: **PROPOSED** · Host: **augustus** · Concerns: **V O** (Caddy vhost + OIDC client)

Parent: [service-consolidation-plan.md](../service-consolidation-plan.md) · Equivalence rule:
[README.md](./README.md)

> **Operational equivalence is the contract.** Deploying this revision MUST be a theoretical no-op.
> This plan moves _where_ home-assistant's networking config is declared (into a colocated
> `features/home-assistant/` catalog entry read by the generators), not _what_ augustus realizes.
> Home Assistant carries two edge cases the generic catalog schema must reproduce **verbatim**: a
> `groups` entry in its `scopeMaps` list, and a **non-`/` landing path** (`/auth/oidc/welcome` with
> callback `/auth/oidc/callback`). See [schema-completeness note](#schema-completeness-note).

## 1. Current emitted output (verbatim)

Source: `nix-config/modules/services/home-assistant.nix` (module
`flake.modules.nixos.home-assistant`), with facts from `constants.services.home-assistant`
(`service-registry.nix`): `subdomain = "home-assistant"`, `port = 8123`,
`clientId = "home-assistant"`, `url = "https://home-assistant.plato-splunk.media"`,
`configDir = "/var/lib/hass"`.

### 1.1 Caddy vhost — `caddy.virtualHosts."https://home-assistant.plato-splunk.media".extraConfig`

A plain reverse proxy to the loopback port (no TLS gate, no mTLS, no explicit cert — shares Caddy's
managed cert):

```caddy
reverse_proxy localhost:8123
```

Emitted today by:

```nix
services.caddy.virtualHosts."${svc.url}" = {
  extraConfig = ''
    reverse_proxy localhost:${builtins.toString svc.port}
  '';
};
```

### 1.2 OIDC client — `services.kanidm.provision.systems.oauth2.home-assistant`

The full block emitted today (augustus only). Note the two edge cases: the `scopeMaps` list contains
a **`groups`** scope, and the callback/landing paths are the non-standard
`/auth/oidc/callback` and `/auth/oidc/welcome` (the landing is **not** just `/`):

```nix
services.kanidm.provision.systems.oauth2."home-assistant" = {
  originUrl = "https://home-assistant.plato-splunk.media/auth/oidc/callback";
  originLanding = "https://home-assistant.plato-splunk.media/auth/oidc/welcome";
  displayName = "Home Assistant";

  basicSecretFile = config.sops.secrets.home_assistant_client_secret.path;

  scopeMaps."home-assistant.access" = [
    "openid"
    "email"
    "groups"
    "profile"
  ];
};
```

There is **no** `claimMaps` for home-assistant (unlike planka). Role mapping is done app-side via
the `auth_oidc` custom component's `roles` config (`admin` → `home-assistant.admins@<idm>`, `user` →
`home-assistant.access@<idm>`), which stays in `service.nix` (§1.3).

### 1.3 Everything else the module emits (stays in `service.nix`, unchanged)

Not networking-contract concerns — copied **verbatim** into the feature's `service.nix`:

- `sops.templates."home-assistant-secrets.yaml"` — owner `hass`, the three-key YAML content
  (`home_assistant_lat` / `home_assistant_long` / `oauth_client_secret` from sops placeholders),
  written to `${svc.configDir}/secrets.yaml`.
- `services.home-assistant` — `enable = true`, `package = pkgs-unstable.home-assistant`, the
  `auth_oidc` custom component (`pkgs-unstable.home-assistant-custom-components.auth_oidc`), the
  full `extraComponents` list, and the entire `config` block:
  - `configDir = /var/lib/hass`, name/lat/long/unit_system/time_zone, `mobile_app`, `api`;
  - `http` (`server_port = 8123`, `server_host = 127.0.0.1`, `use_x_forwarded_for = true`,
    `trusted_proxies = [ "127.0.0.1" ]`);
  - `auth_oidc` (`client_id`, `client_secret = "!secret oauth_client_secret"`,
    `discovery_url = c.idm.mkOidcEndpoint "home-assistant"`, `features.automatic_person_creation`,
    `id_token_signing_alg = "ES256"`, and the `roles.admin` / `roles.user` group mappings).
- `services.failure-notifs.attachServices = [ "home-assistant" ]`.

## 2. Target feature layout

```
features/home-assistant/
├── catalog.nix    # homelab.catalog.home-assistant = { … }  (vhost + OIDC networking contract)
├── service.nix    # services.home-assistant config + custom components + extraComponents
│                  #   + sops.templates secrets.yaml + failure-notifs.attachServices
├── oidc.nix       # (optional) home-assistant scopeMaps (incl. groups), fed INTO the catalog entry
└── complete.nix   # flake.modules.nixos.home-assistant = { imports = [ ./catalog.nix … ]; }
```

- `service.nix` keeps the `services.home-assistant` block, custom/extra components, and the sops
  template **verbatim**, with `failure-notifs.attachServices` next to the unit it names.
- `oidc.nix` is optional — the single `scopeMaps` entry may live directly in `catalog.nix`.
- `complete.nix` is what `hosts/augustus.nix` imports (`nixos.home-assistant`); importing it
  realizes the HA service **and** registers the catalog entry.

### 2.1 Catalog entry

```nix
homelab.catalog.home-assistant = {
  subdomain = "home-assistant";          # -> https://home-assistant.plato-splunk.media
  host = "augustus";
  backend.reverseProxy.port = 8123;

  tls.cert.shared = { };                 # shares Caddy's managed cert; no security.acme.certs entry
  tls.gate.oidc = { };                   # app-gated OIDC; no Caddy-level auth — emits no extra config

  dns.tailnet = { };                     # emits home-assistant A/AAAA on aedilis -> augustus tailnet IPs

  oidc = {
    clientId = "home-assistant";
    client.basic.secretRef = "home_assistant_client_secret";  # basic client -> basicSecretFile
    displayName = "Home Assistant";
    callbackPath = "/auth/oidc/callback"; # originUrl     = url + /auth/oidc/callback
    landingPath = "/auth/oidc/welcome";   # originLanding = url + /auth/oidc/welcome  (NOT "/")

    scopeMaps."home-assistant.access" = [ "openid" "email" "groups" "profile" ];
    # no claimMaps — role mapping is done app-side in services.home-assistant.config.auth_oidc.roles
  };
};
```

`landingPath` is set explicitly to `/auth/oidc/welcome` — this is the edge case the generic schema
must support (a default of `/` would silently change `originLanding`).

### 2.2 Generator output

**Caddy** (`homelab-service-caddy`, nixos, filtered to `host == "augustus"`) renders the vhost body
from the `backend.reverseProxy` `port`:

```caddy
reverse_proxy 127.0.0.1:8123
```

> **`localhost → 127.0.0.1` note (approved deviation).** The current module writes
> `reverse_proxy localhost:8123`; the renderer standardizes on **`127.0.0.1`** (operator-approved —
> catalog-and-generators §7.8 #22, a bugfix for a real `localhost` DNS-resolution oddity). These are
> runtime-equivalent, so the raw parity gate (§4) shows **exactly** the one-token
> `localhost → 127.0.0.1` diff — the single approved, reviewed change, applied uniformly across all
> migrated reverse-proxy services.

**OIDC** (`homelab-service-oidc`, nixos, augustus only) reconstructs `oauth2.home-assistant` from
the `oidc` field: `originUrl = url + callbackPath` (`/auth/oidc/callback`),
`originLanding = url + landingPath` (`/auth/oidc/welcome`),
`basicSecretFile = config.sops.secrets.home_assistant_client_secret.path`, `displayName`, and the
single `scopeMaps` entry (including `groups`) passed through verbatim. No `claimMaps` is emitted.
Output must equal §1.2 exactly.

## 3. Operational-equivalence argument

- **Vhost.** The catalog + Caddy generator produce the same `reverse_proxy` body to port `8123` on
  augustus, with the approved `localhost → 127.0.0.1` upstream-token substitution (§2.2) as the only
  textual difference. No TLS gate, mTLS, or explicit cert is introduced — `tls.cert.shared` keeps the
  managed-cert behavior.
- **OIDC client.** The OIDC generator must reproduce the **exact** `oauth2.home-assistant` attribute
  set, including:
  - `originUrl` rebuilt to the identical `/auth/oidc/callback` URL;
  - `originLanding` rebuilt to the identical **`/auth/oidc/welcome`** URL — not defaulted to `/`;
  - `basicSecretFile` pointing at the same `home_assistant_client_secret` sops path;
  - `displayName = "Home Assistant"`;
  - `scopeMaps."home-assistant.access"` = the same four scopes **in the same order**, including the
    `groups` scope between `email` and `profile`;
  - **no** `claimMaps` attribute present (home-assistant maps roles app-side).
- **HA service, sops template, failure-notifs.** Moved verbatim into `service.nix`; byte-identical,
  so the `auth_oidc` component config (discovery_url, role group maps) and the rendered
  `secrets.yaml` are unchanged.
- **DNS.** `dns.tailnet = { }` reproduces the existing `home-assistant → augustus` tailnet A/AAAA
  record that `tailnetRewrites` emits today (covered end-to-end by the DNS cutover plan; parity
  verified there).

Net effect on augustus: identical `caddy.virtualHosts`, identical `oauth2.home-assistant`, identical
HA service + sops template + failure-notifs config.

## 4. Parity gate

Run **before** the migration (baseline) and **after** (candidate). The OIDC JSON diff MUST be empty;
the vhost `--raw` diff MUST show **only** the approved `localhost → 127.0.0.1` substitution (§2.2):

```sh
# OIDC client — the critical check (must include the groups scope AND the /auth/oidc/welcome landing)
nix eval --json \
  '.#nixosConfigurations.augustus.config.services.kanidm.provision.systems.oauth2.home-assistant' \
  > /tmp/ha-oauth2.BEFORE.json
# … apply migration, git add new files …
nix eval --json \
  '.#nixosConfigurations.augustus.config.services.kanidm.provision.systems.oauth2.home-assistant' \
  > /tmp/ha-oauth2.AFTER.json
diff /tmp/ha-oauth2.{BEFORE,AFTER}.json

# Caddy vhost extraConfig (raw — catches any whitespace/token drift)
nix eval --raw \
  '.#nixosConfigurations.augustus.config.services.caddy.virtualHosts."https://home-assistant.plato-splunk.media".extraConfig' \
  > /tmp/ha-vhost.BEFORE.conf
# … after …
diff /tmp/ha-vhost.{BEFORE,AFTER}.conf
```

Supplementary (should also be empty), to prove the HA-service/template move is verbatim:

```sh
nix eval --json .#nixosConfigurations.augustus.config.services.home-assistant.config
nix eval --json .#nixosConfigurations.augustus.config.services.failure-notifs.attachServices
nix eval --raw '.#nixosConfigurations.augustus.config.sops.templates."home-assistant-secrets.yaml".content'
```

> Remember: `git add` the new `features/home-assistant/*.nix` files before any `nix eval` — flake
> evaluation reads the git tree, so untracked new files are invisible (per
> `.kiro/steering/validation.md`).

## 5. Schema-completeness note

The generic catalog `oidc` schema in the parent plan (§2.1/§2.6) lists
`clientId / client (client.basic.secretRef | client.public) / callbackPath / landingPath /
displayName / scopeMaps / claimMaps`. Home Assistant exercises two schema requirements:

- **Non-`/` `landingPath`.** The schema already includes `landingPath`, but the parent plan's
  examples all default it to `/`. **Flag for the parent plan:** confirm `landingPath` is a
  required/overridable field with **no hardcoded `/` default baked into the generator** —
  home-assistant needs `/auth/oidc/welcome`, and planka needs `/`. If the generator hardcodes `/`,
  home-assistant's `originLanding` would silently regress. A per-entry `landingPath` with a `/`
  _option default_ (not a generator-hardcoded constant) satisfies both. This is a
  schema-completeness confirmation rather than a new field.
- **`groups` scope.** `scopeMaps` is an opaque `attrsOf (listOf str)` passthrough, so the `groups`
  scope requires **no** schema change — the generator must simply forward the scope list verbatim,
  preserving order. Confirm the generator does not filter/reorder scopes (it would break the
  before/after string match).

No new schema field is strictly required for home-assistant (unlike planka's
`allowInsecureClientDisablePkce`); the note is to ensure `landingPath` is a genuine per-entry value
and scopes pass through unmodified.

## 6. Migration checklist

- [ ] Confirm the parent catalog `oidc` schema treats `landingPath` as an overridable per-entry
      value (no generator-hardcoded `/`) and passes `scopeMaps` lists through verbatim (§5).
- [ ] Create `features/home-assistant/catalog.nix` with the entry from §2.1 (vhost + OIDC contract,
      including the `groups` scope and the `/auth/oidc/welcome` landing / `/auth/oidc/callback`
      callback).
- [ ] Create `features/home-assistant/service.nix` — move the `services.home-assistant` block
      (package, custom/extra components, full `config`), the
      `sops.templates."home-assistant-secrets.yaml"` template, and `failure-notifs.attachServices`
      **verbatim** from today's module.
- [ ] (Optional) Create `features/home-assistant/oidc.nix` for the `scopeMaps` entry; otherwise
      inline it in `catalog.nix`.
- [ ] Create `features/home-assistant/complete.nix` aggregating the sub-modules via `imports`,
      exposed as `flake.modules.nixos.home-assistant`.
- [ ] Confirm the reverse-proxy renderer emits `127.0.0.1:8123` (the approved §2.2 standardization).
- [ ] Delete the old `services/home-assistant.nix` (or reduce it to re-export) once
      `features/home-assistant` is the imported module in `hosts/augustus.nix`.
- [ ] `git add` the new feature files (required for flake eval to see them).
- [ ] Run the parity gate (§4): `oauth2.home-assistant` JSON diff empty (asserting the `groups` scope
      and `/auth/oidc/welcome` landing); vhost `extraConfig` raw diff = only the approved
      `localhost → 127.0.0.1` line.
- [ ] `nix run .#nixfmt -- $(git ls-files '*.nix' ':!:repos/**')`, then `nix flake check`.
- [ ] `nixos-rebuild build --flake .#augustus`; confirm no change to the HA service, OIDC client,
      sops template, or failure-notifs in the built toplevel.
