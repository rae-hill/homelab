# technitium-caddy — Admin UI + mTLS Path-Allowlist Metrics Vhosts (HIGH complexity)

Status: **PROPOSED**
Date: 2026-10-22
Parent: [../service-consolidation-plan.md](../service-consolidation-plan.md) ·
Index: [./README.md](./README.md) ·
Keystone: [./catalog-and-generators.md](./catalog-and-generators.md) ·
mTLS/escape-hatch reference: [./kanidm.md](./kanidm.md) ·
Companion (certs/firewall): [./technitium-aedilis.md](./technitium-aedilis.md)

> **This is the canonical `mtls+allowlist` Caddy vhost case.** `technitium/caddy.nix` emits two HTTPS
> vhosts for aedilis's Technitium: an **admin UI** vhost (`https://dns-admin:8443`, OIDC-gated by
> Technitium itself — not Caddy — with no mTLS), and a **metrics** vhost (`https://dns-metrics:9443`)
> that terminates **mutual TLS** (`client_auth require_and_verify`) **and** enforces a **path
> allowlist** (`@node /metrics`, `@dns /api/dashboard/metrics/text`, `@login /api/user/login`, else
> `respond 404`). The allowlist is the one case the keystone `gate.mtlsAllowlist` variant + the
> `extraCaddyConfig` escape hatch were designed for. This plan owns the two HTTPS vhost **bodies**
> (concern **V**, incl. mTLS + allowlist); the **certs + challenge vhosts + firewall openings** for
> these same names are the companion plan [./technitium-aedilis.md](./technitium-aedilis.md).
>
> Like the companion, this is **already option-driven** via `services.technitium-server-complete.caddy.*`.
> The reconciliation question — feed the options or replace the Caddy pieces — is answered in §2/§8:
> **replace the hand-rolled vhost bodies with catalog → caddy generator, feeding the option values
> (ports/cert paths/trust pool) into the catalog entry; leave the Technitium option module's
> _production_ of those values untouched.**
>
> **Operational-equivalence contract (from [./README.md](./README.md)):** deploying this revision
> MUST be a theoretical no-op. For technitium-caddy there are **zero** permitted intentional
> deviations — both vhost bodies (keys, the explicit `tls`, the mTLS `client_auth` block, the four
> `@matcher`/`handle` blocks, the `respond 404`) and `users.groups.<certGroup>.members = [ "caddy" ]`
> must render byte-identical.

---

## 0. Why technitium-caddy is the `mtls+allowlist` exemplar

Every other vhost in the fleet is either a plain `reverse_proxy` (it-tools, planka — shared Caddy
cert), a static `file_server` (homelab-ui), an explicit-cert reverse-proxy (kanidm), or a plain mTLS
proxy. technitium-caddy's **metrics** vhost is the only one that layers **three** gates at once:

1. **Explicit step-ca cert** (`tls <pem> <key>`) — the dedicated-cert-group cert from the companion
   plan, named in the vhost (not Caddy-managed).
2. **Mutual TLS** (`client_auth { mode require_and_verify; trust_pool file { pem_file <root> } }`) —
   Prometheus has no OIDC, so the client cert is the only authN gate.
3. **A path allowlist** — only three exact paths are proxied (`/metrics` → node_exporter,
   `/api/dashboard/metrics/text` → Technitium web console, `/api/user/login` → Technitium web console
   for the scrape-token mint), and **everything else returns `404`**. This is a deliberately tight
   allowlist: mTLS is the only gate in front of these paths, and the `/api/user/login` endpoint must
   be allowlisted or augustus's `technitium-metrics-token` oneshot fails to mint the scrape token
   (leaving the DNS metrics target DOWN).

The **admin** vhost, by contrast, is the simpler explicit-cert reverse-proxy (no mTLS — Tailscale +
Technitium's own OIDC gate it), structurally like kanidm's main vhost but without the bespoke
HTTPS-upstream transport. If the catalog + caddy generator reproduce the tight allowlist (via the
`extraCaddyConfig` escape hatch) and the explicit-cert admin proxy byte-for-byte, the
`mtls+allowlist` case is proven.

> **Reconciliation note.** `technitium/caddy.nix` is the **generic** Technitium feature's Caddy
> module (not aedilis-specific), guarded by `mkIf (cfg.enable && cfg.caddy.enable)`. It reads **only**
> `services.technitium-server-complete.caddy.*` option values (domains, ports, cert paths, trust pool,
> node-exporter port) + `cfg.webHttpPort` + `cfg.certGroup`. Those option values are **set** by the
> aedilis `complete.nix` `aedilisConfig` module (from constants + the ACME cert directories). The
> migration must keep that split: the catalog entry **feeds** the same resolved values into the caddy
> generator (so the vhost body is byte-identical), while the Technitium option module keeps
> **producing** those values. See §2 / §8.

---

## 1. Current state — emitted output captured verbatim

### 1.1 The module today — `nix-config/modules/features/technitium/caddy.nix`

`flake.modules.nixos.technitium-caddy`, guarded by `mkIf (cfg.enable && cfg.caddy.enable)` where
`cfg = config.services.technitium-server-complete`:

```nix
config = mkIf (cfg.enable && cfg.caddy.enable) {
  services.caddy = {
    enable = true;
    # Every vhost names its cert explicitly; the global default issuer is unused.
    useInternalCA = true;
  };

  # Admin UI (Tailscale-only via firewall, OIDC-gated by Technitium). No mTLS.
  services.caddy.virtualHosts."https://${cfg.caddy.adminDomain}:${toString cfg.caddy.adminPort}" = {
    extraConfig = ''
      tls ${cfg.caddy.adminCertPemFile} ${cfg.caddy.adminCertKeyFile}
      reverse_proxy 127.0.0.1:${toString cfg.webHttpPort}
    '';
  };

  # Metrics endpoint (Tailscale-only, mTLS). node_exporter at /metrics, Technitium DNS
  # metrics at /api/dashboard/metrics/text; everything else denied.
  services.caddy.virtualHosts."https://${cfg.caddy.metricsDomain}:${toString cfg.caddy.metricsPort}" = {
    extraConfig = ''
      tls ${cfg.caddy.metricsCertPemFile} ${cfg.caddy.metricsCertKeyFile} {
        client_auth {
          mode require_and_verify
          trust_pool file {
            pem_file ${cfg.caddy.metricsMtlsTrustPoolFile}
          }
        }
      }

      @node path /metrics
      handle @node {
        reverse_proxy 127.0.0.1:${toString cfg.caddy.nodeExporterPort}
      }

      @dns path /api/dashboard/metrics/text
      handle @dns {
        reverse_proxy 127.0.0.1:${toString cfg.webHttpPort}
      }

      # The scrape token is minted by augustus's technitium-metrics-token oneshot
      # via POST /api/user/login over this same mTLS vhost ...
      @login path /api/user/login
      handle @login {
        reverse_proxy 127.0.0.1:${toString cfg.webHttpPort}
      }

      handle {
        respond 404
      }
    '';
  };

  # Caddy needs read access to the admin + metrics ACME certs (owned by the
  # dedicated cert group) — NOT the service group or any secrets.
  users.groups.${cfg.certGroup}.members = [ "caddy" ];
};
```

### 1.2 Option values it reads (set by aedilis `complete.nix`)

From the companion plan's `aedilisConfig` (`services.technitium-server-complete.caddy` +
`cfg.webHttpPort` + `cfg.certGroup`), resolved from constants + ACME cert directories:

