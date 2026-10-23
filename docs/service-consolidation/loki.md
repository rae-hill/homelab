# loki — mTLS + Tracing Push Ingest (the `gate = "mtls"` + tracing reference)

Status: **PROPOSED**
Date: 2026-10-22
Parent: [../service-consolidation-plan.md](../service-consolidation-plan.md) ·
Index: [./README.md](./README.md) ·
Keystone: [./catalog-and-generators.md](./catalog-and-generators.md)

> **What makes loki distinct.** loki is the canonical **mTLS + tracing** vhost. It runs on
> **augustus** and exposes a single externally-reachable surface — the **`loki-push`** ingest
> vhost — that is client-cert-gated **and** carries a `tracing { span loki-push }` block **and**
> reverse-proxies to the local loki HTTP listener. This is the exact combination the catalog's
> `tls.gate = "mtls"` renderer must reproduce: the mTLS `client_auth` block, the tracing span, and
> the `reverse_proxy` body, composed in that order. No other migrated service exercises all three at
> once, so loki is the reference for the mTLS-with-tracing composition.
>
> **Operational-equivalence contract (from [./README.md](./README.md)):** deploying this revision
> MUST be a theoretical no-op. The `loki-push` vhost `extraConfig`, the `services.loki` block, and
> `failure-notifs` must all render byte-identical. The _only_ permitted intentional deviation is a
> flagged bug fix — there is none here.

---

## 0. Concerns & shape at a glance

Concerns emitted today (per the [index](./README.md)): **V (mTLS)** — one Caddy vhost that is
mTLS-gated, with tracing. No ACME cert owned by this module (C: loki does **not** terminate its own
TLS — Caddy manages the `loki-push` server cert via its managed/on-demand issuance), no OIDC (O), no
service-attributable firewall opening beyond the shared `443`, and no DNS record _owned by this
module_ (the `loki-push` A/AAAA lives in the centralized `tailnetRewrites` map).

| Surface           | Today                                                                    | Catalog entry                                          |
| ----------------- | ------------------------------------------------------------------------ | ------------------------------------------------------ |
| Caddy vhost       | `tls { client_auth … }` + `tracing { span loki-push }` + `reverse_proxy` | `tls.gate = "mtls"`, tracing via Tempo-enable, backend |
| ACME cert         | **none** — Caddy manages the `loki-push` server cert                     | `tls.ca = null` (no `security.acme.certs` entry)       |
| OIDC              | none                                                                     | omit `oidc`                                            |
| Firewall          | nothing new (443 is baseline on augustus)                                | `access.scope = "tailnet"` (opens nothing new)         |
| DNS (`loki-push`) | centralized `tailnetRewrites.loki-push = "augustus"`                     | `dns.enable = true; dns.kind = "tailnet"`              |
| `services.loki`   | full loki runtime config                                                 | stays verbatim in `service.nix` (not in the catalog)   |
| failure-notifs    | `attachServices = [ "loki" ]`                                            | stays in `service.nix`, colocated with the unit        |

> **Naming subtlety the catalog must respect.** The loki _runtime_ (`services.loki`, state dir,
> system user) has **no public hostname** — it listens only on `127.0.0.1:3100`. The externally
> reachable name is **`loki-push`**, a _different_ subdomain whose vhost reverse-proxies into that
> loopback listener. So the catalog entry's `subdomain` is **`loki-push`**, not `loki`; the entry
> name should also be `loki-push` to match the surface it represents. The loki runtime is plumbing
> behind it. (See §2.1.)

---

## 1. Current state — emitted output captured verbatim

### 1.1 The module today: `nix-config/modules/services/loki.nix`

The module has two parts: the **loki runtime** (unchanged plumbing) and the **`loki-push` vhost**
(the cross-cutting surface the catalog absorbs). The runtime:

