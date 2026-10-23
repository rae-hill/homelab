# postgres — Cert-Terminating Service Migration (manual TLS, `postRun` reload)

Status: **PROPOSED**
Date: 2026-10-22
Parent: [../service-consolidation-plan.md](../service-consolidation-plan.md) ·
Index: [./README.md](./README.md) ·
Keystone: [./catalog-and-generators.md](./catalog-and-generators.md)

> **Cert-terminating service.** postgres is one of the four manual-TLS services (with `kanidm`,
> `radius`, aedilis technitium) that terminate their **own** step-ca TLS cert consumed by a
> **non-Caddy process** — here the `postgresql` server itself, which reads `ssl_cert_file` /
> `ssl_key_file` from a copied cert directory. Unlike the reference [it-tools](./it-tools.md)
> migration, postgres has a `security.acme.certs` entry (C) and a per-service cert group — but it
> does **not** share the common `reloadServices` convention: it renews via an ACME **`postRun`** hook
> that starts a `postgresql-update-certs` oneshot. **This reveals an acme-generator schema gap: the
> generator must support a `postRun` passthrough** (today it only models `reloadServices`). See §5.
>
> **Operational-equivalence contract (from [./README.md](./README.md)):** deploying this revision
> MUST be a theoretical no-op. The migration changes _where_ config is declared, never _what_ gets
> realized. The challenge vhost `extraConfig`, the `security.acme.certs."postgres-augustus.plato-splunk.media"`
> block (including `postRun`), the `postgres-certs` group, the `postgresql-update-certs` oneshot, the
> `peesequel` server definition, and failure-notifs must all render byte-identical. The **only**
> permitted deviations are flagged schema additions that produce identical realized config.

---

## 0. Concerns and what makes postgres distinct

Concerns emitted today (per the index): **V C** — a Caddy **challenge** vhost and an ACME cert. Plus
several things the generators do **not** own that must stay in the feature:

- **A non-Caddy TLS consumer.** `postgresql.service` serves TLS directly (`ssl = true`,
  `ssl_cert_file`/`ssl_key_file`/`ssl_ca_file` pointing at `/var/lib/postgresql/certs/*`). Caddy is
  **only** used to answer the HTTP-01 challenge; it never proxies postgres traffic (5432 is not an
  HTTP vhost).
- **`postRun`, not `reloadServices`.** On renewal the cert is copied/owned/permissioned into
  `/var/lib/postgresql/certs` by a `postgresql-update-certs` oneshot, triggered by the ACME
  **`postRun`** hook. This is the schema gap (§5): the keystone acme generator (§3.4 of
  [./catalog-and-generators.md](./catalog-and-generators.md)) only emits `reloadServices`; postgres
  needs `postRun` passthrough.
- **A per-service cert group `postgres-certs`** with `members = [ "postgres" ]`, so the `postgres`
  system user can read the ACME cert directory directly (the `update-certs` oneshot runs as `root`
  and copies out of it). Per parent-plan decision §5.1 #6 this stays a **per-service** group.
- **Its own `enable` option.** The entire module body is gated by `lib.mkIf cfg.enable` where
  `cfg = config.services.peesequel`. postgres has a first-class `services.peesequel.enable` option
  (unlike most services which are simply imported-or-not). The migration must preserve that gate —
  the catalog entry and generators must not materialize postgres config on a host that has
  `services.peesequel.enable = false`.
- **No OIDC, no DNS record owned by the module.** The `postgres-augustus` A/AAAA record lives in the
  centralized `tailnetRewrites` map (→ [./dns-records.md](./dns-records.md)), not this module.
