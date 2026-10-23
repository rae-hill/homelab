# openwebui — Service Consolidation Plan

Status: **PROPOSED** · Host: **augustus** · Concerns: **V O** · Complexity: **low**

Module: `nix-config/modules/services/openwebui.nix`

> Governed by the [operational-equivalence rule](./README.md): deploying this revision must be a
> theoretical **no-op**. The migration moves _where_ config is declared (into
> `features/openwebui/` catalog + generators), not _what_ augustus realizes. Nothing below changes
> runtime behavior.

## 1. Current emitted output (verbatim)

Open WebUI is an **app-gated OIDC** reverse-proxy service: Caddy does a plain `reverse_proxy` with
**no Caddy-level auth** (`tls.gate = "oidc"` means the app handles the OIDC flow itself). Registry
facts (`constants.services.openwebui`): `subdomain = "openwebui"`, `port = 19553`,
`clientId = "openwebui"`, so `svc.url = "https://openwebui.plato-splunk.media"`.

### 1.1 Caddy vhost — `services.caddy.virtualHosts."https://openwebui.plato-splunk.media"`

The module sets `extraConfig` to (note the source uses `localhost`, not `127.0.0.1`):

```caddy
reverse_proxy localhost:19553
```

There is **no** `security.acme.certs` entry — the vhost shares Caddy's managed cert (`tls.ca =
null`). No mTLS, no Caddy-level auth.

### 1.2 Kanidm OIDC — `services.kanidm.provision.systems.oauth2."openwebui"`

Full block emitted today (basic secret client):

```nix
services.kanidm.provision.systems.oauth2."openwebui" = {
  originUrl = "https://openwebui.plato-splunk.media/oauth/oidc/callback";
  originLanding = "https://openwebui.plato-splunk.media/";
  displayName = "Open WebUI";

  basicSecretFile = config.sops.secrets.openwebui_client_secret.path;

  scopeMaps."openwebui.access" = [
    "openid"
    "email"
    "profile"
  ];

  claimMaps.roles = {
    joinType = "array";
    valuesByGroup = {
      "openwebui.admins" = [ "admin" ];
      "openwebui.access" = [ "user" ];
    };
  };
};
```

The genuinely service-specific parts are the **callback path** (`/oauth/oidc/callback`), the
**scopeMaps** (`openwebui.access` → openid/email/profile), and the **claimMaps.roles** mapping
`openwebui.admins → admin` and `openwebui.access → user`. Everything else (`originLanding`,
`basicSecretFile`, `displayName`) is derivable boilerplate.

### 1.3 failure-notifs — `services.failure-notifs.attachServices`

```nix
services.failure-notifs.attachServices = [
  "open-webui"
  "restic-backups-openwebui"
];
```

### 1.4 Other runtime the module owns (stays in the feature, not the catalog)

- `sops.templates."openwebui-env"` (the `WEBUI_URL` / `OAUTH_CLIENT_ID` / `OPENID_PROVIDER_URL =
  mkOidcEndpoint "openwebui"` env file, owned by `openwebui:openwebui`).
- `services.open-webui` (`port = 19553`, `stateDir`, `host = "127.0.0.1"`, `environmentFile`).
- `systemd.services.open-webui.serviceConfig` (`User`/`Group = openwebui`).
- `services.restic.backups.openwebui`.

These are **not** cross-cutting networking facts, so they remain in the feature's runtime module
unchanged.

## 2. New feature layout — `features/openwebui/`

```
features/openwebui/
├── catalog.nix    # contributes homelab.catalog.openwebui (networking contract + OIDC maps)
├── service.nix    # services.open-webui + sops template + restic + failure-notifs
├── oidc.nix       # (optional split) the openwebui OIDC scope/claim maps fed into the catalog
└── complete.nix   # flake.modules.nixos.openwebui = { imports = [ … ]; }
```

### 2.1 `catalog.nix`

```nix
homelab.catalog.openwebui = {
  subdomain = "openwebui";              # -> url = https://openwebui.plato-splunk.media
  host = "augustus";
  backend = { kind = "reverseProxy"; port = 19553; };

  tls = {
    ca = null;                          # shares Caddy's managed cert (no security.acme.certs)
    gate = "oidc";                      # app-gated; NO Caddy-level auth emitted
  };

  access.scope = "tailnet";
  dns.enable = true;                    # emits openwebui A/AAAA -> augustus tailnet IP on aedilis

  oidc = {
    enable = true;
    clientId = "openwebui";
    public = false;                     # basic secret client
    callbackPath = "/oauth/oidc/callback";
    landingPath = "/";
    displayName = "Open WebUI";
    secretRef = "openwebui_client_secret";
    # --- irreducible per-service parts, carried verbatim into the generator ---
    scopeMaps."openwebui.access" = [ "openid" "email" "profile" ];
    claimMaps.roles = {
      joinType = "array";
      valuesByGroup = {
        "openwebui.admins" = [ "admin" ];
        "openwebui.access" = [ "user" ];
      };
    };
  };
};
```

The service-specific OIDC `scopeMaps`/`claimMaps` are the **irreducible per-service parts** and are
carried in the catalog `oidc` field (optionally authored in `oidc.nix` and merged here).

### 2.2 `service.nix`

Keeps everything from §1.4 verbatim — `services.open-webui`, the `openwebui-env` sops template, the
`systemd.services.open-webui.serviceConfig`, `services.restic.backups.openwebui`, and:

```nix
services.failure-notifs.attachServices = [
  "open-webui"
  "restic-backups-openwebui"
];
```

`failure-notifs` stays next to the unit it names (per parent plan §5.1 #2) — never in the catalog.

### 2.3 `complete.nix`

```nix
flake.modules.nixos.openwebui = {
  imports = [
    config.flake.modules.nixos.openwebui-catalog
    config.flake.modules.nixos.openwebui-service
  ];
};
```

`hosts/augustus.nix` continues to import `nixos.openwebui`; importing it both realizes the runtime
and registers the catalog entry, which the (host-imported) caddy / oidc / dns generators then pick
up.

## 3. Operational equivalence argument

### 3.1 Caddy vhost

The caddy generator renders `backend = { kind = "reverseProxy"; port = 19553; }` with `gate =
"oidc"` into:

```caddy
reverse_proxy 127.0.0.1:19553
```

`gate = "oidc"` emits **no** Caddy-level auth (app-gated), so no extra directives appear. `tls.ca =
null` means the generator creates **no** `security.acme.certs` entry — identical to today.

> **Vhost-body note (approved deviation).** The source today emits `reverse_proxy localhost:19553`;
> the shared renderer standardizes on **`127.0.0.1`** (operator-approved — catalog-and-generators
> §7.8 #22, a bugfix for a `localhost` DNS-resolution oddity). So the `--raw` parity gate for openwebui
> shows **exactly** the `localhost → 127.0.0.1` substitution and nothing else — the single approved,
> reviewed diff. Functionally equivalent; `localhost` resolved to `127.0.0.1` anyway.

### 3.2 OIDC client

The oidc generator (augustus only) folds the catalog `oidc` block into
`services.kanidm.provision.systems.oauth2."openwebui"`, deriving:

- `originUrl = "${svc.url}${callbackPath}"` = `https://openwebui.plato-splunk.media/oauth/oidc/callback`
  ✓ (same)