```nix
services.loki = {
  enable = true;
  configuration = {
    auth_enabled = false;

    server = {
      http_listen_port = svc.port;        # svc = constants.services.loki -> 3100
      http_listen_address = "127.0.0.1";
      grpc_listen_port = 9096;
      grpc_listen_address = "127.0.0.1";
    };

    common = {
      path_prefix = svc.stateDir;         # /var/lib/loki
      replication_factor = 1;
      instance_addr = "127.0.0.1";
      ring = {
        kvstore.store = "inmemory";
        instance_addr = "127.0.0.1";
      };
    };

    schema_config.configs = [
      {
        from = "2024-01-01";
        store = "tsdb";
        object_store = "filesystem";
        schema = "v13";
        index = { prefix = "index_"; period = "24h"; };
      }
    ];

    storage_config.filesystem.directory = "${svc.stateDir}/chunks";

    limits_config = {
      retention_period = "30d";
      allow_structured_metadata = true;
      volume_enabled = true;
      discover_log_levels = true;
      log_level_fields = [ "level" "LEVEL" "Level" "log.level" "severity" "SEVERITY"
        "Severity" "SeverityText" "lvl" "LVL" "Lvl" "severity_text" "Severity_Text"
        "SEVERITY_TEXT" ];
      log_level_from_json_max_depth = 2;
    };

    compactor = {
      working_directory = "${svc.stateDir}/compactor";
      delete_request_store = "filesystem";
      retention_enabled = true;
    };
  };
};

systemd.services.loki.serviceConfig = {
  DynamicUser = lib.mkForce false;
  User = "loki";
  Group = "loki";
  StateDirectory = "loki";
};

users.users.loki = {
  isSystemUser = true;
  group = "loki";
  home = svc.stateDir;
};
users.groups.loki = { };
```

The cross-cutting surface — the **`loki-push` ingest vhost** (this is the part the catalog owns):

```nix
# External push ingestion endpoint (mTLS-guarded, for remote Alloy instances)
services.caddy.virtualHosts."${c.services.loki-push.url}" = {
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
      span loki-push
    }
    reverse_proxy 127.0.0.1:${builtins.toString svc.port}
  '';
};

services.failure-notifs.attachServices = [ "loki" ];
```

### 1.2 Constants it reads: `nix-config/modules/service-registry.nix`

```nix
# the loki runtime facts (no subdomain/url — loopback only):
loki = {
  port = 3100;
  stateDir = "/var/lib/loki";
};

# the externally-reachable push surface (a distinct subdomain):
loki-push = {
  subdomain = "loki-push";
  domain = mkDomain "loki-push";   # -> "loki-push.plato-splunk.media"
  url = mkUrl "loki-push";         # -> "https://loki-push.plato-splunk.media"
};
```

and the shared CA/trust fact used by the mTLS block:

```nix
ca.rootCert = certsDir + "/alford-root.crt";   # the step-ca root, used as the client-auth trust pool
```

So `c.services.loki-push.url` = `https://loki-push.plato-splunk.media`, `svc.port` = `3100`, and the
mTLS trust pool PEM is the step-ca root `alford-root.crt`.

### 1.3 The resolved emitted Caddy output

After interpolation, augustus realizes exactly:

```nix
services.caddy.virtualHosts."https://loki-push.plato-splunk.media" = {
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
      span loki-push
    }
    reverse_proxy 127.0.0.1:3100
  '';
};
```

> **Byte-exact structure (the thing the renderer must reproduce):** the body is, in order,
> (1) a `tls { client_auth { mode require_and_verify; trust_pool file { pem_file <ca.rootCert> } } }`
> block, then (2) a `tracing { span loki-push }` block, then (3) `reverse_proxy 127.0.0.1:3100`.
> Note the reverse-proxy upstream here is **`127.0.0.1`** (not `localhost` as in the plain it-tools
> case) — the renderer must emit `127.0.0.1` for this entry to stay byte-identical. Indentation is
> two-space nested; there is a trailing newline after the `reverse_proxy` line. The §4 parity gate
> compares this with `--raw`.

### 1.4 No ACME cert owned here — Caddy manages the server cert

