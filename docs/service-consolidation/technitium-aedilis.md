# technitium-aedilis — Three Manual Certs + Direct Tailnet ACME Challenge Ports (HIGH complexity)

Status: **PROPOSED**
Date: 2026-10-22
Parent: [../service-consolidation-plan.md](../service-consolidation-plan.md) ·
Index: [./README.md](./README.md) ·
Keystone: [./catalog-and-generators.md](./catalog-and-generators.md) ·
Manual-TLS reference: [./kanidm.md](./kanidm.md) ·
Reference structure: [./it-tools.md](./it-tools.md) ·
Companion (vhosts): [./technitium-caddy.md](./technitium-caddy.md)

> **This is the highest-complexity ACME/firewall case in the fleet.** aedilis's Technitium
> deployment terminates **three** manual certs — one **public Let's Encrypt** cert (for native
> DoH/DoT/DoQ) and **two step-ca** certs (admin UI + metrics Caddy vhosts) — and is the **only** host
> that opens **direct tailnet ACME HTTP-01 challenge ports** (`22481`, `22483` on `tailscale0`).
> It is also unlike every other service in the index because it is **already option-driven**: all of
> this is produced via `services.technitium-server-complete.*` option values set by the aedilis
> wiring module. This plan covers the **ACME certs + the three HTTP-01 challenge vhosts + the two
> direct-challenge firewall ports** (concerns **C F**, plus the `http://` challenge vhosts, which are
> **V**). The **admin/metrics HTTPS vhosts** (concerns **V**, incl. mTLS + path allowlist) are the
> companion plan [./technitium-caddy.md](./technitium-caddy.md).
>
> **Operational-equivalence contract (from [./README.md](./README.md)):** deploying this revision
> MUST be a theoretical no-op. The migration changes _where_ the cert/challenge/firewall config is
> declared, never _what_ is realized. For technitium-aedilis there are **zero** permitted intentional
> deviations — all three `security.acme.certs.*` blocks, all three `http://` challenge vhosts, and the
> `tailscale0` `22481`/`22483` firewall openings must render byte-identical.

---

## 0. Why technitium-aedilis is the hardest cert/firewall case

Where kanidm ([./kanidm.md](./kanidm.md)) is the canonical _manual-TLS vhost_ exemplar (one internal
cert, shared cert group, bespoke transport), technitium-aedilis is the canonical _cert-mix +
direct-challenge-firewall_ exemplar. It stacks four things no other module does simultaneously:

1. **A public Let's Encrypt cert** (`dns.plato-splunk.media`) with a **custom `email`**, an explicit
   LE `server` directory, and a **three-unit `reloadServices` list** (`caddy` +
   `technitium-dns-server` + `technitium-provision`). Every other cert in the fleet is internal
   step-ca. This is the only `ca = "letsencrypt"` manual cert.