| Option                               | Resolved value                                               |
| ------------------------------------ | ------------------------------------------------------------ |
| `cfg.caddy.adminDomain`              | `dns-admin.plato-splunk.media`                               |
| `cfg.caddy.adminPort`                | `8443`                                                       |
| `cfg.caddy.adminCertPemFile`         | `/var/lib/acme/dns-admin.plato-splunk.media/fullchain.pem`   |
| `cfg.caddy.adminCertKeyFile`         | `/var/lib/acme/dns-admin.plato-splunk.media/key.pem`         |
| `cfg.caddy.metricsDomain`            | `dns-metrics.plato-splunk.media`                             |
| `cfg.caddy.metricsPort`              | `9443`                                                       |
| `cfg.caddy.metricsCertPemFile`       | `/var/lib/acme/dns-metrics.plato-splunk.media/fullchain.pem` |
| `cfg.caddy.metricsCertKeyFile`       | `/var/lib/acme/dns-metrics.plato-splunk.media/key.pem`       |
| `cfg.caddy.metricsMtlsTrustPoolFile` | `c.ca.rootCert` (`…certs/alford-root.crt`)                   |
| `cfg.caddy.nodeExporterPort`         | `9100`                                                       |
| `cfg.webHttpPort`                    | `5380` (loopback Technitium web console)                     |
| `cfg.certGroup`                      | the dedicated cert group (Caddy member)                      |

### 1.3 The resolved admin vhost — captured verbatim

Key: `https://dns-admin.plato-splunk.media:8443`. Body (byte-for-byte, trailing newline):

```
tls /var/lib/acme/dns-admin.plato-splunk.media/fullchain.pem /var/lib/acme/dns-admin.plato-splunk.media/key.pem
reverse_proxy 127.0.0.1:5380
```

- **Explicit `tls <pem> <key>`** — names the step-ca admin cert (from the companion plan), not a
  Caddy-managed cert. (`useInternalCA = true` is set, but each vhost names its own cert, so the global
  issuer is unused — a reconciliation detail, §3.3.)
- **No mTLS, no allowlist** — Tailscale (firewall `8443` on `tailscale0`) + Technitium's own OIDC gate
  it. Plain `reverse_proxy` to the loopback web console on `5380`.
- Note the upstream token is `127.0.0.1` (not `localhost`).

### 1.4 The resolved metrics vhost — captured verbatim

Key: `https://dns-metrics.plato-splunk.media:9443`. Body (byte-for-byte, trailing newline):

```
tls /var/lib/acme/dns-metrics.plato-splunk.media/fullchain.pem /var/lib/acme/dns-metrics.plato-splunk.media/key.pem {
  client_auth {
    mode require_and_verify
    trust_pool file {
      pem_file /nix/store/…-alford-root.crt
    }
  }
}

@node path /metrics
handle @node {
  reverse_proxy 127.0.0.1:9100
}

@dns path /api/dashboard/metrics/text
handle @dns {
  reverse_proxy 127.0.0.1:5380
}

@login path /api/user/login
handle @login {
  reverse_proxy 127.0.0.1:5380
}

handle {
  respond 404
}
```

(The `pem_file` is the Nix-store path of `c.ca.rootCert`; the comment block before `@login` in the
source is a Nix `#` comment and is **not** part of the rendered Caddyfile string.) Three load-bearing
properties:

1. **Explicit cert + mTLS `client_auth`.** `tls <pem> <key> { client_auth { mode require_and_verify;
   trust_pool file { pem_file <root> } } }`. Prometheus presents a client cert signed by the internal
   root; no cert ⇒ connection rejected.