There is **no** `security.acme.certs."loki-push.plato-splunk.media"` block. The `loki-push` vhost
names **no explicit `tls <cert> <key>`** — the `tls { … }` directive carries only `client_auth`, so
Caddy supplies the **server** certificate itself from its managed/on-demand issuance (the step-ca
ACME issuer configured in the base `services/caddy.nix`). The `tls … client_auth` block constrains
the **client** side (mutual TLS) using the step-ca root as the trust pool. This is the key
distinction for the catalog: **loki is an mTLS _server_ that does not terminate its own manually
provisioned cert** — so `tls.ca = null` (no `security.acme.certs` entry, no HTTP-01 challenge vhost),
yet `tls.gate = "mtls"`. The schema already supports this split (gate is independent of `ca`).

### 1.5 The DNS record (centralized, in `tailnetRewrites`)

The module emits **no** DNS record. `loki-push` resolves because `service-registry.nix` lists it in
`tailnetRewrites` (line ~56):

```nix
tailnetRewrites = {
  # …
  loki-push = "augustus";
  # …
};
```

which becomes an apex A + AAAA under `plato-splunk.media` pointing at augustus's tailnet addresses
(`constants.hosts.augustus.tailscale.{v4,v6}`):

```
loki-push.plato-splunk.media.  A     100.95.250.77
loki-push.plato-splunk.media.  AAAA  fd7a:115c:a1e0::6301:fa4d
```

emitted into the `plato-splunk.media` Primary zone on **aedilis**. The loki _runtime_ name has no
record (loopback only).

### 1.6 The firewall (already satisfied, no module contribution)

loki opens **nothing**. Its HTTP listener binds `127.0.0.1:3100` (loopback), gRPC binds
`127.0.0.1:9096` (loopback), and the public entrypoint is Caddy on `443` — a baseline opening
augustus already owns in `_private/augustus/security.nix`. There is **no loki-attributable firewall
rule to migrate**; the firewall generator must add nothing for this service.

### 1.7 Properties to preserve (invariants)

- **mTLS gate preserved exactly:** `mode require_and_verify` + `trust_pool file { pem_file
  <ca.rootCert> }` — same trust pool PEM (`alford-root.crt`).
- **Tracing span preserved exactly:** `tracing { span loki-push }` — same span name.
- **Reverse-proxy upstream preserved exactly:** `reverse_proxy 127.0.0.1:3100` (note `127.0.0.1`, not
  `localhost`).
- **Block order preserved:** `tls` → `tracing` → `reverse_proxy`.
- **No server cert named / no ACME cert:** `tls.ca = null`; no `security.acme.certs` entry; Caddy
  manages the server cert.
- **No OIDC, no new firewall opening.**
- **`services.loki` runtime copied verbatim** (port, state dir, schema, limits, compactor, system
  user/group, `DynamicUser = mkForce false`).
- **failure-notifs unchanged:** `attachServices = [ "loki" ]` (attaches the `loki` systemd unit, not
  a `podman-` unit — loki is a native `services.loki`, not a container).

---

## 2. Target state — colocated feature layout

Replace `services/loki.nix` with a `features/loki/` directory (parent plan §2.0). loki has **no**
`options.nix` (no service-specific options beyond constants) and **no** `oidc.nix`:

```
features/loki/
├── catalog.nix     # homelab.catalog.loki-push = { … }  (the mTLS + tracing + DNS contract ONLY)
├── service.nix     # services.loki runtime + users + failure-notifs.attachServices (the runtime)
└── complete.nix    # flake.modules.nixos.loki = { imports = [ loki-push-catalog loki-service ]; }
```

- **`catalog.nix`** holds only the cross-cutting networking facts for the **`loki-push`** surface
  (mTLS gate, tracing, backend port, DNS). It does **not** hold `services.loki` or failure-notifs.
- **`service.nix`** holds the loki runtime (`services.loki`, the `systemd.services.loki.serviceConfig`
  override, the `loki` user/group) **and** `services.failure-notifs.attachServices = [ "loki" ]` —
  failure-notifs is tied to the service declaration, so it stays next to the unit it names.
- **`complete.nix`** is what `hosts/augustus.nix` imports (as `nixos.loki` today). Importing it both
  realizes the loki runtime **and** registers the `loki-push` catalog entry; augustus's generators
  pick it up.

### 2.1 `features/loki/catalog.nix`