- `originLanding = "${svc.url}${landingPath}"` = `https://openwebui.plato-splunk.media/` ✓
- `displayName = "Open WebUI"` ✓
- `basicSecretFile = config.sops.secrets.openwebui_client_secret.path` (from `secretRef`) ✓
- `scopeMaps` / `claimMaps.roles` passed through **verbatim** ✓

Every attribute matches §1.2 exactly. The sops secret `openwebui_client_secret` still lives in
augustus's sops config; the generator only references it by name.

### 3.3 failure-notifs + runtime

Unchanged — moved file, same `attachServices`, same `services.open-webui`/restic/sops template. No
behavioral delta.

## 4. Parity gate

Before and after the migration, on augustus, these must be **identical**:

```sh
# OIDC client (full attr, JSON)
nix eval --json \
  .#nixosConfigurations.augustus.config.services.kanidm.provision.systems.oauth2.openwebui

# Caddy vhost body (raw string)
nix eval --raw \
  '.#nixosConfigurations.augustus.config.services.caddy.virtualHosts."https://openwebui.plato-splunk.media".extraConfig'
```

Capture both to files pre-migration, re-run post-migration, then `diff`: the **OIDC JSON diff must be
empty**, and the **vhost `--raw` diff must show only the approved `localhost → 127.0.0.1` line**. Also
sanity-check `services.failure-notifs.attachServices` still contains `open-webui` +
`restic-backups-openwebui`.

> **Stage new files first** (`.kiro/steering/validation.md`): `git add features/openwebui/**` before
> any `nix eval`/`nix flake check` — untracked new `.nix` files are invisible to flake evaluation.

## 5. Migration checklist

- [ ] `git add` the new `features/openwebui/` files **before** any Nix eval.
- [ ] Capture pre-migration baselines: `oauth2.openwebui` JSON + vhost `extraConfig` raw.
- [ ] Create `features/openwebui/catalog.nix` with the §2.1 entry (OIDC maps verbatim).
- [ ] Create `features/openwebui/service.nix` from the current runtime (§1.4 + failure-notifs).
- [ ] (Optional) split OIDC maps into `features/openwebui/oidc.nix`.
- [ ] Create `features/openwebui/complete.nix` exporting `flake.modules.nixos.openwebui`.
- [ ] Delete the old `services/openwebui.nix` (vhost + oauth2 now generated).
- [ ] Confirm the caddy vhost-body renderer emits `127.0.0.1:19553` (the approved standardization).
- [ ] `nix run .#nixfmt -- $(git ls-files '*.nix' ':!:repos/**')`.
- [ ] Re-run the §4 parity evals: OIDC JSON diff empty; vhost `--raw` diff = only the
      `localhost → 127.0.0.1` line.
- [ ] `nix flake check` and `nixos-rebuild build --flake .#augustus`.
- [ ] Deploy — near-no-op (only the approved upstream-token change; no behavioral restart).
