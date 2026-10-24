# prometheus — Client-Cert CONSUMER (the no-vhost / client-cert-only schema case)

Status: **PROPOSED**
Date: 2026-10-22
Parent: [../service-consolidation-plan.md](../service-consolidation-plan.md) ·
Index: [./README.md](./README.md) ·
Keystone: [./catalog-and-generators.md](./catalog-and-generators.md)

> **What makes prometheus distinct — and why it stresses the catalog.** Every service migrated so far
> is a **producer**: it serves a vhost and (maybe) terminates a server cert. prometheus is the first
> **consumer** of a client cert. It requests `security.acme.certs."prometheus-client…"` and threads
> that cert into the `tls_config` (`ca_file`/`cert_file`/`key_file`) of its `scrapeConfigs` so it can
> **scrape remote mTLS-guarded metrics endpoints** (cicero, mini, aedilis). The cert is used as a
> **client** credential pointing _outward_, not as a server cert fronting an inbound vhost. This
> stresses the catalog's ability to model a **client-cert-only, no-vhost, scraped-from** service — a
> shape none of the producer plans needed, and the central schema question this document raises.
>
> **Important correction to the simplified framing.** The task context summarizes prometheus as "a
> client-cert consumer with NO vhost." The **live module today actually also serves a `prometheus`
> mTLS + tracing vhost** (identical in shape to loki's `loki-push`). So prometheus is _both_ a
> producer (one mTLS vhost) _and_ a consumer (the client cert). This plan captures **both** surfaces
> verbatim (operational equivalence forbids silently dropping the vhost) and then develops the
> client-cert-only modeling question the consumer half raises. If the intent is to _remove_ the
> `prometheus` vhost, that is a **behavioral change** (not a no-op) and must be a separately-reviewed,
> explicitly-flagged decision — see §3.1 and §5.
>
> **Operational-equivalence contract (from [./README.md](./README.md)):** deploying this revision
> MUST be a theoretical no-op. The `prometheus-client` ACME cert + its HTTP-01 challenge vhost, every
> `scrapeConfigs` `tls_config` referencing that cert dir, the `prometheus` mTLS+tracing vhost, the
> exporters, the postgres monitoring wiring, the Technitium token oneshot/timer, and `failure-notifs`
> must all render byte-identical.

---

## 0. Concerns & shape at a glance

Concerns emitted today (per the [index](./README.md)): **C (client)** — the module's headline
cross-cutting surface is a **client** ACME cert (`prometheus-client`) consumed by scrape jobs, plus
its HTTP-01 challenge vhost. But the live module **also** emits a `prometheus` server vhost
(mTLS+tracing), node/postgres exporters, postgres monitoring wiring, and a Technitium metrics-token
oneshot/timer.

| Surface                       | Today                                                                             | Catalog entry / disposition                                        |
| ----------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Client ACME cert**          | `security.acme.certs."prometheus-client.plato-splunk.media"` (group `prometheus`) | the client-cert-only shape — see §2.1 (the schema question)        |
| Client-cert challenge vhost   | `http://prometheus-client…` → `reverse_proxy 127.0.0.1:22480`                     | emitted by the ACME generator when the cert is modeled             |
| `scrapeConfigs` `tls_config`  | 5 jobs reference the cert dir (`ca_file`/`cert_file`/`key_file`)                  | stays verbatim in `service.nix` — references the cert path         |
| **`prometheus` server vhost** | `tls { client_auth … }` + `tracing { span prometheus }` + `reverse_proxy`         | mTLS+tracing (identical to loki) — see §3.1 (do NOT silently drop) |
| Client-cert challenge port    | `prometheus-client.acmePort = 22480`, loopback (Caddy fronts :80)                 | `tls.cert.own.challenge.via = "caddy80"` → no firewall opening     |
| Exporters (node, postgres)    | `exporters.node` :9100, `exporters.postgres` :9187 (loopback)                     | stays verbatim in `service.nix`                                    |
| postgres monitoring wiring    | `prometheus_exporter` user/db/role + `pg_monitor`                                 | stays verbatim in `service.nix`                                    |
| Technitium token oneshot      | mTLS login → short-lived bearer token for the `aedilis-dns` scrape job            | stays verbatim in `service.nix` (uses the client cert)             |
| DNS (`prometheus`)            | centralized `tailnetRewrites.prometheus = "augustus"`                             | if the vhost stays: `dns.tailnet` on the vhost entry               |
| DNS (`prometheus-client`)     | centralized `tailnetRewrites.prometheus-client = "augustus"`                      | see §2.1 — a client-cert domain that still needs an A/AAAA record  |
| failure-notifs                | `attachServices = [ "prometheus" "prometheus-node-exporter" ]`                    | stays in `service.nix`, colocated with the units                   |

> **The central distinction.** `prometheus-client` is a **domain that owns a cert but fronts no
> service** — Caddy's HTTP-01 challenge for it is the _only_ thing listening on its name, and the cert
> it produces is consumed **outbound** by prometheus's scrape `tls_config`. It is not reverse-proxied
> to anything; there is no backend. This is precisely the "client-cert-only / no-vhost" shape the
> catalog schema must accommodate (§2.1).

---

## 1. Current state — emitted output captured verbatim

### 1.1 The module today: `nix-config/modules/services/prometheus.nix`

Four cross-cutting pieces matter for the catalog (the full runtime — exporters, postgres wiring,
token oneshot — is quoted where it touches the cert).

**(a) The client cert — the consumer credential.** This is the headline surface:

```nix
# Client certificate for Prometheus to scrape mTLS-guarded remote targets
security.acme.certs."${c.services.prometheus-client.domain}" = {
  domain = c.services.prometheus-client.domain;          # prometheus-client.plato-splunk.media
  listenHTTP = "127.0.0.1:${builtins.toString c.services.prometheus-client.acmePort}";  # :22480
  server = c.ca.acmeDirectoryHttp;                       # internal step-ca
  group = "prometheus";                                  # per-service cert group
  reloadServices = [ "prometheus.service" ];             # reload prometheus (NOT caddy) on renewal
};

services.caddy.virtualHosts."http://${c.services.prometheus-client.domain}" = {
  extraConfig = ''
    reverse_proxy localhost:${builtins.toString c.services.prometheus-client.acmePort}
  '';
};
```

**(b) The scrape jobs that CONSUME the cert.** Five scrape jobs reference the cert directory as a
**client** credential (`cert_file`/`key_file`) plus the CA (`ca_file`) to verify the remote server.
The repeated `tls_config` block (identical across the five remote-mTLS jobs):

```nix
tls_config = {
  ca_file = toString c.ca.rootCert;                       # verify the remote server
  cert_file = "${config.security.acme.certs."${c.services.prometheus-client.domain}".directory}/fullchain.pem";  # OUR client cert
  key_file  = "${config.security.acme.certs."${c.services.prometheus-client.domain}".directory}/key.pem";        # OUR client key
  server_name = …;                                        # per-target SNI
};
```

The five jobs using it (with their `server_name`):

| job_name       | target                                                                                  | server_name                                |
| -------------- | --------------------------------------------------------------------------------------- | ------------------------------------------ |
| `caddy-mini`   | `mini-caddy-metrics.plato-splunk.media`                                                 | `mini-caddy-metrics.plato-splunk.media`    |
| `jellyfin`     | `mini-jellyfin-metrics.plato-splunk.media`                                              | `mini-jellyfin-metrics.plato-splunk.media` |
| `step-ca`      | `${c.ca.metricsDomain}:${c.ca.metricsPort}`                                             | `c.ca.metricsDomain`                       |
| `cicero-node`  | `${c.services.cicero-metrics.domain}:${c.services.cicero-metrics.port}`                 | `c.services.cicero-metrics.domain`         |
| `aedilis-node` | `${c.services.dns-metrics.domain}:${c.services.dns-metrics.port}`                       | `c.services.dns-metrics.domain`            |
| `aedilis-dns`  | same dns-metrics target, **plus** `authorization.credentials_file` (short-lived bearer) | `c.services.dns-metrics.domain`            |

(Six `tls_config` occurrences counting `aedilis-dns`, which adds the Technitium bearer token on top of
the same client cert.) The remaining scrape jobs (`prometheus`, `node`, `caddy`, `loki`, `postgres`,
`tailscale`, `unpoller`) are plain loopback/tailnet HTTP scrapes with **no** `tls_config`.

**(c) The `prometheus` SERVER vhost (mTLS + tracing — the producer half the framing omits):**

```nix
# Caddy reverse proxy with mTLS (Prometheus has no OIDC)
services.caddy.virtualHosts."${svc.url}" = {       # svc = constants.services.prometheus
  extraConfig = ''
    tls {
      client_auth {
        mode require_and_verify
        trust_pool file {
          pem_file ${c.ca.rootCert}
        }
      }
    }
    tracing {
      span prometheus
    }
    reverse_proxy 127.0.0.1:${builtins.toString svc.port}
  '';
};
```

**(d) failure-notifs + the Technitium metrics-token oneshot/timer** (the oneshot uses the client cert
for its mTLS login; quoted in §1.6):

```nix
services.failure-notifs.attachServices = [
  "prometheus"
  "prometheus-node-exporter"
];
```

### 1.2 Constants it reads: `nix-config/modules/service-registry.nix`

```nix
prometheus = {
  subdomain = "prometheus";
  domain = mkDomain "prometheus";   # prometheus.plato-splunk.media
  url = mkUrl "prometheus";         # https://prometheus.plato-splunk.media
  port = 9090;
  stateDir = "/var/lib/prometheus2";
};

prometheus-client = {
  subdomain = "prometheus-client";
  domain = mkDomain "prometheus-client";   # prometheus-client.plato-splunk.media
  acmePort = 22480;
  # NOTE: no `url`, no `port` — it is NOT a reverse-proxied service. Cert-only.
};

# remote mTLS scrape targets:
cicero-metrics = { domain = mkDomain "cicero-metrics"; port = 8443; acmePort = 22479; };  # (acmePort is cicero's, not augustus's)
dns-metrics    = { domain = mkDomain "dns-metrics";    port = 9443; acmePort = 22481; };  # (acmePort is aedilis's)
ca.rootCert         = certsDir + "/alford-root.crt";
ca.acmeDirectoryHttp = "https://ca.plato-splunk.media/acme/http/directory";
ca.metricsDomain    = mkDomain "ca-monitoring";
ca.metricsPort      = 8443;
```

> **Tell-tale of the consumer shape:** the `prometheus-client` constant has **no `url` and no `port`**
> — unlike every producer entry (`prometheus`, `grafana`, `loki-push`, …). It carries only
> `subdomain`/`domain`/`acmePort`. There is nothing to reverse-proxy; the name exists solely to own a
> cert (and to satisfy the ACME HTTP-01 challenge that mints it).

### 1.3 The resolved emitted client-cert output

```nix
security.acme.certs."prometheus-client.plato-splunk.media" = {
  domain = "prometheus-client.plato-splunk.media";
  listenHTTP = "127.0.0.1:22480";
  server = "https://ca.plato-splunk.media/acme/http/directory";
  group = "prometheus";
  reloadServices = [ "prometheus.service" ];
};

services.caddy.virtualHosts."http://prometheus-client.plato-splunk.media" = {
  extraConfig = ''
    reverse_proxy localhost:22480
  '';
};
```

> **Byte notes + approved deviation.** The challenge vhost body is today `reverse_proxy
> localhost:22480` + trailing newline — the **whole** `http://` vhost is a bare reverse-proxy to the
> loopback acmePort, NOT a `handle /.well-known/acme-challenge/*` wrapper. The upstream token
> standardizes to **`127.0.0.1`** (operator-approved, catalog-and-generators §7.8 #22), so the
> generated body is `reverse_proxy 127.0.0.1:22480\n` and the parity gate shows **only** that
> `localhost → 127.0.0.1` substitution. The bare-vs-`handle` form must still be preserved via
> `tls.cert.own.challenge.body.bare = { }` (keystone §7.2 #8 — see §5). The cert block uses `group =
> "prometheus"` and reloads **`prometheus.service`** (not `caddy.service`) on
> renewal — the opposite of a server cert, because the _consumer_ (prometheus) must pick up the
> rotated client cert, and there is no Caddy vhost serving this name.

### 1.4 The resolved `prometheus` server vhost output

```nix
services.caddy.virtualHosts."https://prometheus.plato-splunk.media" = {
  extraConfig = ''
    tls {
      client_auth {
        mode require_and_verify
        trust_pool file {
          pem_file /nix/store/…-certs/alford-root.crt
        }
      }
    }
    tracing {
      span prometheus
    }
    reverse_proxy 127.0.0.1:9090
  '';
};
```

This is byte-for-byte the **same shape as loki's `loki-push`** (mTLS `client_auth` + `tracing { span
… }` + `reverse_proxy 127.0.0.1:<port>`), just with span `prometheus` and port `9090`. See
[./loki.md](./loki.md) §2.3 for the full renderer composition discussion — the same `tls → tracing →
reverse_proxy` ordering + bare-`tls { client_auth }` managed-cert concerns apply identically here.

### 1.5 The DNS records (centralized, in `tailnetRewrites`)

The module emits **no** DNS records. Both names resolve via `tailnetRewrites`:

```nix
tailnetRewrites = {
  # …
  prometheus = "augustus";          # the server vhost name
  prometheus-client = "augustus";   # the client-cert name — STILL needs an A/AAAA!
  # …
};
```

Both become apex A + AAAA under `plato-splunk.media` pointing at augustus's tailnet addresses:

```
prometheus.plato-splunk.media.         A    100.95.250.77   / AAAA fd7a:115c:a1e0::6301:fa4d
prometheus-client.plato-splunk.media.  A    100.95.250.77   / AAAA fd7a:115c:a1e0::6301:fa4d
```

> **Why a client-cert name needs an A/AAAA at all:** the step-ca ACME HTTP-01 challenge must reach the
> `prometheus-client` name to validate issuance — Caddy fronts :80 and proxies
> `/.well-known/acme-challenge/*` to loopback `22480`. For that, `prometheus-client.plato-splunk.media`
> must resolve (to augustus, where the challenge listener lives). So even a no-vhost, cert-only service
> needs DNS — a subtlety the catalog's `dns` field must express for the client-cert entry (§2.1).

### 1.6 The Technitium metrics-token oneshot (consumes the client cert too)

The `aedilis-dns` scrape job needs a short-lived bearer token on top of the mTLS client cert. A
oneshot logs in over mTLS **using the same `prometheus-client` cert** and writes a token the scrape
job reads via `authorization.credentials_file = "/run/technitium-metrics/token"`. The login curl:

```sh
curl -fsS \
  --cacert "${toString c.ca.rootCert}" \
  --cert "${promClientCert}/fullchain.pem" \   # promClientCert = security.acme.certs.<prometheus-client>.directory
  --key  "${promClientCert}/key.pem" \
  "https://dns-metrics.plato-splunk.media:9443/api/user/login?user=prometheus&pass=$PASS&totp=$CODE&includeInfo=false"
```

plus a timer (`OnUnitActiveSec = 20min`) and `tmpfiles` to pre-create the token file. **All of this
stays verbatim in `service.nix`** — it is runtime wiring that references the client cert directory by
the same path the scrape jobs use.

### 1.7 The firewall (loopback challenge → no module contribution)

prometheus opens **nothing** service-attributable. The client-cert challenge listens on loopback
`127.0.0.1:22480` and is fronted by Caddy on `:80` (baseline). The `prometheus` server vhost rides
`443` (baseline). The exporters bind loopback (`9100`, `9187`). So there is **no
prometheus-attributable firewall opening to migrate** — the firewall generator adds nothing.

### 1.8 Properties to preserve (invariants)

- **Client cert preserved exactly:** `security.acme.certs."prometheus-client.plato-splunk.media"` with
  `listenHTTP = 127.0.0.1:22480`, `server = ca.acmeDirectoryHttp`, `group = "prometheus"`,
  `reloadServices = [ "prometheus.service" ]`.
- **Client-cert challenge vhost preserved exactly:** bare `reverse_proxy localhost:22480` on
  `http://prometheus-client…` (NOT the `handle …acme-challenge` form).
- **All scrape `tls_config` blocks preserved exactly:** `ca_file = <ca.rootCert>`, `cert_file`/
  `key_file` pointing at the `prometheus-client` cert directory, per-job `server_name`.
- **The `prometheus` server vhost preserved exactly** (mTLS + tracing + `reverse_proxy 127.0.0.1:9090`)
  — _unless_ its removal is an explicitly-flagged, separately-reviewed behavioral change (§3.1 / §5).
- **Exporters, postgres monitoring wiring, Technitium token oneshot/timer/tmpfiles copied verbatim.**
- **failure-notifs unchanged:** `[ "prometheus" "prometheus-node-exporter" ]`.
- **DNS:** both `prometheus` and `prometheus-client` A/AAAA records survive the DNS cutover.
- **No new firewall opening.**

---

## 2. Target state — colocated feature + the client-cert-only schema question

Replace `services/prometheus.nix` with a `features/prometheus/` directory (parent plan §2.0):

```
features/prometheus/
├── catalog.nix     # homelab.catalog entries: the client-cert entry (+ the prometheus vhost entry)
├── service.nix     # services.prometheus (scrapeConfigs, exporters), postgres wiring,
│                   #   Technitium token oneshot/timer/tmpfiles, failure-notifs (the runtime)
└── complete.nix    # flake.modules.nixos.prometheus = { imports = [ prometheus-catalog prometheus-service ]; }
```

- **`service.nix`** holds nearly everything — `services.prometheus` (all `scrapeConfigs` including the
  `tls_config` client-cert references, exporters), the `prometheus_exporter` postgres user/db/role,
  the Technitium token oneshot/timer/tmpfiles, and `failure-notifs`. These reference the client-cert
  directory by `config.security.acme.certs."prometheus-client…".directory`, which the ACME generator
  still produces — so the reference path is unchanged.
- **`catalog.nix`** holds the cross-cutting cert + (producer) vhost entries. This is where the
  **client-cert-only** modeling question lives.

### 2.1 Modeling a client-cert-only / no-vhost service (the central schema question)

`prometheus-client` is a service that **owns a cert but fronts no backend**. How should the catalog
represent it? Three candidate shapes, evaluated against the keystone schema
([./catalog-and-generators.md](./catalog-and-generators.md) §2):

**Option A — `backend.none = { }` (a no-backend vhost class).** Add a `none` variant to
the `backend` attrTag. The Caddy generator, seeing `backend.none`, emits **no** `https://` reverse-proxy
vhost, but the ACME generator still emits the cert + the `http://` challenge vhost (driven by
`tls.cert.own`). Pros: reuses the existing `tls`/`dns` fields unchanged; the cert, challenge, and DNS all
flow from one entry. Cons: adding a `none` variant means the `reverseProxy → port required` assertion
must special-case it.

**Option B — a dedicated `clientCert` flag / sub-block, decoupled from `backend`.** Add
`tls.clientCert = true` (or a top-level `clientCertOnly = true`) meaning "this entry exists only to
provision a cert that a _consumer_ uses; emit the `security.acme.certs` entry + challenge vhost + DNS,
but NO `https://` vhost and NO backend." The generator gates the server-vhost emission on `!
clientCertOnly`. Pros: makes the intent explicit and greppable ("this is a consumer credential, not a
server"); lets `reloadServices` point at the consumer (`prometheus.service`) naturally; leaves
`backendType` untouched. Cons: a second axis (`clientCertOnly`) that the generators must honor
everywhere they branch on `backend`.

**Option C — don't model it in the catalog at all; keep the client cert in `service.nix`.** Leave
`security.acme.certs."prometheus-client…"` + its challenge vhost hand-written in the prometheus
feature's `service.nix`, exactly as today, and only migrate the **producer** `prometheus` vhost into
the catalog. Pros: zero schema change; the consumer credential stays colocated with its sole consumer
(prometheus); trivially byte-identical. Cons: leaves one `security.acme.certs` + challenge vhost
outside the catalog, so the "one declaration per service" goal is only partially met for this service,
and the firewall/DNS for `prometheus-client` are not catalog-derived.

**Recommendation: Option B (a `clientCertOnly` entry), with Option C as the pragmatic fallback.**
Option B cleanly captures the reality that `prometheus-client` is a **cert-only, scraped-from,
internal** service: it has `tls.cert.own` + `acmePort = 22480` (so the ACME generator mints
it), `dns.tailnet = { }` (so the challenge name resolves — §1.5), **no `backend`** (`backend.none = { }`) and **no server
vhost**, and `access.scope` that opens nothing (the challenge is loopback-fronted). Concretely:

```nix
# features/prometheus/catalog.nix  — the CLIENT-CERT-ONLY entry
homelab.catalog.prometheus-client = {
  subdomain = "prometheus-client";
  host = "augustus";

  # NO backend — this entry fronts nothing. (Option B: a clientCertOnly marker.)
  clientCertOnly = true;            # NEW schema field: emit cert + challenge + DNS, but NO https vhost
  backend.none = { };               # fronts nothing

  tls = {
    cert.own = {
      # mint via step-ca -> security.acme.certs entry
      acmePort = 22480;
      certGroup = "prometheus";       # the consumer's group reads the cert
      reloadServices = [ "prometheus.service" ];   # reload the CONSUMER, not caddy
      challenge.via = "caddy80";                   # loopback acmePort, Caddy fronts :80 -> no firewall opening
      # the bare `reverse_proxy localhost:<acmePort>` challenge body (NOT handle-wrapped) — see §5
      challenge.body.bare = { };
    };
  };

  # The cert name must still resolve for the ACME HTTP-01 challenge (§1.5).
  dns.tailnet = { };                # A/AAAA for prometheus-client -> augustus
  access.scope.tailnet = { };       # opens nothing new (loopback challenge; 80/443 baseline)
};
```

This answers the task's schema question directly: **a client-cert-only service is modeled as an entry
with `backend.none = { }` and a `clientCertOnly` marker — it drives the ACME cert + challenge + DNS, but the
Caddy server-vhost generator skips it.** `tls.cert.own` genuinely mints a cert, `tls.gate` is
irrelevant (no vhost to gate), and `reloadServices` points at the **consumer** process. The consumer
side (the scrape `tls_config` referencing the cert directory) stays in `service.nix` — the catalog
expresses "this cert exists and resolves"; the service expresses "I use it to scrape X."

> If the keystone PR prefers not to grow the schema, fall back to **Option C**: keep the
> `prometheus-client` cert + challenge vhost in `service.nix` verbatim and migrate only the producer
> `prometheus` vhost. That is a strictly smaller change and still a clean no-op; it just leaves the
> consumer credential un-catalogued. The recommendation is B because the catalog's stated goal is
> _one declaration per cross-cutting fact_, and the client cert **is** a cross-cutting fact (it ties
> augustus to remote mTLS endpoints).

### 2.2 The producer `prometheus` vhost entry (do not silently drop)

If the `prometheus` server vhost is retained (the no-op path), it is an ordinary mTLS+tracing entry —
identical in shape to loki's `loki-push`:

```nix
# features/prometheus/catalog.nix  — the PRODUCER vhost entry (kept for no-op parity)
homelab.catalog.prometheus = {
  subdomain = "prometheus";
  host = "augustus";
  backend.reverseProxy.port = 9090;
  tls = {
    cert.shared = { };                # Caddy-managed server cert (no security.acme.certs)
    gate.mtls.trustPoolFile = c.ca.rootCert;
  };
  access.scope.tailnet = { };
  dns.tailnet = { };                  # prometheus A/AAAA -> augustus
};
```

See [./loki.md](./loki.md) §2.3 and §5 for the renderer composition + the two renderer gaps (block
ordering `tls → tracing → reverse_proxy`; bare `tls { client_auth }` managed-cert mTLS) — they apply
verbatim to this entry.

### 2.3 `features/prometheus/service.nix` (the runtime — verbatim)

Everything else moves unchanged: `services.prometheus` (all `scrapeConfigs` with their client-cert
`tls_config` blocks, `exporters.node`, `exporters.postgres`, `extraFlags`, `globalConfig`,
`retentionTime`, `stateDir`), the `prometheus_exporter` postgres user/db/`pg_monitor` role, the
Technitium metrics-token oneshot/timer/tmpfiles, and:

```nix
services.failure-notifs.attachServices = [
  "prometheus"
  "prometheus-node-exporter"
];
```

The scrape `tls_config` blocks continue to reference
`config.security.acme.certs."prometheus-client.plato-splunk.media".directory` — the ACME generator
(driven by the §2.1 catalog entry) produces that exact cert at that exact directory, so the reference
resolves identically.

---

## 3. Operational equivalence argument

### 3.1 The `prometheus` server vhost — the one real risk

The simplified framing ("prometheus has NO vhost") conflicts with the live module, which **does**
serve a `prometheus` mTLS+tracing vhost (§1.4). **Operational equivalence forbids dropping it as part
of a "no-op" migration.** Two paths:

- **No-op path (recommended for this migration):** retain the vhost via the §2.2 catalog entry. The
  rendered body must be byte-identical to §1.4 (subject to the loki renderer fixes). The deploy stays
  a true no-op.
- **Removal path (separate change):** if the intent is that prometheus should _not_ be reachable
  inbound (consumer-only), removing the vhost is a **behavioral change** — it closes an existing
  surface. That must be a distinct, explicitly-flagged, separately-reviewed commit (the README permits
  intentional deviations only when flagged), with its own parity note documenting that the
  `https://prometheus.plato-splunk.media` vhost is _intentionally_ gone. Do **not** fold it into the
  catalog migration silently.

This plan proceeds on the **no-op path**. If removal is desired, do it as a follow-up with its own
review.

### 3.2 Client cert (augustus) — byte-identical

- `security.acme.certs."prometheus-client.plato-splunk.media"`: the §2.1 entry yields the same
  `domain`, `listenHTTP = 127.0.0.1:22480`, `server = ca.acmeDirectoryHttp`, `group = "prometheus"`,
  `reloadServices = [ "prometheus.service" ]`. Identical.
- The `http://prometheus-client…` challenge vhost: the ACME generator must emit the **bare**
  `reverse_proxy localhost:22480` body (not the `handle …acme-challenge` form) to match §1.3 — see the
  §5 renderer note.

### 3.3 Scrape `tls_config` (augustus) — byte-identical

- Every `tls_config` references `config.security.acme.certs."prometheus-client…".directory`, which is
  unchanged (same cert, same directory). `ca_file`/`cert_file`/`key_file`/`server_name` all resolve to
  the same strings. The entire `services.prometheus.scrapeConfigs` list is copied verbatim into
  `service.nix`. Identical.

### 3.4 DNS (aedilis) — both records reproduced

- Today: `tailnetRewrites.prometheus = "augustus"` and `tailnetRewrites.prometheus-client =
  "augustus"` → two apex A+AAAA pairs at augustus's tailnet IPs.
- New: the §2.2 (`prometheus`) and §2.1 (`prometheus-client`) entries both set `dns.tailnet = { };
  host = "augustus"` → the DNS generator emits the same A/AAAA pairs from
  `constants.hosts.augustus.tailscale.{v4,v6}`. Identical; upsert-only preserved. (Under Option C,
  `prometheus-client` DNS stays in `tailnetRewrites` until separately migrated.)

### 3.5 Firewall / exporters / postgres wiring / token oneshot / failure-notifs — unchanged

- No service-attributable firewall opening (loopback challenge + baseline 80/443). `networking.
  firewall` byte-identical.
- Exporters, `prometheus_exporter` postgres user/db/role, the Technitium token oneshot/timer/tmpfiles
  are copied verbatim into `service.nix` → identical units and resources.
- `failure-notifs.attachServices` still contains `"prometheus"` + `"prometheus-node-exporter"`.

**Conclusion:** on the no-op path, every realized attribute (client cert, challenge vhost, all scrape
`tls_config`, the `prometheus` server vhost, exporters, postgres wiring, token oneshot/timer, DNS,
firewall, failure-notifs) is identical before and after — subject to (a) the loki renderer fixes for
the `prometheus` vhost and (b) the ACME generator emitting the bare challenge-vhost body (§5). The
deploy is a theoretical no-op.

---

## 4. Parity gate (exact commands)

> **Prerequisite (`.kiro/steering/validation.md`):** `git add` the new `features/prometheus/*.nix`
> files before any eval (keep `services/prometheus.nix` until "after" passes).

### 4.1 Client cert — the primary gate

```sh
# before and after — must be byte-identical:
nix eval '.#nixosConfigurations.augustus.config.security.acme.certs."prometheus-client.plato-splunk.media"' --json \
  > /tmp/prom-client-cert.before     # (…after → .after)
diff /tmp/prom-client-cert.before /tmp/prom-client-cert.after   # MUST be empty
```

Confirms `listenHTTP = 127.0.0.1:22480`, `server = …/acme/http/directory`, `group = "prometheus"`,
`reloadServices = ["prometheus.service"]`, `directory` path unchanged.

### 4.2 Client-cert challenge vhost — bare reverse_proxy form

```sh
nix eval \
  '.#nixosConfigurations.augustus.config.services.caddy.virtualHosts."http://prometheus-client.plato-splunk.media".extraConfig' \
  --raw
```

Must be exactly `reverse_proxy 127.0.0.1:22480\n` after (was `localhost:22480` before — the approved
`localhost → 127.0.0.1` substitution; NOT a `handle /.well-known/acme-challenge/*` wrapper).
Before/after diff MUST show only that one-token change.

### 4.3 Scrape `tls_config` consumption — cert path threaded correctly

```sh
# dump the full scrape config and confirm every tls_config points at the prometheus-client cert dir:
nix eval '.#nixosConfigurations.augustus.config.services.prometheus.scrapeConfigs' --json \
  > /tmp/prom-scrape.before          # (…after → .after)
diff /tmp/prom-scrape.before /tmp/prom-scrape.after   # MUST be empty

# spot-check the client-cert references survive:
nix eval '.#nixosConfigurations.augustus.config.services.prometheus.scrapeConfigs' --json \
  | jq '[.[] | select(.tls_config) | .job_name]'
# -> ["caddy-mini","jellyfin","step-ca","cicero-node","aedilis-node","aedilis-dns"]
```

### 4.4 `prometheus` server vhost — no-op path (keep) OR flagged removal

```sh
# NO-OP PATH: byte-identical before/after (same mTLS + tracing + reverse_proxy 127.0.0.1:9090):
nix eval \
  '.#nixosConfigurations.augustus.config.services.caddy.virtualHosts."https://prometheus.plato-splunk.media".extraConfig' \
  --raw > /tmp/prom-vhost.before     # (…after → .after)
diff /tmp/prom-vhost.before /tmp/prom-vhost.after   # MUST be empty on the no-op path
```

If the body differs ONLY by `tls`/`tracing` ordering, that is the flagged loki renderer issue
([./loki.md](./loki.md) §5) — fix the renderer, don't accept the diff. If the vhost is intentionally
**removed**, this key must be absent after — a deliberate, separately-reviewed deviation (§3.1), not
part of the no-op migration.

### 4.5 DNS parity (with the dns-records migration)

```sh
nix eval \
  '.#nixosConfigurations.aedilis.config.services.technitium-server-complete.provision.ensureDnsRecords.zones' \
  --json \
  | jq '."plato-splunk.media".records | map(select(.name == "prometheus" or .name == "prometheus-client"))'
```

Before/after must contain the same A (`100.95.250.77`) + AAAA (`fd7a:115c:a1e0::6301:fa4d`) pairs for
**both** `prometheus` and `prometheus-client`.

### 4.6 Runtime no-change checks

```sh
# exporters + postgres wiring + token oneshot unchanged:
nix eval '.#nixosConfigurations.augustus.config.services.prometheus.exporters.node' --json
nix eval '.#nixosConfigurations.augustus.config.services.prometheus.exporters.postgres' --json
nix eval '.#nixosConfigurations.augustus.config.systemd.services.technitium-metrics-token' --json
nix eval '.#nixosConfigurations.augustus.config.systemd.timers.technitium-metrics-token' --json

# failure-notifs still attaches both units:
nix eval '.#nixosConfigurations.augustus.config.services.failure-notifs.attachServices' --json \
  | jq '[index("prometheus"), index("prometheus-node-exporter")] | all(. != null)'   # -> true

# firewall byte-identical:
nix eval '.#nixosConfigurations.augustus.config.networking.firewall.allowedTCPPorts' --json
nix eval '.#nixosConfigurations.augustus.config.networking.firewall.interfaces.tailscale0.allowedTCPPorts' --json
```

### 4.7 Build gate

```sh
nix run .#nixfmt -- $(git ls-files '*.nix' ':!:repos/**')
nix flake check
nixos-rebuild build --flake .#augustus
```

---

## 5. Schema / renderer gaps this plan surfaces

prometheus is the service that forces the catalog to model a **consumer**, and it exposes gaps the
producer plans did not:

1. **Client-cert-only / no-vhost / scraped-from service shape (the central schema question).** The
   catalog, as drafted, assumes every entry fronts a `backend` and serves a vhost. `prometheus-client`
   owns a cert but fronts nothing — it is consumed _outbound_ by scrape jobs. **Resolution
   (recommended, §2.1 Option B):** add a `clientCertOnly` marker (or a `backend.none = { }`
   variant) so an entry can drive `security.acme.certs` + the HTTP-01 challenge vhost + DNS **without**
   emitting an `https://` server vhost, with `reloadServices` pointing at the **consumer** process. The
   key insight: **cert ownership is orthogonal to serving a vhost** — a cert can be a client
   credential. The schema must separate "mint/own this cert" from "front this backend." (Fallback:
   Option C — keep the client cert in `service.nix`, un-catalogued.)

2. **ACME challenge-vhost body: `handle`-wrapped vs bare `reverse_proxy` (byte-parity).** The keystone
   ACME generator (§3.4) defaults the challenge vhost to a `handle /.well-known/acme-challenge/* {
   reverse_proxy … }` wrapper, but prometheus-client's current challenge vhost is a **bare**
   `reverse_proxy localhost:22480` over the whole `http://` vhost (the kanidm-style form). The two are
   functionally equivalent for ACME, but **not byte-identical**. **Resolution:** either the ACME
   generator must support emitting the bare form per-entry (an escape-hatch / `challengeStyle` flag),
   or prometheus-client accepts the normalized `handle` form as an explicitly-justified reviewed
   deviation (confirmed functionally equivalent). Prefer the former for a true no-op. (This is the same
   note the keystone §3.4 flags for kanidm.)

3. **`reloadServices` points at a consumer, not caddy (already supported — confirmation).** For a
   server cert, renewal reloads `caddy.service`. For this **client** cert, renewal must reload
   **`prometheus.service`** so prometheus picks up the rotated client credential — and must **not**
   reload caddy (caddy serves nothing on this name). The keystone schema's `tls.reloadServices` list
   already allows arbitrary units, and the generator prepends `caddy.service` by default — which is
   **wrong** for a client-cert-only entry (caddy need not reload). **Resolution:** for
   `clientCertOnly` entries, the ACME generator must **not** prepend `caddy.service`; the reload set is
   exactly the declared `reloadServices` (`[ "prometheus.service" ]`). This is a generator branch tied
   to the §5 #1 `clientCertOnly` marker.

4. **The inbound `prometheus` vhost contradicts the "consumer-only" framing (behavioral, not schema).**
   Flagged in §3.1: the live module serves a `prometheus` mTLS+tracing vhost. Whether to keep it
   (no-op) or remove it (consumer-only) is a **product decision**, not a schema gap — but the catalog
   must not let the migration drop it silently. Captured here so the reviewer decides explicitly.

5. **(Inherited from loki) mTLS + tracing renderer composition.** The `prometheus` server vhost (if
   kept) needs the same two loki renderer fixes: `tls → tracing → reverse_proxy` block ordering, and
   the bare `tls { client_auth … }` managed-cert mTLS form. See [./loki.md](./loki.md) §5 — no new
   work beyond loki's.

---

## 6. Migration checklist (condensed)

- [ ] Baseline captured (§4.1 client cert, §4.2 challenge vhost `--raw`, §4.3 scrape config, §4.4
      `prometheus` vhost `--raw`, §4.6 exporters/token/firewall → `*.before`)
- [ ] **Decision recorded:** keep the `prometheus` server vhost (no-op) or remove it (separate flagged
      change) — §3.1. This plan assumes keep.
- [ ] **Schema decision recorded:** Option B `clientCertOnly` marker (recommended) vs Option C
      (client cert stays in `service.nix`) — §2.1 / §5 #1.
- [ ] Keystone changes landed (if Option B): `clientCertOnly` schema field; ACME generator emits cert
      + challenge + DNS but no `https` vhost for such entries; `reloadServices` not prefixed with
      `caddy.service` for client-cert-only entries (§5 #3); bare challenge-vhost body option (§5 #2);
      plus the loki renderer fixes for the `prometheus` vhost (§5 #5)
- [ ] `features/prometheus/catalog.nix` — the `prometheus-client` client-cert-only entry (§2.1) and
      (no-op path) the `prometheus` mTLS+tracing vhost entry (§2.2)
- [ ] `features/prometheus/service.nix` — `services.prometheus` (scrapeConfigs incl. client-cert
      `tls_config`, exporters, extraFlags), postgres `prometheus_exporter` user/db/`pg_monitor`,
      Technitium token oneshot/timer/tmpfiles, `failure-notifs.attachServices` (all verbatim)
- [ ] `features/prometheus/complete.nix` — aggregates to `flake.modules.nixos.prometheus`;
      `hosts/augustus.nix` import name preserved
- [ ] ACME generator opted in (`managedBy.acme`) for `prometheus-client`; Caddy generator opted in
      (`managedBy.caddy`) for the `prometheus` vhost; hand-written cert + both vhosts deleted
- [ ] Old `services/prometheus.nix` removed
- [ ] New files `git add`ed
- [ ] **Parity gate green:** client cert JSON diff empty (§4.1); challenge vhost bare `reverse_proxy
      localhost:22480` (§4.2); scrape config diff empty + 6 `tls_config` jobs present (§4.3);
      `prometheus` vhost `--raw` diff empty on the no-op path (§4.4); exporters/token/firewall/
      failure-notifs unchanged (§4.6)
- [ ] DNS parity deferred to [./dns-records.md](./dns-records.md) (§4.5) for BOTH `prometheus` and
      `prometheus-client`; `tailnetRewrites` entries removed there
- [ ] `nix run .#nixfmt`, `nix flake check`, `nixos-rebuild build --flake .#augustus` all pass
- [ ] Deployed — confirmed no-op (client cert, scrape config, `prometheus` vhost, token oneshot,
      exporters, failure-notifs unchanged)