```nix
{ config, ... }:
let
  c = config.constants;
  loki = c.services.loki;             # runtime facts (port 3100)
in
{
  homelab.catalog.loki-push = {
    # The externally-reachable surface is loki-push, NOT loki (loki is loopback-only).
    subdomain = "loki-push";
    zone = "plato-splunk.media";      # default; stated for clarity
    host = "augustus";

    # Reverse-proxy into the loopback loki HTTP listener.
    backend = {
      kind = "reverseProxy";
      port = loki.port;               # 3100
    };

    tls = {
      # loki does NOT terminate its own manual cert — Caddy manages the loki-push server
      # cert via managed/on-demand issuance. So NO security.acme.certs entry.
      ca = null;
      # But the vhost IS client-cert gated: mutual TLS using the step-ca root as trust pool.
      gate = "mtls";
      mtlsTrustPoolFile = c.ca.rootCert;   # alford-root.crt
    };

    # Reachable over the tailnet (opens nothing new: 443 is a baseline host opening).
    access.scope = "tailnet";

    # Emit the loki-push A/AAAA record on aedilis (reproduces tailnetRewrites.loki-push).
    dns.enable = true;
    # dns.kind defaults to "tailnet" -> A/AAAA from constants.hosts.augustus.tailscale.
  };
}
```

Notes:

- **`tls.ca = null` with `tls.gate = "mtls"`** is the crucial combination: a client-cert-gated vhost
  whose **server** cert is Caddy-managed (no `security.acme.certs`). The ACME generator skips it
  (filters on `tls.ca != null`); the Caddy generator still emits the mTLS block because `gate ==
  "mtls"`.
- **`mtlsTrustPoolFile = c.ca.rootCert`** carries the `pem_file` path the `trust_pool file { … }`
  block needs. This is the field the keystone schema (§2 of
  [catalog-and-generators.md](./catalog-and-generators.md)) defines for exactly this case.
- **Tracing is not a catalog field** — the renderer appends `tracing { span <name> }` automatically
  when `config.services.tempo.enable` is true on the host (see §2.3). The span name is the entry
  name (`loki-push`). This matches today's hard-coded `span loki-push` (see the composition caveat in
  §2.3 / §5).

### 2.2 `features/loki/service.nix`

Verbatim carry-over of the loki runtime + system user + failure-notifs (unchanged behavior):

```nix
{ config, ... }:
let
  svc = config.constants.services.loki;
in
{
  flake.modules.nixos.loki-service =
    { lib, ... }:
    {
      services.loki = {
        enable = true;
        configuration = {
          auth_enabled = false;
          server = {
            http_listen_port = svc.port;
            http_listen_address = "127.0.0.1";
            grpc_listen_port = 9096;
            grpc_listen_address = "127.0.0.1";
          };
          common = {
            path_prefix = svc.stateDir;
            replication_factor = 1;
            instance_addr = "127.0.0.1";
            ring = {
              kvstore.store = "inmemory";
              instance_addr = "127.0.0.1";
            };
          };
          schema_config.configs = [
            {
              from = "2024-01-01";
              store = "tsdb";
              object_store = "filesystem";
              schema = "v13";
              index = { prefix = "index_"; period = "24h"; };
            }
          ];
          storage_config.filesystem.directory = "${svc.stateDir}/chunks";
          limits_config = {
            retention_period = "30d";
            allow_structured_metadata = true;
            volume_enabled = true;
            discover_log_levels = true;
            log_level_fields = [
              "level" "LEVEL" "Level" "log.level" "severity" "SEVERITY" "Severity"
              "SeverityText" "lvl" "LVL" "Lvl" "severity_text" "Severity_Text"
              "SEVERITY_TEXT"
            ];
            log_level_from_json_max_depth = 2;
          };
          compactor = {
            working_directory = "${svc.stateDir}/compactor";
            delete_request_store = "filesystem";
            retention_enabled = true;
          };
        };
      };

      systemd.services.loki.serviceConfig = {
        DynamicUser = lib.mkForce false;
        User = "loki";
        Group = "loki";
        StateDirectory = "loki";
      };

      users.users.loki = {
        isSystemUser = true;
        group = "loki";
        home = svc.stateDir;
      };
      users.groups.loki = { };

      services.failure-notifs.attachServices = [ "loki" ];
    };
}
```