2. **Two step-ca certs** (`dns-admin`, `dns-metrics`) on **two different cert groups** than the public
   one — the admin/metrics certs are owned by `cfg.certGroup` (read by Caddy, and Alloy for metrics),
   while the public cert is owned by `cfg.group` (the Technitium service group, which reads it for the
   PKCS#12 conversion).
3. **Three distinct `http://` challenge vhosts** with **two different shapes**: the public `dns` one
   has a `handle /.well-known/acme-challenge/*` block **plus** an HTTPS redirect `handle` (because
   port 80 is public and must redirect normal traffic), while the admin/metrics ones are **bare**
   `reverse_proxy 127.0.0.1:<acmePort>` (reached directly over Tailscale, so no redirect needed).
4. **Direct tailnet ACME challenge ports.** The admin/metrics certs are for **tailnet-only** names,
   so step-ca (on cicero) reaches their HTTP-01 challenge listeners **directly over Tailscale** on
   `22483`/`22481` — the firewall opens those two ports on `tailscale0`. This is the one real
   `tls.challenge = { via = "direct"; iface = "tailscale0"; }` case the keystone firewall generator
   (catalog-and-generators §3.5) was designed for. The public `dns` cert's challenge, by contrast,
   arrives on the **public** `:80` fronted by Caddy (`via = "caddy80"`), needing **no** challenge-port
   opening.

If the catalog + generators reproduce all three certs, all three challenge vhosts, and exactly the
`22481`/`22483` tailnet openings byte-for-byte, the schema is proven adequate for the public-LE,
multi-group, and direct-tailnet-challenge cases at once. §7 flags the schema gaps this surfaces.

> **Critical reconciliation note (read before touching anything).** Technitium is **already
> option-driven** via `services.technitium-server-complete`. The ACME certs here are **not** owned by
> the generic `technitium` feature — they are a **separate aedilis-only module**
> (`technitium-aedilis-acme`) whose cert `directory` outputs are **consumed back** by the Technitium
> service options (`encryptedDns.certPemFile`, `caddy.adminCertPemFile`, …,
> `observability.lokiClientCertPemFile`) **and** by the `provision.certReadyUnits =
> [ "acme-${tech.domain}.service" ]` ordering. The migration must preserve that consumption contract
> exactly (§3.6 / §7 gap (D)): the generated cert **names** must stay
> `dns`/`dns-admin`/`dns-metrics` `.plato-splunk.media` so every `config.security.acme.certs.<name>.directory`
> reference in `complete.nix` still resolves to the same `/var/lib/acme/<name>` path, and the
> `acme-dns.plato-splunk.media.service` unit the provisioner waits on still exists under the same
> name. This is why the recommendation (§2 / §8) is to have the catalog **feed the acme generator**
> (replacing `technitium-aedilis-acme`) while **leaving the Technitium option module untouched** — not
> to fold the Technitium options themselves into the catalog.

---

## 1. Current state — emitted output captured verbatim

### 1.1 Constants read — `nix-config/modules/service-registry.nix`

The `technitium` entry (lines ~383–407) and `dns-metrics` entry (lines ~409–418):

```nix
technitium = {
  subdomain = "dns";
  domain = mkDomain "dns";                 # "dns.plato-splunk.media"
  url = mkUrl "dns";                       # "https://dns.plato-splunk.media"
  clientId = "technitium";
  oidcEndpoint = mkOidcEndpoint "technitium";
  dnsPort = 53;                            # plain DNS — Tailscale-only
  dotPort = 853;                           # DoT (tcp) + DoQ (udp) — public
  dohPort = 443;                           # DoH — public
  webHttpPort = 5380;                      # loopback plain HTTP, fronted by Caddy
  acmePort = 22482;                        # HTTP-01 challenge listener (loopback; Caddy fronts :80)
  adminSubdomain = "dns-admin";
  adminDomain = mkDomain "dns-admin";      # "dns-admin.plato-splunk.media"
  adminUrl = mkUrl "dns-admin";            # "https://dns-admin.plato-splunk.media"
  adminPort = 8443;                        # admin UI Caddy vhost (Tailscale-only, OIDC-gated)
  adminAcmePort = 22483;                   # admin-cert HTTP-01 challenge listener
};

dns-metrics = {
  subdomain = "dns-metrics";
  domain = mkDomain "dns-metrics";         # "dns-metrics.plato-splunk.media"
  url = mkUrl "dns-metrics";               # "https://dns-metrics.plato-splunk.media"
  port = 9443;                             # metrics Caddy vhost (Tailscale-only, mTLS)
  acmePort = 22481;                        # metrics-cert HTTP-01 challenge listener
  nodeExporterPort = 9100;                 # node_exporter on the aedilis host
};
```

with the shared helpers + CA constants:

```nix
baseDomain = "plato-splunk.media";
mkDomain = subdomain: "${subdomain}.${baseDomain}";
ca.acmeDirectoryHttp = "https://ca.plato-splunk.media/acme/http/directory";   # internal step-ca
ca.rootCert = …certs/alford-root.crt…                                          # mTLS trust pool
```

Resolved facts table:

| Fact                     | Value                                                   |
| ------------------------ | ------------------------------------------------------- |
| `tech.domain`            | `dns.plato-splunk.media` (PUBLIC)                       |
| `tech.acmePort`          | `22482` (loopback; Caddy fronts :80)                    |
| `tech.adminDomain`       | `dns-admin.plato-splunk.media` (tailnet)                |
| `tech.adminAcmePort`     | `22483` (direct over tailscale0)                        |
| `dnsMetrics.domain`      | `dns-metrics.plato-splunk.media` (tailnet)              |
| `dnsMetrics.acmePort`    | `22481` (direct over tailscale0)                        |
| `c.ca.acmeDirectoryHttp` | `https://ca.plato-splunk.media/acme/http/directory`     |
| LE directory             | `https://acme-v02.api.letsencrypt.org/directory`        |
| `cfg.group`              | `technitium` (service group; reads public cert)         |
| `cfg.certGroup`          | dedicated cert group (Caddy + Alloy read step-ca certs) |

### 1.2 The THREE `security.acme.certs.*` — captured verbatim

From `nix-config/modules/features/technitium-aedilis/acme.nix`
(`flake.modules.nixos.technitium-aedilis-acme`). `cfg = config.services.technitium-server-complete`.

```nix
services.homelab-acme.defaultCA = "internal";

# (1) PUBLIC Let's Encrypt cert — DoH/DoT/DoQ termination by Technitium itself.
security.acme.certs."${tech.domain}" = {
  domain = tech.domain;                                  # dns.plato-splunk.media
  email = "rae@plato-splunk.media";                      # custom LE account email
  server = "https://acme-v02.api.letsencrypt.org/directory";
  listenHTTP = "127.0.0.1:${toString tech.acmePort}";    # 127.0.0.1:22482 (loopback)
  group = cfg.group;                                     # "technitium" — service reads for PKCS#12
  reloadServices = [
    "caddy.service"
    "technitium-dns-server.service"
    "technitium-provision.service"
  ];
};

# (2) step-ca cert — admin UI vhost (Caddy).
security.acme.certs."${tech.adminDomain}" = {
  domain = tech.adminDomain;                             # dns-admin.plato-splunk.media
  listenHTTP = "127.0.0.1:${toString tech.adminAcmePort}"; # 127.0.0.1:22483 (loopback listener)
  server = c.ca.acmeDirectoryHttp;                       # internal step-ca
  group = cfg.certGroup;                                 # dedicated cert group (Caddy)
  reloadServices = [ "caddy.service" ];
};

# (3) step-ca cert — metrics vhost (Caddy) + Alloy client cert (Loki push).
security.acme.certs."${dnsMetrics.domain}" = {
  domain = dnsMetrics.domain;                            # dns-metrics.plato-splunk.media
  listenHTTP = "127.0.0.1:${toString dnsMetrics.acmePort}"; # 127.0.0.1:22481 (loopback listener)
  server = c.ca.acmeDirectoryHttp;                       # internal step-ca
  group = cfg.certGroup;                                 # dedicated cert group (Caddy + Alloy)
  reloadServices = [
    "caddy.service"
    "alloy.service"
  ];
};
```

Resolved (after interpolation):

| Cert name                        | `server`                        | `listenHTTP`      | `group`         | `reloadServices`                                                             |
| -------------------------------- | ------------------------------- | ----------------- | --------------- | ---------------------------------------------------------------------------- |
| `dns.plato-splunk.media`         | LE directory                    | `127.0.0.1:22482` | `cfg.group`     | `[caddy.service technitium-dns-server.service technitium-provision.service]` |
| `dns-admin.plato-splunk.media`   | step-ca `…/acme/http/directory` | `127.0.0.1:22483` | `cfg.certGroup` | `[caddy.service]`                                                            |
| `dns-metrics.plato-splunk.media` | step-ca `…/acme/http/directory` | `127.0.0.1:22481` | `cfg.certGroup` | `[caddy.service alloy.service]`                                              |

The public cert also sets `email = "rae@plato-splunk.media"` (the LE account email — a field the
internal certs omit). This is the only cert in the fleet with a custom `email`.

### 1.3 The THREE `http://` challenge vhosts — captured verbatim

Also from `technitium-aedilis-acme`:

```nix
# (1) PUBLIC dns challenge — :80 is public; handle the challenge AND redirect everything else.
services.caddy.virtualHosts."http://${tech.domain}" = {
  extraConfig = ''
    handle /.well-known/acme-challenge/* {
      reverse_proxy 127.0.0.1:${toString tech.acmePort}
    }
    handle {
      redir https://${tech.domain}{uri}
    }
  '';
};

# (2) admin challenge — reached DIRECTLY over tailscale on 22483; bare proxy, no redirect.
services.caddy.virtualHosts."http://${tech.adminDomain}" = {
  extraConfig = ''
    reverse_proxy 127.0.0.1:${toString tech.adminAcmePort}
  '';
};

# (3) metrics challenge — reached DIRECTLY over tailscale on 22481; bare proxy, no redirect.
services.caddy.virtualHosts."http://${dnsMetrics.domain}" = {
  extraConfig = ''
    reverse_proxy 127.0.0.1:${toString dnsMetrics.acmePort}
  '';
};
```

Resolved bodies (byte-for-byte, each with a single trailing newline):

```
# http://dns.plato-splunk.media
handle /.well-known/acme-challenge/* {
  reverse_proxy 127.0.0.1:22482
}
handle {
  redir https://dns.plato-splunk.media{uri}
}
```

```
# http://dns-admin.plato-splunk.media
reverse_proxy 127.0.0.1:22483
```

```
# http://dns-metrics.plato-splunk.media
reverse_proxy 127.0.0.1:22481
```

**Three asymmetries the catalog must model:**

1. **The public `dns` challenge vhost has a redirect `handle`** that the admin/metrics ones lack —
   because its `:80` is the **public** interface and normal HTTP traffic must be bounced to HTTPS.
   The admin/metrics `:80` is only ever hit by step-ca's direct HTTP-01 challenge over Tailscale, so
   they are bare proxies.
2. **The challenge body uses `127.0.0.1` (not `localhost`)** and — for the public one — a
   `handle /.well-known/acme-challenge/*` wrapper. Contrast kanidm, which uses a **bare**
   `reverse_proxy localhost:<port>` with `localhost`. So the challenge-vhost renderer must support
   **both** the `handle`-wrapper-with-`127.0.0.1` form (technitium `dns`) and the bare form
   (technitium admin/metrics; kanidm) — see §7 gap (C).
3. **`via` differs per cert.** `dns` is `via = "caddy80"` (public `:80`, no challenge-port opening);
   `dns-admin`/`dns-metrics` are `via = "direct"; iface = "tailscale0"` (step-ca connects straight to
   the loopback listener over Tailscale → the firewall opens `22483`/`22481`).

### 1.4 Firewall (aedilis) — the two direct tailnet ACME ports — captured verbatim

From `nix-config/modules/_private/aedilis/security.nix`:

```nix
networking.firewall = {
  enable = true;

  # Public, internet-facing ports.
  allowedTCPPorts = [
    80   # Let's Encrypt HTTP-01 challenge (Caddy; Technitium does not use 80)
    443  # DoH (Technitium-native TLS)
    853  # DoT (Technitium-native TLS)
  ];
  allowedUDPPorts = [
    853  # DoQ (Technitium-native TLS)
  ];

  # Tailscale-only ports.
  interfaces.tailscale0 = {
    allowedTCPPorts = [
      22    # SSH
      53    # plain DNS over Tailscale (TCP fallback)
      8443  # admin UI vhost (Caddy, OIDC-gated, no mTLS)
      9443  # dns-metrics endpoint (Caddy, mTLS)
      5252  # Tailscale metrics exporter
      22481 # acme http challenge          <-- dns-metrics cert, DIRECT over tailscale
      22483 # acme http challenge          <-- dns-admin cert, DIRECT over tailscale
    ];
    allowedUDPPorts = [
      53    # plain DNS over Tailscale
    ];
  };
};
```

The **service-attributable** openings this plan owns are exactly:

- `tailscale0.allowedTCPPorts`: **`22481`** (dns-metrics direct ACME challenge) and **`22483`**
  (dns-admin direct ACME challenge). These equal the two `acmePort` constants, hand-copied here today.
- `tailscale0.allowedTCPPorts`: **`8443`** (admin UI vhost `listenPort`) and **`9443`** (metrics
  vhost `listenPort`) — the two HTTPS vhost ports, both `access.scope = "tailnet"`. (These belong to
  the companion [./technitium-caddy.md](./technitium-caddy.md) vhosts but are **firewall-generated**
  from the same catalog entries; this plan owns the firewall half for all four.)

Everything else here is **baseline host infrastructure**, NOT service-attributable, and stays
hand-listed per decision §5.1 #7:

- **Public `80`/`443`/`853` (TCP)** and **`853` (UDP)** — `80` is the public LE challenge (Caddy, and
  it is the public `via = "caddy80"` interface for the `dns` cert — see §3.4 for why it is _not_
  generated), and `443`/`853` are **Technitium-native DoH/DoT/DoQ** listeners (Technitium's own
  protocol ports, not a Caddy vhost — pure host infra).
- **`22` (SSH)**, **`53` (plain DNS, TCP + UDP)**, **`5252` (TS metrics exporter)** — host infra.

> **Subtle point on public `80`.** The `dns` cert's challenge is `via = "caddy80"`, which by the
> keystone rule (catalog-and-generators §3.5) emits **no** firewall opening (the loopback `22482`
> listener is fronted by Caddy on `:80`). But `80` _is_ open publicly — because it is the **baseline**
> public HTTP port the host hand-lists (shared with the redirect `handle`), exactly like augustus's
> baseline `80`. So the firewall generator must **not** add `80`, and the host keeps `80` in its
> hand-written `allowedTCPPorts`. The generator owns only `22481`/`22483` (direct challenges) +
> `8443`/`9443` (vhost listen ports) on `tailscale0`.

### 1.5 How this is wired today — the option-driven consumption contract

The crucial structural fact (see §0). `features/technitium-aedilis/complete.nix` builds
`flake.modules.nixos.technitium-aedilis` by importing the generic `technitium` feature, the
`technitium-provisioning` feature, **`technitium-aedilis-acme`** (the module in §1.2/§1.3), the
observability layer, and an inline `aedilisConfig` module that **consumes the cert directories**:

```nix
# aedilisConfig (inline in complete.nix), reading the evaluated config:
metricsCertDir = config.security.acme.certs."${dnsMetrics.domain}".directory;  # /var/lib/acme/dns-metrics.plato-splunk.media
adminCertDir   = config.security.acme.certs."${tech.adminDomain}".directory;   # /var/lib/acme/dns-admin.plato-splunk.media
publicCertDir  = config.security.acme.certs."${tech.domain}".directory;        # /var/lib/acme/dns.plato-splunk.media

services.technitium-server-complete = {
  # … enable, domain, webHttpPort, oidc, recursion, rateLimit, provision, …
  encryptedDns = {
    certPemFile = "${publicCertDir}/fullchain.pem";
    certKeyFile = "${publicCertDir}/key.pem";
    # …
  };
  provision.certReadyUnits = [ "acme-${tech.domain}.service" ];  # waits on acme-dns.plato-splunk.media.service
  caddy = {
    adminCertPemFile   = "${adminCertDir}/fullchain.pem";
    adminCertKeyFile   = "${adminCertDir}/key.pem";
    metricsCertPemFile = "${metricsCertDir}/fullchain.pem";
    metricsCertKeyFile = "${metricsCertDir}/key.pem";
    # …
  };
  observability = {
    lokiClientCertPemFile = "${metricsCertDir}/fullchain.pem";
    lokiClientCertKeyFile = "${metricsCertDir}/key.pem";
    # …
  };
};
```

So the certs are **produced** by `technitium-aedilis-acme` and **consumed** by the Technitium option
module via `config.security.acme.certs.<name>.directory`. Any migration MUST keep the three cert
**names** (`dns`, `dns-admin`, `dns-metrics` under `plato-splunk.media`) so every `directory`
reference and the `certReadyUnits` ordering resolve identically. This is the central reconciliation
constraint (§3.6 / §7 gap (D)).

### 1.6 Properties to preserve (invariants checklist)

- **Three certs**, exact names `dns`/`dns-admin`/`dns-metrics` `.plato-splunk.media`, with:
  - `dns`: `server` = LE directory, `email = "rae@plato-splunk.media"`, `listenHTTP = 127.0.0.1:22482`,
    `group = cfg.group`, `reloadServices = [caddy, technitium-dns-server, technitium-provision]`.
  - `dns-admin`: `server` = step-ca, `listenHTTP = 127.0.0.1:22483`, `group = cfg.certGroup`,
    `reloadServices = [caddy]`.
  - `dns-metrics`: `server` = step-ca, `listenHTTP = 127.0.0.1:22481`, `group = cfg.certGroup`,
    `reloadServices = [caddy, alloy]`.
- **Three `http://` challenge vhosts**: `dns` with `handle /.well-known/acme-challenge/*` +
  HTTPS-redirect `handle` (`127.0.0.1:22482`); `dns-admin` bare `reverse_proxy 127.0.0.1:22483`;
  `dns-metrics` bare `reverse_proxy 127.0.0.1:22481`. All with `127.0.0.1` (not `localhost`), single
  trailing newline.
- **`services.homelab-acme.defaultCA = "internal"`** unchanged.
- **Firewall:** `tailscale0.allowedTCPPorts` contains `22481` + `22483` (direct challenges) and
  `8443` + `9443` (vhost listen ports). Public `80`/`443`/`853`, `22`, `53`, `5252` stay baseline.
- **Cert directories** `/var/lib/acme/{dns,dns-admin,dns-metrics}.plato-splunk.media` unchanged so the
  Technitium option module's `*CertPemFile`/`*CertKeyFile`/`certReadyUnits` consumers resolve
  identically.
- **Everything in the Technitium option module** (`recursion`, `rateLimit`, `oidc`, `encryptedDns`,
  `provision`, `caddy`, `observability`) is **unchanged** — it is not in scope here.

---

## 2. Target state — feed the acme generator, leave the option module intact (RECOMMENDATION)

Technitium is already option-driven, so the naïve "collapse everything into a `homelab.catalog`
entry" does **not** apply cleanly. There are two defensible shapes; the recommendation is the first:

- **(RECOMMENDED) Catalog feeds the ACME generator + firewall generator; replace only
  `technitium-aedilis-acme`. Leave the Technitium option module (`complete.nix`'s `aedilisConfig`,
  the generic `technitium` feature, and `technitium/caddy.nix`) untouched for the _cert production_
  and _consumption_ contract.** Concretely:
  - Add a `features/technitium-aedilis/catalog.nix` that contributes **three** catalog entries
    (`technitium`, `technitium-admin`, `technitium-metrics`) carrying only the **cert + challenge +
    firewall** facts (`tls.ca`, `tls.acmePort`, `tls.email`, `tls.certGroup`, `tls.reloadServices`,
    `tls.challenge`, `access.scope`, `listenPort`).
  - Opt those entries into `managedBy.acme = true` and `managedBy.firewall = true` **only** (NOT
    `managedBy.caddy` for the cert production — the HTTPS vhosts are the companion plan; see §2.1).
  - Delete `technitium-aedilis-acme` once the acme generator emits the identical three certs + three
    challenge vhosts, and delete the hand-copied `22481`/`22483`/`8443`/`9443` tailnet firewall ports
    once the firewall generator emits them.
  - **Do NOT touch** `aedilisConfig`'s `config.security.acme.certs.<name>.directory` reads,
    `certReadyUnits`, or any `services.technitium-server-complete.*` option value. Because the acme
    generator creates the certs under the **same names**, every `directory` reference still resolves
    to the same path (§3.6).

- **(NOT recommended) Fold the whole Technitium deployment into the catalog.** This would require the
  catalog to model `encryptedDns`, `provision`, `recursion`, `rateLimit`, `oidc`, and the two Caddy
  vhost bodies — far beyond the catalog's "cross-cutting networking facts" scope (keystone §2), and
  it would fight the existing, well-factored option surface. The whole point of the option module is
  that it already is the single source of truth for the _service runtime_; the catalog's job is only
  the _cross-cutting cert/challenge/firewall/vhost_ surfaces. Folding the runtime in would duplicate
  and de-factor it. **Reject.**

> **Why this is the careful reconciliation the task demands.** The catalog **feeds** the three
> cross-cutting surfaces it is good at (cert request, challenge vhost, firewall opening) and
> **replaces** only the hand-rolled `technitium-aedilis-acme` module + the hand-copied firewall
> ports. It **does not** replace or duplicate the Technitium option surface, which remains the owner
> of the service runtime and the _consumer_ of the cert directories. The two meet at exactly one
> contract: the cert **names**. Keep those identical and the deploy is a no-op.

### 2.0 Colocated feature layout

```
features/technitium-aedilis/
├── catalog.nix     # THREE homelab.catalog entries (cert + challenge + firewall facts ONLY)
├── complete.nix    # UNCHANGED option module: imports generic technitium + provisioning +
│                   #   observability + aedilisConfig (the service runtime + cert CONSUMERS)
├── acme.nix        # DELETED after migration (its certs/challenges now come from the generator)
└── observability.nix  # unchanged
```

`technitium/caddy.nix` (the two HTTPS vhosts) is the companion plan
[./technitium-caddy.md](./technitium-caddy.md); it is **not** touched by this plan except that the
firewall openings for its `8443`/`9443` vhosts are generated here (both plans read the same catalog
entries — §3.5 note).

### 2.1 `features/technitium-aedilis/catalog.nix` (proposed)

Three entries — one per cert/challenge/vhost. The `technitium` entry carries the public cert + the
admin/metrics are separate entries (they are separate certs on separate challenge ports with separate
vhosts). All three are `host = "aedilis"`.

```nix
{ config, ... }:
let
  c = config.constants;
  tech = c.services.technitium;        # domain=dns, acmePort=22482, adminDomain=dns-admin,
                                       #   adminAcmePort=22483, adminPort=8443, webHttpPort=5380
  dnsMetrics = c.services.dns-metrics; # domain=dns-metrics, acmePort=22481, port=9443
in
{
  flake.modules.nixos.technitium-aedilis-catalog =
    { config, ... }:
    {
      # (1) PUBLIC Let's Encrypt cert for the DoH/DoT/DoQ endpoint. NOT a Caddy HTTPS
      #     vhost — Technitium terminates TLS natively — so NO backend/managedBy.caddy.
      #     The catalog entry exists ONLY to request the cert + its public :80 challenge.
      homelab.catalog.technitium = {
        subdomain = "dns";
        host = "aedilis";
        # No Caddy HTTPS vhost (Technitium-native TLS). backend modeled as "none"/raw (gap E).
        backend.kind = "raw";            # emits no vhost body; cert-only entry (see §7 gap E)
        tls = {
          ca = "letsencrypt";            # public LE directory
          email = "rae@plato-splunk.media";  # custom LE account email (gap A)
          acmePort = tech.acmePort;      # 22482 loopback
          certGroup = "technitium";      # cfg.group — service reads for PKCS#12 (override default)
          reloadServices = [             # generator prepends caddy.service? -> NO (gap B): see §3.3
            "caddy.service"
            "technitium-dns-server.service"
            "technitium-provision.service"
          ];
          challenge = {
            via = "caddy80";             # public :80 fronts loopback 22482; NO firewall opening
            # The public challenge vhost needs the HTTPS-redirect handle (gap C).
            redirectToHttps = true;      # emits the `handle { redir https://…{uri} }` block
          };
          gate = "none";
        };
        access.scope = "public";         # DoH/DoT/DoQ are public — but see §3.4: the firewall
                                         #   generator must NOT open 443/853 (Technitium-native,
                                         #   baseline host infra, not a vhost listenPort).
        dns.enable = false;              # the dns/aedilis public-identity records are emitted by
                                         #   the dns-records migration, NOT this cert entry (§3.7).
      };

      # (2) step-ca cert — admin UI vhost (companion plan technitium-caddy.md owns the HTTPS vhost
      #     BODY; this entry owns the CERT + challenge + firewall). listenPort 8443, tailnet.
      homelab.catalog.technitium-admin = {
        subdomain = "dns-admin";
        host = "aedilis";
        listenPort = tech.adminPort;     # 8443
        backend = { kind = "reverseProxy"; port = tech.webHttpPort; };  # 5380 (companion vhost)
        tls = {
          ca = "internal";               # step-ca
          acmePort = tech.adminAcmePort; # 22483 loopback listener
          certGroup = "<cfg.certGroup>"; # dedicated cert group (override — see §3.3 note)
          reloadServices = [ ];          # generator yields exactly [ caddy.service ]
          challenge = {
            via = "direct";              # step-ca connects straight to 22483 over tailscale
            iface = "tailscale0";        # -> firewall opens 22483 on tailscale0
            body = "bare";               # bare `reverse_proxy 127.0.0.1:22483`, no handle (gap C)
          };
          gate = "oidc";                 # OIDC-gated by Technitium itself (not Caddy) — doc only
        };
        access.scope = "tailnet";        # opens 8443 on tailscale0
        dns.enable = false;              # dns-records migration owns the dns-admin record (§3.7)
        # managedBy.caddy stays OFF here — the HTTPS vhost body is the companion plan.
      };

      # (3) step-ca cert — metrics vhost + Alloy Loki client cert. listenPort 9443, mTLS, tailnet.
      homelab.catalog.technitium-metrics = {
        subdomain = "dns-metrics";
        host = "aedilis";
        listenPort = dnsMetrics.port;    # 9443
        backend = { kind = "reverseProxy"; port = dnsMetrics.nodeExporterPort; };  # companion vhost
        tls = {
          ca = "internal";               # step-ca
          acmePort = dnsMetrics.acmePort; # 22481 loopback listener
          certGroup = "<cfg.certGroup>"; # dedicated cert group (Caddy + Alloy)
          reloadServices = [ "alloy.service" ]; # generator prepends caddy.service -> [caddy, alloy]
          challenge = {
            via = "direct";              # step-ca connects straight to 22481 over tailscale
            iface = "tailscale0";        # -> firewall opens 22481 on tailscale0
            body = "bare";               # bare `reverse_proxy 127.0.0.1:22481`, no handle (gap C)
          };
          gate = "mtls+allowlist";       # companion plan's path allowlist (technitium-caddy.md)
        };
        access.scope = "tailnet";        # opens 9443 on tailscale0
        dns.enable = false;              # dns-records migration owns the dns-metrics record (§3.7)
      };
    };
}
```

> **`certGroup` must be overridden for all three.** By default `certGroup` is the entry name
> (`technitium`/`technitium-admin`/`technitium-metrics`). But today the public cert uses `cfg.group`
> (`"technitium"`, which happens to match entry #1's name — but it is semantically the **service**
> group, so set it explicitly) and the two step-ca certs use `cfg.certGroup` (the **dedicated** cert
> group, a different name). The catalog must set `tls.certGroup` to the exact current group names — a
> literal reconciliation point since `cfg.group` / `cfg.certGroup` are option values in the Technitium
> module (resolve their concrete string values from `services.technitium-server-complete` defaults and
> hard-code them in the catalog, OR read them via `config.services.technitium-server-complete.{group,certGroup}`
> — the latter keeps a single source of truth; see §3.3).

### 2.2 `complete.nix` — unchanged option module, minus the acme import

The only change to `complete.nix` is **removing the `technitium-aedilis-acme` import** once the
catalog's acme generator supersedes it. The inline `aedilisConfig` module — including every
`config.security.acme.certs.<name>.directory` read, the `certReadyUnits`, and all
`services.technitium-server-complete.*` values — stays **verbatim**:

```nix
flake.modules.nixos.technitium-aedilis = {
  imports = [
    inputs.self.modules.nixos.technitium
    inputs.self.modules.nixos.technitium-provisioning
    # inputs.self.modules.nixos.technitium-aedilis-acme   <-- REMOVED (certs now from the generator)
    inputs.self.modules.nixos.technitium-aedilis-observability
    inputs.self.modules.nixos.technitium-aedilis-catalog  # <-- ADDED (contributes the 3 entries)
    aedilisConfig
  ];
};
```

> **The `aedilisConfig` cert-directory reads keep working** because the acme generator creates
> `security.acme.certs."dns.plato-splunk.media"`, `"dns-admin.plato-splunk.media"`, and
> `"dns-metrics.plato-splunk.media"` — the exact names `aedilisConfig` references
> (`config.security.acme.certs."${tech.domain}".directory` etc.). Same names → same
> `/var/lib/acme/<name>` directories → `encryptedDns.certPemFile`, `caddy.*CertPemFile`,
> `observability.lokiClientCertPemFile`, and `provision.certReadyUnits` all resolve identically
> (§3.6).

### 2.3 Where the HTTPS vhosts come from

The **HTTPS** admin (`:8443`) and metrics (`:9443`) vhost **bodies** remain produced by
`technitium/caddy.nix` until the companion [./technitium-caddy.md](./technitium-caddy.md) migration
moves them onto `managedBy.caddy`. This plan touches **only** the certs, the `http://` challenge
vhosts, and the firewall. The `8443`/`9443` firewall openings are generated here (from the
`access.scope = "tailnet"` + `listenPort` of entries #2/#3), while the vhost bodies stay with the
companion plan — both read the same three catalog entries, so there is no duplication of facts, only
a split of which generator consumes which field (§3.5 note).

---

## 3. Mapping each surface onto the catalog + argument

### 3.1 The public Let's Encrypt cert (`dns`)

The acme generator (keystone §3.4) for `host == aedilis && managedBy.acme && tls.ca != null` renders,
with `tls.ca == "letsencrypt"` selecting the LE directory:

```nix
security.acme.certs."dns.plato-splunk.media" = {
  domain = "dns.plato-splunk.media";
  listenHTTP = "127.0.0.1:22482";
  server = "https://acme-v02.api.letsencrypt.org/directory";
  group = "technitium";                                   # tls.certGroup
  reloadServices = [ "caddy.service" "technitium-dns-server.service" "technitium-provision.service" ];
  email = "rae@plato-splunk.media";                       # tls.email (schema gap A)
};
```

**Equivalence argument.** `domain`/`listenHTTP`/`group` map one-to-one. `server` comes from the
generator's `certServer e` which, for `ca == "letsencrypt"`, returns exactly
`https://acme-v02.api.letsencrypt.org/directory` (keystone §3.4). Two deltas from the generic
generator (both schema gaps):

- **`email`** — the keystone cert generator has no `email` field; LE certs with a custom account email
  need it. **Gap (A):** add `tls.email` (nullable; only emitted when set). See §7.
- **`reloadServices`** — the generic generator does `[ "caddy.service" ] ++ tls.reloadServices`. But
  the public cert's exact list is `[ caddy, technitium-dns-server, technitium-provision ]`. If the
  generator **prepends** `caddy.service`, the catalog must supply `tls.reloadServices =
  [ technitium-dns-server.service technitium-provision.service ]` (NOT including caddy). **Gap (B):**
  the kanidm plan already relies on this prepend behavior; confirm it and set the catalog's list
  **without** `caddy.service` so the merged result is exactly the current three-element list in the
  current order (caddy first). See §3.3.

### 3.2 The two step-ca certs (`dns-admin`, `dns-metrics`)

For `ca == "internal"` the generator's `certServer e` returns `c.ca.acmeDirectoryHttp`:

```nix
security.acme.certs."dns-admin.plato-splunk.media" = {
  domain = "dns-admin.plato-splunk.media";
  listenHTTP = "127.0.0.1:22483";
  server = "https://ca.plato-splunk.media/acme/http/directory";
  group = "<cfg.certGroup>";
  reloadServices = [ "caddy.service" ];                   # [caddy] ++ [] (no extra)
};
security.acme.certs."dns-metrics.plato-splunk.media" = {
  domain = "dns-metrics.plato-splunk.media";
  listenHTTP = "127.0.0.1:22481";
  server = "https://ca.plato-splunk.media/acme/http/directory";
  group = "<cfg.certGroup>";
  reloadServices = [ "caddy.service" "alloy.service" ];   # [caddy] ++ [alloy]
};
```

**Equivalence argument.** `domain`/`listenHTTP`/`server`/`group` all map one-to-one. `dns-admin`'s
`reloadServices` is just `[ caddy.service ]` (generator prepends caddy, catalog adds nothing).
`dns-metrics`'s is `[ caddy.service ] ++ [ alloy.service ] = [ caddy.service alloy.service ]`, order
preserved. No `email` (internal certs omit it; the `tls.email` field stays null for these two).

### 3.3 `reloadServices` prepend + `certGroup` resolution — the reconciliation details

- **Prepend order.** The keystone generator emits `reloadServices = [ "caddy.service" ] ++
  e.tls.reloadServices` (catalog-and-generators §3.4). All three current lists have `caddy.service`
  **first**, so the catalog must supply `tls.reloadServices` as the list **minus** the leading
  `caddy.service`, in the current order:
  - `dns`: `[ "technitium-dns-server.service" "technitium-provision.service" ]`
  - `dns-admin`: `[ ]`
  - `dns-metrics`: `[ "alloy.service" ]`
    This reproduces `[caddy, …]` exactly. (If, during the kanidm/catalog migration, the prepend
    convention changes, re-derive — but the current plans fix it as "caddy.service first".)
- **`certGroup` source.** `cfg.group` and `cfg.certGroup` are `services.technitium-server-complete`
  option values. To avoid drift, the catalog should read them from the evaluated config
  (`config.services.technitium-server-complete.group` / `.certGroup`) rather than hard-coding the
  strings — **but** the catalog entry is contributed in the same module that imports the option
  module, so those values are in scope. Resolve the concrete default strings during migration and
  verify via the parity gate (§5.3) that `group` matches byte-for-byte. The public cert's
  `group = cfg.group = "technitium"`; the two step-ca certs' `group = cfg.certGroup` (the dedicated
  group name — resolve and confirm).