2. **Tight path allowlist.** Exactly three `@matcher` + `handle` pairs — `/metrics` → node_exporter
   (`9100`), `/api/dashboard/metrics/text` → web console (`5380`), `/api/user/login` → web console
   (`5380`) — then a catch-all `handle { respond 404 }`. Any other path is `404`.
3. **The `/api/user/login` allowlist entry is load-bearing.** augustus's `technitium-metrics-token`
   oneshot `POST`s to `/api/user/login` over this mTLS vhost to mint the scrape token; if it is not
   allowlisted, Caddy returns `404`, the token mint fails ("login request failed"), and the DNS
   metrics scrape target goes DOWN. The allowlist is intentionally tight — only the login endpoint,
   not all of `/api/*` — because mTLS is the sole gate in front of it.

### 1.5 Cert-group membership — captured verbatim

```nix
users.groups.${cfg.certGroup}.members = [ "caddy" ];
```

Caddy joins the **dedicated cert group** (`cfg.certGroup`) so it can read the admin + metrics ACME
certs. **Not** the service group, and **not** any secret. (Contrast kanidm, where the cert group
`idm` also includes `kanidm`; here only `caddy` reads the admin/metrics certs — Alloy reads the
metrics cert too, but Alloy's membership is wired in the observability layer, not here.)

### 1.6 `services.caddy.enable` + `useInternalCA`

```nix
services.caddy = { enable = true; useInternalCA = true; };
```

Both are host/feature-level Caddy settings (not per-vhost). `useInternalCA = true` sets the global
ACME issuer to the internal step-ca, but since **every** vhost names its cert explicitly, the global
issuer is unused — a reconciliation detail the migration must preserve verbatim (§3.3).

### 1.7 Firewall + certs — owned by the companion plan

The `8443`/`9443` vhost-port firewall openings and the `22483`/`22481` challenge-port openings, plus
the three `security.acme.certs.*` blocks and the three `http://` challenge vhosts, are all owned by
[./technitium-aedilis.md](./technitium-aedilis.md). This plan reads the certs (by path) and the ports
(by number) but does **not** emit them.

### 1.8 Properties to preserve (invariants checklist)

- **Admin vhost** key `https://dns-admin.plato-splunk.media:8443`, body = `tls <adminPem> <adminKey>`
  - `reverse_proxy 127.0.0.1:5380`, single trailing newline.
- **Metrics vhost** key `https://dns-metrics.plato-splunk.media:9443`, body = explicit `tls` + mTLS
  `client_auth` block + the three `@node`/`@dns`/`@login` matcher/handle pairs + `handle { respond
  404 }`, single trailing newline, exact ordering.
- **Cert paths** `/var/lib/acme/{dns-admin,dns-metrics}.plato-splunk.media/{fullchain,key}.pem`,
  trust pool `c.ca.rootCert`, upstream ports `9100`/`5380` — all byte-identical.
- **`users.groups.<certGroup>.members = [ "caddy" ]`** unchanged.
- **`services.caddy.enable = true`, `useInternalCA = true`** unchanged.
- **No firewall/cert/challenge/DNS** emitted here (companion + dns-records plans own those).

---

## 2. Target state — feed option values into the caddy generator; leave the option module producing them (RECOMMENDATION)

As with the companion, two shapes; the first is recommended:

- **(RECOMMENDED) Catalog feeds the caddy generator for the two vhost bodies; the Technitium option
  module keeps producing the values.** The two catalog entries `technitium-admin` /
  `technitium-metrics` (the **same** entries defined in the companion plan
  [./technitium-aedilis.md](./technitium-aedilis.md) §2.1) gain `managedBy.caddy = true` and the
  fields needed to render the body: `backend` (upstream port), `tls.gate` (`oidc` for admin,
  `mtlsAllowlist` for metrics), `tls.gate.mtlsAllowlist.trustPoolFile`, and `extraCaddyConfig` for the metrics
  allowlist. The caddy generator reads the ACME cert directory (created by the acme generator in the
  companion plan) to render the explicit `tls <pem> <key>` line — exactly as the keystone renderer
  does for kanidm. `technitium/caddy.nix`'s two `services.caddy.virtualHosts` blocks are deleted; the
  `services.caddy.enable`/`useInternalCA` and `users.groups.<certGroup>.members` lines are preserved
  (moved into the feature, §2.3).
- **(NOT recommended) Keep the option-driven `technitium/caddy.nix` as-is and not migrate.** Valid,
  but leaves the two most bespoke vhosts outside the catalog, defeating the consolidation for the
  hardest Caddy case. The point of the exercise is to prove `mtls+allowlist` fits the catalog. Migrate.

> **Why this reconciliation.** The vhost **bodies** are cross-cutting Caddy config — exactly the caddy
> generator's job — so they move to the catalog + `extraCaddyConfig`. The **values** they interpolate
> (ports, cert paths, trust pool) are still **produced** by the Technitium option module; the catalog
> entry reads them (via `config.services.technitium-server-complete.caddy.*` and the ACME cert
> directory) so there is a single source of truth and the rendered body is byte-identical. This is the
> same "feed, don't duplicate" split as the companion plan.

### 2.1 Catalog entries — shared with the companion plan, `managedBy.caddy` added

The `technitium-admin` and `technitium-metrics` entries are defined once (companion plan §2.1). This
plan **adds the Caddy-body fields** to those same entries and flips `managedBy.caddy = true`:

```nix
# features/technitium-aedilis/catalog.nix — the Caddy-relevant fields (companion plan owns
# the cert/challenge/firewall fields on the SAME entries).
{ config, ... }:
let
  c = config.constants;
  tech = c.services.technitium;        # adminDomain=dns-admin, adminPort=8443, webHttpPort=5380
  dnsMetrics = c.services.dns-metrics; # domain=dns-metrics, port=9443, nodeExporterPort=9100
in
{
  flake.modules.nixos.technitium-aedilis-catalog =
    { config, ... }:
    let
      ttc = config.services.technitium-server-complete;
    in
    {
      # ---- ADMIN UI vhost (https://dns-admin:8443) — explicit cert, OIDC-gated by app, no mTLS ----
      homelab.catalog.technitium-admin = {
        subdomain = "dns-admin";
        host = "aedilis";
        listenPort = tech.adminPort;                 # 8443 -> vhost key gets :8443 suffix
        backend.reverseProxy.port = tech.webHttpPort;  # 127.0.0.1:5380
        tls = {
          cert.own.ca = "internal";                  # explicit step-ca cert named in the vhost
          # … companion plan's own.acmePort/certGroup/reloadServices/challenge (not repeated here) …
          gate.oidc = { };                           # OIDC handled by Technitium, NOT Caddy -> no Caddy auth
          # upstream token is 127.0.0.1 (the renderer's global default — §7.8 #22; matches source).
        };
        access.scope.tailnet = { };
        # managedBy.caddy = true;  (flipped on in this plan's migration step)
      };

      # ---- METRICS vhost (https://dns-metrics:9443) — explicit cert + mTLS + path allowlist ----
      homelab.catalog.technitium-metrics = {
        subdomain = "dns-metrics";
        host = "aedilis";
        listenPort = dnsMetrics.port;                # 9443
        backend.reverseProxy.port = dnsMetrics.nodeExporterPort;  # 127.0.0.1:9100 (@node)
        tls = {
          cert.own.ca = "internal";
          gate.mtlsAllowlist.trustPoolFile = c.ca.rootCert; # mTLS client_auth + the path allowlist below
          # … companion plan's own.acmePort/certGroup/reloadServices/challenge …
        };
        access.scope.tailnet = { };
        # The path allowlist is bespoke -> escape hatch. The @node handle is the "backend"
        # (/metrics -> nodeExporterPort), but @dns/@login proxy a DIFFERENT upstream (webHttpPort),
        # and the catch-all is `respond 404`. The whole allowlist is supplied verbatim so it is
        # byte-exact; see §3.2 / §7 gap (G) for how the generator composes cert + mtls + this body.
        extraCaddyConfig = ''
          @node path /metrics
          handle @node {
            reverse_proxy 127.0.0.1:${toString dnsMetrics.nodeExporterPort}
          }

          @dns path /api/dashboard/metrics/text
          handle @dns {
            reverse_proxy 127.0.0.1:${toString tech.webHttpPort}
          }

          @login path /api/user/login
          handle @login {
            reverse_proxy 127.0.0.1:${toString tech.webHttpPort}
          }

          handle {
            respond 404
          }
        '';
        # managedBy.caddy = true;  (flipped on in this plan's migration step)
      };
    };
}
```

> The `tls.cert.own.acmePort`, `tls.cert.own.certGroup`, `tls.cert.own.reloadServices`, and
> `tls.cert.own.challenge` fields on these two entries are defined by the companion plan (which owns
> cert/challenge/firewall). This plan only adds `backend`, `tls.gate`,
> `tls.gate.mtlsAllowlist.trustPoolFile`, `extraCaddyConfig`, and flips `managedBy.caddy`.
> Both plans contribute to the **same** two entries — no duplication of the shared facts.

### 2.2 What the caddy generator must render

The keystone caddy generator (catalog-and-generators §3.2) for `host == aedilis && managedBy.caddy`,
reading `certDir = config.security.acme.certs.<fqdn>.directory` (created by the companion plan's acme
generator), must render the shared vhost body (`renderVhostBody`, keystone §3.1):

- **Admin** (`gate.oidc`, `backend.reverseProxy`): the renderer emits `plainTlsLine`
  (explicit `tls <fullchain> <key>` from `certDir`) then `backendBlock` (`reverse_proxy
  127.0.0.1:5380`). `gate.oidc` adds **no** Caddy auth (app-handled — keystone §3.1). Vhost key
  gets the `:8443` suffix because `listenPort != 443` (keystone §3.2). Byte-exact to §1.3 —
  **conditional on the upstream token being `127.0.0.1`** (gap F; keystone default is `localhost` for
  reverse-proxy, which would diverge).
- **Metrics** (`gate.mtlsAllowlist`): the renderer emits `mtlsTlsLine` (explicit `tls <fullchain>
  <key> { client_auth { mode require_and_verify; trust_pool file { pem_file <trustPoolFile> } } }`)
  then — for `mtlsAllowlist` — **suppresses** the default `backendBlock` (the allowlist's `@node`
  handle IS the backend) and emits the `extraCaddyConfig` allowlist verbatim. Vhost key gets `:9443`.
  Byte-exact to §1.4 — **conditional on gap (G)**: `mtlsAllowlist` must emit cert + mTLS block +
  `extraCaddyConfig` and **not** an auto `backendBlock` (else the body would double a `reverse_proxy`).

### 2.3 `services.caddy.enable`/`useInternalCA` + cert-group membership — preserved in the feature

`technitium/caddy.nix`'s non-vhost config stays, moved into the aedilis feature (or kept in a trimmed
`technitium/caddy.nix` that only sets these when `cfg.caddy.enable`):