> Every line of the loki runtime is copied **exactly** — same ports, state dir, schema window,
> retention, compactor, the `DynamicUser = lib.mkForce false` + `loki` user/group, and
> `attachServices = [ "loki" ]`. No behavioral change.

### 2.3 What the Caddy generator must render for loki-push

The generator (parent plan §2.3; keystone §3.1–§3.2) filters to `host == augustus` and, for
`gate == "mtls"`, composes the body through the shared `renderVhostBody` helper. For `loki-push` it
must produce **exactly** today's body:

```
tls {
  client_auth {
    mode require_and_verify
    trust_pool file {
      pem_file <ca.rootCert>
    }
  }
}
tracing {
  span loki-push
}
reverse_proxy 127.0.0.1:3100
```

**How the renderer composes mTLS + tracing + reverse_proxy (the core of this plan).** The shared
`renderVhostBody` (keystone §3.1) builds the body by concatenating, in a fixed order:

1. **tracing block** — `tracingBlock hostCfg name`, emitted only when `hostCfg.services.tempo.enable`
   (augustus runs Tempo, so it fires). Produces `tracing {\n  span <name>\n}\n`.
2. **tls block** — because `gate == "mtls"`, `mtlsTlsLine { certPem; certKey; trustPool }` emits the
   `tls … { client_auth { mode require_and_verify; trust_pool file { pem_file <trustPool> } } }`
   wrapper.
3. **backend block** — `backendBlock e` emits `reverse_proxy <upstream>:<port>`.
4. **extraCaddyConfig** — appended verbatim (empty for loki).

> **Composition caveat the keystone renderer must fix for byte-parity (flagged schema/renderer gap).**
> The keystone's `renderVhostBody` (as drafted in [catalog-and-generators.md](./catalog-and-generators.md)
> §3.1) concatenates **`tracingBlock` first, then `tls`, then `backend`** — i.e. order
> `tracing → tls → reverse_proxy`. But loki's current body is ordered **`tls → tracing →
> reverse_proxy`**. Caddyfile directive order inside a site block is **not** semantically significant
> for these directives (Caddy sorts by its internal directive order at parse time), so the two are
> _operationally_ equivalent — but they are **not byte-identical**, and the `--raw` parity gate (§4)
> compares bytes. Two ways to resolve, pick one in the keystone PR:
>
> 1. **Make the renderer emit `tls → tracing → reverse_proxy`** (reorder `renderVhostBody` so the mTLS
>    `tls` block precedes the tracing block). This reproduces loki's current bytes exactly and is the
>    recommended fix — it also matches the mental model "TLS first, then telemetry, then upstream."
> 2. **Normalize to the renderer's `tracing → tls → reverse_proxy` order** and accept the byte diff as
>    an _explicitly-justified, reviewed_ change, having confirmed via `caddy fmt`/`caddy validate`
>    that the two orders produce an identical parsed config. This is a permitted deviation only
>    because it is provably a no-op at the Caddy-config level, but it muddies the "empty diff"
>    contract, so option 1 is preferred.
>
> **The mTLS trust-pool `pem_file` plus the tracing `span` plus the `reverse_proxy` upstream must all
> appear verbatim.** Also: the mTLS `tls { client_auth … }` here carries **no** explicit server
> `tls <cert> <key>` (Caddy-managed), so `mtlsTlsLine` must emit the `tls { client_auth { … } }`
> _bare_ form (no cert/key args) when `certDir == null`. The keystone's `mtlsTlsLine` as drafted takes
> `certPem`/`certKey` and emits `tls <certPem> <certKey> { client_auth … }` — that is the
> **manual-cert mTLS** shape (technitium). loki needs the **managed-cert mTLS** shape `tls {
> client_auth … }` (no positional cert args). This is a second renderer gap: `mtlsTlsLine` must branch
> on whether a server cert is named (`certDir != null` → `tls <cert> <key> { client_auth … }`;
> `certDir == null` → `tls { client_auth … }`). See §5.

The vhost **key** must remain the full `https://loki-push.plato-splunk.media` (derived from
`<subdomain>.<zone>`), identical to `c.services.loki-push.url` today. `listenPort` stays the default
`443` (no `:port` suffix on the key).