### 3.4 The three `http://` challenge vhosts + the `dns` redirect

The acme generator emits a challenge vhost per cert. Two shape requirements the generic generator
does not yet cover (gap C):

- **`dns` (public, `via = "caddy80"`):** body is
  ```
  handle /.well-known/acme-challenge/* {
    reverse_proxy 127.0.0.1:22482
  }
  handle {
    redir https://dns.plato-splunk.media{uri}
  }
  ```
  This is the keystone's **default** `handle /.well-known/acme-challenge/*` form (with `127.0.0.1`,
  matching the keystone default) **plus** an HTTPS-redirect `handle` block. The redirect is the
  delta: **gap (C) redirect half** — `tls.challenge.redirectToHttps = true` makes the generator append
  the `handle { redir https://<fqdn>{uri} }` block. Only the public `dns` challenge sets it.
- **`dns-admin` / `dns-metrics` (`via = "direct"`):** bodies are the **bare**
  `reverse_proxy 127.0.0.1:22483` / `reverse_proxy 127.0.0.1:22481` (no `handle` wrapper, no
  redirect). This is the same "bare body" shape kanidm needs. **Gap (C)** — `tls.challenge.body =
  "bare"` makes the generator emit the bare `reverse_proxy 127.0.0.1:<acmePort>` form. The upstream
  token is `127.0.0.1` via the renderer's global standardization (§7.8 #22) — matching the source
  exactly; no per-entry host-token field is needed (kanidm's challenge body likewise becomes
  `127.0.0.1`, the one approved substitution there). See §7 gap (C).

