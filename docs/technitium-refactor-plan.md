# Technitium Module Refactor Plan — Configurable Module + Provisioning

Status: **planning** (nothing implemented yet)
Date: 2026-10-12

## Goal

Refactor the `technitium` feature from an aedilis-specific bundle into a **generic, reusable,
option-driven** NixOS module, and split the aedilis-specific wiring into a new `technitium-aedilis`
feature (mirroring the `cicero-observability` pattern). Simplify the provisioning script by dropping
the DoH-over-HTTP-behind-Caddy mechanism, and make provisioning behavior configurable via Nix
options.

---

## 1. Scope of Changes

1. **Drop the DoH-over-HTTP reverse-proxy mechanism.** Serve **plain DNS on 53** directly and let
   Technitium **natively terminate** the encrypted forms (DoH 443, DoT 853, DoQ 853/udp). Removes
   the port-80 collision workaround and most of the provision script's complexity.
2. **Make the module configurable with Nix options** — a dedicated `options.nix` module.
3. **Consolidate** the service + provisioner into one option-driven feature, with provisioning
   behavior toggled by options (`provisionDoTDoQCert`, `provisionMetricsUser`, TOTP, etc.).
4. **Decouple ACME from the provisioner** — cert inputs are passed in as file/dir paths.
5. **New `technitium-aedilis` feature** that consumes the generic `technitium` module, supplies the
   ACME config + aedilis specifics, conditionally includes observability, and exposes its own
   `complete` referencing the `technitium` `complete`.

---

## 2. Encrypted DNS termination model — CONFIRMED