---

## 3. Operational equivalence argument

Deploying this revision must change nothing on augustus. Per surface:

### 3.1 Caddy `loki-push` vhost — byte-identical (modulo the flagged block-order fix)

- **Key:** `https://loki-push.plato-splunk.media` = `mkUrl "loki-push"`; the catalog derives `url`
  from `<subdomain>.<zone>` with the same base domain, so the attribute key is identical.
- **Body:** the mTLS `client_auth` block (same `mode require_and_verify`, same `pem_file
  <ca.rootCert>` trust pool), the `tracing { span loki-push }` block (same span name, fires because
  augustus has Tempo enabled), and `reverse_proxy 127.0.0.1:3100` (same `127.0.0.1` upstream, same
  port). The only risk is **block ordering** — resolved by the keystone renderer emitting `tls →
  tracing → reverse_proxy` (§2.3 option 1) so the bytes match. With that fix the body is identical;
  without it the config is operationally identical but the `--raw` diff is non-empty (a provably-no-op
  reorder — see §5).
- **No server `tls <cert> <key>`** either way (Caddy-managed), so no cert path is added or dropped —
  provided `mtlsTlsLine` emits the bare `tls { client_auth … }` form (§2.3 / §5).

### 3.2 ACME cert (augustus) — none, before and after

- loki owns no `security.acme.certs` entry today, and `tls.ca = null` means the ACME generator emits
  nothing. No cert, no HTTP-01 challenge vhost, no change.

### 3.3 DNS (aedilis) — same A/AAAA pair reproduced

- Today: `tailnetRewrites.loki-push = "augustus"` → apex A `100.95.250.77` + AAAA
  `fd7a:115c:a1e0::6301:fa4d` in the `plato-splunk.media` Primary zone.
- New: `dns.enable = true; dns.kind = "tailnet"; host = "augustus"` → the DNS generator emits A/AAAA
  from `constants.hosts.augustus.tailscale.{v4,v6}`, which equal the `ts.augustus` values the
  `tailnetRewrites` fold uses today. Identical record set; upsert-only semantics preserved.

> **Sequencing:** the Caddy/feature move and the DNS generator cutover are independent (parent plan
> §3 steps 2 vs 9). `dns.enable = true` is declared now, but the `loki-push` A/AAAA continues to be
> produced by `tailnetRewrites` until the DNS generator is switched on and the `tailnetRewrites.
> loki-push` entry is deleted in the same change ([./dns-records.md](./dns-records.md)). One source at
> a time — never a duplicate or a gap.

### 3.4 Firewall (augustus) — no change

- loki opens nothing; `access.scope = "tailnet"` maps to `tailscale0`, but `443` is a baseline host
  opening (owned by `_private/augustus/security.nix`, not service-attributable). The firewall
  generator adds **no** new port for loki. `networking.firewall` must be byte-identical.

### 3.5 `services.loki` runtime + failure-notifs (augustus) — unchanged

- `services.loki`, the `systemd.services.loki.serviceConfig` override, and the `loki` user/group are
  copied verbatim from §1.1 into `service.nix` → identical `loki.service`.
- `services.failure-notifs.attachServices` still contains `"loki"`, now sourced from `service.nix`.
  NixOS concatenates the list, so the merged augustus list is identical.

**Conclusion:** every realized attribute (the `loki-push` vhost body + key, the absence of any ACME
cert, DNS records, firewall ports, the loki runtime, the failure-notifs list) is identical before and
after — provided the keystone renderer is fixed to (a) emit `tls → tracing → reverse_proxy` order and
(b) emit the bare `tls { client_auth … }` managed-cert mTLS form. With those two renderer fixes the
deploy is a theoretical no-op.

---

## 4. Parity gate (exact commands)