**Equivalence argument.** All three keys (`http://dns…`, `http://dns-admin…`, `http://dns-metrics…`)
derive from `"http://" + fqdn`. The `dns` body = keystone default `handle` (127.0.0.1:22482) +
redirect handle. The admin/metrics bodies = bare `reverse_proxy 127.0.0.1:{22483,22481}`. With the
gap-C fields set per entry, each renders byte-for-byte including trailing newline.

### 3.5 Firewall — the two direct tailnet challenge ports + the two vhost ports

The firewall generator (keystone §3.5) for `host == aedilis && managedBy.firewall` folds:

- **Listen-port openings** by `access.scope`'s interface:
  - entry #1 `technitium` (`scope = "public"`, `backend.kind = "raw"`, **no** vhost listenPort) →
    see the caveat below: it must contribute **nothing** (443/853 are Technitium-native baseline, not
    a vhost `listenPort`).
  - entry #2 `technitium-admin` (`scope = "tailnet"`, `listenPort = 8443`) → `tailscale0` opens `8443`.
  - entry #3 `technitium-metrics` (`scope = "tailnet"`, `listenPort = 9443`) → `tailscale0` opens `9443`.
- **Direct-challenge acmePorts** (`tls.challenge.via == "direct"`), grouped by `iface`:
  - entry #2 → `tailscale0` opens `22483`.
  - entry #3 → `tailscale0` opens `22481`.
  - entry #1 is `via = "caddy80"` → contributes **no** challenge-port opening.