```nix
services.caddy = { enable = true; useInternalCA = true; };
users.groups.${cfg.certGroup}.members = [ "caddy" ];
```

- **`services.caddy.enable`/`useInternalCA`** — host/feature-level, not per-vhost; the caddy generator
  does not own them. Preserve verbatim (the base `caddy` module may already set `enable`; confirm no
  double-set changes anything — §3.3).
- **`users.groups.<certGroup>.members = [ "caddy" ]`** — stays in the feature, exactly like kanidm's
  `users.groups.idm.members` stays in `service.nix` (keystone §3.4 note; kanidm.md §2). The acme
  generator sets the cert `group`; the feature owns who is in it. Caddy is the only member here.

### 2.4 Where the certs/firewall/DNS come from

Certs (`dns-admin`/`dns-metrics` step-ca), their `http://` challenge vhosts, and the `8443`/`9443` +
`22483`/`22481` firewall openings are the companion plan [./technitium-aedilis.md](./technitium-aedilis.md).
DNS (`dns-admin`/`dns-metrics` records) is [./dns-records.md](./dns-records.md). This plan emits
**only** the two HTTPS vhost bodies + the Caddy-enable/trust-group lines.

---

## 3. Mapping each surface onto the catalog + argument

### 3.1 Admin vhost — explicit-cert reverse proxy, OIDC gate is app-side