> **Prerequisite (`.kiro/steering/validation.md`):** flake eval reads the **git tree**. Before any
> eval, `git add` the new `features/loki/*.nix` files (and keep `services/loki.nix` until the "after"
> eval passes). Untracked new `.nix` files are invisible to `import-tree` and yield a misleading
> "missing attribute" error.

### 4.1 `loki-push` vhost body — the primary gate

Run **before** the migration and capture:

```sh
nix eval \
  '.#nixosConfigurations.augustus.config.services.caddy.virtualHosts."https://loki-push.plato-splunk.media".extraConfig' \
  --raw > /tmp/loki-push-vhost.before
```

Run the **same** command **after** the migration → `/tmp/loki-push-vhost.after`, then:

```sh
diff /tmp/loki-push-vhost.before /tmp/loki-push-vhost.after   # MUST be empty
```

An empty `diff` is the pass condition. The body must contain, verbatim: the `tls { client_auth {
mode require_and_verify; trust_pool file { pem_file <…alford-root.crt> } } }` block, the `tracing {
span loki-push }` block, and `reverse_proxy 127.0.0.1:3100`. If the diff is non-empty **only** due to
the `tls`/`tracing` block ordering, that is the flagged renderer issue (§2.3 / §5) — fix the renderer
to emit `tls → tracing → reverse_proxy` and re-diff; do not accept a non-empty diff otherwise.

### 4.2 Whole-vhosts sanity (catches accidental key change or extra attrs)

```sh
nix eval '.#nixosConfigurations.augustus.config.services.caddy.virtualHosts' --json \
  | jq '."https://loki-push.plato-splunk.media"'
```

Before/after JSON for this key must match (confirms the key string is unchanged and no stray
`serverAliases`/`tls`-cert attrs crept in).

### 4.3 No ACME cert for loki-push (must stay absent)

```sh
nix eval '.#nixosConfigurations.augustus.config.security.acme.certs' --json \
  | jq 'has("loki-push.plato-splunk.media")'   # -> false, before AND after
```

loki must never acquire a `security.acme.certs` entry — the server cert is Caddy-managed.

### 4.4 DNS parity (verified with the dns-records migration)

```sh
nix eval \
  '.#nixosConfigurations.aedilis.config.services.technitium-server-complete.provision.ensureDnsRecords.zones' \
  --json \
  | jq '."plato-splunk.media".records | map(select(.name == "loki-push"))'
```

Before/after must contain the same A (`100.95.250.77`) and AAAA (`fd7a:115c:a1e0::6301:fa4d`) records
for `loki-push`. (Run as part of [./dns-records.md](./dns-records.md) when the DNS generator is
switched on.)

### 4.5 Firewall + failure-notifs + runtime no-change checks

```sh
# firewall: byte-identical before/after
nix eval '.#nixosConfigurations.augustus.config.networking.firewall.allowedTCPPorts' --json
nix eval '.#nixosConfigurations.augustus.config.networking.firewall.interfaces.tailscale0.allowedTCPPorts' --json

# failure-notifs still attaches the loki unit
nix eval '.#nixosConfigurations.augustus.config.services.failure-notifs.attachServices' --json \
  | jq 'index("loki") != null'   # -> true

# loki runtime unchanged
nix eval '.#nixosConfigurations.augustus.config.services.loki.configuration' --json
```

### 4.6 Build gate

```sh
nix run .#nixfmt -- $(git ls-files '*.nix' ':!:repos/**')
nix flake check
nixos-rebuild build --flake .#augustus
```

---

## 5. Schema / renderer gaps this plan surfaces

loki is the first service to exercise the **mTLS + tracing + managed-server-cert** combination, and
it exposes two concrete gaps in the keystone renderer
([./catalog-and-generators.md](./catalog-and-generators.md)) that MUST be closed before the loki
parity gate can go green:

1. **mTLS directive ordering vs tracing (byte-parity).** The drafted `renderVhostBody` concatenates
   `tracing → tls → backend`, but loki's live body is `tls → tracing → reverse_proxy`. The orders are
   operationally equivalent (Caddy reorders directives internally) but **not byte-identical**, and the
   parity gate is a `--raw` byte compare. **Fix:** reorder `renderVhostBody` to emit the `tls` block
   **before** the `tracing` block (recommended), or accept the reorder as a provably-no-op reviewed
   deviation (less clean). This is a renderer change in the keystone module, not a loki-specific one —
   but loki is where it first bites.

