# cicero-observability — mTLS metrics vhosts + Alloy client cert (host runs Caddy on :8443)

Status: **PROPOSED**
Date: 2026-10-22
Parent: [../service-consolidation-plan.md](../service-consolidation-plan.md) ·
Index: [./README.md](./README.md) ·
Keystone: [./catalog-and-generators.md](./catalog-and-generators.md)

> **Operational-equivalence contract (from [./README.md](./README.md)):** deploying this revision
> MUST be a theoretical no-op. The migration changes _where_ config is declared (into a colocated
> `features/cicero-observability/` catalog entry read by the generators), never _what_ is realized on
> cicero. The three Caddy vhosts (`extraConfig` strings), the global `https_port 8443`, and the
> `security.acme.certs.cicero-metrics` cert block must all render byte-identical.

cicero is the **certificate authority** host: it runs **step-ca**, which owns `:443` (the public ACME

- CA API). Because step-ca occupies `:443`, **cicero runs Caddy on `:8443`** — a global
  `https_port 8443` in the Caddy config. This is a **key finding**: it directly parallels the
  praeconinus `443 → 8443` finding (see [./praeconinus.md](./praeconinus.md) and parent plan §5.2 #1),
  but the _cause is different_ — praeconinus moves to `:8443` because **tailscaled** owns `:443` for
  Funnel ingress, whereas cicero moves to `:8443` because **step-ca** owns `:443`. Both are
  host-level, non-443 Caddy listen ports driven by another process on the box occupying `:443`.

Concerns emitted today (per the index): **V C** — three Caddy vhosts (one HTTP-01 challenge vhost +
two mTLS metrics vhosts) and one ACME cert (used as an **Alloy client cert**, not a Caddy server
cert). No OIDC, no DNS owned by this module (the `cicero-metrics` / `ca-monitoring` A/AAAA records
live in the centralized `tailnetRewrites`), no service-attributable firewall opening beyond the
host-level `8443`/`80` on `tailscale0`.

---

## 0. Why cicero-observability is distinctive

Three things set it apart from the reference [it-tools.md](./it-tools.md):

1. **Host-level non-443 listen port.** `services.caddy.globalConfig = "https_port 8443"` is a
   **whole-host** Caddy setting, not a per-vhost field. The catalog today models listen port **per
   entry** (`listenPort`, default 443 — keystone §2). Expressing "this entire host's Caddy defaults to
   `:8443`" is a **schema/host-config gap** flagged in §5.
2. **mTLS metrics vhosts.** Two vhosts gate on `client_auth { mode require_and_verify; trust_pool
   file { pem_file <ca.rootCert> } }` → catalog `tls.gate.mtls` +
   `tls.gate.mtls.trustPoolFile = c.ca.rootCert` (keystone §3.1 `mtlsTlsLine`).
3. **ACME cert consumed by Alloy, not Caddy.** `security.acme.certs.cicero-metrics` is a step-ca cert
   whose `reloadServices = [ "alloy.service" ]` (NOT `caddy.service`), used by Alloy as a **client
   cert** to push logs to augustus' Loki over mTLS. This is the same shape as the `prometheus-client`
   cert (parent plan index: "prometheus — C (client)"): the cert is consumed by a sibling service, so
   the reload target is that service, not Caddy. Flagged in §5 as the **alloy-client-cert reload
   target** gap.

---

## 1. Current state — emitted output captured verbatim

### 1.1 Caddy module: `features/cicero-observability/caddy.nix`

```nix
{ config, inputs, ... }:
let
  c = config.constants;
  ciceroMetrics = c.services.cicero-metrics;
  stepCa = c.ca;
in
{
  flake.modules.nixos.cicero-observability-caddy =
    { config, lib, ... }:
    {
      imports = [
        inputs.self.modules.nixos.caddy
      ];

      services.caddy = {
        enable = true;
        globalConfig = ''
          https_port 8443
        '';
        useInternalCA = true;
      };

      # HTTP vhost on port 80 to serve ACME http-01 challenges
      # (for both Caddy's own certs AND the NixOS ACME client cert for Alloy)
      services.caddy.virtualHosts."http://${ciceroMetrics.domain}" = {
        extraConfig = ''
          reverse_proxy localhost:${builtins.toString ciceroMetrics.acmePort}
        '';
      };

      # mTLS-guarded metrics endpoint (node_exporter)
      # Caddy obtains its own server cert via built-in ACME from step-ca
      services.caddy.virtualHosts."https://${ciceroMetrics.domain}:${toString ciceroMetrics.port}" = {
        extraConfig = ''
          tls {
            client_auth {
              mode require_and_verify
              trust_pool file {
                pem_file ${c.ca.rootCert}
              }
            }
          }
          reverse_proxy 127.0.0.1:9100
        '';
      };

      # mTLS-guarded metrics endpoint (step-ca)
      # Caddy obtains its own server cert via built-in ACME from step-ca
      services.caddy.virtualHosts."https://${stepCa.metricsDomain}:${toString stepCa.metricsPort}" = {
        extraConfig = ''
          tls {
            client_auth {
              mode require_and_verify
              trust_pool file {
                pem_file ${c.ca.rootCert}
              }
            }
          }
          reverse_proxy 127.0.0.1:${builtins.toString stepCa.metricsPortInternal}
        '';
      };
    };
}
```

### 1.2 ACME module: `features/cicero-observability/acme.nix`

```nix
{ config, ... }:
let
  c = config.constants;
  ciceroMetrics = c.services.cicero-metrics;
in
{
  flake.modules.nixos.cicero-observability-acme =
    { config, lib, ... }:
    {
      security.acme = {
        acceptTerms = true;
        defaults.email = c.acme.email;
      };

      # Client certificate for Alloy to authenticate when pushing to Augustus' Loki
      # step-ca's default template includes both serverAuth and clientAuth EKU
      security.acme.certs."${ciceroMetrics.domain}" = {
        domain = ciceroMetrics.domain;
        listenHTTP = "127.0.0.1:${builtins.toString ciceroMetrics.acmePort}";
        server = c.ca.acmeDirectoryHttp;
        group = "cicero-observability";
        reloadServices = [
          "alloy.service"
        ];
      };

      users.groups.cicero-observability = { };
    };
}
```

### 1.3 Constants it reads: `service-registry.nix`

`cicero-metrics` service entry (lines ~346–352):

```nix
cicero-metrics = {
  subdomain = "cicero-metrics";
  domain = mkDomain "cicero-metrics";   # -> "cicero-metrics.plato-splunk.media"
  url = mkUrl "cicero-metrics";         # -> "https://cicero-metrics.plato-splunk.media"
  port = 8443;
  acmePort = 22479;
};
```

`ca` block (lines ~136–146):

```nix
ca = {
  domain = mkDomain "ca";                       # "ca.plato-splunk.media"
  url = mkUrl "ca";
  metricsPort = 8443;
  metricsPortInternal = 43379;
  metricsDomain = mkDomain "ca-monitoring";     # "ca-monitoring.plato-splunk.media"
  metricsBaseUrl = "https://ca-monitoring.plato-splunk.media:8443";
  metricsUrl = "https://ca-monitoring.plato-splunk.media:8443/metrics";
  acmeDirectory = "https://ca.plato-splunk.media/acme/acme/directory";
  acmeDirectoryHttp = "https://ca.plato-splunk.media/acme/http/directory";
  acmeDirectoryClients = "https://ca.plato-splunk.media/acme/eap/directory";
  rootCert = certsDir + "/alford-root.crt";
  # …
};
```

So after interpolation:

- `ciceroMetrics.domain` = `cicero-metrics.plato-splunk.media`, `.port` = `8443`, `.acmePort` =
  `22479`.
- `stepCa.metricsDomain` = `ca-monitoring.plato-splunk.media`, `.metricsPort` = `8443`,
  `.metricsPortInternal` = `43379`.

### 1.4 The resolved emitted Caddy output (byte-exact targets)

After interpolation, cicero realizes **one global config + three vhosts**:

```nix
services.caddy.enable = true;
services.caddy.useInternalCA = true;    # -> base caddy.nix sets acmeCA = c.ca.acmeDirectoryHttp
services.caddy.globalConfig = ''
  https_port 8443
'';

# (A) HTTP-01 challenge vhost on :80
services.caddy.virtualHosts."http://cicero-metrics.plato-splunk.media".extraConfig = ''
  reverse_proxy localhost:22479
'';

# (B) mTLS node_exporter metrics (https on :8443)
services.caddy.virtualHosts."https://cicero-metrics.plato-splunk.media:8443".extraConfig = ''
  tls {
    client_auth {
      mode require_and_verify
      trust_pool file {
        pem_file ${c.ca.rootCert}
      }
    }
  }
  reverse_proxy 127.0.0.1:9100
'';

# (C) mTLS step-ca metrics (https on :8443)
services.caddy.virtualHosts."https://ca-monitoring.plato-splunk.media:8443".extraConfig = ''
  tls {
    client_auth {
      mode require_and_verify
      trust_pool file {
        pem_file ${c.ca.rootCert}
      }
    }
  }
  reverse_proxy 127.0.0.1:43379
'';
```

> **Byte-exact notes.**
>
> - `globalConfig` is the single line `https_port 8443` + trailing newline.
> - The challenge vhost (A) is a plain `reverse_proxy` (NOT a `handle /.well-known/acme-challenge/*`
>   wrapper) proxying the _entire_ `http://` vhost to the ACME listener. The upstream token
>   standardizes to **`127.0.0.1`** (operator-approved, catalog-and-generators §7.8 #22; today it is
>   `localhost`), so the parity gate shows only that `localhost → 127.0.0.1` substitution. The
>   bare-vs-`handle` form is preserved via `tls.cert.own.challenge.body.bare = { }` (keystone §7.2 #8).
> - The mTLS vhosts (B)/(C) use `127.0.0.1` upstreams (`:9100`, `:43379`) — not `localhost`. The
>   renderer must preserve each upstream token exactly as written today.
> - Each mTLS `tls { client_auth { … pem_file <rootCert> … } }` block uses **no explicit cert
>   files** — Caddy obtains its own server cert via built-in ACME (`useInternalCA`). So these are
>   `tls.gate.mtls` vhosts whose `tls` block carries **only** `client_auth` (no `tls <fullchain>
>   <key>` prefix). The keystone `mtlsTlsLine` helper emits `tls <cert> <key> { client_auth … }`;
>   cicero needs the **cert-less** variant `tls { client_auth … }`. See §3.3 + §5 gap.

### 1.5 The ACME cert output (byte-exact target)

```nix
security.acme.acceptTerms = true;
security.acme.defaults.email = "web@jacob-alford.dev";

security.acme.certs."cicero-metrics.plato-splunk.media" = {
  domain = "cicero-metrics.plato-splunk.media";
  listenHTTP = "127.0.0.1:22479";
  server = "https://ca.plato-splunk.media/acme/http/directory";   # c.ca.acmeDirectoryHttp
  group = "cicero-observability";
  reloadServices = [ "alloy.service" ];
};

users.groups.cicero-observability = { };
```

This cert is **not** a Caddy server cert. It is consumed by **Alloy** (`alloy.nix`): the
`loki.write "remote"` block references `${directory}/fullchain.pem` + `${directory}/key.pem` as the
**client** cert/key for mTLS push to augustus' Loki (`lokiPush.url`). Hence
`reloadServices = [ "alloy.service" ]` and the dedicated `cicero-observability` group (Alloy's
static user joins it via `SupplementaryGroups`). The Caddy mTLS vhosts above get their **own** server
certs from built-in ACME and do **not** use this cert at all.

### 1.6 Firewall (host-level, on tailscale0)

`_private/cicero/security.nix` opens, on the `tailscale0` interface only:

```nix
networking.firewall.interfaces.tailscale0.allowedTCPPorts = [
  22     # ssh
  80     # ACME http-01 challenge (Caddy fronts it -> loopback 22479)
  443    # step-ca public ACME + CA API (owned by step-ca, NOT Caddy)
  5252   # tailscale metrics exporter
  8443   # Caddy https (the cicero-metrics / ca-monitoring mTLS vhosts)
];
```

Of these, only **`8443`** (Caddy's https listen port) and **`80`** (the HTTP-01 challenge Caddy
fronts to loopback `22479`) are Caddy/catalog-attributable. `443` is **step-ca's**, not Caddy's —
step-ca owns it (the reason Caddy is on `8443`). `22`/`5252` are baseline infra (parent plan §5.1
#7). The loopback `22479` ACME listener needs **no** opening (it is `via = "caddy80"` — fronted by
Caddy on `:80`).

### 1.7 Properties to preserve (invariants)

- **Global `https_port 8443`** — the whole-host Caddy listen port. step-ca owns `:443`.
- **`useInternalCA = true`** — base `caddy.nix` wires `acmeCA = c.ca.acmeDirectoryHttp` (Caddy's own
  server certs issue from step-ca).
- **Three vhosts**, exact bodies: (A) challenge `reverse_proxy localhost:22479`; (B) mTLS →
  `reverse_proxy 127.0.0.1:9100`; (C) mTLS → `reverse_proxy 127.0.0.1:43379`.
- **mTLS trust pool** = `c.ca.rootCert` for both (B)/(C).
- **Alloy client cert**: `security.acme.certs.cicero-metrics` with `listenHTTP = 127.0.0.1:22479`,
  `server = c.ca.acmeDirectoryHttp`, `group = cicero-observability`,
  `reloadServices = [ "alloy.service" ]`, plus `users.groups.cicero-observability`.
- **No OIDC. No module-owned DNS. No new service-attributable firewall port** (80/8443 are host-level
  Caddy infra already open; 443 is step-ca's).

---

## 2. Target state — colocated feature + catalog entries

`features/cicero-observability/` already follows the colocated convention (`complete.nix` aggregates
`-acme`, `-caddy`, `-node-exporter`, `-alloy`). The migration replaces the hand-written vhosts/cert
with **catalog entries** consumed by cicero's generators, keeping the node-exporter and alloy
sub-modules (and the alloy cert consumer) as-is.

cicero imports `homelab-service-apphost` (keystone §1: caddy + acme + firewall; **no** dns/oidc).

### 2.1 Catalog entries

This module contributes **two** catalog entries — one per mTLS metrics domain — plus the shared
host-level Caddy settings (see §5 for the host-config gap on `https_port`):

```nix
# features/cicero-observability/catalog.nix
{ config, ... }:
let
  c = config.constants;
  ciceroMetrics = c.services.cicero-metrics;   # subdomain cicero-metrics, port 8443, acmePort 22479
  stepCa = c.ca;                                # metricsDomain ca-monitoring, metricsPort 8443,
                                                #   metricsPortInternal 43379
in
{
  homelab.catalog = {
    # (B) node_exporter metrics, mTLS. Also owns the ACME cert (consumed by Alloy, see below).
    cicero-metrics = {
      subdomain = "cicero-metrics";
      host = "cicero";
      listenPort = ciceroMetrics.port;          # 8443 (host runs Caddy on 8443; see §5)

      backend.reverseProxy.port = 9100;         # 127.0.0.1:9100 node_exporter

      tls = {
        gate.mtls = {
          trustPoolFile = c.ca.rootCert;
          mtlsServerCert = null;                # NEW: cert-less mTLS (Caddy ACME server cert); see §5
        };

        # The ACME cert here is an ALLOY CLIENT cert, not a Caddy server cert.
        cert.own = {
          acmePort = ciceroMetrics.acmePort;      # 22479
          certGroup = "cicero-observability";     # matches today's group (NOT the default name)
          reloadServices = [ "alloy.service" ];   # reload Alloy, NOT caddy (client-cert consumer)
          reloadCaddy = false;                    # client-cert consumer -> do NOT reload caddy (see §5)
          challenge.via = "caddy80";              # loopback 22479 fronted by Caddy on :80

          # today's challenge vhost is a bare `reverse_proxy localhost:<acmePort>`, NOT a
          # `handle /.well-known/acme-challenge/*` wrapper -> reproduce verbatim:
          challengeVerbatim = true;               # NEW flag (see §5); or use extraCaddyConfig
        };
      };

      access.scope.tailnet = { };               # reachable over tailscale0 (8443 already host-open)
      dns = null;                               # cicero-metrics A/AAAA stays in tailnetRewrites for now
    };

    # (C) step-ca metrics, mTLS. No ACME cert of its own (Caddy ACME server cert only).
    ca-monitoring = {
      subdomain = "ca-monitoring";
      host = "cicero";
      listenPort = stepCa.metricsPort;          # 8443

      backend.reverseProxy.port = stepCa.metricsPortInternal;  # 127.0.0.1:43379

      tls = {
        gate.mtls = {
          trustPoolFile = c.ca.rootCert;
          mtlsServerCert = null;                # cert-less mTLS
        };
        cert.shared = { };                      # no security.acme.certs entry (Caddy manages its own)
      };

      access.scope.tailnet = { };
      dns = null;                               # ca-monitoring A/AAAA stays in tailnetRewrites for now
    };
  };
}
```

> **Why two entries and not three:** the `http://cicero-metrics` vhost (A) is the **HTTP-01 challenge
> vhost** for the `cicero-metrics` cert. It is emitted by the **acme generator** (keystone §3.4), not
> declared as a separate catalog service — it is a byproduct of `tls.cert.own` +
> `tls.cert.own.challenge.via = "caddy80"`. See §3.2.

### 2.2 Host-level Caddy settings (`https_port 8443`, `useInternalCA`)

The per-entry `listenPort = 8443` tells the Caddy generator to key each vhost as
`https://<fqdn>:8443` (keystone §3.2 appends `:${listenPort}` when `!= 443`). But the **global**
`https_port 8443` + `useInternalCA = true` + `services.caddy.enable = true` are **whole-host**
settings the catalog does not currently express. For the no-op migration these stay **hand-written**
in the feature (a thin `caddy-host.nix` retaining the global block):

```nix
# features/cicero-observability/caddy-host.nix  (host-level Caddy settings the catalog can't express yet)
{ inputs, ... }:
{
  flake.modules.nixos.cicero-observability-caddy-host =
    { ... }:
    {
      imports = [ inputs.self.modules.nixos.caddy ];
      services.caddy = {
        enable = true;
        globalConfig = ''
          https_port 8443
        '';
        useInternalCA = true;
      };
    };
}
```

This is the **host-config gap** (§5 #1): until the catalog models a host-level default listen port,
the global `https_port` block remains explicit — the generator only produces the vhost bodies +
cert, which merge into this host Caddy config.

### 2.3 What the generators must render

- **Caddy generator** (keystone §3.2), filtering `host == cicero && managedBy.caddy`:
  - For `cicero-metrics`: key `https://cicero-metrics.plato-splunk.media:8443` (listenPort 8443),
    body = cert-less mTLS `tls { client_auth { mode require_and_verify; trust_pool file { pem_file
    <rootCert> } } }` + `reverse_proxy 127.0.0.1:9100`.
  - For `ca-monitoring`: key `https://ca-monitoring.plato-splunk.media:8443`, body = same mTLS block
    - `reverse_proxy 127.0.0.1:43379`.
- **ACME generator** (keystone §3.4), filtering `host == cicero && managedBy.acme && tls.cert.own`:
  - Only `cicero-metrics` qualifies → `security.acme.certs."cicero-metrics.plato-splunk.media"` with
    `listenHTTP = 127.0.0.1:22479`, `server = c.ca.acmeDirectoryHttp`,
    `group = "cicero-observability"`, `reloadServices = [ "caddy.service" "alloy.service" ]` — **see
    §3.2 reload-target subtlety**.
  - Plus the `http://cicero-metrics.plato-splunk.media` challenge vhost. Today's is the bare
    `reverse_proxy localhost:22479` form, so either `challengeVerbatim`/`extraCaddyConfig` reproduces
    it exactly, or normalizing to `handle /.well-known/acme-challenge/*` is a flagged deviation.
- **Firewall generator** (keystone §3.5): `cicero-metrics`/`ca-monitoring` have
  `access.scope.tailnet` → would open `listenPort` 8443 on `tailscale0`. Since `8443` is already
  a baseline host opening, this is either (a) left to the host file (don't set `managedBy.firewall`),
  or (b) owned by the generator with `8443` removed from `security.nix`. Either way the final port set
  must be byte-identical (§4.3). Recommend **not** opting `managedBy.firewall` for cicero — `8443`/
  `80`/`443` are host-level (step-ca owns 443; 8443/80 are Caddy infra) — keeping the generator out of
  the host-level ports entirely (parent plan §5.1 #7).
- **DNS / OIDC generators**: not imported by cicero; `dns = null` keeps `cicero-metrics` /
  `ca-monitoring` records in `tailnetRewrites` until the dns-records migration.

---

## 3. Operational equivalence argument

### 3.1 Caddy — three vhosts byte-identical

- **Vhost keys.** `https://cicero-metrics.plato-splunk.media:8443` and
  `https://ca-monitoring.plato-splunk.media:8443` derive from `<subdomain>.<zone>` + `:${listenPort}`
  (8443 ≠ 443 so the suffix is appended). The challenge key `http://cicero-metrics.plato-splunk.media`
  comes from the acme generator. All three match today's keys exactly.
- **mTLS bodies (B)/(C).** Both are the cert-less `tls { client_auth { mode require_and_verify;
  trust_pool file { pem_file <c.ca.rootCert> } } }` block + `reverse_proxy 127.0.0.1:<port>`. The
  renderer must emit the **cert-less** `tls { … }` (no `tls <fullchain> <key>` prefix) and preserve
  the `127.0.0.1` upstream token and the exact ports (`9100`, `43379`).
- **Challenge body (A).** `reverse_proxy localhost:22479` + trailing newline — the bare-`reverse_proxy`
  form (not `handle`), `localhost` token preserved.
- **Global config.** `https_port 8443` stays, from the host-level `caddy-host.nix`.

### 3.2 ACME cert — one subtlety: the reload target

Today the cert block has `reloadServices = [ "alloy.service" ]` — **just** Alloy, because the cert is
an Alloy **client** cert (not a Caddy server cert; the mTLS vhosts get their own ACME server certs).
The keystone acme generator (§3.4) hard-codes `reloadServices = [ "caddy.service" ] ++
e.tls.cert.own.reloadServices`, which for this entry would produce `[ "caddy.service" "alloy.service" ]` —
**not byte-identical** to today's `[ "alloy.service" ]`.

This is the **alloy-client-cert reload target gap** (§5 #3). Two equivalence-preserving resolutions:

1. **Schema: `tls.cert.own.reloadCaddy` toggle (default true).** Add a per-entry
   `tls.cert.own.reloadCaddy = mkOption { type = bool; default = true; }`. The generator emits
   `(lib.optional e.tls.cert.own.reloadCaddy "caddy.service") ++ e.tls.cert.own.reloadServices`. cicero-metrics sets
   `tls.cert.own.reloadCaddy = false` → `reloadServices = [ "alloy.service" ]`, byte-identical. This mirrors
   the parent plan's prometheus-client case (a cert consumed by a sibling, not Caddy).
2. **Treat the extra `caddy.service` reload as a reviewed, benign deviation.** Reloading Caddy on this
   cert's renewal is harmless (Caddy doesn't use this cert), but it is still a **behavioral change**
   (an extra reload) and therefore NOT a no-op — so option (1) is preferred.

Recommend **option (1)**. Everything else on the cert (domain, `listenHTTP 127.0.0.1:22479`,
`server c.ca.acmeDirectoryHttp`, `group cicero-observability`) matches, and `users.groups
.cicero-observability` + the Alloy group membership stay in the feature (the group's members are
service-specific — keystone §3.4 note).

### 3.3 The cert-less mTLS gap (`tls { client_auth … }` with no cert files)

The keystone `mtlsTlsLine` (§3.1) emits `tls <certPem> <certKey> { client_auth … }` — it always
names explicit cert files (the kanidm/technitium manual-TLS shape). cicero's mTLS vhosts name **no**
cert (Caddy's built-in ACME supplies the server cert). The renderer must support a **cert-less**
variant: when `tls.mtlsServerCert == null` (new field) emit `tls { client_auth … }`. Without this,
the generator would either inject a bogus `tls <path> <path>` prefix (not byte-identical) or fail.
Flagged in §5 #4.

### 3.4 Firewall — no change

With cicero **not** opting `managedBy.firewall` (recommended §2.3), the firewall generator emits
nothing for cicero, and `_private/cicero/security.nix` keeps `[ 22 80 443 5252 8443 ]` on
`tailscale0` verbatim. Byte-identical. (If instead the generator owned `8443`, `8443` must be removed
from `security.nix` and the resulting set must still equal the list above — but `443` is step-ca's
and `80` fronts the challenge, so cleanest to leave the whole set host-owned.)

### 3.5 node-exporter + alloy — unchanged

`cicero-observability-node-exporter` and `cicero-observability-alloy` are untouched. Alloy still
reads `config.security.acme.certs."cicero-metrics.plato-splunk.media".directory` for its client
cert/key, and still orders after `acme-cicero-metrics.plato-splunk.media.service`. Because the cert's
`directory` and `group` are unchanged, Alloy's config and unit are identical.

**Conclusion:** with the `tls.cert.own.reloadCaddy` toggle (§3.2) and the cert-less mTLS variant (§3.3), every
realized attribute (three vhosts, global config, the cert block, the group, firewall ports, alloy
config) is byte-identical. The deploy is a theoretical no-op. The _only_ candidate deviations
(extra `caddy.service` reload; `handle`-form challenge) are avoided by reproducing the verbatim
current shapes.

---

## 4. Parity gate (exact commands)

> **Prerequisite (from `.kiro/steering/validation.md`):** flake eval reads the **git tree**. Before
> any eval, `git add` the new `features/cicero-observability/*.nix` files; keep the old
> `caddy.nix`/`acme.nix` until the "after" eval passes. Untracked new `.nix` files are invisible to
> `import-tree`.

### 4.1 Caddy vhosts — primary gate

```sh
# whole vhost set on cicero, before and after:
nix eval '.#nixosConfigurations.cicero.config.services.caddy.virtualHosts' --json > /tmp/cicero-vhosts.before
# … migrate …
nix eval '.#nixosConfigurations.cicero.config.services.caddy.virtualHosts' --json > /tmp/cicero-vhosts.after
diff <(jq -S . /tmp/cicero-vhosts.before) <(jq -S . /tmp/cicero-vhosts.after)   # must be empty
```

Per-vhost `--raw` spot checks (byte-exact bodies):

```sh
nix eval '.#nixosConfigurations.cicero.config.services.caddy.virtualHosts."http://cicero-metrics.plato-splunk.media".extraConfig' --raw
# expect: reverse_proxy localhost:22479

nix eval '.#nixosConfigurations.cicero.config.services.caddy.virtualHosts."https://cicero-metrics.plato-splunk.media:8443".extraConfig' --raw
# expect the cert-less mTLS block + reverse_proxy 127.0.0.1:9100

nix eval '.#nixosConfigurations.cicero.config.services.caddy.virtualHosts."https://ca-monitoring.plato-splunk.media:8443".extraConfig' --raw
# expect the cert-less mTLS block + reverse_proxy 127.0.0.1:43379
```

### 4.2 Global config

```sh
nix eval '.#nixosConfigurations.cicero.config.services.caddy.globalConfig' --raw   # expect: https_port 8443
nix eval '.#nixosConfigurations.cicero.config.services.caddy.useInternalCA' --json # expect: true
```

### 4.3 ACME cert — byte-exact, incl. reload target

```sh
nix eval '.#nixosConfigurations.cicero.config.security.acme.certs."cicero-metrics.plato-splunk.media"' --json \
  | jq '{domain, listenHTTP, server, group, reloadServices}'
# expect:
# { "domain": "cicero-metrics.plato-splunk.media",
#   "listenHTTP": "127.0.0.1:22479",
#   "server": "https://ca.plato-splunk.media/acme/http/directory",
#   "group": "cicero-observability",
#   "reloadServices": ["alloy.service"] }      # NOT ["caddy.service","alloy.service"]
```

This is the critical assertion for the §3.2 gap: `reloadServices` MUST be exactly `[ "alloy.service" ]`.

### 4.4 Firewall + alloy no-change checks

```sh
# firewall: byte-identical (cicero does NOT opt managedBy.firewall)
nix eval '.#nixosConfigurations.cicero.config.networking.firewall.interfaces.tailscale0.allowedTCPPorts' --json
# expect: [22,80,443,5252,8443]

# alloy config still references the same cert directory
nix eval '.#nixosConfigurations.cicero.config.environment.etc."alloy/config.alloy".text' --raw \
  | grep -F 'acme.d'   # fullchain.pem / key.pem path unchanged

# the cert group exists
nix eval '.#nixosConfigurations.cicero.config.users.groups.cicero-observability' --json
```

### 4.5 Build gate

```sh
nix run .#nixfmt -- $(git ls-files '*.nix' ':!:repos/**')
nix flake check
nixos-rebuild build --flake .#cicero
```

---

## 5. Schema gaps flagged

These are the catalog-schema shortfalls this module surfaces. Each is a prerequisite for a true
no-op; resolve in [./catalog-and-generators.md](./catalog-and-generators.md) before migrating cicero.

1. **Host-level non-443 `https_port` (host-config gap).** cicero runs **all** Caddy on `:8443`
   (step-ca owns `:443`) via a whole-host `services.caddy.globalConfig = "https_port 8443"`. The
   catalog models listen port **per entry** (`listenPort`), not **per host**. Two options: (a) keep
   the global block hand-written in a thin `caddy-host.nix` (recommended for the no-op — §2.2), and
   rely on `listenPort = 8443` per entry so vhost keys get the `:8443` suffix; or (b) add a host-level
   `homelab.catalogHost.<host>.caddy.httpsPort` that the Caddy generator renders into `globalConfig`
   and defaults each entry's `listenPort`. **This directly parallels praeconinus** (Caddy on `:8443`
   because tailscaled owns `:443`) — a shared "another process owns :443, Caddy runs on :8443"
   host-level pattern worth modeling once (parent plan §5.2 #1).
2. **Cert consumed by a non-Caddy sibling → reload target.** The `cicero-metrics` cert is an **Alloy
   client cert**; its `reloadServices` is `[ "alloy.service" ]` with **no** `caddy.service`. The
   keystone acme generator always prepends `caddy.service`. Add a per-entry
   `tls.cert.own.reloadCaddy = mkOption { type = bool; default = true; }`; cicero sets it `false`. Same shape
   as the `prometheus-client` cert (parent plan index). **Alloy-client-cert reload-target gap.**
3. **Challenge vhost verbatim form.** Today's `http://cicero-metrics` challenge vhost is a bare
   `reverse_proxy localhost:22479` (whole-vhost proxy), **not** the keystone's default
   `handle /.well-known/acme-challenge/* { reverse_proxy 127.0.0.1:<acmePort> }`. For a no-op, the
   acme generator must emit the verbatim bare form here (a `challengeVerbatim` flag or an
   `extraCaddyConfig`-based challenge override), OR normalizing to the `handle` form is an
   explicitly-reviewed, functionally-equivalent deviation (same as the kanidm note, keystone §3.4).
   Note also the `localhost` vs `127.0.0.1` token difference between today's challenge body
   (`localhost`) and the keystone default (`127.0.0.1`).
4. **Cert-less mTLS (`tls { client_auth … }`).** cicero's two mTLS vhosts name **no** explicit cert
   (Caddy's built-in ACME supplies the server cert). The keystone `mtlsTlsLine` always emits
   `tls <certPem> <certKey> { client_auth … }`. Add a `tls.gate.mtls.mtlsServerCert` (nullable) so
   `mtlsTlsLine` emits the cert-less `tls { client_auth … }` when null. (technitium's mTLS vhost —
   [./technitium-caddy.md](./technitium-caddy.md) — likely shares this shape; resolve once.)

---

## 6. Migration checklist (condensed)

- [ ] Baseline captured: §4.1 (whole vhosts JSON + 3 per-vhost `--raw`), §4.2 (globalConfig/
      useInternalCA), §4.3 (cert block), §4.4 (firewall/alloy/group) → `*.before`
- [ ] Keystone schema gaps resolved: host-level `https_port` approach (§5 #1), `tls.cert.own.reloadCaddy`
      toggle (§5 #2), challenge-verbatim option (§5 #3), cert-less `tls.gate.mtls.mtlsServerCert` (§5 #4)
- [ ] `features/cicero-observability/catalog.nix` — `cicero-metrics` + `ca-monitoring` entries (§2.1)
      with `listenPort = 8443`, `gate.mtls.trustPoolFile = c.ca.rootCert`,
      `gate.mtls.mtlsServerCert = null`; cicero-metrics adds `cert.own` with `acmePort = 22479`,
      `certGroup = "cicero-observability"`, `reloadServices = [ "alloy.service" ]`,
      `reloadCaddy = false`, challenge `via = "caddy80"` + verbatim; both `dns = null`
- [ ] `features/cicero-observability/caddy-host.nix` — host-level `enable`/`https_port 8443`/
      `useInternalCA` + base caddy import (§2.2)
- [ ] `caddy.nix` hand-written vhosts deleted; `acme.nix` hand-written cert deleted (now generated);
      `users.groups.cicero-observability` kept in the feature (alloy group membership service-specific)
- [ ] `complete.nix` updated to import `catalog.nix` + `caddy-host.nix` + keep `-node-exporter` /
      `-alloy`; cicero imports `homelab-service-apphost`; cicero does **not** opt `managedBy.firewall`
- [ ] New files `git add`ed (Nix sees the git tree)
- [ ] **Parity gate green:** 3 vhost `--raw` diffs empty (§4.1); globalConfig `https_port 8443` (§4.2);
      cert block byte-exact incl. `reloadServices == ["alloy.service"]` (§4.3); firewall
      `[22,80,443,5252,8443]` + alloy cert dir unchanged (§4.4)
- [ ] DNS deferred: `tailnetRewrites.{cicero-metrics,ca-monitoring,ca} = "cicero"` stay until
      [./dns-records.md](./dns-records.md)
- [ ] `nix run .#nixfmt`, `nix flake check`, `nixos-rebuild build --flake .#cicero` all pass
- [ ] Deployed — confirmed no-op (3 vhosts, global :8443, alloy client cert unchanged)

---

## 7. Cross-references

- **praeconinus parallel (:8443).** cicero and praeconinus **both** run Caddy on `:8443` because a
  different process owns `:443` — step-ca on cicero, tailscaled (Funnel) on praeconinus. Model the
  host-level non-443 listen port once (§5 #1 / parent plan §5.2 #1 / [./praeconinus.md](./praeconinus.md)).
- **prometheus-client parallel (client cert).** The `cicero-metrics` cert is consumed by Alloy, not
  Caddy — same pattern as the `prometheus-client` cert (cert → scrape client, reload the consumer).
  The `tls.cert.own.reloadCaddy = false` toggle (§5 #2) serves both.
- **technitium mTLS parallel.** The cert-less `tls { client_auth … }` mTLS shape (§5 #4) likely also
  appears in [./technitium-caddy.md](./technitium-caddy.md); the `tls.mtlsServerCert` nullable field
  should be designed to cover both.
