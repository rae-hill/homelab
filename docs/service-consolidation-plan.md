# Service Consolidation Plan — One Declaration per Service

Status: **PROPOSED**
Date: 2026-10-22

## Goal

Collapse the pieces of boilerplate every externally-reachable service repeats today —
**Caddy vhost**, **ACME cert (+ HTTP-01 challenge vhost)**, **Technitium DNS record** (on aedilis),
**Kanidm OIDC client registration** (on augustus), and the **host firewall openings** — into **one
declaration per service**, owned by that service's own feature. A single `homelab.catalog.<name>`
entry should:

1. add the correct Caddy vhost to the host that actually runs the service,
2. request the correct ACME cert (internal step-ca or public Let's Encrypt) and wire its HTTP-01
   challenge,
3. emit the correct A/AAAA (or CNAME) record into the right authoritative zone on aedilis,
4. optionally register an OIDC client in Kanidm with scope/claim maps, and
5. open the correct firewall ports on the serving host (443 + any directly-reached ACME challenge
   port), on the right interface,

all derived from one source of truth, eliminating the drift between `constants.services.*`,
`constants.dnsRecords` / `tailnetRewrites`, the per-service `caddy.nix`/`kanidm.nix`, the
hand-written `security.acme.certs.*` blocks, and the per-host `security.nix` firewall lists.

---

## 1. Current State — How the Subsystems Work Today

The repo is a **dendritic flake-parts** tree: every file under `nix-config/modules/` is auto-imported
(`inputs.import-tree`), and modules publish NixOS module functions into
`flake.modules.nixos.<name>`. Hosts (`modules/hosts/<host>.nix`) then cherry-pick the named modules
they want into `nixosSystem { modules = [ nixos.caddy nixos.planka … ]; }`. Shared facts live in
`config.constants` (`modules/constants.nix` + `modules/service-registry.nix`).

### 1.1 Service registry (`service-registry.nix`)

`config.constants.services.<name>` is the closest thing to a source of truth today. Each entry
carries an ad-hoc mix of `subdomain`, `domain` (`mkDomain subdomain`), `url` (`mkUrl subdomain`),
`clientId`, `port`, `acmePort`, `stateDir`, etc. The shape is **inconsistent** — some have
`acmePort`, some don't; some have `clientId`, some don't; `oidcEndpoint` is present on a couple.

### 1.2 Caddy (`services/caddy.nix` + per-service vhosts)

- `flake.modules.nixos.caddy` defines the base Caddy (log scrubbing, `useInternalCA` toggle for the
  step-ca ACME issuer). No vhosts.
- **Every service module** appends its own `services.caddy.virtualHosts."${svc.url}"` with a nearly
  identical `reverse_proxy localhost:<port>` body. Examples: `it-tools.nix`, `openwebui.nix`,
  `planka.nix`, `home-assistant.nix`, `grafana.nix`, `homelab-api/caddy.nix`, `homelab-ui/caddy.nix`.
- mTLS-gated vhosts (`technitium/caddy.nix`, prometheus client scrape) and ACME HTTP-01 challenge
  vhosts (`technitium-aedilis/acme.nix`) hand-roll `tls … { client_auth … }` and
  `handle /.well-known/acme-challenge/*` blocks repeatedly.
- The frontend (`homelab-ui/caddy.nix`) serves static files instead of `reverse_proxy` — a variant
  the consolidation must still support.

### 1.3 ACME (`services/acme.nix` + per-service certs)

- `flake.modules.nixos.acme` sets `security.acme` defaults and a `services.homelab-acme.defaultCA`
  enum (`internal` step-ca vs `letsencrypt`).
- Per-cert blocks (`security.acme.certs."<domain>"`) are hand-written in `kanidm.nix`,
  `postgres.nix`, `radius.nix`, `cicero-observability/acme.nix`, and `technitium-aedilis/acme.nix`,
  each repeating `listenHTTP = "127.0.0.1:${acmePort}"`, `server = …acmeDirectoryHttp`,
  `group = …`, `reloadServices = [ "caddy.service" … ]`, plus a matching `http://<domain>`
  challenge vhost.

### 1.4 Technitium DNS (`features/technitium-provisioning/*` + `constants.dnsRecords`)

- aedilis runs `services.technitium-server-complete` (generic `technitium` feature + aedilis wiring
  in `technitium-aedilis/`). The `provision.ensureDnsRecords.zones` option takes a typed, upsert-only
  (no-delete) attrset of zones → records (`technitium-provisioning/options.nix`,
  `records.nix`).
- Records are fed from `constants.dnsRecords.private`, which is generated in `service-registry.nix`
  from a **hand-maintained `tailnetRewrites` map** (`subdomain → hostKey`) plus `ts` (per-host
  tailnet IPs). **This duplicates the service list**: adding a service means editing both
  `constants.services.<name>` AND `tailnetRewrites`, and keeping the subdomain strings in sync.
- `ts` also duplicates `constants.hosts.<name>.tailscale` (with an in-file comment admitting they
  must be kept in sync).

### 1.5 Kanidm OIDC (per-service `kanidm.nix` / inline `oauth2` blocks)

- Each OIDC service appends `services.kanidm.provision.systems.oauth2."<clientId>"` with `originUrl`
  (callback), `originLanding`, `displayName`, `basicSecretFile` (or `public = true`), `scopeMaps`,
  and optional `claimMaps`. This provisioning only matters on **augustus** (the Kanidm host), but the
  blocks are physically colocated with the service (`planka.nix`, `openwebui.nix`,
  `home-assistant.nix`, `grafana.nix`) or split into a feature `kanidm.nix`
  (`homelab-api/kanidm.nix`, `technitium/kanidm.nix`).
- The callback path, scope names, and claim/group maps are the genuinely service-specific parts; the
  rest (`issuer`, `displayName`, secret file wiring) is boilerplate derivable from the service name.

### 1.6 The core problem

A single new service touches, in the worst case, **six** places that must agree on subdomain,
port, clientId, and host:

1. `constants.services.<name>` (facts)
2. a per-service `caddy.nix` vhost
3. a `security.acme.certs.*` block + challenge vhost
4. `tailnetRewrites` (so DNS resolves)
5. a `kanidm.nix` OIDC block
6. `_private/<host>/security.nix` firewall ports (443, and ACME challenge ports like aedilis's
   `22481`/`22483` on `tailscale0` — hand-copied from the `acmePort` constants)

Nothing enforces consistency between them; the only safety net is `nix flake check` catching a
missing attr. The subdomain/domain/url triple is recomputed in several styles, the DNS record
host-binding is maintained entirely separately from the module that deploys the service, and the
firewall openings drift from the ports the catalog already knows about.

---

## 2. Design — A Catalog Registry Fed by Self-Contained Service Features

The design has two layers that must not be conflated:

- **The catalog registry** — a typed option `homelab.catalog.<name>` (schema module under
  `features/homelab-service/`). It is a _registry_, not an owner: any module may contribute an entry.
  It holds **only the four cross-cutting networking facts** (vhost, cert, DNS, OIDC).
- **Per-service features** — each service is a self-contained feature directory
  (`features/<service>/`) that **owns everything about that service**: its own NixOS options, its
  runtime module (container / `services.*` block / backups), its `failure-notifs.attachServices`, and
  a one-liner that **populates its own catalog entry**. The feature is the unit a host imports.

The four generators (§2.2) read the _aggregate_ catalog and render the vhost/cert/DNS/OIDC config.
This cleanly answers "where does `failure-notifs` go": it is tied to the **service declaration** (the
systemd unit the feature defines), so it lives in the feature's runtime module — never in the catalog
schema. The catalog stays a tight, uniform networking contract; everything service-specific stays
colocated with the service.

The key property is preserved: **declare a service once** (in its feature), and the vhost lands on
its host, the cert is requested, the DNS record is emitted on aedilis, and the OIDC client is
registered on augustus — with no cross-file drift.

### 2.0 Colocated service feature layout

Each service becomes a feature directory mirroring the existing `features/<name>/` convention
(`complete.nix` aggregates sub-modules via `imports`, as `cicero-observability` and `acme-client-cert`
already do). A representative service feature:

```
features/planka/
├── options.nix     # flake.modules.nixos.planka-options — service-specific NixOS options (if any)
├── catalog.nix     # contributes `homelab.catalog.planka = { … }`  (the networking contract)
├── service.nix     # the runtime: oci-container / services.* block, restic backup,
│                   #   AND `services.failure-notifs.attachServices = [ "podman-planka" … ]`
├── oidc.nix        # (optional) service-specific OIDC scope/claim maps fed INTO the catalog entry
└── complete.nix    # flake.modules.nixos.planka = { imports = [ planka-catalog planka-service … ]; }
```

- `catalog.nix` is tiny — it sets `homelab.catalog.planka` from the service's own facts (and may read
  the service's `options.nix` values, so port/subdomain are defined once in the feature).
- `service.nix` keeps `failure-notifs.attachServices` next to the unit it names — honoring the
  reasoning that failure-notifs belong to the service declaration, not the catalog.
- `complete.nix` is what `hosts/augustus.nix` imports (`nixos.planka`). Importing the feature both
  realizes the runtime **and** registers the catalog entry; the generators (imported once per host)
  then pick it up.
- A static frontend like `homelab-ui` has no `service.nix`/`oidc.nix` — just `catalog.nix`
  (`backend.kind = "static"; root = <pkg>`) and `complete.nix`.

This makes a service feature the single, grep-able home for everything about that service, while the
catalog remains a uniform registry the generators consume.

### 2.1 The catalog entry (networking contract)

Define the catalog as a **typed `options.homelab.catalog` submodule** (decided — see §5.1). Each
service feature's `catalog.nix` contributes one entry. The submodule type makes each service's
contract self-documenting and eval-time checked, matching the quality of
`technitium-provisioning/options.nix`. Each entry:

```nix
homelab.catalog.planka = {
  subdomain = "planka";              # -> fqdn/url derived via mkDomain/mkUrl for the chosen zone
  zone = "plato-splunk.media";       # base zone (default: constants.baseDomain)
  host = "augustus";                 # which host runs it (binds the DNS record + vhost)
  backend = { kind = "reverseProxy"; port = 1337; };  # or { kind = "static"; root = <pkg>; }

  tls = {
    ca = "internal";                 # "internal" (step-ca) | "letsencrypt"
    acmePort = 41872;                # loopback HTTP-01 port (internal CA only)
    gate = "oidc";                   # "none" | "oidc" (app-handled) | "mtls" | "mtls+allowlist"
  };

  dns = {
    enable = true;                   # emit A/AAAA into the authoritative zone on aedilis
    kind = "tailnet";                # "tailnet" (A/AAAA from host) | "cname" | "public"
  };

  oidc = {
    enable = true;
    clientId = "planka";             # defaults to <name>
    public = false;                  # public (PKCE, no secret) vs basic (secretFile)
    callbackPath = "/oidc-callback";
    landingPath = "/";
    displayName = "Planka";
    secretRef = "planka_client_secret";  # sops secret name (basic clients)
    scopeMaps = { "planka.access" = [ "openid" "email" "profile" ]; };
    claimMaps = { … };               # passed through verbatim
  };
};
```

Everything else (`fqdn`, `url`, `insecureUrl`, `oidcEndpoint`, DNS target IPs) is **derived**, not
restated. `fqdn`/`url` are built as `<subdomain>.<zone>` so the same declaration works for any future
zone (`zone` defaults to `constants.baseDomain`, i.e. `plato-splunk.media`). `host` resolves its
tailnet IPs from `constants.hosts.<host>.tailscale` — removing the `ts` / `tailnetRewrites`
duplication entirely.

### 2.2 Generator modules, one declaration

The declaration is consumed by small, independent generator modules. Each reads the catalog and
contributes to exactly one subsystem. A host imports only the generators relevant to its role and
platform. The **Caddy** concern must also work on the **nix-darwin** host (`mini`, which fronts
Jellyfin with Caddy), but — as verified below (§2.2a) — nix-darwin has **no `services.caddy` and no
`security.acme` module**, so the Caddy concern has two rendering backends (NixOS → `services.caddy`;
darwin → Caddyfile text) while **ACME is NixOS-only** (on darwin, Caddy does ACME natively). DNS,
OIDC, and firewall are NixOS-only (they target the Linux hosts):

| Generator module           | Class(es) | Imported by   | Emits                                                                   |
| -------------------------- | --------- | ------------- | ----------------------------------------------------------------------- |
| `homelab-service-caddy`    | `nixos`   | each app host | `services.caddy.virtualHosts` for services where `host == this host`    |
| `homelab-service-caddy`    | `darwin`  | `mini`        | Caddyfile site-blocks fragment for services where `host == mini`        |
| `homelab-service-acme`     | `nixos`   | each app host | `security.acme.certs.*` + HTTP-01 challenge vhost for local services    |
| `homelab-service-firewall` | `nixos`   | each app host | `networking.firewall.*` openings for local services (§2.7)              |
| `homelab-service-dns`      | `nixos`   | aedilis       | `…provision.ensureDnsRecords.zones` entries for all `dns.enable` svcs   |
| `homelab-service-oidc`     | `nixos`   | augustus      | `services.kanidm.provision.systems.oauth2.*` for all `oidc.enable` svcs |

Critically, the **Caddy/ACME** generators filter on `host == config.networking.hostName` so a service
declared once only materializes its vhost/cert on the host that runs it. The **DNS** generator runs
only on aedilis and emits records for _every_ service regardless of host (that's the whole point of
central DNS) — including services hosted on `mini`, so a darwin-hosted service still gets a DNS record
from the Linux DNS host. The **OIDC** generator runs only on augustus (the Kanidm host).

This keeps the "write once" property while respecting that DNS and OIDC are centralized on specific
hosts — the declaration lives with the catalog, not the host, and each host picks up its slice.

### 2.2a Cross-platform Caddy/ACME: two rendering backends, one catalog

**Verified against the vendored `repos/nix-darwin` (pinned to `nix-darwin-26.05`, matching
`flake.lock`):** nix-darwin has **no `security.acme` module and no `services.caddy` module**. Its
`security.*` surface is only `pki` (trust store — `security.pki.certificateFiles`), `pam`, `sandbox`,
and `sudo`. So the original "one shared module emits identical `services.caddy.virtualHosts` /
`security.acme.certs` on both platforms" idea does **not** hold. How `mini` works today:

- Caddy runs as a **`launchd.daemons.caddy`** invoking `pkgs.caddy` against a hand-written
  **Caddyfile** in `environment.etc."caddy_nix/Caddyfile"`.
- **ACME is Caddy-native**: the Caddyfile global block sets `acme_ca =
  https://ca.plato-splunk.media/acme/http/directory` + `acme_ca_root`, so Caddy fetches/renews certs
  itself. There is **no** `security.acme`, no HTTP-01 challenge vhost, and no loopback `acmePort` on
  darwin.
- Trust is via `security.pki.certificateFiles` (the step-ca root) — present on darwin, so `mini`
  already trusts step-ca.

The correct design is therefore **one catalog with two rendering backends** that share the vhost-body
semantics but target different config surfaces:

| Concern     | NixOS backend                                   | darwin backend                                            |
| ----------- | ----------------------------------------------- | --------------------------------------------------------- |
| vhost       | `services.caddy.virtualHosts.<url>.extraConfig` | a Caddyfile **site block** appended to the mini Caddyfile |
| TLS / ACME  | `security.acme.certs.*` + `:80` challenge vhost | Caddy-native (global `acme_ca`); **no** `security.acme`   |
| cert reload | `reloadServices = [ "caddy.service" ]`          | launchd daemon (Caddy reloads itself; n/a)                |
| trust root  | `security.pki.certificateFiles`                 | `security.pki.certificateFiles` (same)                    |

Concretely:

- The **vhost-body renderer** (the `reverse_proxy` / `file_server` / mTLS block from §2.3) is a pure
  string function reused by both backends — that's the genuinely shared code.
- The **NixOS backend** (`homelab-service-caddy` / `-acme`, class `nixos`) wraps the body in
  `services.caddy.virtualHosts` and emits the matching `security.acme.certs` + challenge vhost
  (§2.4).
- The **darwin backend** (`homelab-service-caddy`, class `darwin`) folds each local service's body
  into the mini Caddyfile text (the catalog supersedes today's hand-written
  `environment.etc."caddy_nix/Caddyfile"`), and contributes **nothing** for ACME — Caddy's global
  `acme_ca` already handles issuance. There is **no** darwin ACME generator.
- **`networking.hostName`** exists on both platforms, so the `host ==` filter is portable.
- Keep the darwin surface **strictly Caddy (Caddyfile) + trust** — no `security.acme`, no DNS, no
  OIDC, no restic, no failure-notifs (those are Linux/augustus/aedilis concerns), per the
  requirement. Because darwin ACME is Caddy-native, `tls.acmePort` / `tls.challenge` are simply
  **ignored** by the darwin backend.

> Open design choice (not a blocker): either (a) generate the whole mini Caddyfile from the catalog,
> or (b) generate only a site-blocks fragment that the existing Caddyfile `import`s. (b) is less
> invasive for the global options (`acme_ca`, metrics, logging) that are mini-specific; recommend (b).

### 2.3 Caddy vhost generation

A helper renders the vhost body from `backend` + `tls.gate`:

- `backend.kind == "reverseProxy"` → `reverse_proxy 127.0.0.1:<port>` (+ optional tracing span when
  `services.tempo.enable`, matching today's `homelab-api/caddy.nix`).
- `backend.kind == "static"` → `root * <pkg>` + `file_server` (frontend case).
- `tls.gate == "mtls"` → wrap with the `tls … { client_auth { mode require_and_verify; trust_pool
  file { pem_file <ca.rootCert> } } }` block (factor out today's `technitium/caddy.nix`).
- `tls.gate == "oidc"` / `"none"` → no Caddy-level auth (app handles OIDC; today every "OIDC" service
  is actually app-gated, so this is just documentation + no extra config).
- Explicit cert naming: each vhost references its ACME cert via `tls <fullchain> <key>` when not using
  the global issuer, mirroring the current explicit-cert convention.

A `extraCaddyConfig` escape hatch (free-form string appended to the vhost) covers the handful of
bespoke cases (metrics allowlists, redirect handling) without forcing everything into options.

### 2.4 ACME cert generation

For `tls.ca == "internal"`, emit:

```nix
security.acme.certs."<domain>" = {
  domain = <domain>;
  listenHTTP = "127.0.0.1:${toString tls.acmePort}";
  server = constants.ca.acmeDirectoryHttp;
  group = <certGroup>;              # per-service cert group (see below)
  reloadServices = [ "caddy.service" ] ++ extraReloads;
};
```

plus the matching `http://<domain>` challenge vhost
(`handle /.well-known/acme-challenge/* { reverse_proxy 127.0.0.1:<acmePort> }`). For
`tls.ca == "letsencrypt"`, swap `server` to the LE directory and allow per-cert `email`/`group`
overrides (the aedilis public DNS cert is the one real example).

**Most vhosts need no explicit cert at all.** Today's `localhost` reverse-proxy services share
Caddy's managed cert and never name one — so the common case is `tls.ca = null` (or simply omitting
`acmePort`), which skips `security.acme.certs` creation entirely. The ACME generator only fires for
services that genuinely terminate their **own** manual TLS cert — in practice **Kanidm** (which binds
its own `:8443` and needs the step-ca cert directly), **postgres**, **radius**, and the aedilis
Technitium vhosts. Per **decision §5.1 #6**, those keep a **per-service cert group** (the current
convention), not a shared group — the blast radius of a leaked/readable cert stays scoped to the one
service that owns it.

### 2.5 DNS record generation (aedilis)

Replace the hand-maintained `tailnetRewrites` with a fold over the catalog, **grouped by each
service's `zone`** so multiple authoritative zones are supported from one pass:

```nix
# on aedilis only — group dns-enabled services by their declared `zone`, then
# fold each group into that zone's record list.
services.technitium-server-complete.provision.ensureDnsRecords.zones =
  mapAttrs
    (zoneName: svcs: {
      type = "Primary";
      records = concatMap mkRecordsFor svcs;
    })
    (groupBy (s: s.zone) (filter (s: s.dns.enable) catalogServices));
```

where `mkRecordsFor` emits `A`/`AAAA` from `constants.hosts.<svc.host>.tailscale.{v4,v6}` for
`kind == "tailnet"`, a `CNAME` for `kind == "cname"`, or public IPs for `kind == "public"`. The
existing `nasRecords` + `publicEndpointRecords` (non-service outliers) stay as explicit extras merged
into the matching zone. This deletes the `ts` table and the `tailnetRewrites` map, makes "which host
serves this name" a property of the single service declaration, and means a brand-new zone needs no
DNS-side change beyond services declaring `zone = "other.example";` — the generator creates the
Primary zone and populates it automatically.

> Keep the upsert-only (no-delete) guarantee of the existing provisioning feature — this plan only
> changes _how the record list is produced_, not the provisioning mechanism. Non-`plato-splunk.media`
> zones follow the same upsert semantics.

### 2.6 OIDC client generation (augustus)

A fold over `oidc.enable` services producing `services.kanidm.provision.systems.oauth2.<clientId>`:

- derive `originUrl = "${svc.url}${callbackPath}"`, `originLanding = "${svc.url}${landingPath}"`,
  `displayName`, and either `public = true` or `basicSecretFile =
  config.sops.secrets.<secretRef>.path`;
- pass `scopeMaps` / `claimMaps` through verbatim (these are irreducibly service-specific);
- support multiple callback URLs (the `homelab` public client lists two) via `callbackPath` being a
  list.

The sops secret itself still lives in the host's sops config; the generator only references it by
name. This is the one subsystem where the per-service payload stays substantial, but the issuer,
landing, and secret-wiring boilerplate collapses.

### 2.7 Firewall coordination

The firewall is worth coordinating, but it requires separating two concerns that the request
conflated — only one of which `networking.firewall` can actually enforce:

- **Inbound openings (enforceable here, in scope).** Which ports a host _accepts_ and on which
  interface. This is pure `networking.firewall` and is fully derivable from the catalog.
- **The reachability matrix ("which hosts may I reach, over which ports").** That is _egress / peer
  authorization_, which on a tailnet is expressed by **Tailscale ACL grants**, not
  `networking.firewall` (a NixOS host firewall is inbound-only; it cannot say "augustus may reach
  cicero:443"). This repo does **not** manage the tailnet ACL today — it lives in the Tailscale admin
  console. So the matrix can be _declared as intent_ in the catalog and used to **generate the
  inbound half** on each target host, but enforcing the egress half would require also owning the
  Tailscale policy file (a separate, larger effort — see §5.2).

#### What's enforceable now: inbound openings from the catalog

Today each `_private/<host>/security.nix` hand-lists ports, and these already drift from the catalog.
Two concrete examples the generator would own:

- **`443`** — nearly every service's vhost. Rather than repeat it, a host that realizes _any_
  `backend`-serving catalog entry opens 443 once (on the appropriate interface — see below).
- **ACME HTTP-01 challenge ports.** This is the subtle one. The `acmePort` (`listenHTTP =
  127.0.0.1:<acmePort>`) is **loopback-only and needs no firewall opening** when the challenge is
  fronted by Caddy on port 80 (the augustus/cicero model: open `80`, Caddy proxies
  `/.well-known/acme-challenge/*` → loopback `acmePort`). But **aedilis is different**: it opens
  `22481` and `22483` directly on `tailscale0` because those are internal step-ca certs for
  **tailnet-only domains**, and step-ca (on cicero) reaches the challenge listener _over Tailscale_ on
  that port. These two tailnet port openings are exactly the `acmePort` values from the catalog,
  hand-copied into `security.nix` today — prime candidates for generation.

The generator therefore needs each catalog entry's `tls` block to carry enough to decide **whether**
and **on which interface** a port must open:

```nix
tls = {
  ca = "internal";            # internal | letsencrypt
  acmePort = 22481;
  challenge = {
    # how the HTTP-01 challenge is reached:
    #   "caddy80"   -> loopback acmePort, Caddy fronts :80 (no acmePort opening)
    #   "direct"    -> ACME server connects straight to acmePort (needs an opening)
    via = "direct";
    # which interface the opening (if any) lives on:
    #   "public"    -> networking.firewall.allowedTCPPorts
    #   "tailscale0"-> networking.firewall.interfaces.tailscale0.allowedTCPPorts
    iface = "tailscale0";
  };
  gate = "oidc";
};
```

From that, `homelab-service-firewall` (NixOS-only; darwin firewall is out of scope and `mini` keeps
its hand-written rules for now) folds all catalog entries where `host == this host` into:

- `allowedTCPPorts` / `interfaces.<iface>.allowedTCPPorts` for 443 + any `challenge.via == "direct"`
  acmePort, on the declared `iface`;
- leaving loopback-only (`caddy80`) acmePorts out entirely.

Baseline per-host ports that are **not** service-derived (SSH `22`, the tailscale metrics exporter
`5252`, Technitium's `53/80/443/853`, radius `1812/1813`) stay as explicit host config — the
generator only owns the **service-attributable** openings so the host files shrink to genuinely
host-specific rules.

#### Declaring the reachability matrix (intent) + praeconinus

To capture the "which hosts may reach me, over which ports" intent the request describes, add an
optional per-entry `access` field expressing the _allowed source scope_ of the service:

```nix
access = {
  scope = "tailnet";          # "public" | "tailnet" | "host-list" | "none"
  # when scope == "host-list", the specific peer hosts permitted to reach it:
  fromHosts = [ "augustus" ]; # e.g. only augustus's Prometheus may scrape cicero metrics
};
```

- `scope` drives the **interface** of the inbound opening (`public` → public interface; `tailnet`/
  `host-list` → `tailscale0`), which the firewall generator _can_ enforce today.
- `fromHosts` is the **declared intent** for the tailnet ACL. This repo does **not** manage any
  tailnet ACL today and will **not** adopt the Tailscale SaaS policy file; the long-term home is a
  self-hosted **headscale** DERP server with declarative HuJSON ACLs (§5.2 #4). Until then `fromHosts`
  is captured as intent only — optionally rendered into a reviewed reference table — and is not
  auto-applied. When headscale lands, the same `fromHosts` data generates the real grants with no
  re-declaration.
- **praeconinus falls out naturally.** It serves only via **Tailscale Funnel** and should not reach —
  or be reached by — other tailnet devices. Its catalog entries set `access.scope = "public"` (Funnel
  ingress) with **no `fromHosts`**, and it imports the firewall generator but **no DNS/OIDC**
  generators. The result is exactly what the request asked for: praeconinus lists _nothing_ in the
  peer-reachability matrix, and its firewall opens only what Funnel needs — no tailnet peer ports at
  all. Its restricted vhost overrides (base-path rewrites) use the `extraCaddyConfig` escape hatch
  from §2.3.

This keeps the enforceable part (inbound openings) fully declarative and catalog-driven now, while
modeling the egress matrix as first-class intent that becomes enforceable when the self-hosted
headscale DERP server (with declarative ACLs) lands — without changing any service declaration.

The refactor must land without a flag-day rewrite of every service. Proposed order:

1. **Introduce the catalog schema** (`features/homelab-service/options.nix`) with no behavior, plus
   the generators behind an internal per-service opt-in (e.g. `catalog.<name>.managedBy.caddy = true`)
   so services migrate one at a time. Caddy/ACME generators are registered in both nixos + darwin
   classes.
2. **Reshape one service into a colocated feature end-to-end** as the reference pattern. Pick a
   simple one (`it-tools`): split today's single `services/it-tools.nix` into
   `features/it-tools/{catalog,service,complete}.nix`, move its container + `failure-notifs` into
   `service.nix`, add its `catalog.nix` entry, flip its `managedBy.*` opt-ins, and delete the
   hand-written vhost. Verify `nix eval` of the rendered `virtualHosts` is equivalent to before.
3. **Migrate remaining simple services** (`openwebui`, `grafana`, `home-assistant`) the same way,
   moving each service's OIDC scope/claim maps into its feature's `catalog.nix`/`oidc.nix`. Confirm
   `oauth2` attrs are equivalent.
4. **Migrate cert-terminating services** (`kanidm`, `postgres`, `radius`, aedilis technitium) to the
   ACME generator; confirm `security.acme.certs.*` and challenge vhosts match.
5. **Add the firewall generator** and migrate the service-attributable openings (443 + aedilis's
   `22481`/`22483` tailnet ACME ports). Diff `networking.firewall` per host before/after; the
   service-derived ports should match what's hand-listed today, leaving only baseline host ports
   (SSH, metrics, radius, Technitium 53/80/443/853) in `_private/<host>/security.nix`. Render the
   `access.fromHosts` intent as a reference table only (no auto-apply; reserved for future headscale).
6. **Flip DNS**: generate `ensureDnsRecords.zones` from the catalog on aedilis, diff against the
   current `constants.dnsRecords.private`, and only then delete `ts` + `tailnetRewrites`.
7. **Retire `constants.services.*`** once every feature declares its own catalog entry, or keep it as
   a thin derived view for any remaining consumer during the transition.

Each step is independently buildable and testable with `nix eval`/`nix build` per host, so the tree
never enters a broken state. The `mini` darwin feature (Jellyfin → Caddyfile only, no ACME generator)
can be migrated alongside step 2–4 to exercise the darwin Caddyfile backend early.

---

## 4. Validation

Per `.kiro/steering/validation.md`:

- **Stage new files before any Nix check** (`git add`) — flake eval reads the git tree, and untracked
  new `.nix` files are invisible (`import-tree` won't load them).
- Parity checks during migration: `nix eval
  .#nixosConfigurations.<host>.config.services.caddy.virtualHosts --json` (and the analogous
  `security.acme.certs`, `services.kanidm.provision.systems.oauth2`, and
  `services.technitium-server-complete.provision.ensureDnsRecords.zones`) **before and after** each
  service migration; the diff should be empty or an intentional, reviewed change. For `mini` (darwin),
  there is no `services.caddy`/`security.acme` to eval — instead diff the generated Caddyfile text
  (`nix eval .#darwinConfigurations.mini.config.environment.etc."caddy_nix/Caddyfile".text --raw`)
  against the current hand-written one.
- `nix run .#nixfmt -- $(git ls-files '*.nix' ':!:repos/**')` and `nix flake check` after each step.
- Any new shell (unlikely here) must go through `constants.shell.mkScript` and the shellcheck gate.
- Full per-host build: `nixos-rebuild build --flake .#augustus` / `.#aedilis` / `.#praeconinus`, and
  `darwin-rebuild build --flake .#mini` for the darwin Caddyfile path, before deploying.

---

## 5. Decisions & Open Questions

### 5.1 Decided

1. **Typed submodule (not a `constants` attr).** The catalog is a proper
   `options.homelab.catalog = mkOption { type = attrsOf (submodule { … }); }`. It is a **registry**
   contributed to by each service's own feature (`features/<service>/catalog.nix`), not an
   independently-owned table. This gives eval-time type checking and self-documenting option
   descriptions, matching `technitium-provisioning/options.nix`.
2. **Colocated service features own everything service-specific.** Each service is a self-contained
   feature directory (§2.0) that holds its options, runtime module, backups, `failure-notifs`, and a
   one-liner populating its catalog entry. The catalog schema holds **only** the cross-cutting
   networking facts (vhost / cert / DNS / OIDC / firewall). This resolves the earlier open question
   about `failure-notifs`: it is tied to the **service declaration** (the systemd unit the feature
   defines), so it stays in the feature's runtime module — never in the catalog. The feature is the
   single grep-able home for a service; importing it both realizes the runtime and registers the
   catalog entry.
3. **Per-service `zone` option.** Each entry carries `zone` (default `constants.baseDomain =
   "plato-splunk.media"`). `fqdn`/`url` derive from `<subdomain>.<zone>`, and the DNS generator groups
   records by zone and creates each Primary zone on demand (§2.5). Adding a second base domain later
   requires no structural change — services just set `zone`.
4. **Darwin: Caddy only, via a separate Caddyfile backend (no `security.acme`).** Verified against the
   vendored `repos/nix-darwin` (`nix-darwin-26.05`): nix-darwin has **no `services.caddy` and no
   `security.acme` module** (only `security.pki` for trust). `mini` runs Caddy as a `launchd.daemons`
   unit against a hand-written Caddyfile, and ACME is **Caddy-native** (global `acme_ca` → step-ca).
   So the Caddy concern has **two rendering backends** sharing one vhost-body renderer: NixOS emits
   `services.caddy.virtualHosts`; darwin emits a Caddyfile site-blocks fragment (§2.2a). **ACME is
   NixOS-only** — the darwin backend emits no cert config and ignores `tls.acmePort`/`tls.challenge`.
   The darwin surface stays strictly Caddy + trust (via `security.pki.certificateFiles`, already
   present) — no DNS/OIDC/restic/failure-notifs. A mini-hosted service still gets its DNS record from
   aedilis because the DNS generator folds the whole catalog regardless of platform.
5. **Firewall: generate inbound openings, model egress as intent.** The catalog drives
   `networking.firewall` inbound openings per host (443 + `challenge.via == "direct"` ACME ports, on
   the interface the entry's `access.scope`/`tls.challenge.iface` selects) — eliminating the
   hand-copied `acmePort` firewall drift (§2.7). The host-firewall is inbound-only, so the
   "which hosts may I reach" matrix is modeled as declarative **intent** (`access.fromHosts`) captured
   for a future self-hosted headscale DERP server's declarative ACLs (not auto-applied now).
   praeconinus declares no peer reachability (Funnel-only) and imports no DNS/OIDC generators, so it
   lists _nothing_ in the matrix — exactly as desired.
6. **Per-service cert groups (not a shared group).** Only services that terminate their **own** manual
   TLS cert (Kanidm's `:8443`, postgres, radius, aedilis Technitium) get a `security.acme.certs` entry
   at all; each keeps its **own** cert group (the current convention) so a readable/leaked cert's blast
   radius stays scoped to that one service. The common reverse-proxy service names **no** cert and
   shares Caddy's managed cert (`tls.ca = null`). There is no shared `service-certs` group (§2.4).
7. **Baseline (non-service) firewall ports stay explicit.** SSH `22`, TS metrics/webclient `5252`,
   radius `1812/1813`, and Technitium's `53/80/443/853` are host-level infrastructure, not
   service-attributable. They remain hand-listed in `_private/<host>/security.nix`; the firewall
   generator owns only the service-derived openings, keeping its scope auditable.

### 5.2 Open

1. **praeconinus (restricted deployment) — the `:8443` vhost explained.** Investigated: praeconinus
   serves the homelab UI+API over **Tailscale Funnel** at `praeconinus.neko-bicolor.ts.net`, but Caddy
   binds **`:8443`**, not `:443` (`_private/praeconinus/programs.nix`). The reason is Funnel semantics,
   not a local port clash with another app: with `services.tailscale` + Funnel enabled (and
   `TS_PERMIT_CERT_UID = "caddy"` so Caddy can use the Tailscale cert), **tailscaled** terminates
   public TLS and occupies the node's `:443` for Funnel ingress, forwarding to a local Caddy. `8443`
   is chosen because it is one of **Funnel's three permitted ports (443 / 8443 / 10000)**. Note the
   firewall does **not** open `8443` — Funnel traffic reaches Caddy via tailscaled (loopback), not
   through an external-interface firewall rule. Implications for the catalog: a Funnel-fronted service
   needs a `backend`/vhost **listen port** distinct from the standard 443 (model as e.g.
   `access.scope = "funnel"` with an implied `:8443` listen), plus the `extraCaddyConfig` escape hatch
   for its base-path rewrites (`/api`, `/ui`). The old `praeconinus-host-plan.md` still documents the
   original `:443` design — it is stale; the live config is `:8443`.
2. **Per-host import wiring.** Each host must import exactly the generators for its role/platform
   (augustus: all nixos; aedilis: +dns; app hosts: caddy/acme/firewall; mini: darwin caddy only;
   praeconinus: caddy/firewall, no dns/oidc). This is mechanical but worth a short checklist in the
   implementation PR so a host doesn't silently miss a generator.

> Resolved during planning (see §5.1): typed submodule (#1), colocated features incl. failure-notifs
> (#2), per-service `zone` (#3), darwin Caddy-only via Caddyfile backend with no `security.acme` (#4,
> verified against vendored nix-darwin), firewall inbound-generation + egress-as-intent (#5),
> per-service cert groups only for manual-TLS services like Kanidm (#6), baseline infra ports stay
> explicit (#7). The egress/peer matrix is **deferred** to a future self-hosted **headscale** DERP
> server with declarative HuJSON ACLs — `access.fromHosts` is captured as intent now and feeds that
> later with no re-declaration; no Tailscale SaaS policy file is brought in-repo.

---

## 6. Expected Outcome

After migration, adding a new externally-reachable service is a single declaration:

```nix
homelab.catalog.myapp = {
  subdomain = "myapp";
  zone = "plato-splunk.media";       # default; set to another base domain to move zones
  host = "augustus";
  backend = { kind = "reverseProxy"; port = 1234; };
  tls = {
    ca = "internal";
    acmePort = 22490;
    challenge = { via = "caddy80"; };  # loopback challenge; no firewall opening needed
    gate = "oidc";
  };
  access.scope = "tailnet";            # reachable over tailscale0; opens 443 there
  dns.enable = true;
  oidc = {
    enable = true;
    callbackPath = "/oidc/callback";
    displayName = "My App";
    secretRef = "myapp_client_secret";
    scopeMaps."myapp.access" = [ "openid" "email" "profile" ];
  };
};
```

…which automatically yields: the Caddy vhost + ACME cert on augustus, the `443` firewall opening on
`tailscale0`, the `myapp.plato-splunk.media` A/AAAA record on aedilis pointing at augustus's tailnet
IP, and the Kanidm OIDC client on augustus — with no possibility of subdomain / port / host / open-port
drift between the subsystems. The service's own feature module shrinks to just its container/service
definition, backups, and `failure-notifs`. A service needing a directly-reached tailnet ACME
challenge (aedilis's internal step-ca certs) sets `tls.challenge = { via = "direct"; iface =
"tailscale0"; }` and the firewall generator opens that `acmePort` on `tailscale0` automatically —
replacing today's hand-copied `22481`/`22483`.