2. **Managed-cert mTLS vs manual-cert mTLS (`mtlsTlsLine` shape).** The drafted `mtlsTlsLine` always
   emits `tls <certPem> <certKey> { client_auth … }` — the **manual-cert** form (technitium, which
   names an explicit server cert). loki needs the **managed-cert** form `tls { client_auth … }`
   (Caddy supplies the server cert; **no** positional cert/key args), because `tls.ca = null`. **Fix:**
   `mtlsTlsLine` must branch on whether a server cert directory is present:
   - `certDir != null` → `tls ${certDir}/fullchain.pem ${certDir}/key.pem { client_auth … }`
     (manual-cert mTLS — technitium, any `tls.ca != null` mTLS service);
   - `certDir == null` → `tls { client_auth … }` (managed-cert mTLS — loki).

   Equivalently, the keystone's `renderVhostBody` already computes `certDir` (null when `tls.ca ==
   null`); thread it into `mtlsTlsLine` so the bare form is chosen for loki. **This is the single most
   important schema/renderer observation from the loki migration**: `gate = "mtls"` is **orthogonal**
   to `tls.ca` — a vhost can be client-cert-gated while its _server_ cert is Caddy-managed. The schema
   already allows this (gate independent of ca); the renderer must too.

3. **(Minor) Tracing span name = entry name.** The renderer derives the `span` name from the catalog
   entry name. loki's entry is named `loki-push`, so the span is `loki-push` — matching today. Any
   service whose desired span name differs from its entry name would need a `tracing.spanName`
   override field; loki does **not** (confirming the entry-name default is adequate here), but note it
   for services where the span name and entry name diverge.

Neither gap changes loki's _declaration_ — both are fixes inside the shared renderer. They are logged
here because loki is the reference that forces them.

---

## 6. Migration checklist (condensed)

- [ ] Baseline captured (§4.1 `loki-push` vhost `--raw`, §4.2 whole-vhost JSON, §4.3 no-cert, §4.5
      firewall / failure-notifs / runtime → `*.before`)
- [ ] Keystone renderer fixes landed: (a) `tls → tracing → reverse_proxy` ordering, (b) `mtlsTlsLine`
      branches on `certDir` for the bare managed-cert `tls { client_auth … }` form (§5)
- [ ] `features/loki/catalog.nix` — `homelab.catalog.loki-push` entry (`subdomain = "loki-push"`,
      `backend = { reverseProxy; 3100 }`, `tls.ca = null`, `tls.gate = "mtls"`,
      `tls.mtlsTrustPoolFile = c.ca.rootCert`, `access.scope = "tailnet"`, `dns.enable = true`). **No
      `oidc`.**
- [ ] `features/loki/service.nix` — `services.loki` runtime + `systemd.services.loki.serviceConfig` +
      `loki` user/group + `failure-notifs.attachServices = [ "loki" ]` (verbatim)
- [ ] `features/loki/complete.nix` — aggregates to `flake.modules.nixos.loki`; `hosts/augustus.nix`
      import name preserved
- [ ] Caddy generator opted in (`managedBy.caddy`); hand-written `loki-push` vhost deleted
- [ ] Old `services/loki.nix` removed
- [ ] New files `git add`ed (Nix sees the git tree)
- [ ] **Parity gate green:** `loki-push` vhost `--raw` diff empty (§4.1); whole-vhost JSON match
      (§4.2); no `loki-push` ACME cert (§4.3); firewall / failure-notifs / loki runtime unchanged
      (§4.5)
- [ ] DNS parity deferred to [./dns-records.md](./dns-records.md) (§4.4); `tailnetRewrites.loki-push`
      removed there
- [ ] `nix run .#nixfmt`, `nix flake check`, `nixos-rebuild build --flake .#augustus` all pass
- [ ] Deployed — confirmed no-op (loki runtime, `loki-push` vhost, failure-notifs unchanged)
