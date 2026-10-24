# radius — Cert-Terminating Service Migration (manual TLS, PUBLIC app ports)

Status: **PROPOSED**
Date: 2026-10-22
Parent: [../service-consolidation-plan.md](../service-consolidation-plan.md) ·
Index: [./README.md](./README.md) ·
Keystone: [./catalog-and-generators.md](./catalog-and-generators.md)

> **Cert-terminating service.** radius is one of the four manual-TLS services (with `kanidm`,
> `postgres`, aedilis technitium) that terminate their **own** step-ca TLS cert consumed by a
> **non-Caddy process** — here the `kanidm/radius` **OCI container** (`radiusd`), which mounts the
> ACME `fullchain.pem`/`key.pem` directly off the cert `directory`. Like [postgres](./postgres.md) it
> has a `security.acme.certs` entry (C) and a per-service cert group — but unlike postgres it uses the
> standard **`reloadServices = [ "podman-radiusd.service" ]`** convention (no `postRun`), so it does
> **not** hit the postgres `postRun` schema gap. Its distinguishing complication is the **firewall**:
> radius opens `1812`/`1813` TCP+UDP **publicly on `0.0.0.0`** (RADIUS auth/accounting), which the
> firewall generator's existing model does not cleanly express (service-attributable but PUBLIC, not
> tailnet). **This reveals a firewall-generator schema need** (§5).
>
> **Operational-equivalence contract (from [./README.md](./README.md)):** deploying this revision
> MUST be a theoretical no-op. The migration changes _where_ config is declared, never _what_ gets
> realized. The challenge vhost `extraConfig`, the
> `security.acme.certs."radius.plato-splunk.media"` block (incl. `reloadServices`), the `radiusd`
> container (image, the `0.0.0.0` port maps, the cert volume mounts), the `radius_config` sops
> template, the `1812`/`1813` firewall openings, and failure-notifs must all render byte-identical.

---

## 0. Concerns and what makes radius distinct

Concerns emitted today (per the index): **V C** — a Caddy **challenge** vhost and an ACME cert. Plus
things the generators do **not** own that stay in the feature, and one firewall wrinkle:

- **A non-Caddy TLS consumer (an OCI container).** The `radiusd` container mounts
  `${directory}/fullchain.pem` → `/data/cert.pem` and `${directory}/key.pem` → `/data/key.pem` from
  the ACME cert directory, and `radius.toml` points `radius_cert_path`/`radius_key_path` at them.
  Caddy is **only** used to answer the HTTP-01 challenge; RADIUS traffic (1812/1813) never touches
  Caddy.
- **`reloadServices`, not `postRun`.** On renewal the cert reloads via the standard
  `reloadServices = [ "podman-radiusd.service" ]`. This is the common convention the keystone acme
  generator already models (§3.4) — radius does **not** need the postgres `postRun` passthrough.