Resulting generated `tailscale0.allowedTCPPorts` contribution: `[ 8443 9443 22481 22483 ]` — exactly
the four service-attributable ports hand-listed today.

> **Caveat on entry #1's `access.scope = "public"`.** The public `dns` cert entry has **no Caddy
> HTTPS vhost** (`backend.kind = "raw"`) and its "public" ports (`443` DoH, `853` DoT/DoQ) are
> **Technitium-native protocol listeners**, i.e. baseline host infra — **not** a catalog `listenPort`.
> If the firewall generator naïvely opened `listenPort` for `scope = "public"` entries, it would need
> entry #1 to have **no** `listenPort` to open (or `listenPort = null`). **Gap (E):** a cert-only /
> `backend.kind = "raw"` entry with no servable port must contribute **no** listen-port firewall
> opening (only its challenge-port opening, which here is `via = "caddy80"` → also none). The clean
> encoding is `listenPort = null` (or `access.scope = "none"` for the firewall, while still modeling
> the cert as public) so the generator opens nothing for entry #1. **Public `80`/`443`/`853` stay
> hand-listed baseline** in `_private/aedilis/security.nix` (§1.4). See §7 gap (E).

**Equivalence argument.** Generator contributes `[ 8443 9443 22481 22483 ]` to
`tailscale0.allowedTCPPorts`; the host file drops exactly those four and keeps `22`, `53`, `5252`
(tailnet baseline) and the public `80`/`443`/`853`. The merged set is byte-identical (order may
differ — verify the parity gate compares as a **set**, §5.4).