- **No new firewall opening on 443/challenge.** The challenge is fronted by Caddy on `:80` (`via =
  "caddy80"`), so the loopback `acmePort = 41872` needs no firewall rule. Postgres itself listens on
  `5432`, which augustus already opens on `tailscale0` — a **baseline** host opening, not
  service-attributable (parent plan §5.1 #7). The firewall generator adds nothing.

---

## 1. Current state — emitted output captured verbatim

### 1.1 The module today: `nix-config/modules/services/postgres.nix`

The module defines `services.peesequel` options and, under `lib.mkIf cfg.enable`, realizes the
PostgreSQL server, the cert plumbing, the challenge vhost, the cert group, the ACME cert, the
`update-certs` oneshot, and failure-notifs. The cert-relevant pieces (the surfaces this migration
touches) are reproduced here verbatim.

**The ACME cert (note `postRun`, NOT `reloadServices`):**

```nix
security.acme.certs."${domain}" = lib.mkIf cfg.enable {
  inherit domain;
  listenHTTP = "127.0.0.1:${builtins.toString acmePort}";
  server = c.ca.acmeDirectoryHttp;
  group = "postgres-certs";
  postRun = "${pkgs.systemd}/bin/systemctl start postgresql-update-certs.service";
};
```

**The challenge vhost (bare `reverse_proxy`, whole `http://` vhost — not a `handle` wrapper):**

```nix
services.caddy.virtualHosts."http://${domain}" = lib.mkIf cfg.enable {
  extraConfig = ''
    reverse_proxy localhost:${builtins.toString acmePort}
  '';
};
```

**The per-service cert group:**

```nix
users.groups.postgres-certs = lib.mkIf cfg.enable {
  members = [ "postgres" ];
};
```

**The `update-certs` oneshot (copies cert → `/var/lib/postgresql/certs`, restarts postgres):**

```nix
systemd.services.postgresql-update-certs = lib.mkIf cfg.enable {
  description = "Update PostgreSQL TLS certificates from ACME";
  after = [ "acme-${domain}.service" ];
  wantedBy = [ "multi-user.target" ];

  serviceConfig = {
    Type = "oneshot";
    RemainAfterExit = false;
    User = "root";
    ExecStart = updateCertsScript;
    ExecStartPost = "${pkgs.systemd}/bin/systemctl restart postgresql.service";
  };
};
```

where `updateCertsScript` (`pkgs.writeShellScript "update-postgres-certs"`) copies
`${directory}/{fullchain.pem,key.pem,chain.pem}` + `/etc/ssl/certs/ca-certificates.crt` into
`/var/lib/postgresql/certs`, `chown postgres:postgres`, and `chmod` (`644` fullchain/chain/rootCA,
`600` key). `directory` is `config.security.acme.certs."${domain}".directory` — i.e. the oneshot
reads the ACME-managed cert dir the generator will own.

**The server definition** (`services.postgresql` with `ssl = true`, `ssl_cert_file =
"${postgresCredsDir}/fullchain.pem"`, etc.), the `provision-passwords` / `grant-roles` oneshots, the
`postgresqlBackup`, and **failure-notifs** all stay in the feature's `service.nix`:

```nix
services.failure-notifs.attachServices = [
  "postgresql"
  "postgresql-provision-passwords"
  "postgresql-update-certs"
  "restic-backups-postgres"
];
```

### 1.2 Constants it reads: `nix-config/modules/service-registry.nix`

Two entries feed this module. The top-level `postgres` block (lines ~220–223):

```nix
postgres = {
  domain = mkDomain "postgres-augustus";   # -> "postgres-augustus.plato-splunk.media"
  port = 5432;
};
```

and the `services.postgres` block that carries the `acmePort` the module reads as `svc.acmePort`
(where `svc = c.services.postgres`):

```nix
services.postgres = {
  subdomain = "postgres-augustus";
  domain = mkDomain "postgres-augustus";    # -> "postgres-augustus.plato-splunk.media"
  acmePort = 41872;
};
```

> **Provenance note.** The module binds `domain = cfg.tlsDomain` (set by the host's
> `services.peesequel.tlsDomain`, which resolves to `postgres-augustus.plato-splunk.media`) and
> `acmePort = svc.acmePort = 41872`. The catalog entry derives `fqdn = <subdomain>.<zone> =
> postgres-augustus.plato-splunk.media`, matching `cfg.tlsDomain`; keep `tlsDomain` wired to the same
> value during the transition so the server's `ssl_*` paths and the cert `domain` stay in lock-step.

with the shared helper (`baseDomain = "plato-splunk.media"`;
`mkDomain = subdomain: "${subdomain}.${baseDomain}"`). So:

- `domain` = `postgres-augustus.plato-splunk.media`
- `acmePort` = `41872`
- `c.ca.acmeDirectoryHttp` = the internal step-ca HTTP-01 directory URL.

### 1.3 The resolved emitted output

After interpolation, augustus (with `services.peesequel.enable = true`) realizes:

```nix
security.acme.certs."postgres-augustus.plato-splunk.media" = {
  domain = "postgres-augustus.plato-splunk.media";
  listenHTTP = "127.0.0.1:41872";
  server = <c.ca.acmeDirectoryHttp>;
  group = "postgres-certs";
  postRun = "/nix/store/…-systemd/bin/systemctl start postgresql-update-certs.service";
};

services.caddy.virtualHosts."http://postgres-augustus.plato-splunk.media".extraConfig = ''
  reverse_proxy localhost:41872
'';

users.groups.postgres-certs.members = [ "postgres" ];
```

> **Byte note + approved deviation.** The challenge vhost body is today `reverse_proxy
> localhost:41872` plus one trailing newline. The renderer standardizes the upstream token on
> **`127.0.0.1`** (operator-approved, catalog-and-generators §7.8 #22), so the generated body is
> `reverse_proxy 127.0.0.1:41872\n` — the parity gate shows **only** that `localhost → 127.0.0.1`
> substitution, same as [it-tools §2.4](./it-tools.md). The `postRun` string is the absolute
> `systemctl` store path; it must be reproduced exactly (same `pkgs.systemd` derivation → same store
> path for a given revision).

### 1.4 The firewall (already satisfied, no module contribution)

postgres opens no firewall rule in its own module. Its two network-reachable ports are:

- **`5432`** — the postgres server, opened on `tailscale0` in
  `nix-config/modules/_private/augustus/security.nix`:

  ```nix
  networking.firewall.interfaces.tailscale0.allowedTCPPorts = [
    22
    5252
    5432
    25565
  ];
  ```

  This is a **baseline** host opening (postgres is reachable only over the tailnet), owned by the
  host, not service-attributable (parent plan §5.1 #7). The firewall generator must **not** move or
  add it.

- **`41872`** — the ACME challenge listener, bound `127.0.0.1` (loopback). Caddy fronts it on `:80`
  (`via = "caddy80"`), and `80` is already a baseline public opening on augustus. **No firewall rule
  for `41872`.**

So there is **no postgres-attributable firewall rule to migrate** — the firewall generator adds
nothing for this service.

### 1.5 Properties to preserve (invariants)

- **Own `enable` gate.** Everything stays behind `services.peesequel.enable`. The catalog entry and
  the cert/challenge it drives must be absent when `enable = false` (§3.6).
- **`postRun`, not `reloadServices`.** The renewal hook starts `postgresql-update-certs.service` via
  `postRun` — **no** `reloadServices` list. The generator must emit `postRun` (schema gap, §5).
- **Per-service cert group `postgres-certs`**, `members = [ "postgres" ]`.
- **`postgresql-update-certs` oneshot** (and its `updateCertsScript`) stays in the feature — it is
  service-specific cert plumbing, not a generator concern.
- **Challenge vhost is a bare `reverse_proxy` on the whole `http://` vhost** (not a
  `handle /.well-known/acme-challenge/*` wrapper). Byte-exact (§3.4 / §5 flag).
- **No OIDC.** Catalog omits `oidc` → OIDC generator emits nothing.
- **No DNS owned here.** `postgres-augustus` A/AAAA stays in `tailnetRewrites` until
  [./dns-records.md](./dns-records.md).
- **Server + oneshots + backup + failure-notifs unchanged**, moved verbatim into `service.nix`.

---

## 2. Target state — colocated feature layout

Replace `services/postgres.nix` with a `features/postgres/` directory (parent plan §2.0). postgres
keeps an `options.nix` because it owns a real NixOS option set (`services.peesequel.*`):

```
features/postgres/
├── options.nix     # services.peesequel.* option definitions (enable, package, tlsDomain, …)
├── catalog.nix     # homelab.catalog.postgres = { … }  (networking contract ONLY)
├── service.nix     # services.postgresql + update-certs oneshot + group + provision/grant/backup
│                   #   + failure-notifs.attachServices (the runtime + cert plumbing)
└── complete.nix    # flake.modules.nixos.postgres = { imports = [ postgres-options postgres-catalog
                    #   postgres-service ]; }
```

Rationale (per parent plan §2 / §5.1 #2):

- **`options.nix`** holds the `services.peesequel` submodule options (moved verbatim). Keeping them
  in the feature means `enable`/`tlsDomain`/`port` are defined once, next to the service.
- **`catalog.nix`** holds only the cross-cutting networking facts the generators consume (subdomain,
  host, the TLS/ACME descriptor). It is itself gated so it contributes nothing when
  `services.peesequel.enable = false` (§3.6).
- **`service.nix`** holds the runtime (`services.postgresql`), the cert plumbing
  (`postgresql-update-certs` oneshot + `updateCertsScript`), the `postgres-certs` group, the
  `provision-passwords`/`grant-roles` oneshots, the `postgresqlBackup`, **and**
  `failure-notifs.attachServices` — all tied to the postgres systemd units, so they live next to the
  units they name, never in the catalog.
- **`complete.nix`** is what `hosts/augustus.nix` imports (as `nixos.postgres` today). Importing it
  realizes the server **and** registers the catalog entry; augustus's generators pick it up.

### 2.1 `features/postgres/catalog.nix`

```nix
{ config, ... }:
let
  svc = config.constants.services.postgres;        # subdomain/domain/acmePort (transition)
in
{
  flake.modules.nixos.postgres-catalog =
    { config, lib, ... }:
    {
      # Gate the catalog entry on the service's own enable option so nothing materializes
      # on a host where services.peesequel.enable = false (invariant §1.5).
      homelab.catalog = lib.mkIf config.services.peesequel.enable {
        postgres = {
          subdomain = "postgres-augustus";
          # zone defaults to constants.baseDomain = "plato-splunk.media"; stated for clarity.
          zone = "plato-splunk.media";
          host = "augustus";

          # postgres serves TLS itself; Caddy only answers the HTTP-01 challenge.
          # backend.port is the loopback challenge target (acmePort), NOT a proxied app port.
          # (The reverseProxy backend models the CHALLENGE vhost body; see §2.4.)
          backend = {
            kind = "reverseProxy";
            port = svc.acmePort;    # 41872 — challenge listener
          };

          tls = {
            ca = "internal";                 # homelab step-ca
            acmePort = svc.acmePort;         # 41872
            certGroup = "postgres-certs";    # per-service group (parent plan §5.1 #6)
            # SCHEMA GAP (§5): the cert renews via a postRun hook, NOT reloadServices.
            postRun = "systemctl start postgresql-update-certs.service";
            reloadServices = [ ];            # explicitly empty — postgres uses postRun
            challenge = {
              via = "caddy80";               # Caddy fronts :80 -> loopback 41872; no FW opening
            };
            gate = "none";                   # no Caddy-level auth on the challenge vhost
          };

          # 5432 is a baseline tailnet opening owned by the host; the challenge is caddy80
          # (loopback). The firewall generator adds nothing. scope documents reachability.
          access.scope = "tailnet";

          # The postgres-augustus A/AAAA record stays in tailnetRewrites until dns-records.md.
          dns.enable = false;

          # No oidc block -> OIDC generator emits nothing.
        };
      };
    };
}
```

Notes:

- **`backend.port = acmePort`** — for a manual-TLS service the generated `http://` **challenge**
  vhost body is `reverse_proxy localhost:<acmePort>`, which is exactly what the reverseProxy renderer
  produces. See §2.4 for the subtlety that the acme generator (not the caddy generator) owns the
  `http://` vhost, so we must avoid double-emitting.
- **`tls.ca = "internal"`**, **`acmePort = 41872`**, **`certGroup = "postgres-certs"`** → the acme
  generator emits the `security.acme.certs` entry with the per-service group.
- **`tls.postRun`** (NEW field, §5) → the generator must set `security.acme.certs.<fqdn>.postRun`
  from it. **`reloadServices = [ ]`** is explicit — postgres must NOT get the generator's default
  `[ "caddy.service" ]` reload (see the equivalence argument §3.2 for how this is reconciled).
- **`dns.enable = false`** — the record is owned by `tailnetRewrites` today; flipping to generator
  output happens in [./dns-records.md](./dns-records.md).

### 2.2 `features/postgres/service.nix`

Verbatim carry-over of the runtime and cert plumbing (unchanged behavior). This is the bulk of the
module: `services.postgresql` (with `ssl = true` + the `ssl_cert_file`/`ssl_key_file`/`ssl_ca_file`
pointing at `/var/lib/postgresql/certs/*`, the `identMap`/`authentication` blocks), the
`postgresql-update-certs` oneshot + `updateCertsScript`, `users.groups.postgres-certs`, the
`postgresql-provision-passwords` and `postgresql-grant-roles` oneshots, `services.postgresqlBackup`,
and failure-notifs — all under `lib.mkIf cfg.enable` exactly as today:

```nix
services.failure-notifs.attachServices = [
  "postgresql"
  "postgresql-provision-passwords"
  "postgresql-update-certs"
  "restic-backups-postgres"
];
```

> The `postgresql-update-certs` oneshot and `updateCertsScript` are copied **exactly** — same
> `ExecStart` script (copy/chown/chmod of `fullchain.pem`/`key.pem`/`chain.pem`/root CA into
> `/var/lib/postgresql/certs`), same `ExecStartPost = systemctl restart postgresql.service`, same
> `after = [ "acme-${domain}.service" ]`. It still reads `config.security.acme.certs."${domain}".directory`
> — now that cert is produced by the acme generator instead of the hand-written block, but the
> `directory` value is identical, so the oneshot is unchanged.

### 2.3 `features/postgres/complete.nix`

```nix
{ ... }:
{
  flake.modules.nixos.postgres = {
    imports = [
      # options.nix  -> flake.modules.nixos.postgres-options  (services.peesequel.* options)
      # catalog.nix  -> flake.modules.nixos.postgres-catalog  (homelab.catalog.postgres)
      # service.nix  -> flake.modules.nixos.postgres-service  (runtime + cert plumbing + notifs)
    ];
  };
}
```

> Mirrors existing `features/<name>/complete.nix`. `hosts/augustus.nix` keeps importing one name
> (`nixos.postgres`); importing it realizes the server **and** registers the catalog entry. augustus
> imports the generator modules (`homelab-service-acme`, `-caddy`, `-firewall`) once via its
> role aggregator (`homelab-service-oidc-host`, which composes the apphost generators — keystone §1).

### 2.4 What the acme + caddy generators must render for postgres

Per the keystone §3.4, the **acme generator** owns both the `security.acme.certs` entry **and** the
`http://<fqdn>` challenge vhost. For postgres it must produce **exactly**:

```nix
security.acme.certs."postgres-augustus.plato-splunk.media" = {
  domain = "postgres-augustus.plato-splunk.media";
  listenHTTP = "127.0.0.1:41872";
  server = <c.ca.acmeDirectoryHttp>;
  group = "postgres-certs";
  postRun = "<pkgs.systemd>/bin/systemctl start postgresql-update-certs.service";
};

services.caddy.virtualHosts."http://postgres-augustus.plato-splunk.media".extraConfig = ''
  reverse_proxy localhost:41872
'';
```

Two generator behaviors this service pins down:

1. **`postRun` passthrough (schema gap, §5).** The keystone acme generator only emits
   `reloadServices = [ "caddy.service" ] ++ e.tls.reloadServices`. postgres has **no** caddy reload
   and instead needs `postRun`. The generator's `mkCert` must be extended to emit
   `postRun = e.tls.postRun` when set, and to **omit the default `caddy.service` reload** when
   `reloadServices == [ ]` and `postRun` is set (postgres's current cert has neither a
   `reloadServices` nor a `caddy.service` reload). See §3.2 for why the current block has no caddy
   reload at all.

2. **Challenge vhost is the bare `reverse_proxy` form, not the `handle` wrapper.** Today postgres (like
   kanidm and radius) uses `reverse_proxy localhost:41872` on the whole `http://` vhost, **not**
   `handle /.well-known/acme-challenge/* { … }`. The keystone generator (§3.4) notes it defaults to
   the `handle` form and flags this exact divergence. For a byte-exact no-op, postgres must render the
   **bare `reverse_proxy` body**. Options (choose per the parity diff):
   - (a) Have the acme generator's challenge renderer emit the bare `reverse_proxy localhost:<port>`
     form (matching today) rather than the `handle` wrapper — recommended, since all three manual-TLS
     services (kanidm/postgres/radius) currently use the bare form, so the bare form IS the common
     case and the `handle` form would be the deviation.
   - (b) Keep the bare body via `extraCaddyConfig` on the challenge entry.
     The `handle`-vs-bare choice is **functionally equivalent for ACME** (both route
     `/.well-known/acme-challenge/*` to the loopback listener), but byte-exactness requires matching
     today's bare form, so (a) is the no-op path.

The vhost **key** must remain `http://postgres-augustus.plato-splunk.media` (the `http://` scheme,
derived from `<subdomain>.<zone>`).

> **Avoid double-emitting the vhost.** Because the acme generator owns the `http://` challenge vhost
> for manual-TLS services, `managedBy.caddy` for postgres should be **off** (or the caddy generator
> must skip entries whose only vhost is the ACME challenge). postgres has **no** app `https://` vhost
> at all (Caddy never proxies 5432), so the caddy generator emits nothing for it — only the acme
> generator does. Confirm the caddy generator does not also try to render an `https://` vhost for a
> service whose `backend` models the challenge port.

---

## 3. Operational equivalence argument

Deploying this revision must change nothing on augustus (and nothing anywhere `peesequel.enable =
false`). Per surface:

### 3.1 ACME cert (augustus) — byte-identical

- **Key:** `postgres-augustus.plato-splunk.media`, derived `<subdomain>.<zone>` with the same base
  domain → identical to `cfg.tlsDomain` / `mkDomain "postgres-augustus"`.
- **`listenHTTP`:** `127.0.0.1:41872` from `tls.acmePort = 41872` → identical.
- **`server`:** `c.ca.acmeDirectoryHttp` (the acme generator uses the same constant for
  `ca == "internal"`) → identical.
- **`group`:** `postgres-certs` from `tls.certGroup` → identical (per-service group preserved).
- **`postRun`:** `<pkgs.systemd>/bin/systemctl start postgresql-update-certs.service` from
  `tls.postRun` → identical, **provided the generator emits `postRun`** (schema gap §5). The `pkgs`
  reference resolves to the same store path on a given revision, so the string is byte-identical.

### 3.2 `reloadServices` — the subtle part

Today's postgres cert has **neither** `reloadServices` **nor** a `caddy.service` reload — it relies
solely on `postRun`. The keystone generator's default is `reloadServices = [ "caddy.service" ] ++
e.tls.reloadServices`. If applied unchanged, postgres would **gain** a `caddy.service` reload it does
not have today — a behavioral change (not a no-op). Resolution: the generator must treat a
`postRun`-only cert specially — when `tls.postRun != null` and `tls.reloadServices == [ ]`, emit
**no** `reloadServices` attr at all (matching today). This is part of the §5 schema addition and is
required for byte-exact parity. The parity gate (§4.1) will show any spurious `reloadServices` or
`caddy.service` entry as a failing diff.

### 3.3 Challenge vhost (augustus) — byte-identical

- **Key:** `http://postgres-augustus.plato-splunk.media` (same scheme + fqdn).
- **Body:** both old and new render `reverse_proxy localhost:41872\n` — same `localhost` token, same
  port, same single trailing newline, **provided** the generator emits the bare `reverse_proxy` form
  rather than the `handle` wrapper (§2.4 option (a)). Any switch to the `handle` form is a reviewed,
  explicitly-flagged deviation — NOT part of this no-op migration.

### 3.4 Cert group (augustus) — unchanged

- `users.groups.postgres-certs.members = [ "postgres" ]` stays in `service.nix` (it is service cert
  plumbing, keyed to the `postgres` user), merged identically. The generator does **not** own group
  membership (keystone §3.4 note) — it is kept in the feature.

### 3.5 `update-certs` oneshot + server + backup + failure-notifs — unchanged

- `postgresql-update-certs` (and `updateCertsScript`), `services.postgresql` (incl. `ssl_*`),
  `provision-passwords`/`grant-roles`, `postgresqlBackup`, and
  `failure-notifs.attachServices = [ "postgresql" "postgresql-provision-passwords"
  "postgresql-update-certs" "restic-backups-postgres" ]` are copied verbatim into `service.nix`.
  NixOS merges `attachServices` by concatenation → identical final list. The oneshot still reads the
  same ACME `directory`, now produced by the generator with an identical value.

### 3.6 The `enable` gate — preserved

- Today everything is `lib.mkIf cfg.enable`. In the feature, `options.nix` defines
  `services.peesequel.enable`; `catalog.nix` wraps its `homelab.catalog.postgres` contribution in
  `lib.mkIf config.services.peesequel.enable`; `service.nix` keeps `config = lib.mkIf cfg.enable { …
  }`. On a host with `enable = false`, the catalog entry is absent → acme/caddy generators emit
  nothing for postgres → identical to today (no cert, no challenge vhost, no group). Verify by
  evaluating on a host where postgres is disabled (or by toggling): the generated
  `security.acme.certs` / challenge vhost must not appear.

### 3.7 Firewall — no change

- `5432` on `tailscale0` stays in `_private/augustus/security.nix` (baseline, host-owned). `41872` is
  loopback (`caddy80`). The firewall generator adds nothing for postgres. `networking.firewall` is
  byte-identical.

**Conclusion:** every realized attribute (ACME cert incl. `postRun`, challenge vhost, cert group,
`update-certs` oneshot, postgres server, backup, failure-notifs, firewall) is identical before and
after — provided the acme generator gains `postRun` passthrough and the `postRun`-only
no-`reloadServices` handling (§5). Those are additive schema changes that produce byte-identical
realized config, not behavioral deviations.

---

## 4. Parity gate (exact commands)

> **Prerequisite (`.kiro/steering/validation.md`):** flake eval reads the **git tree**. Before any
> eval, `git add` the new `features/postgres/*.nix` files (keep `services/postgres.nix` until the
> "after" eval passes). Untracked new `.nix` files are invisible to `import-tree` and produce a
> misleading "missing attribute" error.

### 4.1 ACME cert — the primary gate

Run **before** and **after** the migration and diff:

```sh
nix eval \
  '.#nixosConfigurations.augustus.config.security.acme.certs."postgres-augustus.plato-splunk.media"' \
  --json | jq 'pick(.domain, .listenHTTP, .server, .group, .postRun, .reloadServices)'
```

The before/after JSON MUST be identical, and MUST show:

- `domain = "postgres-augustus.plato-splunk.media"`
- `listenHTTP = "127.0.0.1:41872"`
- `server = <c.ca.acmeDirectoryHttp>`
- `group = "postgres-certs"`
- `postRun` present (the `systemctl start postgresql-update-certs.service` store path)
- `reloadServices` **absent or `[]`** (postgres must NOT gain a `caddy.service` reload — §3.2)

One-shot diff:

```sh
# before:
nix eval '.#nixosConfigurations.augustus.config.security.acme.certs."postgres-augustus.plato-splunk.media"' --json > /tmp/pg-cert.before
# after:
nix eval '.#nixosConfigurations.augustus.config.security.acme.certs."postgres-augustus.plato-splunk.media"' --json > /tmp/pg-cert.after
diff <(jq -S . /tmp/pg-cert.before) <(jq -S . /tmp/pg-cert.after)   # must be empty
```

### 4.2 Challenge vhost — byte-exact `--raw`

```sh
nix eval \
  '.#nixosConfigurations.augustus.config.services.caddy.virtualHosts."http://postgres-augustus.plato-splunk.media".extraConfig' \
  --raw
```

Expected (byte-for-byte), single line + trailing newline:

```
reverse_proxy localhost:41872
```

Diff before/after:

```sh
nix eval '.#nixosConfigurations.augustus.config.services.caddy.virtualHosts."http://postgres-augustus.plato-splunk.media".extraConfig' --raw > /tmp/pg-vhost.before
nix eval '.#nixosConfigurations.augustus.config.services.caddy.virtualHosts."http://postgres-augustus.plato-splunk.media".extraConfig' --raw > /tmp/pg-vhost.after
diff /tmp/pg-vhost.before /tmp/pg-vhost.after   # must be empty
```

### 4.3 Cert group, oneshot, server, backup, failure-notifs — no-change checks

```sh
# cert group membership unchanged
nix eval '.#nixosConfigurations.augustus.config.users.groups.postgres-certs.members' --json
# -> ["postgres"]

# update-certs oneshot unchanged (ExecStart script + ExecStartPost restart)
nix eval '.#nixosConfigurations.augustus.config.systemd.services.postgresql-update-certs.serviceConfig' --json

# postgres server ssl paths unchanged
nix eval '.#nixosConfigurations.augustus.config.services.postgresql.settings.ssl_cert_file' --raw
nix eval '.#nixosConfigurations.augustus.config.services.postgresql.settings.ssl_key_file' --raw

# failure-notifs still attaches the postgres units
nix eval '.#nixosConfigurations.augustus.config.services.failure-notifs.attachServices' --json \
  | jq 'map(select(. == "postgresql" or . == "postgresql-provision-passwords"
            or . == "postgresql-update-certs" or . == "restic-backups-postgres"))'
```

### 4.4 Firewall no-change check

```sh
nix eval '.#nixosConfigurations.augustus.config.networking.firewall.interfaces.tailscale0.allowedTCPPorts' --json
# must still contain 5432, unchanged; no 41872
nix eval '.#nixosConfigurations.augustus.config.networking.firewall.allowedTCPPorts' --json
```

### 4.5 `enable = false` gate check

On a toggled eval (or a host with `services.peesequel.enable = false`), confirm the catalog produces
nothing:

```sh
# with peesequel disabled, the cert key must NOT exist:
nix eval '.#nixosConfigurations.augustus.config.security.acme.certs' --json \
  | jq 'has("postgres-augustus.plato-splunk.media")'   # expected false when disabled
```

### 4.6 Build gate

```sh
nix run .#nixfmt -- $(git ls-files '*.nix' ':!:repos/**')
nix flake check
nixos-rebuild build --flake .#augustus
```

---

## 5. Schema gap flagged for the catalog / acme generator

This migration **cannot** be a no-op without an additive change to the keystone acme-generator schema
([./catalog-and-generators.md](./catalog-and-generators.md) §2 `tlsType`, §3.4 `mkCert`). postgres is
the service that surfaces it:

1. **`tls.postRun` passthrough (NEW field).** Add an optional field to the `tlsType` submodule:

   ```nix
   postRun = mkOption {
     type = types.nullOr types.str;
     default = null;
     description = ''
       ACME postRun hook (a shell command run after a successful renewal). Used by
       services whose cert is consumed by a non-Caddy process that must be re-materialized
       on renewal via a bespoke oneshot (postgres -> postgresql-update-certs), rather than
       a plain systemd reload. Passed through to security.acme.certs.<domain>.postRun.
     '';
   };
   ```

   and in `mkCert`, emit it:

   ```nix
   // lib.optionalAttrs (e.tls.postRun != null) { postRun = e.tls.postRun; }
   ```

2. **`postRun`-only certs must not gain the default `caddy.service` reload.** Today's postgres cert
   has **no** `reloadServices` at all. The generator's default (`reloadServices = [ "caddy.service" ]
   ++ e.tls.reloadServices`) would add one. For byte-exact parity, when `tls.postRun != null` **and**
   `tls.reloadServices == [ ]`, the generator must emit **no** `reloadServices` attribute:

   ```nix
   // lib.optionalAttrs (e.tls.reloadServices != [ ] || e.tls.postRun == null) {
        reloadServices = [ "caddy.service" ] ++ e.tls.reloadServices;
      }
   ```

   (i.e. only add the caddy reload for the normal Caddy-fronted case; a `postRun`-only cert opts out.)
   Record this in the keystone plan as the postgres-driven refinement of `mkCert`.

3. **Challenge vhost bare-`reverse_proxy` form (not `handle`).** As the keystone §3.4 already flags:
   all three manual-TLS services (kanidm/postgres/radius) use the bare `reverse_proxy
   localhost:<acmePort>` challenge body today. Recommend the generator default to the **bare** form so
   these three are byte-exact no-ops; the `handle /.well-known/acme-challenge/*` wrapper, if ever
   adopted, is a separately-reviewed normalization (functionally equivalent for ACME). (§2.4 option
   (a).)

These three are the only permitted deviations for postgres, and all three are additive schema changes
that yield byte-identical realized config — not runtime behavior changes.

---

## 6. Step-by-step migration checklist

> Depends on the catalog schema + generators existing
> ([./catalog-and-generators.md](./catalog-and-generators.md)) **with the §5 `postRun` additions
> landed**, and follows the parent-plan ordering (cert-terminating services after the simple ones,
> parent §3 step 4).

1. **Land the acme-generator schema additions (§5)** in `features/homelab-service/`: `tls.postRun`
   field, `mkCert` `postRun` emission, and the `postRun`-only no-`reloadServices` handling. Re-run the
   keystone §5 parity gate (introducing the fields with no entry using them stays a no-op).

2. **Capture baseline.** Run §4.1 (cert JSON), §4.2 (challenge vhost `--raw`), §4.3 (group/oneshot/
   server/failure-notifs), §4.4 (firewall). Save to `/tmp/pg-*.before`.

3. **Create the feature directory** `nix-config/modules/features/postgres/`:
   - `options.nix` — move the `services.peesequel.*` option definitions verbatim.
   - `catalog.nix` — the `homelab.catalog.postgres` entry from §2.1, gated on
     `services.peesequel.enable`: `subdomain = "postgres-augustus"`, `host = "augustus"`,
     `tls = { ca = "internal"; acmePort = 41872; certGroup = "postgres-certs"; postRun =
     "systemctl start postgresql-update-certs.service"; reloadServices = [ ]; challenge.via =
     "caddy80"; }`, `access.scope = "tailnet"`, `dns.enable = false`. **No `oidc`.**
   - `service.nix` — the server, `postgresql-update-certs` oneshot + `updateCertsScript`,
     `postgres-certs` group, provision/grant oneshots, backup, and failure-notifs — copied verbatim,
     all under `lib.mkIf cfg.enable`.
   - `complete.nix` — aggregate the three into `flake.modules.nixos.postgres` (§2.3), preserving the
     import name `hosts/augustus.nix` uses.

4. **Opt the service into the acme generator** (`managedBy.acme = true`); keep `managedBy.caddy` off
   for postgres (the acme generator owns the `http://` challenge vhost; postgres has no `https://`
   app vhost — §2.4). Ensure augustus's generators now render the cert + challenge vhost **instead of**
   the hand-written blocks.

5. **Delete the hand-written cert + challenge vhost** from the old module: remove
   `security.acme.certs."${domain}"` and `services.caddy.virtualHosts."http://${domain}"` (now
   generated). Keep everything else moving into `service.nix`.

6. **Remove the old module** `services/postgres.nix` once `features/postgres/` fully supersedes it.
   Confirm `hosts/augustus.nix` still imports `nixos.postgres` (now from `complete.nix`).

7. **Stage new files for Nix eval:** `git add nix-config/modules/features/postgres/` and stage the
   deletion of `services/postgres.nix`. (Required — see §4 prerequisite.)

8. **Run the parity gate.** Re-run §4.1–§4.5 → `/tmp/pg-*.after`; `diff` each against `.before`.
   **All diffs MUST be empty** (cert incl. `postRun`, no spurious `reloadServices`/`caddy.service`;
   challenge vhost byte-exact; group/oneshot/server/failure-notifs/firewall unchanged; disabled host
   emits nothing). Fix the generator/catalog until byte-exact (likely culprits: missing `postRun`,
   spurious `caddy.service` reload, `handle` vs bare challenge body, `127.0.0.1` vs `localhost`).

9. **DNS (deferred).** Leave `tailnetRewrites.postgres-augustus = "augustus"` in place;
   `dns.enable = false` here. The record cutover happens in [./dns-records.md](./dns-records.md).

10. **Format + check + build.** `nix run .#nixfmt -- …`, `nix flake check`,
    `nixos-rebuild build --flake .#augustus`. All must pass.

11. **Deploy as a no-op.** Every realized attribute is identical; the postgres server, its cert
    renewal (`postRun` → `postgresql-update-certs` → restart), the challenge vhost, the cert group,
    and failure-notifs are unchanged on augustus.

---

## 7. Migration checklist (condensed)

- [ ] acme-generator schema additions landed (§5: `tls.postRun`, `mkCert` emission, `postRun`-only
      no-`reloadServices`)
- [ ] Baseline captured (§4.1–§4.4 → `*.before`)
- [ ] `features/postgres/options.nix` — `services.peesequel.*` options (verbatim)
- [ ] `features/postgres/catalog.nix` — entry gated on `peesequel.enable`; `tls.ca = "internal"`,
      `acmePort = 41872`, `certGroup = "postgres-certs"`, `postRun = …`, `reloadServices = [ ]`,
      `challenge.via = "caddy80"`; **no OIDC**; `dns.enable = false`
- [ ] `features/postgres/service.nix` — server + update-certs oneshot + `postgres-certs` group +
      provision/grant + backup + `failure-notifs.attachServices` (verbatim, under `mkIf cfg.enable`)
- [ ] `features/postgres/complete.nix` — aggregates to `flake.modules.nixos.postgres`
- [ ] acme generator opted in (`managedBy.acme`); caddy generator does NOT double-emit the challenge
- [ ] hand-written cert + challenge vhost deleted; old `services/postgres.nix` removed; import name
      preserved
- [ ] New files `git add`ed
- [ ] **Parity gate green:** cert JSON diff empty incl. `postRun`, no stray `reloadServices` (§4.1);
      challenge vhost `--raw` diff empty (§4.2); group/oneshot/server/failure-notifs unchanged (§4.3);
      firewall unchanged (§4.4); disabled-host emits nothing (§4.5)
- [ ] DNS parity deferred to [./dns-records.md](./dns-records.md); `tailnetRewrites.postgres-augustus`
      removed there
- [ ] `nix run .#nixfmt`, `nix flake check`, `nixos-rebuild build --flake .#augustus` all pass
- [ ] Deployed — confirmed no-op (server, cert renewal, challenge vhost, group, failure-notifs
      unchanged)