- **A per-service cert group `radiusd`.** The container runs with access to the cert dir via this
  group (per parent-plan decision §5.1 #6 a per-service group, not shared).
- **PUBLIC app ports `1812`/`1813` (TCP **and** UDP) on `0.0.0.0`.** This is the key difference from
  postgres (whose `5432` is tailnet-only). RADIUS auth (`1812`) and accounting (`1813`) are opened to
  the **public** interface in `_private/augustus/security.nix`. These ports are **service-
  attributable** (they belong to radius) but **PUBLIC**, not tailnet — a combination the firewall
  generator's current `access.scope` model under-serves, and they span **both** TCP and UDP. See §5.
- **A sops template `radius_config`** (`radius.toml`) rendered with kanidm placeholders — stays in
  the feature.
- **No OIDC, no DNS record owned by the module.** The `radius` A/AAAA record lives in the centralized
  `tailnetRewrites` map (→ [./dns-records.md](./dns-records.md)), not this module. (Note: the DNS
  record is tailnet — the RADIUS _service_ ports are public, but its _hostname_ resolves to the
  tailnet address, matching today.)
- **No new firewall opening for the challenge.** The challenge is fronted by Caddy on `:80`
  (`via = "caddy80"`), so the loopback `acmePort = 22378` needs no firewall rule.

---

## 1. Current state — emitted output captured verbatim

### 1.1 The module today: `nix-config/modules/services/radius.nix`

The module realizes the `radiusd` OCI container, the ACME cert, the challenge vhost, the
`radius_config` sops template, and failure-notifs. The cert-relevant and firewall-relevant surfaces
are reproduced here verbatim.

**The ACME cert (`reloadServices`, standard convention):**

```nix
security.acme.certs."${svc.domain}" = {
  domain = svc.domain;
  group = "radiusd";
  server = c.ca.acmeDirectoryHttp;
  listenHTTP = "127.0.0.1:${builtins.toString svc.acmePort}";
  reloadServices = [ "podman-${containerName}.service" ];   # podman-radiusd.service
};
```

**The challenge vhost (bare `reverse_proxy`, whole `http://` vhost — not a `handle` wrapper):**

```nix
services.caddy.virtualHosts."http://${svc.domain}" = {
  extraConfig = ''
    reverse_proxy localhost:${builtins.toString svc.acmePort}
  '';
};
```

**The container (PUBLIC `0.0.0.0` port maps + cert volume mounts):**

```nix
virtualisation.oci-containers.containers."radiusd" = {
  user = "root";
  image = "kanidm/radius:latest";
  ports = [
    "0.0.0.0:1812:1812"
    "0.0.0.0:1812:1812/udp"
    "0.0.0.0:1813:1813"
    "0.0.0.0:1813:1813/udp"
  ];
  environment = {
    RADIUS_USER = "222:222";
    DEBUG = "True";
    REQUESTS_CA_BUNDLE = "/data/ca.pem";
  };
  volumes = [
    "${caCert}:/etc/pki/ca-trust/source/anchors"
    "${caCert}:/data/ca.pem"
    "${radiusCaDir}:/data/radius-ca:ro"
    "${directory}/fullchain.pem:/data/cert.pem"    # <- ACME cert dir
    "${directory}/key.pem:/data/key.pem"           # <- ACME cert dir
    "${config.sops.templates."radius_config".path}:/data/radius.toml:Z"
  ];
};
```

where `directory = config.security.acme.certs."${svc.domain}".directory` (the ACME-managed cert dir
the generator will own), `caCert = config.environment.etc."ssl/certs/ca-certificates.crt".source`,
and `radiusCaDir` is a `pkgs.runCommand` dir containing the rehashed root/intermediate CA PEMs from
`inputs.self + "/certs/…"`.

**The sops template** (`radius_config` → `radius.toml`, owner `radiusd`, with kanidm URL/domain,
VLAN maps, and `unifi_radius_secret`/`ui_radius_auth_token` placeholders) and **failure-notifs** stay
in the feature:

```nix
services.failure-notifs.attachServices = [
  "podman-radiusd"
];
```

### 1.2 Constants it reads: `nix-config/modules/service-registry.nix`

The `services.radius` entry:

```nix
services.radius = {
  subdomain = "radius";
  domain = mkDomain "radius";    # -> "radius.plato-splunk.media"
  acmePort = 22378;
};
```

with the shared helper (`baseDomain = "plato-splunk.media"`;
`mkDomain = subdomain: "${subdomain}.${baseDomain}"`). So:

- `svc.domain` = `radius.plato-splunk.media`
- `svc.acmePort` = `22378`
- `containerName` = `radiusd` → `podman-radiusd.service`
- `c.ca.acmeDirectoryHttp` = the internal step-ca HTTP-01 directory URL.

### 1.3 The resolved emitted output

After interpolation, augustus realizes:

```nix
security.acme.certs."radius.plato-splunk.media" = {
  domain = "radius.plato-splunk.media";
  group = "radiusd";
  server = <c.ca.acmeDirectoryHttp>;
  listenHTTP = "127.0.0.1:22378";
  reloadServices = [ "podman-radiusd.service" ];
};

services.caddy.virtualHosts."http://radius.plato-splunk.media".extraConfig = ''
  reverse_proxy localhost:22378
'';
```

> **Byte note + approved deviation.** The challenge vhost body is today `reverse_proxy
> localhost:22378` plus one trailing newline. The renderer standardizes the upstream token on
> **`127.0.0.1`** (operator-approved, catalog-and-generators §7.8 #22), so the generated body is
> `reverse_proxy 127.0.0.1:22378\n` — the parity gate shows **only** that `localhost → 127.0.0.1`
> substitution, same as [it-tools §2.4](./it-tools.md).

### 1.4 The firewall — radius OWNS the `1812`/`1813` openings (PUBLIC)

Unlike postgres, radius is the service the public `1812`/`1813` openings belong to. In
`nix-config/modules/_private/augustus/security.nix`:

```nix
networking.firewall = {
  enable = true;

  interfaces = {
    tailscale0 = {
      allowedTCPPorts = [
        22
        5252
        5432
        25565
      ];
    };
  };

  allowedTCPPorts = [
    80
    443

    # radius
    1812
    1813
  ];

  allowedUDPPorts = [
    1812
    1813
  ];
};
```

So radius contributes **four** public openings: `1812` TCP, `1813` TCP, `1812` UDP, `1813` UDP — all
on the default (public) interface, i.e. `0.0.0.0`, matching the container's `0.0.0.0:1812/1813` port
maps. These are **service-attributable** (clearly radius, and even already labelled `# radius`) but
**PUBLIC** and span **both protocols** — which the firewall generator's current model does not
express (§5). The `acmePort = 22378` is loopback (`caddy80`) and needs no opening.

### 1.5 Properties to preserve (invariants)

- **`reloadServices = [ "podman-radiusd.service" ]`** (standard convention; NOT `postRun`).
- **Per-service cert group `radiusd`.**
- **Challenge vhost is a bare `reverse_proxy` on the whole `http://` vhost** (not a `handle` wrapper).
  Byte-exact (§2.4 / §5 flag, shared with postgres/kanidm).
- **Container unchanged:** `kanidm/radius:latest`, `user = "root"`, the four `0.0.0.0:1812/1813`
  TCP+UDP port maps, the cert volume mounts off the ACME `directory`, the CA mounts, the env, and the
  `radius.toml` mount.
- **PUBLIC `1812`/`1813` TCP+UDP firewall openings preserved** (whether via the generator or left in
  the host — §5 discusses which).
- **`radius_config` sops template unchanged** (owner, content, placeholders).
- **No OIDC.** Catalog omits `oidc` → OIDC generator emits nothing.
- **No DNS owned here.** `radius` A/AAAA stays in `tailnetRewrites` until
  [./dns-records.md](./dns-records.md) (tailnet record — the hostname resolves to augustus's tailnet
  IP even though the service ports are public).
- **failure-notifs unchanged:** `attachServices = [ "podman-radiusd" ]`.

---

## 2. Target state — colocated feature layout

Replace `services/radius.nix` with a `features/radius/` directory (parent plan §2.0). radius has no
first-class `enable` option (it is simply imported-or-not, like most services) and **no** service
options, so no `options.nix`; and no OIDC, so no `oidc.nix`:

```
features/radius/
├── catalog.nix     # homelab.catalog.radius = { … }  (networking contract: TLS/ACME + firewall)
├── service.nix     # oci-container radiusd + radius_config sops template + failure-notifs (runtime)
└── complete.nix    # flake.modules.nixos.radius = { imports = [ radius-catalog radius-service ]; }
```

Rationale (per parent plan §2 / §5.1 #2):

- **`catalog.nix`** holds only the cross-cutting networking facts the generators consume: subdomain,
  host, the TLS/ACME descriptor, **and** the public `access` descriptor driving the firewall
  openings.
- **`service.nix`** holds the runtime (`radiusd` container), the `radius_config` sops template, the
  `radiusCaDir`/`caCert` derivations, **and** `failure-notifs.attachServices = [ "podman-radiusd" ]`
  — all tied to the `podman-radiusd` unit, so they live next to the unit they name, never in the
  catalog.
- **`complete.nix`** is what `hosts/augustus.nix` imports (as `nixos.radius` today). Importing it
  realizes the container **and** registers the catalog entry; augustus's generators pick it up.

### 2.1 `features/radius/catalog.nix`

```nix
{ config, ... }:
let
  svc = config.constants.services.radius;        # subdomain/domain/acmePort (transition)
in
{
  flake.modules.nixos.radius-catalog =
    { ... }:
    {
      homelab.catalog.radius = {
        subdomain = "radius";
        # zone defaults to constants.baseDomain = "plato-splunk.media"; stated for clarity.
        zone = "plato-splunk.media";
        host = "augustus";

        # radiusd serves its own TLS (RADSEC); Caddy only answers the HTTP-01 challenge.
        # No Caddy-proxied app port; the challenge body is driven by tls.cert.own.challenge.
        backend.none = { };

        tls = {
          cert.own = {
            ca = "internal"; # homelab step-ca
            acmePort = svc.acmePort; # 22378
            certGroup = "radiusd"; # per-service group (parent §5.1 #6)
            reloadServices = [ "podman-radiusd.service" ]; # standard reload (NOT postRun)
            challenge = {
              via = "caddy80"; # Caddy fronts :80 -> loopback; no FW opening
              body.bare = { };
            };
          };
          gate.none = { };
        };

        # radius is reachable on the PUBLIC interface for its own app ports (RADIUS 1812/1813,
        # TCP+UDP). This is the firewall-generator schema need (§5): service-attributable PUBLIC
        # ports, spanning both protocols, distinct from the 443/challenge openings.
        access = {
          scope.public = { };
          # SCHEMA NEED (§5): extra service-owned port openings beyond the vhost listenPort.
          extraPublicTCPPorts = [ 1812 1813 ];
          extraPublicUDPPorts = [ 1812 1813 ];
        };

        # The radius A/AAAA record stays in tailnetRewrites until dns-records.md.
        dns = null;

        # No oidc block -> OIDC generator emits nothing.
      };
    };
}
```

> **Firewall-shape caveat.** The `access.extraPublicTCPPorts` / `extraPublicUDPPorts` fields shown
> here are the **proposed** schema additions (§5) — they do not exist in the keystone schema yet. If
> they are judged out of scope for the firewall generator, the fallback (also §5) is to **leave the
> `1812`/`1813` openings hand-listed in `_private/augustus/security.nix`** as baseline-ish
> service ports (the same treatment radius/Technitium baseline ports already get per parent-plan
> decision §5.1 #7), and have the catalog entry merely **document** them via `access.scope.public = { }`
> without generating them. Either way the realized firewall is identical; §5 argues both options.

### 2.2 `features/radius/service.nix`

Verbatim carry-over of the container, the `radius_config` sops template, the CA derivations, and
failure-notifs (unchanged behavior). The container's cert volume mounts still read
`config.security.acme.certs."${svc.domain}".directory` — now produced by the acme generator with an
identical `directory` value, so the mounts are unchanged:

```nix
services.failure-notifs.attachServices = [
  "podman-radiusd"
];
```

> The container block (image, `user`, the four `0.0.0.0:1812/1813` TCP+UDP port maps, env, and all
> volume mounts incl. `${directory}/fullchain.pem`/`key.pem` and the `radius.toml` sops mount) and the
> `sops.templates."radius_config"` block are copied **exactly** from today's module. No behavioral
> change.

### 2.3 `features/radius/complete.nix`

```nix
{ ... }:
{
  flake.modules.nixos.radius = {
    imports = [
      # catalog.nix -> flake.modules.nixos.radius-catalog  (homelab.catalog.radius)
      # service.nix -> flake.modules.nixos.radius-service  (container + sops template + notifs)
    ];
  };
}
```

> Mirrors existing `features/<name>/complete.nix`. `hosts/augustus.nix` keeps importing one name
> (`nixos.radius`); importing it realizes the container **and** registers the catalog entry. augustus
> imports the generator modules (`homelab-service-acme`, `-caddy`, `-firewall`) once via its role
> aggregator (keystone §1).

### 2.4 What the acme generator must render for radius

Per the keystone §3.4, the **acme generator** owns both the `security.acme.certs` entry **and** the
`http://<fqdn>` challenge vhost. For radius it must produce **exactly**:

```nix
security.acme.certs."radius.plato-splunk.media" = {
  domain = "radius.plato-splunk.media";
  listenHTTP = "127.0.0.1:22378";
  server = <c.ca.acmeDirectoryHttp>;
  group = "radiusd";
  reloadServices = [ "caddy.service" "podman-radiusd.service" ];
};

services.caddy.virtualHosts."http://radius.plato-splunk.media".extraConfig = ''
  reverse_proxy localhost:22378
'';
```

> **`reloadServices` subtlety.** Today's radius cert has `reloadServices = [ "podman-radiusd.service"
> ]` — **without** `caddy.service`. The keystone generator default is `reloadServices = [
> "caddy.service" ] ++ e.tls.cert.own.reloadServices`, which would yield `[ "caddy.service"
> "podman-radiusd.service" ]` — a **superset** of today. Adding a `caddy.service` reload to radius's
> cert is a (harmless) behavioral change — **not** a byte-exact no-op. Two ways to make it a true
> no-op, decided at migration time against the parity diff (§4.1):
>
> - **(a) Match today exactly:** the generator must allow suppressing the default `caddy.service`
>   reload for manual-TLS certs whose Caddy only fronts the challenge. Add a per-entry
>   `tls.reloadCaddy = false` (default `true`) so radius (and postgres, and kanidm) omit it. This is
>   the strict no-op path and is the recommended §5 refinement.
> - **(b) Accept the superset as a reviewed deviation:** `caddy.service` reloading on radius-cert
>   renewal is benign (Caddy already reloads on its own certs). If accepted, flag it explicitly in the
>   migration PR as the single permitted intentional deviation for radius. **Not recommended** — the
>   no-op contract is cleaner with (a).

The challenge vhost uses the **bare `reverse_proxy` form** (not the `handle` wrapper), identical to
postgres/kanidm — see §5.

> **Avoid double-emitting the vhost.** The acme generator owns the `http://` challenge vhost; radius
> has **no** app `https://` vhost (Caddy never proxies RADIUS). So `managedBy.caddy` for radius should
> be **off** (the caddy generator must not render an `https://` vhost for a service whose only Caddy
> presence is the ACME challenge). Only the acme generator emits for radius.

---

## 3. Operational equivalence argument

Deploying this revision must change nothing on augustus. Per surface:

### 3.1 ACME cert (augustus) — byte-identical (with the §2.4 `reloadServices` fix)

- **Key:** `radius.plato-splunk.media`, derived `<subdomain>.<zone>` → identical to
  `mkDomain "radius"`.
- **`listenHTTP`:** `127.0.0.1:22378` from `tls.cert.own.acmePort = 22378` → identical.
- **`server`:** `c.ca.acmeDirectoryHttp` for `ca == "internal"` → identical.
- **`group`:** `radiusd` from `tls.cert.own.certGroup` → identical (per-service group preserved).
- **`reloadServices`:** must equal `[ "podman-radiusd.service" ]` exactly. With the §2.4(a)
  `reloadCaddy = false` refinement the generator emits exactly that; without it, it emits the
  superset `[ "caddy.service" "podman-radiusd.service" ]` (a flagged deviation). The parity gate
  (§4.1) decides.

### 3.2 Challenge vhost (augustus) — byte-identical

- **Key:** `http://radius.plato-splunk.media` (same scheme + fqdn).
- **Body:** both old and new render `reverse_proxy localhost:22378\n` — same `localhost` token, same
  port, same single trailing newline, **provided** the generator emits the bare `reverse_proxy` form
  (§2.4 / §5). Any switch to the `handle` wrapper is a reviewed, explicitly-flagged deviation — NOT
  part of this no-op migration.

### 3.3 Container + sops template + CA derivations (augustus) — unchanged

- `virtualisation.oci-containers.containers.radiusd` is copied verbatim (image, `user`, the four
  `0.0.0.0:1812/1813` TCP+UDP maps, env, all volume mounts). The cert mounts still read the same ACME
  `directory` value (now generator-produced), so the resulting `podman-radiusd.service` is identical.
- `sops.templates."radius_config"` (owner `radiusd`, content, placeholders) is copied verbatim → the
  rendered `radius.toml` is identical.
- `radiusCaDir` / `caCert` derivations are copied verbatim → identical store paths.

### 3.4 Firewall (augustus) — identical realized ports (schema choice in §5)

- Whether the `1812`/`1813` TCP+UDP public openings are generated from `access.extraPublic*Ports`
  (§5 option A) or left hand-listed in `_private/augustus/security.nix` (§5 option B), the **realized**
  `networking.firewall.allowedTCPPorts` / `allowedUDPPorts` must contain `1812` and `1813` exactly as
  today, on the public interface. The parity gate (§4.4) diffs the full firewall before/after and must
  be empty. The `acmePort = 22378` is loopback (`caddy80`) and adds nothing either way.

### 3.5 failure-notifs (augustus) — unchanged

- `services.failure-notifs.attachServices` still contains `"podman-radiusd"`, now sourced from
  `service.nix`. NixOS merges by concatenation → identical final list.

**Conclusion:** every realized attribute (ACME cert incl. `reloadServices`, challenge vhost,
container, sops template, CA derivations, firewall ports, failure-notifs) is identical before and
after — provided the acme generator suppresses the default `caddy.service` reload for radius (§2.4a)
and emits the bare challenge body (§5), and the firewall generator either generates or defers the
public `1812`/`1813` openings (§5). Those are additive schema refinements producing byte-identical
realized config.

---

## 4. Parity gate (exact commands)

> **Prerequisite (`.kiro/steering/validation.md`):** flake eval reads the **git tree**. Before any
> eval, `git add` the new `features/radius/*.nix` files (keep `services/radius.nix` until the "after"
> eval passes). Untracked new `.nix` files are invisible to `import-tree`.

### 4.1 ACME cert — the primary gate

```sh
nix eval \
  '.#nixosConfigurations.augustus.config.security.acme.certs."radius.plato-splunk.media"' \
  --json | jq 'pick(.domain, .listenHTTP, .server, .group, .reloadServices)'
```

The before/after JSON MUST be identical, and MUST show:

- `domain = "radius.plato-splunk.media"`
- `listenHTTP = "127.0.0.1:22378"`
- `server = <c.ca.acmeDirectoryHttp>`
- `group = "radiusd"`
- `reloadServices = ["podman-radiusd.service"]` (exactly — **no** `caddy.service`, assuming the
  §2.4(a) `reloadCaddy = false` refinement; if option (b) is accepted the diff will show the
  flagged `caddy.service` addition)

One-shot diff:

```sh
nix eval '.#nixosConfigurations.augustus.config.security.acme.certs."radius.plato-splunk.media"' --json > /tmp/radius-cert.before
nix eval '.#nixosConfigurations.augustus.config.security.acme.certs."radius.plato-splunk.media"' --json > /tmp/radius-cert.after
diff <(jq -S . /tmp/radius-cert.before) <(jq -S . /tmp/radius-cert.after)   # must be empty
```

### 4.2 Challenge vhost — byte-exact `--raw`

```sh
nix eval \
  '.#nixosConfigurations.augustus.config.services.caddy.virtualHosts."http://radius.plato-splunk.media".extraConfig' \
  --raw
```

Expected (byte-for-byte), single line + trailing newline:

```
reverse_proxy localhost:22378
```

Diff before/after:

```sh
nix eval '.#nixosConfigurations.augustus.config.services.caddy.virtualHosts."http://radius.plato-splunk.media".extraConfig' --raw > /tmp/radius-vhost.before
nix eval '.#nixosConfigurations.augustus.config.services.caddy.virtualHosts."http://radius.plato-splunk.media".extraConfig' --raw > /tmp/radius-vhost.after
diff /tmp/radius-vhost.before /tmp/radius-vhost.after   # must be empty
```

### 4.3 Container + sops template — no-change checks

```sh
# container unchanged (image, ports, volumes, env)
nix eval '.#nixosConfigurations.augustus.config.virtualisation.oci-containers.containers.radiusd' --json \
  | jq 'pick(.image, .user, .ports, .volumes, .environment)'
# ports must list the four 0.0.0.0:1812/1813 TCP+UDP maps; volumes must mount
# <acme-dir>/fullchain.pem -> /data/cert.pem and <acme-dir>/key.pem -> /data/key.pem

# sops template owner unchanged
nix eval '.#nixosConfigurations.augustus.config.sops.templates."radius_config".owner' --raw
# -> radiusd

# failure-notifs still attaches podman-radiusd
nix eval '.#nixosConfigurations.augustus.config.services.failure-notifs.attachServices' --json \
  | jq 'index("podman-radiusd") != null'   # -> true
```

### 4.4 Firewall — the radius-specific gate (must contain 1812/1813 TCP+UDP, public)

```sh
# public TCP: must contain 1812, 1813 (and 80, 443) — byte-identical before/after
nix eval '.#nixosConfigurations.augustus.config.networking.firewall.allowedTCPPorts' --json \
  | jq 'map(select(. == 1812 or . == 1813))'
# -> [1812,1813]

# public UDP: must contain 1812, 1813 — byte-identical before/after
nix eval '.#nixosConfigurations.augustus.config.networking.firewall.allowedUDPPorts' --json
# -> [1812,1813] (unchanged)

# full-firewall diff (catches any drift whichever §5 option is chosen):
nix eval '.#nixosConfigurations.augustus.config.networking.firewall' --json > /tmp/radius-fw.before
nix eval '.#nixosConfigurations.augustus.config.networking.firewall' --json > /tmp/radius-fw.after
diff <(jq -S . /tmp/radius-fw.before) <(jq -S . /tmp/radius-fw.after)   # must be empty
```

### 4.5 Build gate

```sh
nix run .#nixfmt -- $(git ls-files '*.nix' ':!:repos/**')
nix flake check
nixos-rebuild build --flake .#augustus
```

---

## 5. Schema gaps flagged for the catalog / generators

radius surfaces two needs beyond the reference pattern — one shared with postgres/kanidm (challenge
body + `caddy.service` reload), one unique to radius (PUBLIC service app ports):

### 5.1 Firewall generator: PUBLIC, service-attributable app ports (TCP **and** UDP)

The keystone firewall generator (§3.5 of
[./catalog-and-generators.md](./catalog-and-generators.md)) only opens the vhost **`listenPort`**
(443) and any `challenge.via == "direct"` acmePort, on the interface `access.scope` selects — and it
only emits **TCP** (`allowedTCPPorts` / `interfaces.<iface>.allowedTCPPorts`). radius's `1812`/`1813`
are:

- **app ports**, not a vhost listen port or an ACME port — the generator has no concept of
  "additional service-owned ports";
- **PUBLIC** (`0.0.0.0`), i.e. on the default interface, which `access.scope.public = { }` already
  selects, **but**
- span **both TCP and UDP** — the generator emits no UDP at all.

Two ways to make radius a no-op:

- **Option A — extend the firewall schema (recommended if generation is wanted).** Add optional
  per-entry fields the firewall generator folds into the public openings:

  ```nix
  access = {
    extraPublicTCPPorts = mkOption {
      type = types.listOf types.port; default = [ ];
      description = "Extra service-owned TCP ports opened on the public interface (e.g. radius 1812/1813).";
    };
    extraPublicUDPPorts = mkOption {
      type = types.listOf types.port; default = [ ];
      description = "Extra service-owned UDP ports opened on the public interface (e.g. radius 1812/1813).";
    };
    extraTailnetTCPPorts = mkOption { type = types.listOf types.port; default = [ ]; … };
    extraTailnetUDPPorts = mkOption { type = types.listOf types.port; default = [ ]; … };
  };
  ```

  and in the firewall generator:

  ```nix
  networking.firewall.allowedTCPPorts = publicListen ++ publicAcme
    ++ lib.concatMap (e: e.access.extraPublicTCPPorts) entries;
  networking.firewall.allowedUDPPorts =
    lib.concatMap (e: e.access.extraPublicUDPPorts) entries;
  ```

  This generalizes the firewall generator from "HTTPS + ACME only" to "any service-owned port on the
  declared interface, either protocol" — radius sets `extraPublicTCPPorts = [ 1812 1813 ]` and
  `extraPublicUDPPorts = [ 1812 1813 ]`, reproducing the hand-listed openings exactly.

- **Option B — keep `1812`/`1813` hand-listed as baseline-ish service ports.** Per parent-plan
  decision §5.1 #7, non-vhost infrastructure ports (SSH `22`, TS metrics `5252`, Technitium
  `53/80/443/853`, **and radius `1812/1813`**) already stay hand-listed in
  `_private/augustus/security.nix`. The radius catalog entry then only **documents** reachability
  (`access.scope.public = { }`) and the firewall generator contributes **nothing** for radius. This is
  the smaller change and matches the parent plan's existing treatment of radius ports as baseline.

**Recommendation:** Option B for the initial migration (smaller, matches parent §5.1 #7 which already
names radius `1812/1813` as baseline), with Option A noted as the clean long-term home if/when the
firewall generator is generalized to own all service-attributable ports. Either way the realized
firewall is byte-identical (§4.4), so radius stays a no-op regardless of which is chosen — the choice
is about _where the declaration lives_, not _what is realized_.

### 5.2 Shared with postgres/kanidm: challenge body + `caddy.service` reload suppression

- **Bare `reverse_proxy` challenge body, not the `handle` wrapper.** As the keystone §3.4 flags, all
  three manual-TLS services (kanidm/postgres/radius) use `reverse_proxy localhost:<acmePort>` on the
  whole `http://` vhost today. Recommend the generator default to the **bare** form so these are
  byte-exact no-ops (§2.4).
- **`tls.reloadCaddy = false` to suppress the default `caddy.service` reload.** radius's cert has
  `reloadServices = [ "podman-radiusd.service" ]` **without** `caddy.service`. The generator's default
  prepends `caddy.service`; a per-entry `tls.reloadCaddy` (default `true`) lets manual-TLS services
  whose Caddy only fronts the challenge opt out, matching today exactly (§2.4a). This is the same
  refinement postgres needs for its `postRun`-only cert — generalize it into one mechanism in the
  keystone acme generator.

These are additive schema refinements that yield byte-identical realized config.

---

## 6. Step-by-step migration checklist

> Depends on the catalog schema + generators existing
> ([./catalog-and-generators.md](./catalog-and-generators.md)) **with the §5 refinements landed**
> (bare challenge body + `reloadCaddy` suppression; firewall Option A only if generation is chosen),
> and follows the parent-plan ordering (cert-terminating services, parent §3 step 4; firewall,
> parent §3 step 5).

1. **Land the generator refinements (§5):** bare `reverse_proxy` challenge body as the default,
   `tls.reloadCaddy` (default `true`) to suppress the default `caddy.service` reload, and — if Option
   A is chosen — the `access.extraPublic{TCP,UDP}Ports` firewall fields. Re-run the keystone §5
   parity gate (adding unused fields stays a no-op).

2. **Capture baseline.** Run §4.1 (cert JSON), §4.2 (challenge vhost `--raw`), §4.3 (container/sops/
   failure-notifs), §4.4 (full firewall). Save to `/tmp/radius-*.before`.

3. **Create the feature directory** `nix-config/modules/features/radius/`:
   - `catalog.nix` — the `homelab.catalog.radius` entry from §2.1: `subdomain = "radius"`,
     `host = "augustus"`, `tls.cert.own = { ca = "internal"; acmePort = 22378; certGroup = "radiusd";
     reloadServices = [ "podman-radiusd.service" ]; reloadCaddy = false; challenge = { via = "caddy80";
     body.bare = { }; }; }`, `access.scope.public = { }` (+ `extraPublic{TCP,UDP}Ports = [ 1812 1813 ]`
     **only if** Option A), `dns = null`. **No `oidc`.**
   - `service.nix` — the `radiusd` container, the `radius_config` sops template, the `radiusCaDir`/
     `caCert` derivations, and `failure-notifs.attachServices = [ "podman-radiusd" ]` — copied
     verbatim.
   - `complete.nix` — aggregate both into `flake.modules.nixos.radius` (§2.3), preserving the import
     name `hosts/augustus.nix` uses.

4. **Opt the service into the acme generator** (`managedBy.acme = true`); keep `managedBy.caddy`
   **off** for radius (acme generator owns the `http://` challenge; radius has no `https://` app vhost
   — §2.4). If Option A: also flip `managedBy.firewall = true`; if Option B: leave `managedBy.firewall`
   off and keep `1812`/`1813` in `_private/augustus/security.nix`.

5. **Delete the hand-written cert + challenge vhost** from the old module: remove
   `security.acme.certs."${svc.domain}"` and `services.caddy.virtualHosts."http://${svc.domain}"`
   (now generated).

6. **Firewall (per §5 choice):**
   - **Option A:** remove `# radius` `1812`/`1813` from `allowedTCPPorts` and the `allowedUDPPorts`
     list in `_private/augustus/security.nix` (now generated from `access.extraPublic*Ports`).
   - **Option B:** leave them in `_private/augustus/security.nix` untouched (baseline).

7. **Remove the old module** `services/radius.nix` once `features/radius/` fully supersedes it.
   Confirm `hosts/augustus.nix` still imports `nixos.radius` (now from `complete.nix`).

8. **Stage new files for Nix eval:** `git add nix-config/modules/features/radius/` and stage the
   deletion of `services/radius.nix` (and the firewall edit if Option A). (Required — see §4
   prerequisite.)

9. **Run the parity gate.** Re-run §4.1–§4.4 → `/tmp/radius-*.after`; `diff` each against `.before`.
   **All diffs MUST be empty** (cert with `reloadServices = ["podman-radiusd.service"]` and no stray
   `caddy.service`; challenge vhost byte-exact; container/sops/failure-notifs unchanged; firewall
   `1812`/`1813` TCP+UDP present and unchanged). Fix the generator/catalog until byte-exact (likely
   culprits: a spurious `caddy.service` reload, `handle` vs bare challenge body, `127.0.0.1` vs
   `localhost`, missing UDP openings under Option A).

10. **DNS (deferred).** Leave `tailnetRewrites.radius = "augustus"` in place; `dns = null`
    here. The record cutover happens in [./dns-records.md](./dns-records.md).

11. **Format + check + build.** `nix run .#nixfmt -- …`, `nix flake check`,
    `nixos-rebuild build --flake .#augustus`. All must pass.

12. **Deploy as a no-op.** Every realized attribute is identical; the `radiusd` container, its cert
    renewal (`reloadServices` → `podman-radiusd`), the challenge vhost, the public `1812`/`1813`
    openings, the sops template, and failure-notifs are unchanged on augustus.

---

## 7. Migration checklist (condensed)

- [ ] Generator refinements landed (§5: bare challenge body default, `tls.reloadCaddy` suppression,
      and `access.extraPublic{TCP,UDP}Ports` **iff** firewall Option A)
- [ ] Baseline captured (§4.1–§4.4 → `*.before`)
- [ ] `features/radius/catalog.nix` — entry: `tls.cert.own = { ca = "internal"; acmePort = 22378;
      certGroup = "radiusd"; reloadServices = ["podman-radiusd.service"]; reloadCaddy = false;
      challenge = { via = "caddy80"; body.bare = { }; }; }`; `access.scope.public = { }`
      (+ `extraPublic*Ports = [1812 1813]` iff Option A); **no OIDC**; `dns = null`
- [ ] `features/radius/service.nix` — `radiusd` container + `radius_config` sops template + CA
      derivations + `failure-notifs.attachServices` (verbatim)
- [ ] `features/radius/complete.nix` — aggregates to `flake.modules.nixos.radius`
- [ ] acme generator opted in (`managedBy.acme`); caddy generator does NOT double-emit the challenge;
      firewall handled per §5 option (A: generated; B: left in host security.nix)
- [ ] hand-written cert + challenge vhost deleted; old `services/radius.nix` removed; import name
      preserved
- [ ] New files `git add`ed
- [ ] **Parity gate green:** cert JSON diff empty incl. `reloadServices = ["podman-radiusd.service"]`
      (§4.1); challenge vhost `--raw` diff empty (§4.2); container/sops/failure-notifs unchanged
      (§4.3); firewall `1812`/`1813` TCP+UDP present + full-firewall diff empty (§4.4)
- [ ] DNS parity deferred to [./dns-records.md](./dns-records.md); `tailnetRewrites.radius` removed
      there
- [ ] `nix run .#nixfmt`, `nix flake check`, `nixos-rebuild build --flake .#augustus` all pass
- [ ] Deployed — confirmed no-op (container, cert renewal, challenge vhost, public ports, sops
      template, failure-notifs unchanged)