### 3.6 Cert-directory consumption contract — must stay byte-identical

This is the central reconciliation guarantee. `aedilisConfig` reads:

```nix
publicCertDir  = config.security.acme.certs."dns.plato-splunk.media".directory;        # /var/lib/acme/dns.plato-splunk.media
adminCertDir   = config.security.acme.certs."dns-admin.plato-splunk.media".directory;  # /var/lib/acme/dns-admin.plato-splunk.media
metricsCertDir = config.security.acme.certs."dns-metrics.plato-splunk.media".directory;# /var/lib/acme/dns-metrics.plato-splunk.media
```

and `provision.certReadyUnits = [ "acme-dns.plato-splunk.media.service" ]`. Because the acme
generator creates the certs under the **same three names** (`fqdn = <subdomain>.<zone>` =
`dns`/`dns-admin`/`dns-metrics` `.plato-splunk.media`), every `.directory` resolves to the same
`/var/lib/acme/<name>` path, and the `acme-dns.plato-splunk.media.service` systemd unit still exists
under the same name. So `encryptedDns.certPemFile`, `caddy.{admin,metrics}Cert{Pem,Key}File`,
`observability.lokiClientCert{Pem,Key}File`, and `provision.certReadyUnits` are all byte-identical.
**This is the one contract the migration must not break** (§7 gap (D) tracks it as a verification
obligation, not a schema change).

### 3.7 DNS — NOT owned by this plan

The `dns`, `dns-admin`, `dns-metrics`, and `aedilis` A/AAAA records (and the whole internal
`plato-splunk.media` zone) are provisioned via `services.technitium-server-complete.provision.ensureDnsRecords.zones
= c.dnsRecords.private` in `aedilisConfig`. That is the **DNS-records migration**
([./dns-records.md](./dns-records.md)), not this plan — so all three catalog entries set
`dns.enable = false` (the records come from the existing `ensureDnsRecords` wiring, and will be
migrated wholesale by the DNS generator later). This plan must **not** emit any DNS record, or it
would duplicate the authoritative zone.

> **Important:** aedilis is the DNS **host**, and its zone is self-referential (it resolves its own
> `dns`/`dns-admin`/`dns-metrics` names). The direct-tailnet challenge vhosts (`dns-admin`,
> `dns-metrics`) are only reachable because those names resolve to aedilis in the local Primary zone.
> That resolution is owned by the existing `ensureDnsRecords.zones = c.dnsRecords.private` — do not
> disturb it.

---

## 4. Operational-equivalence summary (per surface)