The keystone renderer for `gate.oidc` + `backend.reverseProxy` + `certDir != null`
produces:

```
tls <certDir>/fullchain.pem <certDir>/key.pem
reverse_proxy 127.0.0.1:5380
```

**Equivalence argument.**

- **Key:** `https://dns-admin.plato-splunk.media:8443` = `"https://" + fqdn + ":" + listenPort`
  (`fqdn = dns-admin.plato-splunk.media`, `listenPort = 8443 != 443` → suffix appended, keystone
  §3.2). Identical to `"https://${cfg.caddy.adminDomain}:${toString cfg.caddy.adminPort}"`.
- **`tls` line:** `certDir = config.security.acme.certs."dns-admin.plato-splunk.media".directory =
  /var/lib/acme/dns-admin.plato-splunk.media`, so `tls /var/lib/acme/dns-admin.plato-splunk.media/fullchain.pem
  /var/lib/acme/dns-admin.plato-splunk.media/key.pem` = today's `tls ${cfg.caddy.adminCertPemFile}
  ${cfg.caddy.adminCertKeyFile}` (those options are set to exactly those paths, companion §1.2). ✓
- **`reverse_proxy` line:** must be `reverse_proxy 127.0.0.1:5380`. The renderer standardizes the
  upstream token on **`127.0.0.1`** (operator-approved, catalog-and-generators §7.8 #22), which
  matches today's source **exactly** — so there is **no** deviation here (gap (F) is resolved by the
  global standardization; no `backend.upstreamHost` field needed). ✓
- **`gate.oidc`** adds no Caddy auth (correct — Technitium does OIDC itself). ✓
- No tracing span (aedilis has no `services.tempo.enable` fronting this, and today's body has none) —
  the renderer's `tracingBlock` emits nothing. Confirm via parity gate. ✓

### 3.2 Metrics vhost — mTLS + path allowlist (the escape-hatch case)

The keystone renderer for `gate.mtlsAllowlist` + `certDir != null` + `trustPoolFile` + the
`extraCaddyConfig` allowlist produces:

```
tls <certDir>/fullchain.pem <certDir>/key.pem {
  client_auth {
    mode require_and_verify
    trust_pool file {
      pem_file <trustPoolFile>
    }
  }
}

@node path /metrics
handle @node {
  reverse_proxy 127.0.0.1:9100
}

@dns path /api/dashboard/metrics/text
handle @dns {
  reverse_proxy 127.0.0.1:5380
}

@login path /api/user/login
handle @login {
  reverse_proxy 127.0.0.1:5380
}

handle {
  respond 404
}
```

**Equivalence argument.**

- **Key:** `https://dns-metrics.plato-splunk.media:9443` (`listenPort = 9443`). Identical. ✓
- **mTLS `tls` block:** `mtlsTlsLine { certPem = <certDir>/fullchain.pem; certKey = <certDir>/key.pem;
  trustPool = gate.mtlsAllowlist.trustPoolFile }` (keystone §3.1) renders exactly the `tls <pem> <key> { client_auth
  { mode require_and_verify; trust_pool file { pem_file <root> } } }` block. `certDir =
  /var/lib/acme/dns-metrics.plato-splunk.media` = today's `metricsCertPemFile`/`metricsCertKeyFile`;
  `tls.gate.mtlsAllowlist.trustPoolFile = c.ca.rootCert` = today's `metricsMtlsTrustPoolFile`. ✓
- **The allowlist** comes **verbatim** from `extraCaddyConfig` (§2.1) — same three matcher/handle
  pairs in the same order, same upstreams (`9100` for `@node`, `5380` for `@dns`/`@login`), same
  catch-all `respond 404`. Character-for-character copy of today's block (minus the Nix `#` comment,
  which was never part of the rendered string). ✓
- **No double backend.** The keystone renderer **always** appends `backendBlock` before
  `extraCaddyConfig`. For `mtlsAllowlist` the backend IS the allowlist, so the auto `backendBlock`
  must be **suppressed** (else a stray `reverse_proxy 127.0.0.1:9100` would precede the allowlist).
  → **gap (G):** `gate.mtlsAllowlist` suppresses `backendBlock`, emitting only the mTLS `tls`
  block + `extraCaddyConfig`. (The `backend.reverseProxy.port` is then only documentary / used by the firewall
  generator — not rendered. Alternatively set `backend.raw = { }` for this entry so the renderer
  emits only the mTLS line + `extraCaddyConfig`; §7 gap (G) recommends the `mtlsAllowlist`
  suppression so the mTLS line is still auto-rendered.)
