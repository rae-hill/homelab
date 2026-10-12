# Technitium Module Refactor Plan — Configurable Module + Provisioning

Status: **IMPLEMENTED** (2026-10-12) — the plan below was carried out. See the implementation note.
Date: 2026-10-12

> **Implementation note (2026-10-12):** The refactor is complete and `aedilis` evaluates cleanly.
> Delivered:
>
> - `features/technitium/` is now generic + option-driven via
>   `services.technitium-server-complete` (`options.nix`, `service.nix`, `provision.nix`,
>   `caddy.nix`, `complete.nix`). `kanidm.nix` stays (augustus-targeted).
> - Removed `acme.nix`, `alloy.nix`, `node-exporter.nix` from the generic feature.
> - New `features/technitium-aedilis/` (`acme.nix`, `observability.nix`, `complete.nix`) wires the
>   aedilis option values + ACME certs, mirroring `cicero-observability`.
> - DoH/DoT/DoQ are Technitium-native (managed LE cert → PKCS#12 by path); the DoH-over-HTTP
>   mechanism is fully removed. Admin UI on Caddy `:8443` (OIDC, no mTLS); metrics on Caddy `:9443`
>   (mTLS). Recursion ACL + `preferIPv6` are options. `dohBackendPort` dropped.
> - `hosts/aedilis.nix` → `nixos.technitium-aedilis`; firewall + `docs/port-assignments.md` updated.
> - Provision script passes shellcheck; augustus scrape auto-updated to `:9443`.

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
- **Caddy listens on `8443` (Tailscale-only)** and reverse-proxies to that internal HTTP port.
  **No mTLS** — the admin UI is already Tailscale-only (firewall) AND OIDC-gated (Kanidm SSO behind
  it), so client-cert gating is redundant. Caddy just terminates TLS (step-ca cert) and proxies.
- `DNS_SERVER_WEB_SERVICE_REVERSE_PROXY_ADDRESSES = "127.0.0.1"` so the console trusts Caddy.
- Technitium's own HTTPS web console (`DNS_SERVER_WEB_SERVICE_ENABLE_HTTPS`) stays **disabled** — TLS
  for the admin UI is Caddy's job.

### Recursion / anti-amplification — CONFIRMED

- Recursion is restricted by **network ACL to the Tailscale interface** (IPv4 CGNAT + IPv6 ULA +
  loopback), via `DNS_SERVER_RECURSION=UseSpecifiedNetworkACL` +
  `DNS_SERVER_RECURSION_NETWORK_ACL`. Technitium's recursion gate is network-based (not
  transport-based), which is the correct model: public clients over **any** transport get
  authoritative-only answers; trusted Tailscale clients get recursion over any transport (plain or
  encrypted). This prevents UDP/53 amplification/reflection abuse from the public internet.
- **Prefer IPv6** for outbound resolution (`DNS_SERVER_PREFER_IPV6=true`). Configurable.
- Recursion ACL and preferIPv6 are **options** (see §4).

### Resulting port map

| Port                      | Bind       | Served by  | Purpose                                         |
| ------------------------- | ---------- | ---------- | ----------------------------------------------- |
| 53 udp/tcp                | public     | Technitium | Plain DNS (authoritative; recursion ACL)        |
| 443                       | public     | Technitium | DoH (native TLS, managed cert)                  |
| 853 tcp                   | public     | Technitium | DoT (native TLS, managed cert)                  |
| 853 udp                   | public     | Technitium | DoQ (native TLS, managed cert)                  |
| 80                        | public     | Caddy      | HTTP-01 ACME challenge (now free — see note)    |
| `webHttpPort` (e.g. 5380) | 127.0.0.1  | Technitium | Web console (plain HTTP, behind Caddy)          |
| 8443                      | tailscale0 | Caddy      | Admin UI (TLS, OIDC) → proxies to `webHttpPort` |
| `metricsPort` (e.g. 9443) | tailscale0 | Caddy      | Metrics (mTLS) → node-exporter + DNS metrics    |

