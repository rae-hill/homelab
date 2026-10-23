# kanidm — Manual-TLS / Per-Service-Cert-Group Exemplar (HIGH complexity)

Status: **PROPOSED**
Date: 2026-10-22
Parent: [../service-consolidation-plan.md](../service-consolidation-plan.md) ·
Index: [./README.md](./README.md) ·
Keystone: [./catalog-and-generators.md](./catalog-and-generators.md) ·
Reference structure: [./it-tools.md](./it-tools.md)

> **This is the canonical manual-TLS case.** kanidm is the one service that terminates its own TLS
> cert, names that cert explicitly in its Caddy vhost, joins a **per-service cert group** (`idm`)
> shared only with Caddy, runs a **bespoke reverse-proxy transport** (upstream TLS with a pinned
> `tls_server_name`), and emits a **tracing span**. It currently also publishes a second HTTP-01
> challenge vhost for `ldap` — but see the approved deviation below: **the `ldap` route is being
> removed.** It also keeps a large `services.kanidm` block (server + full provision tree) and a restic
> backup that do **not** move to the catalog. Concerns emitted today (per the index): **V C O\*** —
> Caddy vhost, ACME cert, and it is the OIDC _host_ (it does not register a client for itself).
>
> **Operational-equivalence contract (from [./README.md](./README.md)):** deploying this revision
> MUST be a theoretical no-op **except for one operator-approved deviation**: the
> `http://ldap.plato-splunk.media` challenge vhost and the `ldap` DNS record are **removed** (the
> homelab is OIDC-exclusive; LDAP is unused — see [catalog-and-generators §7.8 #21](./catalog-and-generators.md)).
> Everything else — the main vhost `extraConfig` (explicit `tls`, `tracing`, bespoke transport), the
> **`idm`** challenge vhost, the `security.acme.certs."idm.plato-splunk.media"` block, the `idm`
> cert-group membership, and the `services.kanidm` server/provision/restic blocks (incl. the LDAP
> `bindaddress` setting, kept for config parity) — must render byte-identical. The `127.0.0.1`
> upstream standardization (§7.8 #22) does **not** affect kanidm's main vhost, whose upstream is the
> kanidm server's own `https://localhost:8443` listener (a kanidm-side `provision.instanceUrl`, not a
> Caddy loopback token) and is left untouched; the `idm` challenge vhost's bare `reverse_proxy`
> loopback IS standardized to `127.0.0.1`.

---

## 0. Why kanidm is the manual-TLS exemplar

kanidm is structurally unlike every reverse-proxy service (`it-tools`, `planka`, …) because it does
**not** share Caddy's managed cert. It binds its own TLS listener on `127.0.0.1:8443` and reads the
step-ca-issued cert directly off disk (`tls_key`/`tls_chain`), so the **same cert files** must be
readable by **both** Caddy (to terminate the public vhost) and the `kanidm` server process (to serve
its own `:8443`). That dual-reader requirement is exactly why it has a **per-service cert group**
(`idm`) with `caddy` and `kanidm` as members, and why the cert's `reloadServices` reloads **both**
units on renewal. Everything bespoke about kanidm flows from this one fact:

- **Explicit cert in the vhost.** The main vhost names the cert files (`tls "<dir>/fullchain.pem"
  "<dir>/key.pem"`) rather than letting Caddy auto-manage — because the cert is the step-ca one shared
  with the `kanidm` server, not a Caddy-internal cert.
- **Bespoke upstream transport.** The `reverse_proxy` target is kanidm's own HTTPS listener
  (`https://localhost:8443`), so the proxy block speaks **TLS to the upstream** with a pinned
  `tls_server_name` and forwards the original `HOST` header — not a plain `reverse_proxy
  localhost:<port>`.
- **Tracing span.** A `tracing { span kanidm }` block (present only when Tempo is enabled on the
  host).
- **~~Two challenge vhosts for one cert.~~ `ldap` route removed (approved).** The cert's `domain` is
  only `idm.plato-splunk.media`. Today there are HTTP-01 challenge vhosts for **both** `idm` and
  `ldap`; the `ldap` one (and its DNS record) is being **removed** — LDAP is unused and the homelab is
  OIDC-exclusive. Only the `idm` challenge vhost remains.
- **Per-service cert group (`idm`), decision §5.1 #6.** Not a shared `service-certs` group — the blast
  radius of the readable cert stays scoped to kanidm + caddy.

If the catalog + generators reproduce all of this byte-for-byte (modulo the approved `ldap` removal),
the schema is proven adequate for the hardest manual-TLS case. §7 covers the schema gaps this
exercise surfaces.

---

## 1. Current state — emitted output captured verbatim

### 1.1 Constants it reads: `nix-config/modules/service-registry.nix`

The `kanidm` entry (lines ~281–287):

```nix
kanidm = {
  subdomain = "idm";
  domain = idmDomain;              # idmDomain = mkDomain "idm" = "idm.plato-splunk.media"
  ldapDomain = mkDomain "ldap";    # -> "ldap.plato-splunk.media"
  backupPath = "/var/lib/kanidm/backups";
  acmePort = 64073;
};
```

with the shared helpers and CA constants (lines ~7–13, ~145):

```nix
baseDomain = "plato-splunk.media";
mkDomain = subdomain: "${subdomain}.${baseDomain}";
idmDomain = mkDomain "idm";                                    # "idm.plato-splunk.media"
# …
ca.acmeDirectoryHttp = "https://${mkDomain "ca"}/acme/http/directory";  # internal step-ca HTTP-01
```

So the resolved facts are:

| Fact                           | Value                                                   |
| ------------------------------ | ------------------------------------------------------- |
| `svc.subdomain`                | `idm`                                                   |
| `svc.domain`                   | `idm.plato-splunk.media`                                |
| `svc.ldapDomain`               | `ldap.plato-splunk.media`                               |
| `svc.acmePort`                 | `64073`                                                 |
| `c.ca.acmeDirectoryHttp`       | `https://ca.plato-splunk.media/acme/http/directory`     |
| kanidm server `bindaddress`    | `127.0.0.1:8443`                                        |
| kanidm `provision.instanceUrl` | `https://localhost:8443` (nixpkgs default from `:8443`) |

> **`instanceUrl` resolution (verified against vendored `repos/nixpkgs-26.05`):** the kanidm NixOS
> module (`nixos/modules/services/security/kanidm.nix` line ~450) defines
> `provision.instanceUrl` with `default = "https://localhost:${serverPort}"`, where `serverPort`
> comes from `server.settings.bindaddress` (`127.0.0.1:8443`). The module sets no explicit
> `instanceUrl`, so the main vhost's `reverse_proxy ${config.services.kanidm.provision.instanceUrl}`
> resolves to **`https://localhost:8443`** — an **HTTPS** upstream. This is the root reason the
> transport block exists (see §1.3).

### 1.2 The server settings (manual TLS on `:8443`) — stays in `service.nix`

From `services/kanidm.nix` (the `server.settings` block):

```nix
server = {
  enable = true;
  settings = {
    domain = svc.domain;                       # idm.plato-splunk.media
    origin = "https://${svc.domain}";          # https://idm.plato-splunk.media
    ldapbindaddress = "127.0.0.1:636";
    bindaddress = "127.0.0.1:8443";

    tls_key = "${directory}/key.pem";          # directory = security.acme.certs."idm…".directory
    tls_chain = "${directory}/fullchain.pem";

    online_backup = {
      versions = 7;
      path = svc.backupPath;
    };
  };
};
```

`directory` is bound at the top of the module from the ACME cert:

```nix
inherit (config.security.acme.certs."${svc.domain}") directory;
```

i.e. `tls_key`/`tls_chain` point **into the same ACME cert directory** that Caddy's vhost names. This
is the crux of the shared-cert / per-service-group design: the `kanidm` process and `caddy` read the
identical files, so both must be members of the `idm` group, and both must reload on renewal.

> **This whole `services.kanidm` block — `package`, `client`, `server`, and the entire `provision`
> tree (groups, persons) — does NOT move to the catalog.** It is the service runtime and stays in the
> kanidm feature's `service.nix` (parent plan §2.0 / §5.1 #2). The catalog carries only the
> cross-cutting networking surfaces (the vhost, the cert, the firewall posture).

### 1.3 The MAIN vhost (explicit TLS + tracing + bespoke transport) — captured verbatim

```nix
services.caddy.virtualHosts."https://${svc.domain}" = {
  extraConfig = ''
    tls "${directory}/fullchain.pem" "${directory}/key.pem"
    tracing {
      span kanidm
    }
    reverse_proxy ${config.services.kanidm.provision.instanceUrl} {
      header_up HOST {host}
      transport http {
        tls_server_name ${svc.domain}
      }
    }
  '';
};
```

After interpolation (`directory` = `/var/lib/acme/idm.plato-splunk.media`,
`instanceUrl` = `https://localhost:8443`, `svc.domain` = `idm.plato-splunk.media`), the realized
`extraConfig` for key `https://idm.plato-splunk.media` is **exactly**:

```
tls "/var/lib/acme/idm.plato-splunk.media/fullchain.pem" "/var/lib/acme/idm.plato-splunk.media/key.pem"
tracing {
  span kanidm
}
reverse_proxy https://localhost:8443 {
  header_up HOST {host}
  transport http {
    tls_server_name idm.plato-splunk.media
  }
}
```

(followed by a single trailing newline). **This body is NOT a plain `reverse_proxy`.** Three things
make it bespoke, each load-bearing:

1. **`tls "<fullchain>" "<key>"`** — names the step-ca cert explicitly (shared with the `kanidm`
   server). A reverse-proxy service would omit this and use Caddy's managed cert.
2. **`reverse_proxy https://localhost:8443`** with **`transport http { tls_server_name
   idm.plato-splunk.media }`** — the upstream is kanidm's **own HTTPS** listener, so Caddy must
   speak TLS to it and present/validate the SNI `idm.plato-splunk.media` (kanidm's `origin` is
   `https://idm.plato-splunk.media`, and its cert is for that name; without the pinned
   `tls_server_name`, upstream TLS verification against `localhost` would fail).
3. **`header_up HOST {host}`** — forwards the original public `Host` header to the upstream so kanidm
   sees `idm.plato-splunk.media` (it is strict about `Host`/`origin` matching).

> **The step-ca cert `directory` is `/var/lib/acme/idm.plato-splunk.media`** — the default
> `security.acme.certs.<name>.directory` for a cert named `idm.plato-splunk.media`. The generator
> must reference the ACME cert directory the same way (`config.security.acme.certs.<fqdn>.directory`),
> so the interpolated path is identical. The catalog's `fqdn` (`idm.plato-splunk.media`) equals the
> cert name, which equals the vhost key host — one derivation, no drift.

### 1.4 The TWO challenge vhosts (`idm` + `ldap`) — captured verbatim

```nix
services.caddy.virtualHosts."http://${svc.domain}" = {
  extraConfig = ''
    reverse_proxy localhost:${builtins.toString svc.acmePort}
  '';
};

services.caddy.virtualHosts."http://${svc.ldapDomain}" = {
  extraConfig = ''
    reverse_proxy localhost:${builtins.toString svc.acmePort}
  '';
};
```

Realized:

```nix
services.caddy.virtualHosts."http://idm.plato-splunk.media".extraConfig  = "reverse_proxy localhost:64073\n";
services.caddy.virtualHosts."http://ldap.plato-splunk.media".extraConfig = "reverse_proxy localhost:64073\n";
```

**Both** challenge vhosts proxy `:80` → loopback `64073` (the `acmePort` where `security.acme`'s
`listenHTTP` listens). Key observations:

- **Two `http://` vhosts, one cert.** The ACME cert's `domain` is only `idm.plato-splunk.media` (the
  cert block names no `extraDomainNames`). Yet there is a **second** challenge vhost for
  `ldap.plato-splunk.media`. The `ldap` vhost exists so that the `ldap.plato-splunk.media` name also
  satisfies an HTTP-01 challenge if/when something requests a cert or validation for it — but the
  kanidm cert block itself does **not** cover `ldap`. This is a genuine asymmetry the catalog must
  model: **a challenge vhost whose domain is not the cert's domain.**
- **Bare `reverse_proxy localhost:<acmePort>` on the whole `http://` vhost**, NOT the
  `handle /.well-known/acme-challenge/* { … }` wrapper the keystone's default ACME generator emits
  (catalog-and-generators §3.4). This is a byte-level divergence the parity gate will catch (§5) —
  see §3.2 for the resolution (carry the verbatim body via `extraCaddyConfig`, OR normalize to
  `handle` as an explicitly-reviewed functional-equivalent change — **recommend verbatim** to keep a
  true no-op). The bare `localhost:64073` loopback token is standardized to `127.0.0.1:64073` per the
  approved deviation (catalog-and-generators §7.8 #22).

> **Approved removal (not a no-op):** the `http://ldap.plato-splunk.media` challenge vhost shown above
> is being **deleted** in the target (§2+). LDAP is unused and the homelab is OIDC-exclusive, so the
> `ldap` route and its DNS record go away entirely. §1.4 documents it only as _current_ state; the
> target reproduces **only** the `idm` challenge vhost. This eliminates the "secondary challenge
> domain" asymmetry — so schema gap (B)/`tls.extraChallengeDomains` is **no longer needed** (see §2.1,
> §3.2, §3.5, §7 Gap (B), all updated to reflect the removal).

### 1.5 The manual ACME cert + per-service group wiring — captured verbatim

```nix
users.groups.idm.members = [
  "caddy"
  "kanidm"
];

security.acme.certs."${svc.domain}" = {
  domain = svc.domain;                                 # idm.plato-splunk.media
  listenHTTP = "127.0.0.1:${builtins.toString svc.acmePort}";  # 127.0.0.1:64073
  server = c.ca.acmeDirectoryHttp;                     # internal step-ca HTTP-01 directory
  group = "idm";                                       # per-service cert group
  reloadServices = [
    "caddy.service"
    "kanidm.service"                                   # reload BOTH readers on renewal
  ];
};
```

Realized `security.acme.certs."idm.plato-splunk.media"`:

```nix
{
  domain = "idm.plato-splunk.media";
  listenHTTP = "127.0.0.1:64073";
  server = "https://ca.plato-splunk.media/acme/http/directory";
  group = "idm";
  reloadServices = [ "caddy.service" "kanidm.service" ];
}
```

The three load-bearing manual-TLS properties:

1. **`group = "idm"` + `users.groups.idm.members = [ "caddy" "kanidm" ]`** — the per-service cert
   group. step-ca/acme writes the cert owned by group `idm`; both `caddy` (vhost TLS) and `kanidm`
   (its `:8443` `tls_key`/`tls_chain`) are members so both can read it. **Not** a shared group
   (decision §5.1 #6) — only kanidm's two readers are in it.
2. **`listenHTTP = "127.0.0.1:64073"`** — loopback HTTP-01 listener, fronted by Caddy on `:80` via
   the `idm` challenge vhost. `via = "caddy80"` in catalog terms (no direct firewall opening).
3. **`reloadServices = [ "caddy.service" "kanidm.service" ]`** — on renewal, reload **both** the proxy
   and the server (the server holds the cert open on its own listener).

### 1.6 The restic backup + OTEL env + failure-notifs — stays in `service.nix`

```nix
services.restic.backups.kanidm = { … paths = [ svc.backupPath ]; … };
systemd.services.kanidm.environment.KANIDM_OTEL_GRPC_URL =
  "http://127.0.0.1:${toString c.services.tempo.grpcPort}";
services.failure-notifs.attachServices = [
  "kanidm"
  "restic-backups-kanidm"
  "kanidm-posix-provision"
];
```

All three stay colocated with the runtime in the feature's `service.nix` — they belong to the
service's systemd units, never the catalog (parent plan §5.1 #2). **Note the `tracing` span in the
vhost is Tempo-coupled**, matching the `KANIDM_OTEL_GRPC_URL` here: the keystone renderer's
`tracingBlock` emits the span only when `services.tempo.enable` on the host (catalog-and-generators
§3.1), which must hold on augustus so the span is reproduced.

### 1.7 Firewall (augustus) — nothing kanidm-attributable

`nix-config/modules/_private/augustus/security.nix` opens:

```nix
networking.firewall = {
  interfaces.tailscale0.allowedTCPPorts = [ 22 5252 5432 25565 ];
  allowedTCPPorts   = [ 80 443 1812 1813 ];
  allowedUDPPorts   = [ 1812 1813 ];
};
```

kanidm's public entrypoint is Caddy on `443` (baseline, already open). Its `:8443` and `:636` bind to
`127.0.0.1` (loopback — no opening). The HTTP-01 challenge listener is loopback `64073` fronted by
Caddy on `80` (also baseline). So **kanidm contributes no service-attributable firewall opening** —
`challenge.via = "caddy80"` means the firewall generator adds nothing (decision §5.1 #7; baseline
`80`/`443` stay hand-listed). The firewall generator must **not** regress these.

### 1.8 OIDC — kanidm is the host, not a client

kanidm is the Kanidm server itself; it registers **no** OIDC client for itself. The catalog entry
omits `oidc` entirely → the OIDC generator emits nothing for `kanidm`. (The `provision.systems.oauth2`
clients that _other_ services register all land in `services.kanidm.provision` on augustus via the
OIDC generator — that is those services' concern, not kanidm's.)

### 1.9 Properties to preserve (invariants checklist)

- **Main vhost key** `https://idm.plato-splunk.media`, body = explicit `tls` + `tracing { span
  kanidm }` + bespoke `reverse_proxy https://localhost:8443 { header_up HOST {host}; transport http {
  tls_server_name idm.plato-splunk.media } }`, single trailing newline.
- **Challenge vhost (target)** `http://idm.plato-splunk.media`, body `reverse_proxy 127.0.0.1:64073\n`
  (bare, NOT `handle …`; loopback standardized to `127.0.0.1` per §7.8 #22). **The former
  `http://ldap.plato-splunk.media` challenge vhost is removed** (approved deviation) — do not
  reproduce it.
- **Cert** `security.acme.certs."idm.plato-splunk.media"` with `domain=idm…`, `listenHTTP=127.0.0.1:64073`,
  `server=…ca…/acme/http/directory`, `group="idm"`, `reloadServices=["caddy.service" "kanidm.service"]`.
- **Per-service group** `users.groups.idm.members = [ "caddy" "kanidm" ]`.
- **Server** `bindaddress 127.0.0.1:8443`, `tls_key`/`tls_chain` → the `idm…` cert directory.
- **No firewall change**, **no OIDC client for self**.
- **`services.kanidm` (server + provision), restic, OTEL env, failure-notifs** unchanged in
  `service.nix`.

---

## 2. Target state — colocated feature layout

Replace `services/kanidm.nix` with a `features/kanidm/` directory (parent plan §2.0). Because the
`services.kanidm` block is large and bespoke, almost all of it stays in `service.nix`; only the
vhosts, the cert, and the group wiring become catalog-driven:

```
features/kanidm/
├── catalog.nix     # homelab.catalog.kanidm = { … }  (main vhost + cert + challenge domains ONLY)
├── service.nix     # services.kanidm (server + full provision tree), restic, OTEL env,
│                   #   users.groups.idm.members, failure-notifs.attachServices
└── complete.nix    # flake.modules.nixos.kanidm = { imports = [ kanidm-catalog kanidm-service ]; }
```

Rationale for the split:

- **`catalog.nix`** holds the three cross-cutting surfaces: the manual-TLS main vhost (via the
  escape hatch / bespoke transport — §2.1), the `security.acme.certs` request (via `tls.ca=internal`
  - `acmePort` + `certGroup` + `reloadServices`), and the **secondary `ldap` challenge domain**
    (schema gap — §2.1 / §7).
- **`service.nix`** keeps everything that is the service runtime: the entire `services.kanidm`
  (server settings + provision groups/persons), the restic backup, the OTEL env, the
  `users.groups.idm.members` cert-group membership (service-specific — it knows `kanidm` is the second
  reader, catalog-and-generators §3.4 note), and `failure-notifs.attachServices`.
- **`complete.nix`** is what `hosts/augustus.nix` imports (as `nixos.kanidm` today). Importing it
  realizes the runtime **and** registers the catalog entry.

> **Cert-group membership placement.** The keystone leaves `users.groups.<certGroup>.members` in the
> service feature, not the acme generator, precisely because membership is service-specific — kanidm
> adds `kanidm` as a second member alongside `caddy` (catalog-and-generators §3.4 note). So
> `users.groups.idm.members = [ "caddy" "kanidm" ]` stays verbatim in `service.nix`. The acme
> generator only sets `group = "idm"` on the cert; the feature owns who is in the group.

### 2.1 `features/kanidm/catalog.nix` (proposed)

```nix
{ config, ... }:
let
  c = config.constants;
  svc = c.services.kanidm;          # subdomain=idm, domain, ldapDomain, acmePort=64073
in
{
  flake.modules.nixos.kanidm-catalog =
    { config, ... }:
    let
      # The ACME cert directory the generator will create for fqdn idm.plato-splunk.media.
      # Equals /var/lib/acme/idm.plato-splunk.media (default security.acme.certs.<name>.directory).
      certDir = config.security.acme.certs."${svc.domain}".directory;
      instanceUrl = config.services.kanidm.provision.instanceUrl;  # https://localhost:8443
    in
    {
      homelab.catalog.kanidm = {
        subdomain = "idm";
        zone = "plato-splunk.media";   # default; stated for clarity
        host = "augustus";

        # The upstream is kanidm's OWN https listener, reached via a bespoke transport —
        # NOT a plain reverse_proxy. Modeled via the extraCaddyConfig escape hatch (see §3.1
        # for the backend-kind alternative and why escape hatch is recommended).
        backend = {
          kind = "reverseProxy";
          # port is unused when the body is fully supplied via extraCaddyConfig; see §3.1 /
          # §7 gap (A). The generated backend directive must be SUPPRESSED for kanidm.
          port = 8443;   # documentary; the real target is https://localhost:8443 (below)
        };

        tls = {
          ca = "internal";              # step-ca: server = c.ca.acmeDirectoryHttp
          acmePort = svc.acmePort;      # 64073 loopback HTTP-01 listener
          certGroup = "idm";            # per-service group (default would be "kanidm" — override!)
          reloadServices = [ "kanidm.service" ];  # generator prepends "caddy.service"
          challenge = {
            via = "caddy80";            # loopback acmePort fronted by Caddy :80; no firewall opening
            body = "bare";              # bare `reverse_proxy 127.0.0.1:<acmePort>`, not handle+redir
          };
          gate = "none";                # no Caddy-level auth; kanidm handles its own auth
        };

        access.scope = "tailnet";       # reachable over tailscale0; 443 already baseline-open
        dns.enable = true;              # emit idm A/AAAA on aedilis (reproduces tailnetRewrites)
        # dns.kind defaults to "tailnet" -> A/AAAA from constants.hosts.augustus.tailscale.
        # NOTE: no ldap entry anywhere — the ldap route + DNS record are REMOVED (approved, §2.1.1).

        # No oidc block -> kanidm registers no client for itself (§1.8).

        # ---- BESPOKE MAIN-VHOST BODY (escape hatch) ----
        # Reproduces the explicit tls + tracing span + HTTPS-upstream transport verbatim.
        # The generator must render NO backend/tls line for kanidm and emit ONLY this
        # (plus the tracingBlock, which is Tempo-gated and already matches) — see §3.1 / §7 gap (A).
        extraCaddyConfig = ''
          tls "${certDir}/fullchain.pem" "${certDir}/key.pem"
          tracing {
            span kanidm
          }
          reverse_proxy ${instanceUrl} {
            header_up HOST {host}
            transport http {
              tls_server_name ${svc.domain}
            }
          }
        '';
      };
    };
}
```

#### 2.1.1 The `ldap` challenge domain is REMOVED (approved deviation)

kanidm currently publishes a **second** challenge vhost for `ldap.plato-splunk.media` (a name the
cert does not cover) plus an `ldap` DNS record. **Decision (operator):** LDAP is unused and the
homelab is OIDC-exclusive, so the `ldap` Caddy route **and** its DNS record are **removed entirely**
— not modeled in the catalog. Consequences:

- The catalog entry above has **no** `tls.extraChallengeDomains` and no `ldap` anything. The target
  emits only the single `idm` challenge vhost.
- Schema gap (B)/`tls.extraChallengeDomains` is **dropped** — it was only ever motivated by this one
  case, which no longer exists. (See §7 Gap (B), §3.2, §3.5.)
- The kanidm server's own LDAP `bindaddress = "127.0.0.1:636"` setting in `service.nix` is **kept
  untouched** for config parity — nothing routes to it, but removing it is out of scope for this
  migration.
- This is an **intentional, approved** departure from the no-op contract: the Caddy parity gate (§5.2)
  will show the `ldap` challenge vhost dropped, and the DNS gate (§5.6) the `ldap` record dropped.
  Both are expected and reviewed.

### 2.2 `features/kanidm/service.nix` (verbatim runtime carry-over)

The entire `services.kanidm` block (package, client, server settings, provision groups + persons),
`services.restic.backups.kanidm`, `systemd.services.kanidm.environment.KANIDM_OTEL_GRPC_URL`,
`users.groups.idm.members = [ "caddy" "kanidm" ]`, and
`services.failure-notifs.attachServices = [ "kanidm" "restic-backups-kanidm" "kanidm-posix-provision" ]`
are copied **verbatim** from today's `services/kanidm.nix`, published as
`flake.modules.nixos.kanidm-service`. The `directory` binding (`inherit (config.security.acme.certs."${svc.domain}") directory;`) stays — the server's `tls_key`/`tls_chain` still read from the ACME cert
directory the acme generator now creates (same name, same path, so `tls_key`/`tls_chain` are
unchanged).

> **Critical coupling:** the acme generator must create `security.acme.certs."idm.plato-splunk.media"`
> with the **same cert name** so that `config.security.acme.certs."${svc.domain}".directory` (read by
> both `service.nix`'s server settings and `catalog.nix`'s `certDir`) resolves identically to
> `/var/lib/acme/idm.plato-splunk.media`. The catalog's `fqdn = <subdomain>.<zone>` = `idm.plato-splunk.media`
> guarantees this.

### 2.3 `features/kanidm/complete.nix`

Aggregates `kanidm-catalog` + `kanidm-service` into `flake.modules.nixos.kanidm`, preserving the
single import name `hosts/augustus.nix` already uses (mirrors
`features/<name>/complete.nix`, e.g. `cicero-observability`).

---

## 3. Mapping each bespoke surface onto the catalog + argument

### 3.1 Main vhost — escape hatch vs dedicated backend kind (RECOMMENDATION)

The main vhost body is NOT representable by the typed `backend`/`tls` renderer: it needs an explicit
`tls <fullchain> <key>` line **and** a `reverse_proxy https://localhost:8443` with a `transport http {
tls_server_name … }` block **and** `header_up HOST {host}`. Two ways to carry it:

- **Escape hatch (`extraCaddyConfig`) — RECOMMENDED.** Supply the exact body verbatim (§2.1), and have
  the Caddy generator emit **nothing else** for this entry (no `backendBlock`, no `plainTlsLine`).
  This is a **byte-exact** reproduction with zero renderer changes. The only cost is the §7 gap (A):
  the keystone renderer currently **always** appends `backendBlock e` and (when `certDir != null`) a
  `plainTlsLine`, then appends `extraCaddyConfig`. For kanidm that would **double** the `tls`/
  `reverse_proxy` lines. So the renderer needs a way to **suppress** its auto-emitted backend/tls when
  the entry supplies a full bespoke body.
- **Dedicated backend kind (`kind = "reverseProxyTls"` or `"kanidm"`).** Teach `backendBlock` a new
  kind that renders `reverse_proxy <upstreamUrl> { header_up HOST {host}; transport http {
  tls_server_name <sni> } }` from typed fields (`upstreamUrl`, `tlsServerName`, `headerUpHost`), plus
  a `tls.explicitCert = true` flag so `plainTlsLine` fires with the cert files. This is more
  "schema-pure" but adds several fields used by exactly one service, and still must get the span/tls
  ordering byte-exact.

**Recommendation: the escape hatch (option A) + a renderer suppression flag.** kanidm is a true
one-off (the only HTTPS-upstream, SNI-pinned, explicit-cert proxy in the fleet); a bespoke
`backendBlock` kind would be dead weight everywhere else, and the escape hatch already exists for
exactly this ("bespoke cases … without forcing every variant into typed options", keystone §3.1).
The required renderer change is the **suppression flag** (§7 gap (A)):

> **Schema gap (A): `backend.kind = "raw"` (or `tls.rawVhostBody = true`).** Add a backend kind (or a
> boolean) that tells `renderVhostBody` to emit **only** `tracingBlock` + `extraCaddyConfig` and skip
> both `backendBlock` and the auto `plainTlsLine`. kanidm sets it; the body comes entirely from
> `extraCaddyConfig`. This keeps the tracing span generated (so its Tempo-gating still matches) while
> letting the explicit-cert + bespoke-transport body pass through verbatim.

**Ordering byte-exactness.** Today's body is `tls` → `tracing` → `reverse_proxy …`. The keystone
renderer order is `tracingBlock` → `tls` → `backendBlock` → `extraCaddyConfig`. With option A, the
renderer emits `tracingBlock` first, then the `extraCaddyConfig` (which itself starts with the `tls`
line, then repeats the `tracing` block). **That double-emits `tracing`.** Therefore the recommended
concrete shape is: with the `raw` suppression flag set, the renderer emits **only**
`extraCaddyConfig` (NOT a separate `tracingBlock`), and the `extraCaddyConfig` carries the full body
including `tls`, `tracing`, and the transport — exactly as today. (The Tempo gating is then the
operator's responsibility to keep in the raw body; since augustus always has Tempo enabled and the
body is verbatim, this is byte-exact. If Tempo-gating must stay dynamic, option B is the alternative.)

**Operational-equivalence argument (main vhost):**

- **Key:** `https://idm.plato-splunk.media` = `"https://" + fqdn` where `fqdn = <subdomain>.<zone> =
  idm.plato-splunk.media` = today's `https://${svc.domain}`. Identical. `listenPort = 443` (default),
  so no `:port` suffix on the key.
- **Body:** the `extraCaddyConfig` is copied character-for-character from today's `extraConfig`
  (same `certDir` interpolation via `config.security.acme.certs."idm…".directory`, same
  `instanceUrl` = `https://localhost:8443`, same `svc.domain` SNI). With the `raw` flag suppressing
  auto backend/tls, the rendered body equals the current body byte-for-byte, trailing newline
  included.

### 3.2 The two challenge vhosts — modeling the `ldap` asymmetry

- **`http://idm.plato-splunk.media`** — the cert's own challenge. The acme generator emits this for
  `tls.ca != null` (keystone §3.4). **But** today's body is the bare `reverse_proxy localhost:64073\n`,
  while the keystone generator defaults to the `handle /.well-known/acme-challenge/* { reverse_proxy
  127.0.0.1:<acmePort> }` wrapper. The keystone explicitly calls out this kanidm difference
  (catalog-and-generators §3.4 note). **Resolution:** have the acme generator emit the **bare**
  `reverse_proxy 127.0.0.1:${acmePort}\n` body for the challenge vhost via the per-entry
  `tls.challenge.body = "bare"` selector (schema gap #8). The upstream token is `127.0.0.1` per the
  approved standardization (§7.8 #22) — the source's `localhost:64073` becomes `127.0.0.1:64073`,
  which is the one expected byte diff on this vhost.
- **~~`http://ldap.plato-splunk.media`~~ — REMOVED (approved).** The secondary `ldap` challenge vhost
  is **deleted**, not modeled: LDAP is unused and the homelab is OIDC-exclusive (§2.1.1). The target
  emits no `ldap` vhost and no `ldap` DNS record, and schema gap (B)/`tls.extraChallengeDomains` is
  dropped.

**Operational-equivalence argument (challenge vhost):** the single remaining key
`http://idm.plato-splunk.media` is reproduced with body `reverse_proxy 127.0.0.1:64073\n` (the
`localhost → 127.0.0.1` substitution is the sole expected diff). The former
`http://ldap.plato-splunk.media` vhost is intentionally gone.

### 3.3 The ACME cert + per-service group

The acme generator (keystone §3.4) renders, for `host == augustus && managedBy.acme && tls.ca !=
null`:

```nix
security.acme.certs."idm.plato-splunk.media" = {
  domain = "idm.plato-splunk.media";              # = fqdn
  listenHTTP = "127.0.0.1:64073";                 # = 127.0.0.1:${tls.acmePort}
  server = "https://ca.plato-splunk.media/acme/http/directory";  # internal CA (c.ca.acmeDirectoryHttp)
  group = "idm";                                  # = tls.certGroup (override; default would be "kanidm")
  reloadServices = [ "caddy.service" "kanidm.service" ];  # ["caddy.service"] ++ tls.reloadServices
};
```

**Operational-equivalence argument (cert):**

- `domain` = `fqdn` = `idm.plato-splunk.media` ✓
- `listenHTTP` = `127.0.0.1:${acmePort}` = `127.0.0.1:64073` ✓ (`acmePort` sourced from the same
  `svc.acmePort`)
- `server` = `c.ca.acmeDirectoryHttp` (the generator's `certServer e` for `ca == "internal"` returns
  exactly `c.ca.acmeDirectoryHttp`) ✓
- `group` = `tls.certGroup` = `"idm"` ✓ — **must override the default** (`certGroup` defaults to the
  entry name `kanidm`; §2.1 sets it to `idm`). This is the per-service-cert-group decision #6 made
  concrete: the cert group is `idm`, scoped to kanidm's two readers.
- `reloadServices` = `[ "caddy.service" ] ++ tls.reloadServices` = `[ "caddy.service"
  "kanidm.service" ]` ✓ — the generator prepends `caddy.service`; the catalog supplies the
  service-specific `kanidm.service`.
- **`users.groups.idm.members = [ "caddy" "kanidm" ]`** — stays in `service.nix` (the generator does
  not own group membership; keystone §3.4 note). Byte-identical.

### 3.4 Server `:8443` + `tls_key`/`tls_chain` — unchanged

`service.nix` keeps `bindaddress = "127.0.0.1:8443"`, `tls_key = "${directory}/key.pem"`,
`tls_chain = "${directory}/fullchain.pem"`, where `directory =
config.security.acme.certs."idm.plato-splunk.media".directory`. Because the acme generator creates
that exact cert name, `directory` resolves to the same `/var/lib/acme/idm.plato-splunk.media` and the
server settings are byte-identical. (The cert is now _generated_ instead of _hand-written_, but it is
the same attribute at the same path.)

### 3.5 DNS (aedilis) — `idm` record (ldap removed)

- **`idm`**: `dns.enable = true; dns.kind = "tailnet"; host = "augustus"` → the DNS generator emits
  `idm.plato-splunk.media` A/AAAA from `constants.hosts.augustus.tailscale.{v4,v6}`, reproducing
  today's `tailnetRewrites.idm = "augustus"` record (verified in the dns-records migration).
- **`ldap`**: **removed (approved).** `tailnetRewrites.ldap = "augustus"` exists today; it is
  **deleted** alongside the `ldap` Caddy route (§2.1.1). The dns-records set-equality gate will show
  the `ldap` A/AAAA pair dropped — an expected, reviewed deviation, listed with the apprise removal in
  [dns-records.md](./dns-records.md) and [catalog-and-generators §7.8](./catalog-and-generators.md).
  No DNS half of a (now-dropped) `extraChallengeDomains` field is needed.

### 3.6 Firewall + OIDC — no change

- **Firewall:** `access.scope = "tailnet"`, `challenge.via = "caddy80"` → the firewall generator adds
  nothing (443/80 baseline, loopback `64073`). `networking.firewall` byte-identical (§1.7).
- **OIDC:** no `oidc` block → OIDC generator emits nothing for kanidm (§1.8). The _other_ services'
  `oauth2` clients are unaffected.

---

## 4. Operational-equivalence summary (per surface)

| Surface                                                          | Today                                          | After (source)                                              | Equivalent?               |
| ---------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------- | ------------------------- |
| Main vhost `https://idm…` key                                    | `https://${svc.domain}`                        | `https://${fqdn}` (= idm.plato-splunk.media)                | ✓ identical               |
| Main vhost body (explicit tls+tracing+transport)                 | hand-written `extraConfig`                     | `extraCaddyConfig` verbatim + `raw` suppression (gap A)     | ✓ byte-exact              |
| Challenge vhost `http://idm…`                                    | `reverse_proxy localhost:64073\n`              | acme generator, `tls.challenge.body="bare"`, `127.0.0.1`    | ≈ (localhost→127.0.0.1)   |
| ~~Challenge vhost `http://ldap…`~~                               | `reverse_proxy localhost:64073\n`              | **REMOVED** (approved — ldap route deleted)                 | ✗ intentional removal     |
| `security.acme.certs."idm…"`                                     | hand-written (group=idm, reloads caddy+kanidm) | acme generator (`tls.ca/acmePort/certGroup/reloadServices`) | ✓ identical               |
| `users.groups.idm.members`                                       | `[ "caddy" "kanidm" ]`                         | unchanged in `service.nix`                                  | ✓ identical               |
| Server `:8443` + tls_key/tls_chain                               | reads `security.acme.certs."idm…".directory`   | same cert name → same directory                             | ✓ identical               |
| DNS `idm`                                                        | `tailnetRewrites.idm`                          | DNS generator `dns.enable` (augustus A/AAAA)                | ✓ (dns-records migration) |
| ~~DNS `ldap`~~                                                   | `tailnetRewrites.ldap`                         | **REMOVED** (approved — ldap record deleted)                | ✗ intentional removal     |
| Firewall                                                         | 80/443 baseline, loopback 64073                | firewall generator adds nothing                             | ✓ no change               |
| OIDC (self)                                                      | none                                           | none                                                        | ✓ no change               |
| `services.kanidm` server+provision, restic, OTEL, failure-notifs | in `services/kanidm.nix`                       | verbatim in `features/kanidm/service.nix`                   | ✓ identical               |

**Conclusion:** every realized attribute is identical before and after **except two
operator-approved intentional removals** (the `http://ldap.plato-splunk.media` challenge vhost and the
`ldap` DNS record) and one approved standardization (the `idm` challenge vhost's loopback token
`localhost → 127.0.0.1`), **conditional on the schema additions** gap A (raw-body suppression) and gap
#8 (`tls.challenge.body = "bare"`). Schema gap (B) is **dropped** (no secondary challenge domain
needed). With those, the deploy is a theoretical no-op aside from the three documented LDAP/loopback
deviations.

---

## 5. Parity gates (exact commands)

> **Prerequisite (`.kiro/steering/validation.md`):** flake eval reads the **git tree**. Before any
> eval, `git add` the new `features/kanidm/*.nix` files (keep `services/kanidm.nix` until the "after"
> evals pass). Untracked new `.nix` files are invisible to `import-tree` and produce a misleading
> "missing attribute" error.

### 5.1 Main vhost — primary gate (`--raw`, byte-for-byte)

```sh
# before (current tree):
nix eval \
  '.#nixosConfigurations.augustus.config.services.caddy.virtualHosts."https://idm.plato-splunk.media".extraConfig' \
  --raw > /tmp/kanidm-idm-vhost.before
# after (migrated tree):
nix eval \
  '.#nixosConfigurations.augustus.config.services.caddy.virtualHosts."https://idm.plato-splunk.media".extraConfig' \
  --raw > /tmp/kanidm-idm-vhost.after
diff /tmp/kanidm-idm-vhost.before /tmp/kanidm-idm-vhost.after   # MUST be empty
```

Expected body (byte-for-byte, trailing newline):

```
tls "/var/lib/acme/idm.plato-splunk.media/fullchain.pem" "/var/lib/acme/idm.plato-splunk.media/key.pem"
tracing {
  span kanidm
}
reverse_proxy https://localhost:8443 {
  header_up HOST {host}
  transport http {
    tls_server_name idm.plato-splunk.media
  }
}
```

### 5.2 Challenge vhost — `--raw` (idm only; ldap must be ABSENT)

```sh
# idm challenge vhost — expected body after:  reverse_proxy 127.0.0.1:64073\n
# (before was `localhost:64073`; the localhost→127.0.0.1 substitution is the one approved diff)
nix eval '.#nixosConfigurations.augustus.config.services.caddy.virtualHosts."http://idm.plato-splunk.media".extraConfig'  --raw

# ldap challenge vhost — must NO LONGER EXIST (approved removal). This should ERROR
# ("attribute 'http://ldap.plato-splunk.media' missing") on the AFTER tree:
nix eval '.#nixosConfigurations.augustus.config.services.caddy.virtualHosts."http://ldap.plato-splunk.media".extraConfig' --raw || echo "ldap vhost absent (expected)"
```

### 5.3 ACME cert — `--json`

```sh
nix eval '.#nixosConfigurations.augustus.config.security.acme.certs."idm.plato-splunk.media"' --json \
  | jq '{domain, listenHTTP, server, group, reloadServices}'
```

Before/after must match:

```json
{
  "domain": "idm.plato-splunk.media",
  "listenHTTP": "127.0.0.1:64073",
  "server": "https://ca.plato-splunk.media/acme/http/directory",
  "group": "idm",
  "reloadServices": ["caddy.service", "kanidm.service"]
}
```

### 5.4 Cert-group membership, server settings, firewall, failure-notifs, OIDC — no-change checks

```sh
# per-service cert group members unchanged:
nix eval '.#nixosConfigurations.augustus.config.users.groups.idm.members' --json   # ["caddy","kanidm"]

# server still binds :8443 and reads the idm cert dir:
nix eval '.#nixosConfigurations.augustus.config.services.kanidm.server.settings.bindaddress' --raw   # 127.0.0.1:8443
nix eval '.#nixosConfigurations.augustus.config.services.kanidm.server.settings.tls_chain' --raw     # /var/lib/acme/idm.plato-splunk.media/fullchain.pem
nix eval '.#nixosConfigurations.augustus.config.services.kanidm.server.settings.tls_key'   --raw     # /var/lib/acme/idm.plato-splunk.media/key.pem

# firewall byte-identical (kanidm contributes nothing):
nix eval '.#nixosConfigurations.augustus.config.networking.firewall.allowedTCPPorts' --json
nix eval '.#nixosConfigurations.augustus.config.networking.firewall.interfaces.tailscale0.allowedTCPPorts' --json

# failure-notifs still attaches all three kanidm units:
nix eval '.#nixosConfigurations.augustus.config.services.failure-notifs.attachServices' --json \
  | jq 'map(select(. == "kanidm" or . == "restic-backups-kanidm" or . == "kanidm-posix-provision")) | length == 3'  # true

# kanidm registers NO oauth2 client for itself (key absent):
nix eval '.#nixosConfigurations.augustus.config.services.kanidm.provision.systems.oauth2' --json \
  | jq 'has("kanidm")'   # false

# full provision tree unchanged (groups + persons) — diff before/after:
nix eval '.#nixosConfigurations.augustus.config.services.kanidm.provision.systems.oauth2' --json > /tmp/kanidm-oauth2.after   # compare to .before
nix eval '.#nixosConfigurations.augustus.config.services.kanidm.provision.groups'  --json > /tmp/kanidm-groups.after
nix eval '.#nixosConfigurations.augustus.config.services.kanidm.provision.persons' --json > /tmp/kanidm-persons.after
```

### 5.5 Whole-vhosts sanity + restic

```sh
nix eval '.#nixosConfigurations.augustus.config.services.caddy.virtualHosts' --json \
  | jq '{a:."https://idm.plato-splunk.media", b:."http://idm.plato-splunk.media", ldap_absent:(has("http://ldap.plato-splunk.media")|not)}'
nix eval '.#nixosConfigurations.augustus.config.services.restic.backups.kanidm' --json   # before == after
```

### 5.6 DNS (aedilis) — verified with the dns-records migration

```sh
nix eval \
  '.#nixosConfigurations.aedilis.config.services.technitium-server-complete.provision.ensureDnsRecords.zones' \
  --json \
  | jq '."plato-splunk.media".records | map(select(.name == "idm" or .name == "ldap"))'
```

Before: both `idm` **and** `ldap` A/AAAA present. After: **only `idm`** A/AAAA — the `ldap` records
are intentionally dropped (approved, §3.5). Run as part of [./dns-records.md](./dns-records.md).

### 5.7 Build gate

```sh
nix run .#nixfmt -- $(git ls-files '*.nix' ':!:repos/**')
nix flake check
nixos-rebuild build --flake .#augustus
```

---

## 6. Migration checklist

> Depends on the catalog schema + generators ([./catalog-and-generators.md](./catalog-and-generators.md))
> **including the schema additions this plan surfaces** (§7): gap (A) raw-body suppression and gap #8
> (`tls.challenge.body = "bare"`). Schema gap (B) is **dropped** — the `ldap` route is removed, not
> modeled. Sequence kanidm in parent plan §3 step 4 (cert-terminating services), after the
> schema/generators and the reference `it-tools` migration.

1. **Land schema gaps first** (§7): add `backend.kind = "raw"` (or `tls.rawVhostBody`) renderer
   suppression and the `tls.challenge.body = "bare"` selector to `features/homelab-service/`. Verify
   the keystone's "introducing the module is a no-op" gate still holds (all `managedBy.*` false).
2. **Capture baseline.** Run §5.1 (main vhost `--raw`), §5.2 (idm challenge vhost `--raw` + confirm
   ldap present before), §5.3 (cert `--json`), §5.4 (group/server/firewall/failure-notifs/oauth2),
   §5.5 (whole-vhosts + restic), → `/tmp/kanidm-*.before`.
3. **Create `features/kanidm/`:**
   - `catalog.nix` — the `homelab.catalog.kanidm` entry (§2.1): `subdomain=idm`, `host=augustus`,
     `tls.ca=internal`, `tls.acmePort=64073`, `tls.certGroup=idm`,
     `tls.reloadServices=["kanidm.service"]`, `tls.challenge.via="caddy80"`,
     `tls.challenge.body="bare"`, `access.scope="tailnet"`, `dns.enable=true`,
     `backend.kind="raw"`, and the verbatim `extraCaddyConfig` main-vhost body. **No `oidc`, no
     `ldap`/`extraChallengeDomains`.**
   - `service.nix` — the full `services.kanidm` (server + provision groups/persons, incl. the
     unused-but-kept LDAP `bindaddress`), restic, OTEL env,
     `users.groups.idm.members=["caddy" "kanidm"]`, `failure-notifs.attachServices`, copied
     **verbatim** from today's module.
   - `complete.nix` — aggregate into `flake.modules.nixos.kanidm`, preserving the import name.
4. **Opt in** `managedBy.caddy = true` and `managedBy.acme = true` for the `kanidm` entry on augustus.
   (DNS deferred to the dns-records migration; `managedBy.dns` stays off here.)
5. **Delete the hand-written surfaces** from the old module: the `https://` vhost, the **`idm`**
   `http://` challenge vhost, the **`ldap`** `http://` challenge vhost (removed, not migrated), and
   the `security.acme.certs."${svc.domain}"` block. **Keep** `users.groups.idm.members`, the entire
   `services.kanidm` block, restic, OTEL env, and failure-notifs in `service.nix`.
6. **Remove `services/kanidm.nix`** once `features/kanidm/complete.nix` fully supersedes it; confirm
   `hosts/augustus.nix` still imports `nixos.kanidm`.
7. **Stage new files:** `git add nix-config/modules/features/kanidm/` and stage the deletion of
   `services/kanidm.nix` (required — §5 prerequisite).
8. **Run the parity gate.** Re-run §5.1–§5.5 → `/tmp/kanidm-*.after`; `diff` each against `.before`.
9. **DNS (dns-records migration).** Verify §5.6 (**only** the `idm` records remain; `ldap` dropped)
   and delete the `idm` **and** `ldap` `tailnetRewrites` entries in that same change (the `idm` record
   is reproduced by the generator; the `ldap` record is intentionally gone).
10. **Format + check + build.** `nix run .#nixfmt -- …`, `nix flake check`,
    `nixos-rebuild build --flake .#augustus`. All must pass.
11. **Deploy as a near-no-op.** Every realized attribute identical **except** the three approved
    deviations (ldap route gone, ldap DNS gone, `idm` challenge loopback `localhost → 127.0.0.1`);
    the `kanidm` server, the `idm` vhosts, the shared `idm` cert + group, restic, and failure-notifs
    are unchanged on augustus.

---

## 7. Catalog schema gaps this exercise surfaces

kanidm is the stress test that exposes where the keystone schema is currently insufficient. One gap
(plus a shared challenge-body selector) must be added to `features/homelab-service/` before kanidm
can migrate. The previously-surfaced "secondary challenge domain" gap (B) is **dropped** now that the
`ldap` route is removed rather than modeled.

### Gap (A) — raw/bespoke vhost body (suppress auto backend + tls)

The keystone `renderVhostBody` (catalog-and-generators §3.1) **always** appends `backendBlock e` and,
when `certDir != null`, a `plainTlsLine` — then appends `extraCaddyConfig`. kanidm's main vhost needs
a **fully bespoke** body (explicit `tls`, `tracing`, HTTPS-upstream `transport` with pinned
`tls_server_name`, `header_up HOST`). Without suppression, the generator would **double** the
`tls`/`reverse_proxy` directives.

- **Add:** `backend.kind = "raw"` (preferred) — a new enum value meaning "emit **only**
  `extraCaddyConfig`; skip `backendBlock` and the auto `plainTlsLine`." Equivalently a
  `tls.rawVhostBody = true` boolean. kanidm sets it and supplies the complete body via
  `extraCaddyConfig`.
- **Why escape hatch, not a new backend kind:** kanidm is the only HTTPS-upstream, SNI-pinned,
  explicit-cert proxy in the fleet. A dedicated `backendBlock` kind (`reverseProxyTls` with
  `upstreamUrl`/`tlsServerName`/`headerUpHost`) would be dead weight for every other service, whereas
  `extraCaddyConfig` already exists for exactly this purpose (keystone §3.1). **Recommend the raw flag
  - escape hatch.**
- **Tracing-span caveat:** with `raw`, the renderer must **not** also emit its own `tracingBlock`
  (that would double the `tracing` block, since the verbatim body already contains it). So `raw`
  suppresses `backendBlock`, `plainTlsLine`, **and** `tracingBlock`, emitting only `extraCaddyConfig`.
  The Tempo gating then lives in the verbatim body (byte-exact on augustus, which always has Tempo).

### Gap (B) — ~~secondary challenge domain~~ DROPPED (ldap route removed)

Originally this exercise surfaced a need for `tls.extraChallengeDomains` because kanidm published a
**second** challenge vhost for `ldap.plato-splunk.media` (a name the cert does not cover). **That gap
is no longer needed:** the operator confirmed LDAP is unused (the homelab is OIDC-exclusive), so the
`ldap` Caddy route **and** its DNS record are **removed entirely** rather than modeled (§2.1.1, §3.2,
§3.5). No `tls.extraChallengeDomains` field is added to the schema. If a genuine cert-alias challenge
domain arises in the future, re-introduce this gap then; for now it is intentionally omitted to keep
the schema minimal.

### Gap #8 — challenge-vhost body form (`bare reverse_proxy` vs `handle …`)

The keystone acme generator defaults the challenge body to
`handle /.well-known/acme-challenge/* { reverse_proxy 127.0.0.1:<acmePort> }`, but kanidm's current
body is the bare `reverse_proxy <host>:<acmePort>` on the whole `http://` vhost. (This is shared gap
#8 in catalog-and-generators §7.2.)

- **Add:** a per-entry `tls.challenge.body = "bare"` selector so the generator emits the **bare**
  `reverse_proxy 127.0.0.1:${acmePort}\n` body. The upstream token is `127.0.0.1` per the approved
  standardization (§7.8 #22) — so the body is `reverse_proxy 127.0.0.1:64073\n`, differing from
  today's `localhost:64073` only by that one approved substitution. Normalizing instead to the
  `handle` form would be an additional, unnecessary byte diff — keep `bare`.

---

## 8. Notes for plans that mirror this one

- **Manual-TLS services (postgres, radius, aedilis technitium) share the cert + per-service-group
  shape** (`tls.ca`, `acmePort`, `certGroup`, `reloadServices`, `users.groups.<g>.members` in
  `service.nix`), but kanidm is the only one with (a) an HTTPS upstream + pinned `tls_server_name`
  transport, (b) a tracing span in the vhost, and (c) a secondary (`ldap`) challenge domain. Those are
  the kanidm-specific deltas; the cert/group mechanics generalize.
- **`certGroup` must be overridden** for every manual-TLS service whose group name differs from the
  entry name (kanidm: entry `kanidm`, group `idm`). Do not rely on the `certGroup` default.
- **The escape hatch (`extraCaddyConfig`) + `raw` suppression** is the pattern for any vhost body the
  typed renderer cannot express; prefer it over new `backendBlock` kinds for one-off bespoke bodies.
- **`services.kanidm` (server + the whole provision tree), restic, OTEL env, and failure-notifs stay
  in `service.nix`** — they are the service runtime, never catalog. Only the vhost/cert/challenge/
  group-wiring are cross-cutting.