- **Blank-line spacing.** Today's body has a blank line between the closing `}` of the `tls` block and
  `@node` (the heredoc has an empty line there). The renderer must reproduce that exact spacing: the
  `mtlsTlsLine` ends with `}\n`, then `extraCaddyConfig` begins with `@node` — so a single `\n`
  separator must sit between them to match the blank line. Verify byte-for-byte (§5.2); if the
  renderer concatenates without the separator, prepend a `\n` to `extraCaddyConfig` or have the
  `mtls+allowlist` path insert one. This is the most likely byte-diff culprit.

### 3.3 Caddy-enable, `useInternalCA`, cert-group — preserved, not generator-owned

- **`services.caddy.enable = true`** — the base `caddy` module (imported by the generator's host)
  likely already enables Caddy; this was set here too. Preserve the set (idempotent). Verify
  `services.caddy.enable` is `true` before/after (§5.4).
- **`useInternalCA = true`** — global issuer set to step-ca. Since every vhost names its cert, it is
  unused, but it must stay set byte-identical (some other vhost or default might rely on it). Preserve
  verbatim in the feature.
- **`users.groups.<certGroup>.members = [ "caddy" ]`** — stays in the feature (not the acme
  generator). The acme generator (companion plan) sets `group = <certGroup>` on the two certs; this
  line grants Caddy read access. Byte-identical.

### 3.4 OIDC / mTLS gating semantics (documentation parity)

- **Admin:** `gate.oidc` documents that OIDC is enforced by **Technitium itself** (its
  `services.technitium-server-complete.oidc.*` config), not Caddy. The catalog's `oidc` block is
  **omitted** on this entry (no Kanidm client is registered by this vhost — Technitium's OIDC client
  is configured in the option module, and the Kanidm-side registration, if any, is a separate
  concern). So the OIDC generator emits nothing for `technitium-admin`. ✓ No behavior change.
- **Metrics:** `gate.mtlsAllowlist` — client cert is the only authN. No OIDC. ✓

---

## 4. Operational-equivalence summary (per surface)

| Surface                                                   | Today                                                 | After (source)                                              | Equivalent?               |
| --------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------- | ------------------------- |
| Admin vhost key `https://dns-admin…:8443`                 | `https://${adminDomain}:${adminPort}`                 | `https://${fqdn}:${listenPort}` (8443)                      | ✓ identical               |
| Admin vhost body (`tls` + `reverse_proxy 127.0.0.1:5380`) | hand-written `extraConfig`                            | caddy generator, `gate.oidc`, renderer upstream `127.0.0.1` | ✓ identical               |
| Metrics vhost key `https://dns-metrics…:9443`             | `https://${metricsDomain}:${metricsPort}`             | `https://${fqdn}:${listenPort}` (9443)                      | ✓ identical               |
| Metrics `tls` + mTLS `client_auth` block                  | explicit cert + `trust_pool file { pem_file <root> }` | `gate.mtlsAllowlist.trustPoolFile` (mtlsTlsLine)            | ✓ identical               |
| Metrics path allowlist (@node/@dns/@login + 404)          | hand-written matcher/handle + `respond 404`           | `extraCaddyConfig` verbatim, no auto backend (gap G)        | ✓ (needs gap G + spacing) |
| `users.groups.<certGroup>.members`                        | `[ "caddy" ]`                                         | unchanged in the feature                                    | ✓ identical               |
| `services.caddy.enable` / `useInternalCA`                 | `true` / `true`                                       | unchanged in the feature                                    | ✓ identical               |
| Certs / challenge vhosts / firewall `8443`/`9443`         | companion plan                                        | [./technitium-aedilis.md](./technitium-aedilis.md)          | ✓ (companion)             |
| DNS (`dns-admin`/`dns-metrics`)                           | `ensureDnsRecords.zones`                              | [./dns-records.md](./dns-records.md)                        | ✓ (deferred)              |

**Conclusion:** both vhost bodies and the Caddy-enable/trust-group lines are byte-identical before and
after, **conditional on gap (G) `mtls+allowlist` backend suppression + the exact blank-line spacing
between the mTLS block and the allowlist**. Gap (F) is **resolved** by the global `127.0.0.1`
standardization (technitium already uses `127.0.0.1`, so no deviation). With gap (G), the deploy is a
theoretical no-op with zero intentional deviations for technitium's vhosts.

---

## 5. Parity gates (exact commands)

> **Prerequisite (`.kiro/steering/validation.md`):** `git add` the new/changed files before any eval
> (keep `technitium/caddy.nix`'s vhost blocks until the "after" evals pass). Untracked new `.nix`
> files are invisible to `import-tree`.

### 5.1 Admin vhost — `--raw`, byte-for-byte

```sh
nix eval \
  '.#nixosConfigurations.aedilis.config.services.caddy.virtualHosts."https://dns-admin.plato-splunk.media:8443".extraConfig' \
  --raw > /tmp/tech-admin-vhost.after
diff /tmp/tech-admin-vhost.before /tmp/tech-admin-vhost.after   # MUST be empty
```

Expected body (byte-for-byte, trailing newline):

```
tls /var/lib/acme/dns-admin.plato-splunk.media/fullchain.pem /var/lib/acme/dns-admin.plato-splunk.media/key.pem
reverse_proxy 127.0.0.1:5380
```

### 5.2 Metrics vhost — `--raw`, byte-for-byte (the critical gate)

```sh
nix eval \
  '.#nixosConfigurations.aedilis.config.services.caddy.virtualHosts."https://dns-metrics.plato-splunk.media:9443".extraConfig' \
  --raw > /tmp/tech-metrics-vhost.after
diff /tmp/tech-metrics-vhost.before /tmp/tech-metrics-vhost.after   # MUST be empty
```

Expected body (byte-for-byte; note the blank line after the `tls`-block `}` and before `@node`, and
the `pem_file` being the store path of `c.ca.rootCert`):

```
tls /var/lib/acme/dns-metrics.plato-splunk.media/fullchain.pem /var/lib/acme/dns-metrics.plato-splunk.media/key.pem {
  client_auth {
    mode require_and_verify
    trust_pool file {
      pem_file /nix/store/…-alford-root.crt
    }
  }
}

@node path /metrics
handle @node {
  reverse_proxy 127.0.0.1:9100
}

@dns path /api/dashboard/metrics/text
handle @dns {
  reverse_proxy 127.0.0.1:5380
}

@login path /api/user/login
handle @login {
  reverse_proxy 127.0.0.1:5380
}

handle {
  respond 404
}
```

### 5.3 Whole-vhosts sanity (keys + no stray attrs)

```sh
nix eval '.#nixosConfigurations.aedilis.config.services.caddy.virtualHosts' --json \
  | jq '{admin:."https://dns-admin.plato-splunk.media:8443", metrics:."https://dns-metrics.plato-splunk.media:9443"}'
# Confirm exactly these two https:// keys (plus the companion plan's three http:// keys) — no more, no less.
```

### 5.4 Caddy-enable, useInternalCA, cert-group — no-change checks

```sh
nix eval '.#nixosConfigurations.aedilis.config.services.caddy.enable'        --json   # true
nix eval '.#nixosConfigurations.aedilis.config.services.caddy.useInternalCA' --json   # true  (if exposed; else inspect the base module)
# cert-group members unchanged (resolve <certGroup> via the companion plan's §5.3):
CG=$(nix eval '.#nixosConfigurations.aedilis.config.services.technitium-server-complete.certGroup' --raw)
nix eval ".#nixosConfigurations.aedilis.config.users.groups.\"$CG\".members" --json   # ["caddy"]
```

### 5.5 OIDC — no client registered by these vhosts

```sh
# technitium-admin / technitium-metrics must NOT appear as Kanidm oauth2 clients (augustus):
nix eval '.#nixosConfigurations.augustus.config.services.kanidm.provision.systems.oauth2' --json \
  | jq 'has("technitium-admin") or has("technitium-metrics")'   # false
```

### 5.6 Build gate

```sh
nix run .#nixfmt -- $(git ls-files '*.nix' ':!:repos/**')
nix flake check
nixos-rebuild build --flake .#aedilis
```

---

## 6. Migration checklist

> Depends on the catalog schema + generators ([./catalog-and-generators.md](./catalog-and-generators.md))
> **including gap (G) `mtls+allowlist` backend suppression + exact spacing** (§7; gap (F) is resolved
> by the global `127.0.0.1` standardization), AND on the companion
> [./technitium-aedilis.md](./technitium-aedilis.md) (same two catalog entries supply the certs these
> vhosts name). **Land both plans together** — the vhost bodies need the certs, and the firewall
> openings for `8443`/`9443` come from the companion. Sequence in parent plan §3 step 4/5.

1. **Land schema gaps first** (§7): `mtls+allowlist` backend-suppression + the blank-line separator
   between the mTLS block and `extraCaddyConfig`. (The upstream token is the renderer's global
   `127.0.0.1` — no per-entry field.) Re-confirm the keystone "introducing the module is a no-op"
   gate.
2. **Capture baseline.** Run §5.1 (admin `--raw`), §5.2 (metrics `--raw`), §5.3 (vhost keys), §5.4
   (caddy-enable/useInternalCA/cert-group), §5.5 (OIDC absent) → `/tmp/tech-*.before`.
3. **Add Caddy-body fields to the two companion catalog entries** (`technitium-admin`,
   `technitium-metrics`) in `features/technitium-aedilis/catalog.nix` (§2.1):
   - admin: `backend.reverseProxy.port=5380`, `tls.gate.oidc={ }`, `listenPort=8443`.
     **No `oidc` block.** (Upstream `127.0.0.1` via the renderer default.)
   - metrics: `backend.reverseProxy.port=9100`, `tls.gate.mtlsAllowlist.trustPoolFile=c.ca.rootCert`,
     `listenPort=9443`, and the verbatim allowlist
     `extraCaddyConfig` (@node/@dns/@login + `respond 404`).
4. **Preserve the non-vhost Caddy config** in the feature: `services.caddy = { enable = true;
   useInternalCA = true; }` and `users.groups.${cfg.certGroup}.members = [ "caddy" ]` (move from
   `technitium/caddy.nix` into the aedilis feature, or keep a trimmed `technitium/caddy.nix` that only
   sets these under `mkIf (cfg.enable && cfg.caddy.enable)`).
5. **Opt in** `managedBy.caddy = true` for both entries (acme/firewall were opted in by the companion).
6. **Delete the two `services.caddy.virtualHosts` blocks** from `technitium/caddy.nix` (now
   generator-produced). Keep (or relocate) the `services.caddy.enable`/`useInternalCA` +
   `users.groups` lines.
7. **Stage files:** `git add` the catalog + feature edits, stage the `technitium/caddy.nix` edit.
8. **Run the parity gate.** Re-run §5.1–§5.5 → `/tmp/tech-*.after`; `diff` each against `.before`.
   **All diffs MUST be empty.** Likely culprits: a stray auto `reverse_proxy` before the metrics
   allowlist (gap G backend not suppressed); the missing blank
   line between the mTLS `}` and `@node` (§3.2 spacing); a dropped/extra trailing newline; `:8443`/
   `:9443` suffix missing from the key; the `tls` cert path differing (cert name/dir drift — companion
   gap D).
9. **Format + check + build.** `nix run .#nixfmt -- …`, `nix flake check`,
   `nixos-rebuild build --flake .#aedilis`. All must pass.
10. **Deploy as a no-op.** Both vhost bodies, the mTLS gate, the tight allowlist, and the cert-group
    membership are unchanged on aedilis — alongside the companion plan's certs/challenges/firewall.

---

## 7. Catalog schema gaps this exercise surfaces

technitium-caddy is the stress test for the **OIDC-gated explicit-cert proxy** and the
**`mtls+allowlist`** vhost. It surfaces two schema additions (F, G) that complement the companion
plan's (A/C/E) and the keystone's existing `tls.gate` variants/`extraCaddyConfig`.

### Gap (F) — ~~per-entry upstream-host token~~ RESOLVED by global `127.0.0.1` standardization

Originally this exercise flagged a `localhost` vs `127.0.0.1` mismatch: technitium's admin vhost uses
`reverse_proxy 127.0.0.1:5380` while the keystone `backendBlock` draft used `localhost`. **Resolved
(operator decision, catalog-and-generators §7.8 #22):** the renderer standardizes the upstream token
on **`127.0.0.1`** for every service. technitium's `127.0.0.1` source therefore matches the generated
output **exactly** — **no** `backend.upstreamHost` field is added, and technitium's admin/metrics
vhosts have **no** approved deviation on this axis (the `localhost`-sourced reverse-proxy services get
the one-token substitution; technitium does not, since it already used `127.0.0.1`).

### Gap (G) — `mtls+allowlist` suppresses the auto backend; exact spacing

The keystone renderer **always** appends `backendBlock` before `extraCaddyConfig`. For the metrics
vhost the "backend" is the allowlist's own `@node … handle` block, and the catch-all is `respond 404`
— so an auto `backendBlock` would inject a stray `reverse_proxy 127.0.0.1:9100` ahead of the
allowlist, breaking byte-equivalence and the gating semantics.

- **Add:** `gate.mtlsAllowlist` in `renderVhostBody` emits **only** the mTLS `tls` block
  (`mtlsTlsLine`) + `extraCaddyConfig` — **no** `backendBlock`, **no** `plainTlsLine` (the mTLS line
  already carries the cert). (`backend.reverseProxy.port` on the entry is then consumed only by the firewall
  generator / documentation, not rendered — or use `backend.raw = { }` with the mTLS line still
  auto-emitted; recommend the `gate`-driven suppression so the mTLS block stays generated.)
- **Spacing requirement.** The current body has a **blank line** between the `tls { … }` block's
  closing `}` and the first matcher `@node`. The renderer must place exactly one `\n` separator
  between `mtlsTlsLine`'s trailing `}\n` and `extraCaddyConfig` (which starts with `@node`). The
  `mtlsAllowlist` path must therefore join the mTLS block and `extraCaddyConfig` with a single blank
  line. This is the single most likely byte-diff; the parity gate §5.2 pins it.

> These two additions (F, G), together with the keystone's existing `gate.mtls` / `gate.mtlsAllowlist` variants,
> their `trustPoolFile`, and `extraCaddyConfig`, are exactly enough to represent the tight-allowlist
> metrics vhost and the explicit-cert admin vhost byte-for-byte. They are small and reusable (F helps
> any `127.0.0.1`-upstream vhost; G helps any mTLS-gated allowlist/deny-by-default vhost), and keep
> technitium as two catalog entries (shared with the companion plan) that feed the caddy generator
> while the Technitium option module stays the untouched owner of the service runtime and the producer
> of the cert paths/ports the vhost bodies interpolate.

---

## 8. Reconciliation summary — what the catalog replaces vs. leaves alone

| Piece                                                      | Decision                                       | Rationale                                                                                     |
| ---------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `technitium/caddy.nix` two `virtualHosts` blocks           | **REPLACE** with catalog → caddy generator     | Cross-cutting vhost bodies — exactly the caddy generator's job (mTLS + escape hatch).         |
| `services.caddy.enable` / `useInternalCA`                  | **KEEP** (in the feature)                      | Host/feature-level Caddy settings, not per-service vhost facts.                               |
| `users.groups.<certGroup>.members = [ "caddy" ]`           | **KEEP** (in the feature)                      | Cert-group membership is service-specific (keystone §3.4 / kanidm.md §2).                     |
| Cert path / port / trust-pool VALUES                       | **FEED** from the option module into the entry | Single source of truth; `config.services.technitium-server-complete.caddy.*` + ACME cert dir. |
| `services.technitium-server-complete.caddy.*` (production) | **LEAVE UNTOUCHED**                            | The option module still produces the values the vhost bodies interpolate.                     |
| Certs / `http://` challenge vhosts / firewall              | **Companion plan** [./technitium-aedilis.md]   | Same two catalog entries; different generators consume cert/challenge/firewall fields.        |
| `dns-admin`/`dns-metrics` DNS records                      | **Deferred** to [./dns-records.md]             | Centralized authoritative zone.                                                               |

The catalog **replaces** only the two hand-rolled vhost bodies (moving the mTLS gate into
`gate.mtlsAllowlist` + the allowlist into `extraCaddyConfig`), **feeds** the interpolated values
from the still-authoritative Technitium option module, and **leaves** the service runtime and the
cert/firewall/DNS surfaces to the option module and the companion/dns-records plans. That is the
careful reconciliation the already-option-driven Technitium Caddy module demands.
