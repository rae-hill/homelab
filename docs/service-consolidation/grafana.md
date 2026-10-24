# grafana — Service Consolidation Plan

Status: **PROPOSED** · Host: **augustus** · Concerns: **V O** · Complexity: **low**

Module: `nix-config/modules/services/grafana.nix`

> Governed by the [operational-equivalence rule](./README.md): deploying this revision must be a
> theoretical **no-op**. The migration moves _where_ config is declared (into `features/grafana/`
> catalog + generators), not _what_ augustus realizes. Nothing below changes runtime behavior.

## 1. Current emitted output (verbatim)

Grafana is an **app-gated OIDC** reverse-proxy service: Caddy does a plain `reverse_proxy` with **no
Caddy-level auth** (`tls.gate.oidc`; Grafana's `auth.generic_oauth` handles the OIDC flow).
Registry facts (`constants.services.grafana`): `subdomain = "grafana"`, `port = 3000`,
`clientId = "grafana"`, so `svc.url = "https://grafana.plato-splunk.media"`.

### 1.1 Caddy vhost — `services.caddy.virtualHosts."https://grafana.plato-splunk.media"`

```caddy
reverse_proxy 127.0.0.1:3000
```

There is **no** `security.acme.certs` entry — the vhost shares Caddy's managed cert
(`tls.cert.shared`). No mTLS, no Caddy-level auth (comment in source: "OIDC handles auth").

### 1.2 Kanidm OIDC — `services.kanidm.provision.systems.oauth2."grafana"`

Full block emitted today (basic secret client):

```nix
services.kanidm.provision.systems.oauth2."grafana" = {
  originUrl = "https://grafana.plato-splunk.media/login/generic_oauth";
  originLanding = "https://grafana.plato-splunk.media/";
  displayName = "Grafana";

  basicSecretFile = config.sops.secrets.grafana_client_secret.path;

  scopeMaps."grafana.access" = [
    "openid"
    "email"
    "profile"
  ];

  claimMaps.roles = {
    joinType = "array";
    valuesByGroup = {
      "grafana.admins" = [ "admin" ];
      "grafana.access" = [ "editor" ];
    };
  };
};
```

The genuinely service-specific parts are the **callback path** (`/login/generic_oauth`), the
**scopeMaps** (`grafana.access` → openid/email/profile), and the **claimMaps.roles** mapping
`grafana.admins → admin` and `grafana.access → editor`. Everything else (`originLanding`,
`basicSecretFile`, `displayName`) is derivable boilerplate.

> Contrast with openwebui: same shape, but a **different callback path**
> (`/login/generic_oauth` vs `/oauth/oidc/callback`) and a different non-admin role
> (`editor` vs `user`). These are exactly the per-service fields the catalog must carry.

### 1.3 failure-notifs — `services.failure-notifs.attachServices`

```nix
services.failure-notifs.attachServices = [
  "grafana"
];
```

### 1.4 Other runtime the module owns (stays in the feature, not the catalog)

- `services.grafana` — the large settings block: `server` (`http_addr = 127.0.0.1`,
  `http_port = 3000`, `domain = svc.domain`, `root_url = svc.url`), `auth.generic_oauth` (client id/
  secret via sops template, Kanidm `auth_url`/`token_url`/`api_url`, `use_pkce`, `tls_client_ca =
  c.ca.rootCert`), `auth.disable_login_form`, `security.secret_key`, `analytics`, `unified_alerting`,
  and the full `provision` tree (datasources Prometheus/Loki/Tempo, contactPoints Pushover, alerting
  rules).
- `systemd.services.grafana` ordering (`after`/`requires` prometheus/loki/tempo).

These are **not** cross-cutting networking facts, so they remain in the feature's runtime module
unchanged.

## 2. New feature layout — `features/grafana/`

```
features/grafana/
├── catalog.nix    # contributes homelab.catalog.grafana (networking contract + OIDC maps)
├── service.nix    # services.grafana (settings + provision) + systemd ordering + failure-notifs
├── oidc.nix       # (optional split) the grafana OIDC scope/claim maps fed into the catalog
└── complete.nix   # flake.modules.nixos.grafana = { imports = [ … ]; }
```

### 2.1 `catalog.nix`

```nix
homelab.catalog.grafana = {
  subdomain = "grafana";                # -> url = https://grafana.plato-splunk.media
  host = "augustus";
  backend.reverseProxy.port = 3000;

  tls.cert.shared = { };                # shares Caddy's managed cert (no security.acme.certs)
  tls.gate.oidc = { };                  # app-gated; NO Caddy-level auth emitted

  access.scope.tailnet = { };
  dns.tailnet = { };                    # emits grafana A/AAAA -> augustus tailnet IP on aedilis

  oidc = {
    clientId = "grafana";
    client.basic.secretRef = "grafana_client_secret";  # basic secret client
    callbackPath = "/login/generic_oauth";
    landingPath = "/";
    displayName = "Grafana";
    # --- irreducible per-service parts, carried verbatim into the generator ---
    scopeMaps."grafana.access" = [ "openid" "email" "profile" ];
    claimMaps.roles = {
      joinType = "array";
      valuesByGroup = {
        "grafana.admins" = [ "admin" ];
        "grafana.access" = [ "editor" ];
      };
    };
  };
};
```

The service-specific OIDC `scopeMaps`/`claimMaps` are the **irreducible per-service parts** and are
carried in the catalog `oidc` field (optionally authored in `oidc.nix` and merged here).

### 2.2 `service.nix`

Keeps everything from §1.4 verbatim — the entire `services.grafana` block (settings +
`auth.generic_oauth` + provision datasources/contactPoints/rules) and the
`systemd.services.grafana` ordering, plus:

```nix
services.failure-notifs.attachServices = [
  "grafana"
];
```

> Note: `services.grafana.settings."auth.generic_oauth"` and `services.grafana.settings.security`
> still read the sops secrets/templates (`grafana_client_secret` template, `grafana_secret`,
> `grafana_pushover_*`) directly. These are Grafana's own app config, **independent** of the Kanidm
> client registration the catalog generates — both reference the same `grafana_client_secret` but
> for different sides of the OIDC handshake (client config vs IdP registration). Keep both.

`failure-notifs` stays next to the unit it names (per parent plan §5.1 #2) — never in the catalog.

### 2.3 `complete.nix`

```nix
flake.modules.nixos.grafana = {
  imports = [
    config.flake.modules.nixos.grafana-catalog
    config.flake.modules.nixos.grafana-service
  ];
};
```

`hosts/augustus.nix` continues to import `nixos.grafana`; importing it both realizes the runtime and
registers the catalog entry, which the (host-imported) caddy / oidc / dns generators then pick up.

## 3. Operational equivalence argument

### 3.1 Caddy vhost

The caddy generator renders `backend.reverseProxy.port = 3000` with `tls.gate.oidc`
into exactly:

```caddy
reverse_proxy 127.0.0.1:3000
```

matching §1.1 byte-for-byte (grafana's source already uses `127.0.0.1`, so if the shared renderer
standardizes on `127.0.0.1` the gate stays empty with no deviation). `tls.gate.oidc` emits **no**
Caddy-level auth. `tls.cert.shared` → no `security.acme.certs` entry, identical to today.

### 3.2 OIDC client

The oidc generator (augustus only) folds the catalog `oidc` block into
`services.kanidm.provision.systems.oauth2."grafana"`, deriving:

- `originUrl = "${svc.url}${callbackPath}"` = `https://grafana.plato-splunk.media/login/generic_oauth`
  ✓ (same)
- `originLanding = "${svc.url}${landingPath}"` = `https://grafana.plato-splunk.media/` ✓
- `displayName = "Grafana"` ✓
- `basicSecretFile = config.sops.secrets.grafana_client_secret.path` (from `client.basic.secretRef`) ✓
- `scopeMaps` / `claimMaps.roles` passed through **verbatim** (incl. `grafana.access → editor`) ✓

Every attribute matches §1.2 exactly. The sops secret `grafana_client_secret` still lives in
augustus's sops config; the generator only references it by name.

### 3.3 failure-notifs + runtime

Unchanged — moved file, same `attachServices = [ "grafana" ]`, same `services.grafana` settings/
provision and systemd ordering. No behavioral delta.

## 4. Parity gate

Before and after the migration, on augustus, these must be **identical**:

```sh
# OIDC client (full attr, JSON)
nix eval --json \
  .#nixosConfigurations.augustus.config.services.kanidm.provision.systems.oauth2.grafana

# Caddy vhost body (raw string)
nix eval --raw \
  '.#nixosConfigurations.augustus.config.services.caddy.virtualHosts."https://grafana.plato-splunk.media".extraConfig'
```

Capture both to files pre-migration, re-run post-migration, `diff` must be empty. Optionally also
diff `services.grafana.settings` JSON to prove the (large, unchanged) app config was moved verbatim:

```sh
nix eval --json .#nixosConfigurations.augustus.config.services.grafana.settings
```

Also sanity-check `services.failure-notifs.attachServices` still contains `grafana`.

> **Stage new files first** (`.kiro/steering/validation.md`): `git add features/grafana/**` before
> any `nix eval`/`nix flake check` — untracked new `.nix` files are invisible to flake evaluation.

## 5. Migration checklist

- [ ] `git add` the new `features/grafana/` files **before** any Nix eval.
- [ ] Capture pre-migration baselines: `oauth2.grafana` JSON + vhost `extraConfig` raw (+ optionally
      `services.grafana.settings` JSON).
- [ ] Create `features/grafana/catalog.nix` with the §2.1 entry (OIDC maps verbatim, callback path
      `/login/generic_oauth`, non-admin role `editor`).
- [ ] Create `features/grafana/service.nix` from the current runtime (§1.4 + failure-notifs),
      preserving the full `services.grafana` settings/provision block and systemd ordering.
- [ ] (Optional) split OIDC maps into `features/grafana/oidc.nix`.
- [ ] Create `features/grafana/complete.nix` exporting `flake.modules.nixos.grafana`.
- [ ] Delete the old `services/grafana.nix` (vhost + oauth2 now generated; rest moved to service.nix).
- [ ] Confirm the caddy vhost-body renderer emits `127.0.0.1:3000` (grafana already uses this).
- [ ] `nix run .#nixfmt -- $(git ls-files '*.nix' ':!:repos/**')`.
- [ ] Re-run the §4 parity evals; `diff` against baselines must be empty.
- [ ] `nix flake check` and `nixos-rebuild build --flake .#augustus`.
- [ ] Deploy — must be a no-op (no service restart beyond config-identical reload).