| Surface                                                  | Today                                                      | After (source)                                                | Equivalent?                |
| -------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------- | -------------------------- |
| `security.acme.certs."dns…"` (public LE)                 | hand-written (LE, email, group=cfg.group, 3 reloads)       | acme generator (`ca=letsencrypt`, `tls.email`, gap A/B)       | ✓ (needs gap A + B)        |
| `security.acme.certs."dns-admin…"` (step-ca)             | hand-written (step-ca, group=cfg.certGroup, [caddy])       | acme generator (`ca=internal`, certGroup override)            | ✓ identical                |
| `security.acme.certs."dns-metrics…"` (step-ca)           | hand-written (step-ca, group=cfg.certGroup, [caddy,alloy]) | acme generator (`ca=internal`, reloadServices=[alloy])        | ✓ identical                |
| `http://dns…` challenge vhost (handle + redirect)        | `handle /.well-known…` + `handle { redir … }`              | acme generator, `redirectToHttps=true` (gap C)                | ✓ (needs gap C redirect)   |
| `http://dns-admin…` challenge vhost (bare)               | `reverse_proxy 127.0.0.1:22483\n`                          | acme generator, `tls.challenge.body="bare"` (gap C)           | ✓ (needs gap C bare body)  |
| `http://dns-metrics…` challenge vhost (bare)             | `reverse_proxy 127.0.0.1:22481\n`                          | acme generator, `tls.challenge.body="bare"` (gap C)           | ✓ (needs gap C bare body)  |
| `services.homelab-acme.defaultCA`                        | `"internal"`                                               | unchanged (set in the catalog feature or kept in complete)    | ✓ identical                |
| firewall `tailscale0` `22481`/`22483` (direct challenge) | hand-copied in security.nix                                | firewall generator (`via=direct;iface=tailscale0`)            | ✓ identical                |
| firewall `tailscale0` `8443`/`9443` (vhost listen)       | hand-copied in security.nix                                | firewall generator (`scope=tailnet;listenPort`)               | ✓ identical                |
| firewall public `80`/`443`/`853`, `22`/`53`/`5252`       | hand-listed baseline                                       | unchanged (baseline, §5.1 #7); gap E keeps entry #1 silent    | ✓ no change                |
| cert directories + `certReadyUnits` consumers            | `config.security.acme.certs.<n>.directory`                 | same cert names → same paths/units                            | ✓ identical (gap D oracle) |
| Technitium option module (runtime)                       | `aedilisConfig` in complete.nix                            | unchanged (only the acme import removed)                      | ✓ identical                |
| DNS records (`dns`/`dns-admin`/`dns-metrics`/`aedilis`)  | `ensureDnsRecords.zones = c.dnsRecords.private`            | unchanged (dns-records migration owns it; `dns.enable=false`) | ✓ no change                |

**Conclusion:** every realized attribute is identical before and after, **conditional on schema gaps
(A) `tls.email`, (B) `reloadServices` prepend-caddy convention, (C) challenge redirect + verbatim-body

- upstream-host token, and (E) cert-only `raw`/no-listenPort entry**, plus the gap (D) **verification
  obligation** that cert names/directories/units stay identical. With those, the deploy is a theoretical
  no-op with zero intentional deviations.

---

## 5. Parity gates (exact commands)

> **Prerequisite (`.kiro/steering/validation.md`):** flake eval reads the **git tree**. Before any
> eval, `git add` the new `features/technitium-aedilis/catalog.nix` (keep `acme.nix` until the "after"
> evals pass). Untracked new `.nix` files are invisible to `import-tree` and produce a misleading
> "missing attribute" error.

### 5.1 The three certs — `--json`

```sh
for d in dns dns-admin dns-metrics; do
  nix eval \
    ".#nixosConfigurations.aedilis.config.security.acme.certs.\"$d.plato-splunk.media\"" --json \
    | jq '{domain, server, listenHTTP, group, reloadServices, email}'
done
```

Before/after must match, i.e.:

```json
{ "domain": "dns.plato-splunk.media", "server": "https://acme-v02.api.letsencrypt.org/directory",
  "listenHTTP": "127.0.0.1:22482", "group": "technitium",
  "reloadServices": ["caddy.service","technitium-dns-server.service","technitium-provision.service"],
  "email": "rae@plato-splunk.media" }
{ "domain": "dns-admin.plato-splunk.media", "server": "https://ca.plato-splunk.media/acme/http/directory",
  "listenHTTP": "127.0.0.1:22483", "group": "<cfg.certGroup>", "reloadServices": ["caddy.service"], "email": null }
{ "domain": "dns-metrics.plato-splunk.media", "server": "https://ca.plato-splunk.media/acme/http/directory",
  "listenHTTP": "127.0.0.1:22481", "group": "<cfg.certGroup>",
  "reloadServices": ["caddy.service","alloy.service"], "email": null }
```

(Resolve `<cfg.certGroup>` to the concrete string by reading
`nix eval '.#nixosConfigurations.aedilis.config.services.technitium-server-complete.certGroup' --raw`
on the base revision; it must be unchanged after.)

### 5.2 The three `http://` challenge vhosts — `--raw`, byte-for-byte

```sh
for d in dns dns-admin dns-metrics; do
  echo "== http://$d.plato-splunk.media =="
  nix eval \
    ".#nixosConfigurations.aedilis.config.services.caddy.virtualHosts.\"http://$d.plato-splunk.media\".extraConfig" \
    --raw
done
```

Expected (byte-for-byte, each with trailing newline):

```
== http://dns.plato-splunk.media ==
handle /.well-known/acme-challenge/* {
  reverse_proxy 127.0.0.1:22482
}
handle {
  redir https://dns.plato-splunk.media{uri}
}
== http://dns-admin.plato-splunk.media ==
reverse_proxy 127.0.0.1:22483
== http://dns-metrics.plato-splunk.media ==
reverse_proxy 127.0.0.1:22481
```

Capture before/after to `/tmp/tech-chal-$d.{before,after}` and `diff` — each MUST be empty.

### 5.3 `certGroup` + `defaultCA` — no-change checks

```sh
nix eval '.#nixosConfigurations.aedilis.config.services.technitium-server-complete.group'     --raw
nix eval '.#nixosConfigurations.aedilis.config.services.technitium-server-complete.certGroup' --raw
nix eval '.#nixosConfigurations.aedilis.config.services.homelab-acme.defaultCA'               --raw   # internal
```

### 5.4 Firewall — service-derived openings present, baseline preserved

```sh
nix eval '.#nixosConfigurations.aedilis.config.networking.firewall.interfaces.tailscale0.allowedTCPPorts' --json \
  | jq 'sort'
# MUST contain (as a set) 8443, 9443, 22481, 22483 — AND still 22, 53, 5252 (baseline).
nix eval '.#nixosConfigurations.aedilis.config.networking.firewall.allowedTCPPorts' --json | jq 'sort'  # 80,443,853 unchanged
nix eval '.#nixosConfigurations.aedilis.config.networking.firewall.allowedUDPPorts' --json | jq 'sort'  # 853 unchanged
nix eval '.#nixosConfigurations.aedilis.config.networking.firewall.interfaces.tailscale0.allowedUDPPorts' --json | jq 'sort'  # 53 unchanged
```

Compare the sorted sets before/after — identical.

### 5.5 Cert-directory consumption contract — gap (D) oracle

```sh
# The three cert directories MUST be unchanged (so every CertPemFile/CertKeyFile consumer resolves same):
for d in dns dns-admin dns-metrics; do
  nix eval ".#nixosConfigurations.aedilis.config.security.acme.certs.\"$d.plato-splunk.media\".directory" --raw
done
# -> /var/lib/acme/dns.plato-splunk.media  (etc.)

# The Technitium option module's cert consumers are byte-identical:
nix eval '.#nixosConfigurations.aedilis.config.services.technitium-server-complete.encryptedDns.certPemFile'          --raw
nix eval '.#nixosConfigurations.aedilis.config.services.technitium-server-complete.caddy.adminCertPemFile'           --raw
nix eval '.#nixosConfigurations.aedilis.config.services.technitium-server-complete.caddy.metricsCertPemFile'         --raw
nix eval '.#nixosConfigurations.aedilis.config.services.technitium-server-complete.observability.lokiClientCertPemFile' --raw
nix eval '.#nixosConfigurations.aedilis.config.services.technitium-server-complete.provision.certReadyUnits'         --json
# -> ["acme-dns.plato-splunk.media.service"]  (the unit must still exist under this name)
```

### 5.6 Whole-vhosts + homelab-acme sanity

```sh
nix eval '.#nixosConfigurations.aedilis.config.services.caddy.virtualHosts' --json \
  | jq 'keys | map(select(startswith("http://")))'   # the three http:// challenge keys, no more/less
```

### 5.7 Build gate

```sh
nix run .#nixfmt -- $(git ls-files '*.nix' ':!:repos/**')
nix flake check
nixos-rebuild build --flake .#aedilis
```

---

## 6. Migration checklist

> Depends on the catalog schema + generators ([./catalog-and-generators.md](./catalog-and-generators.md))
> **including the schema additions this plan surfaces** (§7): gap (A) `tls.email`, gap (B) confirmed
> `reloadServices` prepend-caddy convention, gap (C) challenge redirect + verbatim-body +
> upstream-host token, gap (E) cert-only `raw`/no-listenPort entry. Sequence in parent plan §3 step 4
> (cert-terminating services) / step 5 (firewall) — alongside the companion
> [./technitium-caddy.md](./technitium-caddy.md), which must land together so the `8443`/`9443` vhost
> bodies and their firewall openings are consistent.

1. **Land schema gaps first** (§7): `tls.email`, challenge `redirectToHttps` + `tls.challenge.body =
   "bare"` (shared with kanidm), cert-only `backend.kind = "raw"` + `listenPort = null` handling in
   the firewall generator. (Challenge upstream is the renderer's global `127.0.0.1` — no per-entry
   field.) Re-confirm the keystone "introducing the module is a no-op" gate (all `managedBy.*` false).
2. **Capture baseline.** Run §5.1 (three certs `--json`), §5.2 (three challenge vhosts `--raw`), §5.3
   (certGroup/defaultCA), §5.4 (firewall sets), §5.5 (cert-dir consumers), §5.6 (vhost keys) →
   `/tmp/tech-*.before`.
3. **Create `features/technitium-aedilis/catalog.nix`** with the three entries (§2.1):
   - `technitium` (public LE): `subdomain=dns`, `tls.ca=letsencrypt`, `tls.email="rae@plato-splunk.media"`,
     `tls.acmePort=22482`, `tls.certGroup="technitium"`,
     `tls.reloadServices=["technitium-dns-server.service" "technitium-provision.service"]`,
     `tls.challenge={via="caddy80"; redirectToHttps=true}`, `backend.kind="raw"`,
     `access.scope="public"` (with `listenPort=null` so no vhost port opens), `dns.enable=false`.
   - `technitium-admin` (step-ca): `subdomain=dns-admin`, `listenPort=8443`, `tls.ca=internal`,
     `tls.acmePort=22483`, `tls.certGroup=<cfg.certGroup>`, `tls.reloadServices=[]`,
     `tls.challenge={via="direct"; iface="tailscale0"; body="bare"}`,
     `access.scope="tailnet"`, `dns.enable=false`. **`managedBy.caddy` OFF** (vhost body is companion).
   - `technitium-metrics` (step-ca): `subdomain=dns-metrics`, `listenPort=9443`, `tls.ca=internal`,
     `tls.acmePort=22481`, `tls.certGroup=<cfg.certGroup>`, `tls.reloadServices=["alloy.service"]`,
     `tls.challenge={via="direct"; iface="tailscale0"; body="bare"}`,
     `access.scope="tailnet"`, `dns.enable=false`. **`managedBy.caddy` OFF**.
4. **Resolve `<cfg.certGroup>`** to the concrete string (read it from the base revision, §5.3) and set
   `tls.certGroup` for the two step-ca entries to that exact value (or read it from
   `config.services.technitium-server-complete.certGroup` to keep one source of truth).
5. **Opt in** `managedBy.acme = true` and `managedBy.firewall = true` for all three entries on
   aedilis. (`managedBy.caddy` and `managedBy.dns` stay OFF — companion + dns-records plans own those.)
6. **Delete `technitium-aedilis-acme`** (`acme.nix`): remove the three `security.acme.certs.*` blocks
   and the three `http://` challenge vhosts (now generator-produced), and drop its import from
   `complete.nix`. **Keep** `services.homelab-acme.defaultCA = "internal"` (move it into the catalog
   feature or leave it as a one-liner in the feature so it is not lost).
7. **Delete the hand-copied firewall ports** `22481`, `22483`, `8443`, `9443` from
   `_private/aedilis/security.nix`'s `tailscale0.allowedTCPPorts` (now generator-produced). **Keep**
   `22`, `53`, `5252`, the public `80`/`443`/`853`, and the UDP `53`/`853` (baseline, §5.1 #7).
8. **Do NOT touch** `aedilisConfig` — every `security.acme.certs.<name>.directory` read,
   `certReadyUnits`, and `services.technitium-server-complete.*` value stays verbatim (§3.6).
9. **Stage new/changed files:** `git add nix-config/modules/features/technitium-aedilis/catalog.nix`,
   stage the `acme.nix` deletion, the `complete.nix` import edit, and the `security.nix` edit.
10. **Run the parity gate.** Re-run §5.1–§5.6 → `/tmp/tech-*.after`; `diff` each against `.before`.
    **All diffs MUST be empty.** Likely culprits: missing `email` on the public cert (gap A);
    `caddy.service` not first / duplicated in `reloadServices` (gap B); `handle` wrapper on the
    admin/metrics challenge or a missing redirect on `dns` (gap C); `localhost` vs `127.0.0.1` in a
    challenge body; a stray `8443`/`9443` opened for entry #1 or `80` added by the generator (gap E);
    a changed cert `directory` breaking an `encryptedDns`/`caddy`/`observability` consumer (gap D).
11. **Companion + DNS.** Land [./technitium-caddy.md](./technitium-caddy.md) together (the `8443`/`9443`
    vhost bodies); defer the `dns`/`dns-admin`/`dns-metrics`/`aedilis` records to
    [./dns-records.md](./dns-records.md).
12. **Format + check + build.** `nix run .#nixfmt -- …`, `nix flake check`,
    `nixos-rebuild build --flake .#aedilis`. All must pass.
13. **Deploy as a no-op.** All three certs, all three challenge vhosts, the four tailnet firewall
    ports, the cert directories, and the entire Technitium runtime are unchanged on aedilis.

---

## 7. Catalog schema gaps this exercise surfaces

technitium-aedilis is the stress test for the **public-LE + multi-group + direct-tailnet-challenge**
cert case. It surfaces four schema additions (A, C, E, and a confirmation of B) plus one
verification obligation (D). All are small, typed, reusable, and keep "one declaration per surface".

### Gap (A) — `tls.email` (Let's Encrypt account email)

The keystone acme generator (catalog-and-generators §3.4) has no `email` field; it only swaps the
`server` directory for `ca == "letsencrypt"`. The public `dns` cert sets `email =
"rae@plato-splunk.media"` (the LE account email). This is the only LE cert in the fleet (the parent
plan §2.4 even calls it out as "the one real example").

- **Add:** `tls.email = mkOption { type = nullOr str; default = null; }`. The acme generator emits
  `email = e.tls.email` only when non-null (internal certs leave it null). The field is LE-specific
  but harmless (and ignored) for internal certs.

### Gap (B) — confirm `reloadServices = [ "caddy.service" ] ++ tls.reloadServices` (caddy first)

Not a new field, but a convention this plan **relies on** and must be pinned. All three current certs
list `caddy.service` **first**, then service-specific units. The catalog supplies `tls.reloadServices`
as the list **without** the leading `caddy.service`, in order (`dns`:
`[technitium-dns-server.service, technitium-provision.service]`; `dns-admin`: `[]`; `dns-metrics`:
`[alloy.service]`). The generator's prepend reproduces the exact ordered list.

- **Confirm:** the keystone/kanidm generator prepends `caddy.service` (catalog-and-generators §3.4;
  kanidm.md §3.3). If a future revision changes ordering, re-derive the catalog lists. The parity gate
  §5.1 catches any order/duplication error.

### Gap (C) — challenge-vhost body variants (redirect, verbatim-bare, upstream-host token)

The keystone acme generator defaults the challenge body to a single `handle
/.well-known/acme-challenge/* { reverse_proxy 127.0.0.1:<acmePort> }`. technitium needs **three**
variants in one deployment:

1. **`dns` (public):** the default `handle` block **plus** a trailing `handle { redir
   https://<fqdn>{uri} }` HTTPS-redirect block. **Add:** `tls.challenge.redirectToHttps = bool`
   (default false); when true, the generator appends the redirect `handle`.
2. **`dns-admin` / `dns-metrics` (direct):** the **bare** `reverse_proxy 127.0.0.1:<acmePort>` form
   (no `handle` wrapper). This is the same "bare body" the kanidm plan requests (`tls.challenge.body =
   "bare"`, kanidm.md §7). **Reuse** that selector.
3. **Upstream-host token.** The renderer's global `127.0.0.1` standardization (§7.8 #22) covers both
   technitium's bare body and kanidm's — both emit `127.0.0.1`. No per-entry host-token field is
   needed; the `handle` default already uses `127.0.0.1` too.

- **Net:** `redirectToHttps` (new), `tls.challenge.body = "bare"` (shared with kanidm). Both reproduce
  the current bodies exactly (the `localhost → 127.0.0.1` substitution on bare bodies is the approved
  global standardization, not a per-entry concern).

### Gap (E) — cert-only entry (no servable vhost, no listen-port firewall opening)

The public `dns` cert entry requests a cert and a `:80` challenge **but has no Caddy HTTPS vhost**
(Technitium terminates DoH/DoT/DoQ natively) and its "public" ports (`443`/`853`) are
Technitium-native baseline infra, not a catalog `listenPort`. The firewall generator must **not**
open a listen port for this entry.

- **Add:** support `backend.kind = "raw"` **with `listenPort = null`** (or `access.scope = "none"` for
  the firewall half while still allowing the cert to be requested). The firewall generator opens a
  listen port only when `listenPort != null`; a cert-only entry contributes solely its challenge-port
  opening (here `via = "caddy80"` → none). The caddy generator emits **no** vhost for a `raw`
  cert-only entry (it has no body and `managedBy.caddy` is off anyway). This keeps the public
  `80`/`443`/`853` as hand-listed baseline and lets the entry exist purely to drive the LE cert + its
  public challenge.

### Gap (D) — verification obligation: cert names/directories/units must stay identical (NOT a schema change)

The Technitium option module **consumes** the cert directories
(`config.security.acme.certs.<name>.directory`) and the challenge unit name
(`provision.certReadyUnits = [ "acme-dns.plato-splunk.media.service" ]`). The acme generator must
create the certs under the **exact same names** (`dns`/`dns-admin`/`dns-metrics` `.plato-splunk.media`)
so every consumer resolves identically. This is not a schema addition — it is a **hard constraint**
the migration must verify (§5.5). The catalog's `fqdn = <subdomain>.<zone>` guarantees it as long as
`subdomain`/`zone` are `dns`/`dns-admin`/`dns-metrics` + `plato-splunk.media`.

> These additions (A, C, E) + the B confirmation + the D oracle are the concrete price of
> representing the public-LE + multi-group + direct-tailnet-challenge service. They are small and
> reusable (A helps any LE cert, C helps any service with a public redirect or alias/bare challenge,
> E helps any cert-only/native-TLS service like a future DoT-only resolver), and they keep the "one
> declaration per surface" property intact — technitium-aedilis is three catalog entries that feed the
> acme + firewall generators while the Technitium option module stays the untouched owner of the
> service runtime.

---

## 8. Reconciliation summary — what the catalog replaces vs. leaves alone

Because Technitium is **already option-driven**, this is the explicit answer to "feed the options or
replace the Caddy/ACME pieces":

| Piece                                              | Decision                                      | Rationale                                                                       |
| -------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------- |
| `technitium-aedilis-acme` (3 certs + 3 challenges) | **REPLACE** with catalog → acme generator     | Pure cross-cutting cert/challenge boilerplate — exactly the generator's job.    |
| Hand-copied `22481`/`22483`/`8443`/`9443` firewall | **REPLACE** with catalog → firewall generator | Service-attributable openings that drift from the `acmePort` constants today.   |
| `services.homelab-acme.defaultCA = "internal"`     | **KEEP** (one-liner in the feature)           | Host/feature-level default, not a per-service fact.                             |
| `aedilisConfig` cert-dir reads + `certReadyUnits`  | **LEAVE UNTOUCHED**                           | Consumption contract; same cert names keep it byte-identical (gap D).           |
| `services.technitium-server-complete.*` (runtime)  | **LEAVE UNTOUCHED**                           | Service runtime — the option module is already the single source of truth.      |
| Admin/metrics HTTPS vhost **bodies**               | **Companion plan** [./technitium-caddy.md]    | Those are `managedBy.caddy` surfaces; this plan owns only their certs/firewall. |
| `dns`/`dns-admin`/`dns-metrics`/`aedilis` DNS      | **Deferred** to [./dns-records.md]            | Centralized authoritative zone; `dns.enable=false` here to avoid duplication.   |

The catalog **feeds** the three cross-cutting surfaces (cert, challenge vhost, firewall) and
**replaces** only the hand-rolled acme module + the drifting firewall ports; it **does not** replace
or duplicate the option-driven Technitium runtime, which keeps owning the service and consuming the
cert directories. That is the careful reconciliation the already-option-driven Technitium demands.