**Decided (2026-10-12):** Technitium **natively terminates all encrypted DNS** (DoH, DoT, DoQ)
using a TLS cert **we manage** via NixOS `security.acme` (Let's Encrypt for the public
`dns.plato-splunk.media`) and **pass to Technitium as file/dir paths** (converted to PKCS#12).
Technitium does NOT run its own ACME.

- **Plain DNS:** `53/udp + 53/tcp`, Technitium directly (authoritative-only, recursion ACL-gated).
- **DoT `853/tcp`, DoQ `853/udp`, DoH `443`:** Technitium terminates TLS itself using the managed
  PKCS#12 cert (`dnsTlsCertificatePath`/`dnsTlsCertificatePassword` via `settings/set`).
- **No DoH-over-HTTP-behind-Caddy.** The `DNS_SERVER_OPTIONAL_PROTOCOL_DNS_OVER_HTTP` env var, the
  `dnsOverHttpPort` relocation, and the DoH reverse-proxy ACL are all **removed**.

### Admin UI — CONFIRMED

- Technitium web console listens over **plain HTTP on an internal loopback port**
  (`DNS_SERVER_WEB_SERVICE_HTTP_PORT`, bound to `127.0.0.1`).
- **Caddy listens on `8443` (Tailscale-only)** and reverse-proxies to that internal HTTP port, with
  **mTLS client-cert gating**. OIDC/SSO (Kanidm) runs behind this for interactive login.
- `DNS_SERVER_WEB_SERVICE_REVERSE_PROXY_ADDRESSES = "127.0.0.1"` so the console trusts Caddy.
- Technitium's own HTTPS web console (`DNS_SERVER_WEB_SERVICE_ENABLE_HTTPS`) stays **disabled** — TLS
  for the admin UI is Caddy's job.

### Resulting port map

| Port                                   | Bind       | Served by  | Purpose                                      |
| -------------------------------------- | ---------- | ---------- | -------------------------------------------- |
| 53 udp/tcp                             | public     | Technitium | Plain authoritative DNS                      |
| 443                                    | public     | Technitium | DoH (native TLS, managed cert)               |
| 853 tcp                                | public     | Technitium | DoT (native TLS, managed cert)               |
| 853 udp                                | public     | Technitium | DoQ (native TLS, managed cert)               |
| `webHttpPort` (e.g. 5380)              | 127.0.0.1  | Technitium | Web console (plain HTTP, behind Caddy)       |
| 8443                                   | tailscale0 | Caddy      | Admin UI (mTLS) → proxies to `webHttpPort`   |
| `metricsPort` (pick ≠ 8443, e.g. 9443) | tailscale0 | Caddy      | Metrics (mTLS) → node-exporter + DNS metrics |

> **Port collision:** the metrics vhost currently uses `8443`. Since the admin UI now takes `8443`,
> move the metrics endpoint to a distinct port (e.g. `9443`) in `service-registry.nix` — see §6.

---

## 3. Target Feature Layout

```
nix-config/modules/features/
├── technitium/                      # GENERIC, reusable, option-driven
│   ├── options.nix                  # NEW: options schema (services.technitium-homelab.*)
│   ├── service.nix                  # Technitium service + env bootstrap, driven by options
│   ├── provision.nix                # Provisioner, driven by options (cert paths passed in)
│   ├── caddy.nix                    # Admin UI + metrics vhosts, gated by options
│   └── complete.nix                 # aggregates the generic modules
└── technitium-aedilis/              # NEW: aedilis-specific wiring (like cicero-observability)
    ├── acme.nix                     # Let's Encrypt (public DNS cert) + step-ca (metrics cert)
    ├── observability.nix            # alloy + node-exporter (conditional on options)
    └── complete.nix                 # imports technitium.complete + aedilis layers + option values
```

Notes:

- `kanidm.nix` (`technitium-kanidm`) targets **augustus** (the Kanidm host), NOT aedilis. It stays
  as its own module imported by augustus — it does **not** move under `technitium-aedilis`.
- `alloy.nix` + `node-exporter.nix` fold into `technitium-aedilis/observability.nix`, gated by
  `services.technitium-homelab.observability.enable`.

---

## 4. Option Schema (draft — `options.nix`)

Namespace: `services.technitium-homelab` (avoids clashing with upstream
`services.technitium-dns-server`).

```nix
options.services.technitium-homelab = {
  enable = mkEnableOption "Homelab Technitium DNS wrapper";

  domain = mkOption { type = str; };
  stateDir = mkOption { type = str; default = "/var/lib/technitium-dns-server"; };
  user = mkOption { type = str; default = "technitium"; };
  group = mkOption { type = str; default = "technitium"; };

  webHttpPort = mkOption { type = port; default = 5380; };   # internal plain-HTTP console

  # --- bootstrap (first-boot env vars) ---
  adminPasswordFile = mkOption { type = path; };
  recursion = {
    mode = mkOption { type = enum [ "Deny" "Allow" "AllowOnlyForPrivateNetworks" "UseSpecifiedNetworkACL" ]; default = "UseSpecifiedNetworkACL"; };
    networkACL = mkOption { type = listOf str; default = [ ]; };   # joined to CSV
  };

  # --- OIDC/SSO (optional) ---
  oidc = {
    enable = mkEnableOption "Kanidm OIDC SSO for the admin UI";
    authority = mkOption { type = str; };
    clientId = mkOption { type = str; };
    clientSecretFile = mkOption { type = path; };
    scopes = mkOption { type = listOf str; default = [ "openid" "profile" "email" ]; };
    groupMap = mkOption { type = attrsOf str; default = { }; };    # remote:local
    allowSignup = mkOption { type = bool; default = true; };
    allowSignupOnlyForMappedUsers = mkOption { type = bool; default = true; };
  };

  # --- encrypted DNS (DoH/DoT/DoQ), Technitium-native termination ---
  encryptedDns = {
    enable = mkEnableOption "DoH/DoT/DoQ (Technitium-native TLS termination)";
    # Cert inputs passed in (DECOUPLED from ACME):
    certPemFile = mkOption { type = path; };          # fullchain.pem
    certKeyFile = mkOption { type = path; };          # key.pem
    pkcs12PasswordFile = mkOption { type = path; };   # password for the generated .pfx
    dohPort = mkOption { type = port; default = 443; };
    dotPort = mkOption { type = port; default = 853; };
    doqPort = mkOption { type = port; default = 853; };
  };

  # --- provisioning toggles ---
  provision = {
    enable = mkOption { type = bool; default = true; };
    adminPasswordFile = mkOption { type = path; };    # for API login during provisioning
    provisionDoTDoQCert = mkOption { type = bool; default = cfg.encryptedDns.enable; };
    metricsUser = {
      enable = mkEnableOption "limited Dashboard-view metrics user";
      username = mkOption { type = str; default = "prometheus"; };
      passwordFile = mkOption { type = path; };
      sessionTimeoutSeconds = mkOption { type = int; default = 3600; };
      totp = {
        enable = mkOption { type = bool; default = true; };
        seedOutputPath = mkOption { type = str; default = "${cfg.stateDir}/metrics-totp-seed"; };
      };
    };
  };

  # --- optional Caddy fronting (admin UI + metrics) ---
  caddy = {
    enable = mkEnableOption "Caddy vhosts for admin UI + metrics";
    adminDomain = mkOption { type = str; };
    adminPort = mkOption { type = port; default = 8443; };
    adminCertPemFile = mkOption { type = path; };     # step-ca (internal) PEM
    adminCertKeyFile = mkOption { type = path; };
    metricsDomain = mkOption { type = str; };
    metricsPort = mkOption { type = port; default = 9443; };
    metricsCertPemFile = mkOption { type = path; };
    metricsCertKeyFile = mkOption { type = path; };
    mtlsTrustPoolFile = mkOption { type = path; };    # root CA for client_auth
    nodeExporterPort = mkOption { type = port; default = 9100; };
  };

  # --- observability (conditional) ---
  observability = {
    enable = mkEnableOption "node-exporter + Alloy log shipping";
    nodeExporterPort = mkOption { type = port; default = 9100; };
    lokiPushUrl = mkOption { type = str; };
    lokiClientCertPemFile = mkOption { type = path; };
    lokiClientCertKeyFile = mkOption { type = path; };
    lokiCaFile = mkOption { type = path; };
    alloyPort = mkOption { type = port; default = 12345; };
  };
};
```

Design decisions (recommendations):

- **Cert inputs are file paths, not `security.acme.certs` references** — the decoupling. The aedilis
  layer passes `config.security.acme.certs."dns...".directory + "/fullchain.pem"`; the generic
  module never mentions ACME.
- **TOTP seed is server-generated** by `2fa/init`; the module _outputs_ it to `seedOutputPath` for
  out-of-band transfer to augustus (runbook step 7). We do not inject a seed.
- **Metrics token = expiring session login** (via the augustus oneshot). No non-expiring API-token
  option exposed (security). Flag if you want one anyway.

---

## 5. Module Responsibilities After Refactor

### `technitium/options.nix` (NEW)

Pure option declarations. No config.

### `technitium/service.nix`

- `config = mkIf cfg.enable { ... }`.
- Upstream `services.technitium-dns-server` + static user/group + `CAP_NET_BIND_SERVICE` (unchanged).
- Env bootstrap built **from options**: domain, admin password file, web console on
  `127.0.0.1:${webHttpPort}` (HTTP only), reverse-proxy ACL `127.0.0.1`, recursion mode+ACL, and the
  OIDC block (conditional on `cfg.oidc.enable`).
- **Removed:** all DoH-over-HTTP env vars.

### `technitium/provision.nix`

- `config = mkIf (cfg.enable && cfg.provision.enable) { ... }`.
- Script built from options; **no `security.acme` references**.
- Sections gated by options:
  - **DoT/DoQ/DoH cert** (if `provisionDoTDoQCert`): convert `certPemFile`+`certKeyFile` → PKCS#12
    (password from `pkcs12PasswordFile`), then `settings/set` with
    `enableDnsOverTls/Quic/Https=true`, the three ports, `dnsTlsCertificatePath` + password.
  - **Metrics user** (if `metricsUser.enable`): create `metrics-readonly` group, grant Dashboard
    view-only, create the user, restrict membership + `sessionTimeoutSeconds`; optional TOTP
    `init→enable→persist seed`.
- **Dropped:** the entire `dnsOverHttpPort` relocation + reverse-proxy ACL step.
- Keep fail-fast error handling (status + errorMessage checks on every call).

### `technitium/caddy.nix`

- `config = mkIf cfg.caddy.enable { ... }`.
- **Admin UI vhost:** `https://${adminDomain}:${adminPort}` (8443), `tls` with step-ca cert +
  `client_auth` mTLS, `reverse_proxy 127.0.0.1:${webHttpPort}`.
- **Metrics vhost:** `https://${metricsDomain}:${metricsPort}` (9443), mTLS, path-routed to
  node-exporter (`/metrics`) and Technitium DNS metrics (`/api/dashboard/metrics/text`).
- **No public DoH vhost.** The `http://` ACME challenge vhosts move to the aedilis ACME layer.
- Adds `caddy` to the technitium group for cert read access.

### `technitium/complete.nix`

- Aggregates `technitium-options`, `technitium-service`, `technitium-provision`, `technitium-caddy`.

### `technitium-aedilis/acme.nix` (NEW)

- Let's Encrypt public cert (`dns.plato-splunk.media`, HTTP-01) + step-ca certs for admin + metrics
  domains, plus the `http://` ACME challenge Caddy vhosts.
- Note: with the public DNS cert used by Technitium (not Caddy), the HTTP-01 challenge still needs
  port 80. **Decision:** keep a minimal Caddy `http://dns...` challenge vhost here, OR use the acme
  module's own `listenHTTP` on a loopback port fronted by a tiny Caddy :80 vhost (current pattern).

### `technitium-aedilis/observability.nix` (NEW)

- `mkIf cfg.observability.enable` → node-exporter + Alloy (from current `alloy.nix` / `node-exporter.nix`).

### `technitium-aedilis/complete.nix` (NEW)

- `imports = [ inputs.self.modules.nixos.technitium ] ++ [ acme observability ]`.
- Sets all `services.technitium-homelab.*` values for aedilis (from `config.constants`, sops
  secrets, recursion ACL, OIDC, cert dirs). This concentrates host specifics in one place.

### `technitium-kanidm` (augustus) — unchanged.

### `hosts/aedilis.nix`

- `nixos.technitium` → `nixos.technitium-aedilis`.

---

## 6. `service-registry.nix` changes

- **Remove** `dohBackendPort` (no longer needed).
- **Admin UI** on `8443`; **metrics** moves to a distinct port (e.g. `9443`) to avoid colliding with
  the admin UI. Update `dns-metrics.port`.
- Keep `dnsPort` 53, `dotPort` 853, `dohPort` 443, `webHttpPort` 5380, `acmePort` (public), and the
  metrics `acmePort`.
- Update `_private/aedilis/security.nix` firewall (tailscale0: 22, 8443 admin, 9443 metrics, 5252)
  and `docs/port-assignments.md`.

---

## 7. Risks / Notes

- **State-dir bootstrap caveat persists** (env vars only on first boot). The provisioner (API-driven)
  reconciles DoT/DoQ/DoH + the metrics user on every run, so it's the reconfigurable path. Moving
  recursion/OIDC into the provisioner (`settings/set`, `api/admin/sso/set`) for full
  reconfigurability is possible but **out of scope** for this refactor unless you want it.
- **Augustus unaffected.** `technitium-kanidm` keeps its name/location.
- **Firewall + port doc** must be updated for the 8443/9443 split.

---

## 8. Implementation Order

1. `technitium/options.nix` — schema.
2. Refactor `service.nix`, `provision.nix`, `caddy.nix` → `mkIf cfg.*`, option-driven; drop DoH-over-HTTP.
3. `technitium/complete.nix` — generic aggregate.
4. `technitium-aedilis/{acme,observability,complete}.nix` — aedilis wiring + option values.
5. `hosts/aedilis.nix` → `technitium-aedilis`.
6. `service-registry.nix` — drop `dohBackendPort`; admin 8443 / metrics 9443.
7. Firewall + `docs/port-assignments.md`.
8. Evaluate aedilis + augustus; format; update plan/audit/runbook docs.

---

## 9. Remaining Minor Decisions

1. **Metrics port** when admin UI takes 8443 — recommend `9443`. (OK?)
2. **ACME HTTP-01 challenge serving** for the public DNS cert — keep a minimal Caddy `:80` challenge
   vhost in the aedilis ACME layer (recommended), vs the acme module's own listener. (OK?)
3. **Option namespace** `services.technitium-homelab` — acceptable?
4. Defer moving recursion/OIDC into the provisioner (recommended defer). (OK?)