> **Port 80 is now fully Caddy's.** Technitium no longer uses port 80 for anything (plain 53 is
> sufficient for plaintext DNS), so the public Let's Encrypt HTTP-01 challenge can be served
> directly by Caddy on `:80` without any relocation workaround.
>
> **Metrics port** is arbitrary and Tailscale-restricted on both ends (NixOS firewall + your
> Tailscale ACLs). Using `9443` to avoid the `8443` admin-UI port.
>
> **mTLS remains only on the metrics endpoint** (Prometheus has no OIDC), not the admin UI.

---

## 3. Target Feature Layout

```
nix-config/modules/features/
├── technitium/                      # GENERIC, reusable, option-driven
│   ├── options.nix                  # NEW: options schema (services.technitium-server-complete.*)
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
  `services.technitium-server-complete.observability.enable`.

---

## 4. Option Schema (draft — `options.nix`)

Namespace: `services.technitium-server-complete` (avoids clashing with upstream
`services.technitium-dns-server`).

```nix
options.services.technitium-server-complete = {
  enable = mkEnableOption "Homelab Technitium DNS wrapper";

  domain = mkOption { type = str; };
  stateDir = mkOption { type = str; default = "/var/lib/technitium-dns-server"; };
  user = mkOption { type = str; default = "technitium"; };
  group = mkOption { type = str; default = "technitium"; };

  webHttpPort = mkOption { type = port; default = 5380; };   # internal plain-HTTP console

  # --- bootstrap (first-boot env vars) ---
  adminPasswordFile = mkOption { type = path; };
  preferIPv6 = mkOption { type = bool; default = true; };    # DNS_SERVER_PREFER_IPV6
  recursion = {
    mode = mkOption { type = enum [ "Deny" "Allow" "AllowOnlyForPrivateNetworks" "UseSpecifiedNetworkACL" ]; default = "UseSpecifiedNetworkACL"; };
    # Restrict recursion to trusted networks (Tailscale IPv4 CGNAT + IPv6 ULA +
    # loopback). Public clients get authoritative-only answers over ALL transports
    # — this is the anti-amplification control (network-based, not transport-based).
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
    # Admin UI: TLS + reverse-proxy only. NO mTLS (Tailscale-only + OIDC-gated).
    adminDomain = mkOption { type = str; };
    adminPort = mkOption { type = port; default = 8443; };
    adminCertPemFile = mkOption { type = path; };     # step-ca (internal) PEM
    adminCertKeyFile = mkOption { type = path; };
    # Metrics: TLS + mTLS (Prometheus has no OIDC).
    metricsDomain = mkOption { type = str; };
    metricsPort = mkOption { type = port; default = 9443; };
    metricsCertPemFile = mkOption { type = path; };
    metricsCertKeyFile = mkOption { type = path; };
    metricsMtlsTrustPoolFile = mkOption { type = path; };   # root CA for metrics client_auth
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
  `127.0.0.1:${webHttpPort}` (HTTP only), reverse-proxy ACL `127.0.0.1`, recursion mode+ACL,
  `DNS_SERVER_PREFER_IPV6` from `cfg.preferIPv6`, and the OIDC block (conditional on
  `cfg.oidc.enable`).
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
- **Admin UI vhost:** `https://${adminDomain}:${adminPort}` (8443), `tls` with step-ca cert,
  `reverse_proxy 127.0.0.1:${webHttpPort}`. **No `client_auth`/mTLS** — Tailscale-only + OIDC-gated.
- **Metrics vhost:** `https://${metricsDomain}:${metricsPort}` (9443), `tls` with step-ca cert +
  `client_auth` **mTLS** (`metricsMtlsTrustPoolFile`), path-routed to node-exporter (`/metrics`) and
  Technitium DNS metrics (`/api/dashboard/metrics/text`).
- **No public DoH vhost.** The `http://` ACME challenge vhost (port 80) lives in the aedilis ACME
  layer (port 80 is now entirely free — Technitium doesn't use it).
- Adds `caddy` to the technitium group for cert read access.

### `technitium/complete.nix`

- Aggregates `technitium-options`, `technitium-service`, `technitium-provision`, `technitium-caddy`.

### `technitium-aedilis/acme.nix` (NEW)

- Let's Encrypt public cert (`dns.plato-splunk.media`, HTTP-01) + step-ca certs for admin + metrics
  domains, plus the `http://` ACME challenge Caddy vhost on **port 80** (now fully free since
  Technitium no longer uses 80).
- The public DNS cert is consumed by **Technitium** (encrypted DNS), passed in via
  `encryptedDns.certPemFile`/`certKeyFile`. The admin/metrics step-ca certs are consumed by Caddy.

### `technitium-aedilis/observability.nix` (NEW)

- `mkIf cfg.observability.enable` → node-exporter + Alloy (from current `alloy.nix` / `node-exporter.nix`).

### `technitium-aedilis/complete.nix` (NEW)

- `imports = [ inputs.self.modules.nixos.technitium ] ++ [ acme observability ]`.
- Sets all `services.technitium-server-complete.*` values for aedilis (from `config.constants`, sops
  secrets, recursion ACL, OIDC, cert dirs). This concentrates host specifics in one place.

### `technitium-kanidm` (augustus) — unchanged.

### `hosts/aedilis.nix`

- `nixos.technitium` → `nixos.technitium-aedilis`.

---

## 6. `service-registry.nix` changes

- **Remove** `dohBackendPort` (no longer needed — Technitium frees port 80 entirely).
- **Admin UI** on `8443`; **metrics** on a distinct Tailscale-restricted port (`9443`). Update
  `dns-metrics.port`.
- Keep `dnsPort` 53, `dotPort` 853, `dohPort` 443, `webHttpPort` 5380, and the public ACME port + the
  metrics ACME port.
- Update `_private/aedilis/security.nix` firewall:
  - **public:** 53 (tcp+udp), 443, 853 (tcp+udp), **80** (ACME HTTP-01 — now Caddy-owned).
  - **tailscale0:** 22, 8443 (admin), 9443 (metrics), 5252 (TS metrics).
- Update `docs/port-assignments.md`.

---

## 7. Risks / Notes

- **State-dir bootstrap caveat persists** (env vars only on first boot). The provisioner (API-driven)
  reconciles DoT/DoQ/DoH + the metrics user on every run, so it's the reconfigurable path. Moving
  recursion/OIDC into the provisioner (`settings/set`, `api/admin/sso/set`) for full
  reconfigurability is possible but **out of scope** for this refactor unless you want it.
- **Augustus unaffected.** `technitium-kanidm` keeps its name/location.
- **Firewall + port doc** must be updated for the 8443/9443 split and the freed port 80.

---

## 8. Implementation Order

1. `technitium/options.nix` — schema (`services.technitium-server-complete`).
2. Refactor `service.nix`, `provision.nix`, `caddy.nix` → `mkIf cfg.*`, option-driven; drop
   DoH-over-HTTP; drop admin mTLS; add `preferIPv6`.
3. `technitium/complete.nix` — generic aggregate.
4. `technitium-aedilis/{acme,observability,complete}.nix` — aedilis wiring + option values.
5. `hosts/aedilis.nix` → `technitium-aedilis`.
6. `service-registry.nix` — drop `dohBackendPort`; admin 8443 / metrics 9443.
7. Firewall + `docs/port-assignments.md`.
8. Evaluate aedilis + augustus; format; update plan/audit/runbook docs.

---

## 9. Decisions — all CONFIRMED

1. **Metrics port** = `9443` (arbitrary, Tailscale-restricted on both the NixOS firewall and your
   Tailscale ACLs). ✓
2. **ACME HTTP-01** for the public DNS cert served by Caddy on port **80** (now fully free). ✓
3. **Option namespace** = `services.technitium-server-complete`. ✓
4. **No mTLS on admin UI** (Tailscale-only + OIDC). mTLS stays only on the metrics endpoint. ✓
5. **Recursion** restricted by network ACL to the Tailscale interface (IPv4 CGNAT + IPv6 ULA +
   loopback); plain 53 and encrypted transports alike are authoritative-only for public clients. ✓
6. **`preferIPv6` = true**, configurable via options. ✓
7. Recursion/OIDC stay as first-boot env vars (NOT moved into the provisioner) for this pass. ✓
