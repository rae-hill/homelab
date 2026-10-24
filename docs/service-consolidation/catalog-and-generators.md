# `features/homelab-service/` — Catalog Schema + Generators

Status: **PROPOSED** · Keystone module plan for the
[service consolidation plan](../service-consolidation-plan.md) · Index:
[README](./README.md)

This is the **keystone** plan. It defines the new `features/homelab-service/` feature: the typed
`options.homelab.catalog.<name>` submodule schema (§2) and the **five generator modules** (§3) that
read the aggregate catalog and render the Caddy vhost, ACME cert, firewall opening, DNS record, and
OIDC client — on exactly the host(s) each concern belongs to. Every other per-module plan in this
directory migrates one real module onto the schema and generators defined here.

The overriding constraint is **operational equivalence** (see [README](./README.md)): deploying this
module (and each migration onto it) must be a theoretical no-op. The catalog changes _where_
configuration is declared, never _what_ is realized. §5 gives the `nix eval` parity gates that prove
it.

---

## 1. Module layout & dendritic wiring

The feature mirrors the existing `features/<name>/` convention — a `complete.nix` aggregator that
`imports` sibling modules, each publishing a `flake.modules.nixos.<name>` /
`flake.modules.darwin.<name>` function (as `features/technitium/complete.nix` and
`features/cicero-observability/complete.nix` already do):

```
features/homelab-service/
├── options.nix          # flake.modules.nixos.homelab-catalog-options
│                        #   AND flake.modules.darwin.homelab-catalog-options
│                        #   — defines options.homelab.catalog (schema only, no config)
├── lib.nix              # pure helpers published as config.constants.catalogLib
│                        #   (renderVhostBody, deriveUrl, …) — no module output
├── caddy-nixos.nix      # flake.modules.nixos.homelab-service-caddy
├── caddy-darwin.nix     # flake.modules.darwin.homelab-service-caddy
├── acme.nix             # flake.modules.nixos.homelab-service-acme
├── firewall.nix         # flake.modules.nixos.homelab-service-firewall
├── dns.nix              # flake.modules.nixos.homelab-service-dns
├── oidc.nix             # flake.modules.nixos.homelab-service-oidc
└── complete.nix         # aggregators (see below)
```

`options.nix` must be imported by **every** host (both platforms) so `homelab.catalog` exists
everywhere an entry might be contributed or read. The generators are imported à la carte per host
role/platform. Rather than one `complete.nix`, publish small role aggregators so a host picks up the
right slice with one import:

```nix
# features/homelab-service/complete.nix
{ inputs, ... }:
{
  # Schema only — imported by every host (nixos + darwin). Defines the option, no config.
  flake.modules.nixos.homelab-catalog = {
    imports = [ inputs.self.modules.nixos.homelab-catalog-options ];
  };
  flake.modules.darwin.homelab-catalog = {
    imports = [ inputs.self.modules.darwin.homelab-catalog-options ];
  };

  # An ordinary Linux app host (augustus, cicero, praeconinus): vhost + cert + firewall.
  flake.modules.nixos.homelab-service-apphost = {
    imports = with inputs.self.modules.nixos; [
      homelab-catalog
      homelab-service-caddy
      homelab-service-acme
      homelab-service-firewall
    ];
  };

  # aedilis additionally owns DNS; augustus additionally owns OIDC. Compose on top of apphost.
  flake.modules.nixos.homelab-service-dns-host = {
    imports = with inputs.self.modules.nixos; [ homelab-service-apphost homelab-service-dns ];
  };
  flake.modules.nixos.homelab-service-oidc-host = {
    imports = with inputs.self.modules.nixos; [ homelab-service-apphost homelab-service-oidc ];
  };

  # mini (darwin): Caddyfile backend + trust only. No acme/dns/oidc/firewall.
  flake.modules.darwin.homelab-service-apphost = {
    imports = with inputs.self.modules.darwin; [ homelab-catalog homelab-service-caddy ];
  };
}
```

Per-host import matrix (resolves open question §5.2 #2 of the parent plan):

| Host          | Class    | Imports                                                              |
| ------------- | -------- | -------------------------------------------------------------------- |
| `augustus`    | `nixos`  | `homelab-service-oidc-host` (caddy + acme + firewall + **oidc**)     |
| `aedilis`     | `nixos`  | `homelab-service-dns-host` (caddy + acme + firewall + **dns**)       |
| `cicero`      | `nixos`  | `homelab-service-apphost` (caddy + acme + firewall)                  |
| `praeconinus` | `nixos`  | `homelab-service-apphost` (caddy + acme + firewall; **no** dns/oidc) |
| `mini`        | `darwin` | `homelab-service-apphost` (darwin: Caddyfile only)                   |

> Only `aedilis` imports the DNS generator and only `augustus` imports the OIDC generator, yet both
> fold the **entire** catalog (every host's services) — that is the point of centralized DNS/OIDC.
> The caddy/acme/firewall generators filter to `host == networking.hostName`, so a service declared
> once only materializes its vhost/cert/firewall on the host that actually runs it.

### Service features contribute entries

Each service feature's `catalog.nix` sets one `homelab.catalog.<name>` entry (parent plan §2.0). The
module merge means _any_ imported module may contribute; the generators read the aggregate. Example
(the `it-tools` reference migration):

```nix
# features/it-tools/catalog.nix
{ config, ... }:
let svc = config.constants.services.it-tools; # during transition; later inline
in {
  flake.modules.nixos.it-tools-catalog = { ... }: {
    homelab.catalog.it-tools = {
      subdomain = "dev-tools";
      host = "augustus";
      backend.reverseProxy.port = svc.port;
      tls.cert.shared = { }; # shares Caddy's managed cert; no security.acme.certs entry
      access.scope.tailnet = { };
      dns.tailnet = { };
    };
  };
}
```

---

## 2. The catalog submodule schema (`options.nix`)

Defined as a typed `attrsOf (submodule …)`, matching the quality of
`technitium-provisioning/options.nix` (every field typed, defaulted where sensible, described). The
submodule has access to `config.constants` for defaults (`zone`, interface selection) via the module
arg. `host` is typed as an **enum of the real host names** so a typo is an eval error, and the DNS
generator can resolve `constants.hosts.<host>.tailscale` safely.

### 2.0 Schema style — `attrTag` discriminated unions (NOT enum + booleans)

Every field that is really a **"variant with per-variant data"** is modeled as a
[`types.attrTag`](https://nixos.org/manual/nixos/stable/#sec-option-types-attribute-tagged-union)
(available in nixpkgs ≥ 24.11; confirmed present in the pinned `nixos-26.05`). An `attrTag` value is
a **one-key attrset** `{ <tag> = { …payload… }; }` carrying exactly one tag, and the type system —
**not** prose "Required when …" descriptions — enforces which fields are legal for each variant.

This replaces the earlier enum + sibling-nullable-field design. The win is that **illegal states
become unrepresentable** and no "required when X" documentation is needed:

| Concern              | ❌ old (enum + booleans/nullables)                               | ✅ new (`attrTag`)                                                                     |
| -------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `backend`            | `kind = enum; port = nullOr; root = nullOr`                      | `{ reverseProxy.port } \| { static.root } \| { none } \| { raw }`                      |
| `tls.cert`           | `ca = nullOr enum` + sibling `acmePort`, `certGroup`, `reload*`… | `{ shared } \| { own = { ca; acmePort; certGroup; reload*; postRun; challenge } }`     |
| `tls.gate`           | `gate = enum` + sibling `mtlsTrustPoolFile = nullOr`             | `{ none } \| { oidc } \| { mtls.trustPoolFile } \| { mtlsAllowlist.trustPoolFile }`    |
| `tls…challenge.body` | `body = enum` + sibling `redirectToHttps`                        | `{ handle.redirectToHttps } \| { bare }`                                               |
| `access.scope`       | `scope = enum` + sibling `fromHosts`                             | `{ public } \| { tailnet } \| { hostList.fromHosts } \| { funnel } \| { none }`        |
| `dns`                | `enable = bool; kind = enum` + sibling `cnameTarget`/`publicV*`  | `nullOr ({ tailnet } \| { cname.target } \| { public = { v4; v6 } })` — `null` = none  |
| `oidc`               | `enable = bool; public = bool` + sibling `secretRef = nullOr`    | `nullOr (submodule { client = { public } \| { basic.secretRef }; … })` — `null` = none |

Consequences baked into the schema:

- A `reverseProxy` backend **cannot** carry a `root`; a `static` backend **cannot** carry a `port`.
- A **shared-cert** service has no `acmePort`/`certGroup`/`challenge` fields at all; only `{ own = …
  }` exposes them, and `acmePort`/`certGroup` are **required** inside `own` (no nullable sentinels).
- An **mTLS** gate must carry a `trustPoolFile`; a non-mTLS gate cannot.
- `dns = null` / `oidc = null` mean "no DNS record" / "no OIDC client" — the old `enable` booleans
  are gone. Setting `dns.tailnet = { }` or `oidc = { … }` opts in.

Generators read an `attrTag` via two tiny helpers published on `constants.catalogLib` (§3.1):
`tagOf v = head (attrNames v)` (the active tag) and `payloadOf v = v.${tagOf v}` (its payload). The
`oidc` client-id default (entry name) is resolved **in the OIDC generator** (`o.clientId or name`),
not in the submodule `config`, to avoid a self-referential `nullOr` (`config.oidc` read while
defining `config.oidc`).

```nix
{ config, ... }@topLevel:
{
  flake.modules.nixos.homelab-catalog-options = { lib, ... }: sharedSchema lib;
  flake.modules.darwin.homelab-catalog-options = { lib, ... }: sharedSchema lib;
}
```

where `sharedSchema` is the single schema definition reused by both classes (the submodule type is
platform-independent; only the generators differ). The authoritative source is
`nix-config/modules/features/homelab-service/options.nix`; the abridged shape below shows the
`attrTag` variants (full field descriptions live in the file):

```nix
sharedSchema = lib:
  let
    inherit (lib) mkOption types;
    c = topLevel.config.constants;
    hostNames = lib.attrNames c.hosts;             # ["augustus" "aedilis" "cicero" …]

    # backend: exactly one of the four shapes.
    backendType = types.attrTag {
      reverseProxy = mkOption { type = types.submodule { options.port = mkOption { type = types.port; }; }; };
      static       = mkOption { type = types.submodule { options.root = mkOption { type = types.path; }; }; };
      none         = mkOption { type = types.submodule { options = { }; }; };
      raw          = mkOption { type = types.submodule { options = { }; }; };
    };

    # tls.cert: shared (Caddy-managed) vs own (security.acme.certs.<fqdn>). ALL cert-only
    # fields live INSIDE the `own` variant, so a shared service cannot set them.
    certType = types.attrTag {
      shared = mkOption { type = types.submodule { options = { }; }; };
      own = mkOption { type = types.submodule {
        options = {
          ca             = mkOption { type = types.enum [ "internal" "letsencrypt" ]; default = "internal"; };
          acmePort       = mkOption { type = types.port; };                 # required
          email          = mkOption { type = types.nullOr types.str; default = null; };
          certGroup      = mkOption { type = types.str; };                  # required (per-service)
          reloadServices = mkOption { type = types.listOf types.str; default = [ ]; };
          reloadCaddy    = mkOption { type = types.bool; default = true; };
          postRun        = mkOption { type = types.nullOr types.str; default = null; };
          challenge      = mkOption { type = challengeType; default = { }; };
        };
      }; };
    };

    # tls.gate: the mTLS variants carry the required trust pool.
    gateType = types.attrTag {
      none          = mkOption { type = types.submodule { options = { }; }; };
      oidc          = mkOption { type = types.submodule { options = { }; }; };
      mtls          = mkOption { type = types.submodule { options.trustPoolFile = mkOption { type = types.path; }; }; };
      mtlsAllowlist = mkOption { type = types.submodule { options.trustPoolFile = mkOption { type = types.path; }; }; };
    };

    tlsType = types.submodule {
      options = {
        cert = mkOption { type = certType; default = { shared = { }; }; };
        gate = mkOption { type = gateType; default = { none  = { }; }; };
      };
    };

    # challenge.body: handle (+ optional HTTPS redirect) vs bare reverse_proxy.
    challengeBodyType = types.attrTag {
      handle = mkOption { type = types.submodule { options.redirectToHttps = mkOption { type = types.bool; default = false; }; }; };
      bare   = mkOption { type = types.submodule { options = { }; }; };
    };
    challengeType = types.submodule {
      options = {
        via  = mkOption { type = types.enum [ "caddy80" "direct" ]; default = "caddy80"; };
        iface = mkOption { type = types.enum [ "public" "tailscale0" ]; default = "tailscale0"; };
        body = mkOption { type = challengeBodyType; default = { handle = { }; }; };
      };
    };

    # access.scope: hostList carries the (declared-intent) peer list.
    scopeType = types.attrTag {
      public   = mkOption { type = types.submodule { options = { }; }; };
      tailnet  = mkOption { type = types.submodule { options = { }; }; };
      hostList = mkOption { type = types.submodule { options.fromHosts = mkOption { type = types.listOf (types.enum hostNames); default = [ ]; }; }; };
      funnel   = mkOption { type = types.submodule { options = { }; }; };
      none     = mkOption { type = types.submodule { options = { }; }; };
    };
    accessType = types.submodule {
      options.scope = mkOption { type = scopeType; default = { tailnet = { }; }; };
    };

    # dns: nullOr — null means NO record. Otherwise one of the three record kinds.
    dnsRecordType = types.attrTag {
      tailnet = mkOption { type = types.submodule { options = { }; }; };
      cname   = mkOption { type = types.submodule { options.target = mkOption { type = types.str; }; }; };
      public  = mkOption { type = types.submodule { options = { v4 = mkOption { type = types.str; }; v6 = mkOption { type = types.str; }; }; }; };
    };

    # oidc: nullOr — null means NO client. client is public vs basic (carries secretRef).
    oidcClientType = types.attrTag {
      public = mkOption { type = types.submodule { options = { }; }; };
      basic  = mkOption { type = types.submodule { options.secretRef = mkOption { type = types.str; }; }; };
    };
    oidcType = types.submodule {
      options = {
        clientId                       = mkOption { type = types.nullOr types.str; default = null; };  # defaults to entry name in the generator
        client                         = mkOption { type = oidcClientType; };
        callbackPath                   = mkOption { type = types.either types.str (types.listOf types.str); };
        landingPath                    = mkOption { type = types.str; default = "/"; };
        displayName                    = mkOption { type = types.str; };
        allowInsecureClientDisablePkce = mkOption { type = types.bool; default = false; };
        scopeMaps                      = mkOption { type = types.attrsOf (types.listOf types.str); default = { }; };
        claimMaps                      = mkOption { type = types.attrs; default = { }; };
      };
    };

    managedByType = types.submodule {         # plain bool opt-ins (not a discriminated union)
      options = {
        caddy    = mkOption { type = types.bool; default = false; };
        acme     = mkOption { type = types.bool; default = false; };
        firewall = mkOption { type = types.bool; default = false; };
        dns      = mkOption { type = types.bool; default = false; };
        oidc     = mkOption { type = types.bool; default = false; };
      };
    };

    # The entry submodule wires the variants together. Plain scalars (subdomain/zone/host/
    # listenPort/insecureHttp/clientCertOnly/tracing/extraCaddyConfig/managedBy) stay as
    # before; the discriminated unions use the attrTag types above.
    entryType = types.submodule ({ config, ... }: {
      options = {
        subdomain      = mkOption { type = types.str; };
        zone           = mkOption { type = types.str; default = c.baseDomain; };
        host           = mkOption { type = types.enum hostNames; };
        listenPort     = mkOption { type = types.port; default = 443; };   # 8443 for Funnel
        insecureHttp   = mkOption { type = types.bool; default = false; }; # sibling http:// vhost
        clientCertOnly = mkOption { type = types.bool; default = false; }; # cert but no https vhost
        backend        = mkOption { type = backendType; default = { reverseProxy.port = 80; }; };
        tracing        = mkOption { type = types.submodule { options.enable = mkOption { type = types.bool; default = false; }; }; default = { }; };
        tls            = mkOption { type = tlsType; default = { }; };
        access         = mkOption { type = accessType; default = { }; };
        dns            = mkOption { type = types.nullOr dnsRecordType; default = null; };  # null = no record
        oidc           = mkOption { type = types.nullOr oidcType; default = null; };       # null = no client
        extraCaddyConfig = mkOption { type = types.lines; default = ""; };
        managedBy      = mkOption { type = managedByType; default = { }; };
        # derived read-only convenience:
        fqdn = mkOption { type = types.str; readOnly = true; };
        url  = mkOption { type = types.str; readOnly = true; };
      };
      config = {
        fqdn = "${config.subdomain}.${config.zone}";
        url  = "https://${config.subdomain}.${config.zone}";
        # NOTE: oidc.clientId default (= entry name) is resolved in the OIDC generator, NOT
        # here — reading config.oidc to set config.oidc on a nullOr field is self-referential
        # and triggers infinite recursion.
      };
    });
  in
  {
    options.homelab.catalog = mkOption {
      type = types.attrsOf entryType;
      default = { };
      description = ''
        Registry of externally-reachable services. One entry per service, contributed by
        that service's own feature (features/<service>/catalog.nix). Consumed by the five
        generators (caddy/acme/firewall/dns/oidc). Parent plan §2.1.
      '';
    };
  };
```

> `fqdn`/`url` are `readOnly` derived options for ergonomics. The **authoritative** schema is
> `options.nix` itself (fully-described `attrTag` variants); the abridged listing above shows the
> variant shapes the per-module plans reference. A catalog entry now reads, e.g.:
>
> ```nix
> homelab.catalog.grafana = {
>   subdomain = "grafana"; host = "augustus";
>   backend.reverseProxy.port = 3000;     # was: backend = { kind = "reverseProxy"; port = 3000; }
>   tls.cert.shared = { };                # was: tls.ca = null
>   access.scope.tailnet = { };           # was: access.scope = "tailnet"
>   dns.tailnet = { };                    # was: dns.enable = true (+ dns.kind = "tailnet")
>   oidc = { client.basic.secretRef = "grafana_client_secret"; /* was: public = false; secretRef = … */ … };
>   managedBy = { caddy = true; oidc = true; };
> };
> ```

---

## 3. The five generator modules

All generators share one **pure vhost-body renderer** (§3.1) so the two Caddy backends emit byte-for-
byte identical bodies. Each generator is a thin `flake.modules.{nixos,darwin}.<name>` function that
folds the catalog and emits config for exactly one subsystem.

### 3.1 Shared pure renderer (`lib.nix` → `constants.catalogLib`)

Published as `config.constants.catalogLib` so both Caddy backends (and the acme generator, for cert
paths) consume the identical logic. It is a set of **pure string functions** (plus two `attrTag`
helpers) — no module output. The authoritative source is `lib.nix`; it reads the `attrTag` variants
via `tagOf`/`payloadOf`:

```nix
# features/homelab-service/lib.nix
{ lib, ... }@topLevel:
{
  config.constants.catalogLib = rec {
    # attrTag helpers: a value is a one-key attrset { <tag> = { …payload… }; }.
    tagOf     = v: lib.head (lib.attrNames v);   # the active tag, e.g. "reverseProxy"/"own"/"mtls"
    payloadOf = v: v.${tagOf v};                 # its payload submodule

    fqdn = e: "${e.subdomain}.${e.zone}";
    url  = e: "https://${fqdn e}";

    tracingBlock = hostCfg: name:
      lib.optionalString hostCfg.services.tempo.enable ''
        tracing {
          span ${name}
        }
      '';

    # backend directive — switch on the backend attrTag. 127.0.0.1 upstream (approved §7.8 #22).
    backendBlock = e:
      let kind = tagOf e.backend; in
      if kind == "reverseProxy" then "reverse_proxy 127.0.0.1:${toString e.backend.reverseProxy.port}\n"
      else if kind == "static" then ''
        root * ${e.backend.static.root}
        header /*.html Cache-Control "no-cache, must-revalidate"
        file_server
      ''
      else "";  # "none" / "raw" -> no auto backend directive

    # mTLS wrapper for gate == { mtls = …; } / { mtlsAllowlist = …; }. certPem/certKey null ->
    # Caddy-managed server cert (cert-less `tls { client_auth }`); otherwise explicit cert named.
    mtlsTlsLine = { certPem ? null, certKey ? null, trustPool }:
      let certPrefix = lib.optionalString (certPem != null) "${certPem} ${certKey} "; in ''
      tls ${certPrefix}{
        client_auth {
          mode require_and_verify
          trust_pool file {
            pem_file ${trustPool}
          }
        }
      }
    '';

    plainTlsLine = { certPem, certKey }: "tls ${certPem} ${certKey}\n";

    # THE shared vhost body. certDir = security.acme.certs.<fqdn>.directory when the vhost names
    # an explicit cert (tls.cert == { own = …; } on nixos); null for Caddy-managed / darwin.
    renderVhostBody = { hostCfg, entry, name, certDir ? null }:
      let e = entry; in
      if tagOf e.backend == "raw" then e.extraCaddyConfig   # kanidm / praeconinus: body verbatim
      else
        let
          gateTag = tagOf e.tls.gate;
          isMtls  = gateTag == "mtls" || gateTag == "mtlsAllowlist";
          tls =
            if isMtls then mtlsTlsLine {
              certPem = if certDir != null then "${certDir}/fullchain.pem" else null;
              certKey = if certDir != null then "${certDir}/key.pem" else null;
              trustPool = (payloadOf e.tls.gate).trustPoolFile;
            }
            else if certDir != null then plainTlsLine {
              certPem = "${certDir}/fullchain.pem"; certKey = "${certDir}/key.pem";
            }
            else "";
          # mtlsAllowlist supplies the body via extraCaddyConfig -> suppress the auto backend.
          backend = lib.optionalString (gateTag != "mtlsAllowlist") (backendBlock e);
        in
        lib.concatStrings [
          tls
          (lib.optionalString e.tracing.enable (tracingBlock hostCfg name))
          backend
          e.extraCaddyConfig
        ];
  };
}
```

> **Block ordering:** `tls → tracing → backend → extraCaddyConfig` (matches loki-push's
> `tls { client_auth }` → `tracing` → `reverse_proxy`). `tracing` is opt-in per entry
> (`tracing.enable`) and additionally gated on the host's `services.tempo.enable`.

This single function reproduces every current vhost shape: the plain `reverse_proxy` (it-tools,
planka), the static `file_server` (homelab-ui), the explicit `tls …` + `reverse_proxy` + tracing
(kanidm/homelab-api), and the mTLS `client_auth` block (technitium metrics). The bespoke bits
(metrics path allowlist, redirects) flow through `extraCaddyConfig`.

> **Generator snippets §3.2–§3.7 below are illustrative.** The authoritative source is each
> generator file under `features/homelab-service/`. Where a snippet still shows a pre-`attrTag`
> read (`e.backend.kind`, `e.tls.ca != null`, `e.dns.enable`, `o.public`, `e.access.scope == …`),
> the implemented file uses the `attrTag` form instead:
>
> | illustrative (old)               | implemented (`attrTag`)                                      |
> | -------------------------------- | ------------------------------------------------------------ |
> | `e.backend.kind == "x"`          | `catLib.tagOf e.backend == "x"`                              |
> | `e.backend.port` / `.root`       | `e.backend.reverseProxy.port` / `e.backend.static.root`      |
> | `e.tls.ca != null`               | `catLib.tagOf e.tls.cert == "own"`                           |
> | `e.tls.acmePort` / `.certGroup`  | `e.tls.cert.own.acmePort` / `.certGroup` (etc.)              |
> | `e.tls.challenge.body == "bare"` | `catLib.tagOf e.tls.cert.own.challenge.body == "bare"`       |
> | `e.tls.gate == "mtls"`           | `catLib.tagOf e.tls.gate == "mtls"` (+ `…mtlsAllowlist`)     |
> | `e.access.scope == "tailnet"`    | `catLib.tagOf e.access.scope == "tailnet"` (`hostList` etc.) |
> | `e.dns.enable` / `e.dns.kind`    | `e.dns != null` / `catLib.tagOf e.dns`                       |
> | `e.oidc.enable` / `o.public`     | `e.oidc != null` / `catLib.tagOf o.client == "public"`       |

### 3.2 `homelab-service-caddy` (nixos backend)

Reads: the whole catalog. Filters: `host == config.networking.hostName` **and**
`managedBy.caddy`. Emits: `services.caddy.virtualHosts.<url>.extraConfig` using the shared renderer.

```nix
# features/homelab-service/caddy-nixos.nix
{ ... }:
{
  flake.modules.nixos.homelab-service-caddy =
    { config, lib, ... }:
    let
      catLib = config.constants.catalogLib;
      mine = lib.filterAttrs
        (_: e: e.host == config.networking.hostName && e.managedBy.caddy)
        config.homelab.catalog;

      mkVhost = name: e:
        let
          certDir =
            if e.tls.ca != null
            then config.security.acme.certs.${catLib.fqdn e}.directory
            else null;
          # Funnel listens on :8443; everything else on the entry's listenPort (443).
          vhostKey = "https://${catLib.fqdn e}"
            + lib.optionalString (e.listenPort != 443) ":${toString e.listenPort}";
        in
        lib.nameValuePair vhostKey {
          extraConfig = catLib.renderVhostBody {
            hostCfg = config; entry = e; inherit name certDir;
          };
        };
    in
    {
      services.caddy.virtualHosts = lib.mapAttrs' mkVhost mine;
    };
}
```

### 3.3 `homelab-service-caddy` (darwin backend) — Caddyfile fragment, NO acme

Reads: the whole catalog. Filters: `host == config.networking.hostName` (= `mini`) **and**
`managedBy.caddy`. Emits: **a Caddyfile site-blocks fragment** appended to mini's Caddyfile — **not**
`services.caddy` (which does not exist on nix-darwin), and **no** ACME config at all (Caddy does ACME
natively via the mini Caddyfile's global `acme_ca`). Parent plan §2.2a / decision §5.1 #4.

```nix
# features/homelab-service/caddy-darwin.nix
{ ... }:
{
  flake.modules.darwin.homelab-service-caddy =
    { config, lib, pkgs, ... }:
    let
      catLib = config.constants.catalogLib;
      mine = lib.filterAttrs
        (_: e: e.host == config.networking.hostName && e.managedBy.caddy)
        config.homelab.catalog;

      # One Caddyfile site block per entry. certDir = null -> renderer emits no explicit
      # `tls` line, so Caddy's global acme_ca issues/renews the cert itself.
      siteBlock = name: e: ''
        https://${catLib.fqdn e}${lib.optionalString (e.listenPort != 443) ":${toString e.listenPort}"} {
          ${catLib.renderVhostBody { hostCfg = config; entry = e; inherit name; certDir = null; }}
        }
      '';

      fragment = lib.concatStringsSep "\n"
        (lib.mapAttrsToList siteBlock mine);
    in
    {
      # Recommended approach (parent plan §2.2a, option (b)): emit only a site-blocks
      # fragment that the existing hand-written Caddyfile `import`s, leaving mini's global
      # options (acme_ca, metrics, logging) untouched.
      environment.etc."caddy_nix/catalog-sites.caddy".text = fragment;
      # NO security.acme — does not exist on darwin; Caddy-native ACME handles issuance.
      # NO firewall/dns/oidc — all out of scope for darwin.
    };
}
```

> Parity for darwin is diffed on the generated Caddyfile text, not `services.caddy` (which has no
> darwin equivalent) — see §5.

### 3.4 `homelab-service-acme` (nixos only)

Reads: the whole catalog. Filters: `host == networking.hostName`, `managedBy.acme`, **and**
`tls.ca != null` (the common `tls.ca == null` reverse-proxy case emits nothing — it shares Caddy's
managed cert). Emits: `security.acme.certs.<fqdn>` + the matching `http://<fqdn>` challenge vhost,
reproducing the current kanidm/postgres/radius/aedilis-technitium cert blocks exactly.

```nix
# features/homelab-service/acme.nix
{ config, ... }@topLevel:
{
  flake.modules.nixos.homelab-service-acme =
    { config, lib, ... }:
    let
      c = config.constants;
      catLib = c.catalogLib;
      mine = lib.filterAttrs
        (_: e: e.host == config.networking.hostName && e.managedBy.acme && e.tls.ca != null)
        config.homelab.catalog;

      certServer = e:
        if e.tls.ca == "letsencrypt"
        then "https://acme-v02.api.letsencrypt.org/directory"
        else c.ca.acmeDirectoryHttp;        # internal step-ca

      mkCert = name: e:
        lib.nameValuePair (catLib.fqdn e) {
          domain = catLib.fqdn e;
          listenHTTP = "127.0.0.1:${toString e.tls.acmePort}";
          server = certServer e;
          group = e.tls.certGroup;          # per-service group (default = name)
          reloadServices = [ "caddy.service" ] ++ e.tls.reloadServices;
        };

      # The :80 HTTP-01 challenge vhost (only needed for via == "caddy80"; "direct"
      # challenges reach the loopback acmePort straight from the ACME server).
      mkChallengeVhost = name: e:
        lib.nameValuePair "http://${catLib.fqdn e}" {
          extraConfig = ''
            handle /.well-known/acme-challenge/* {
              reverse_proxy 127.0.0.1:${toString e.tls.acmePort}
            }
          '';
        };

      caddy80 = lib.filterAttrs (_: e: e.tls.challenge.via == "caddy80") mine;
    in
    {
      security.acme.certs = lib.mapAttrs' mkCert mine;
      services.caddy.virtualHosts = lib.mapAttrs' mkChallengeVhost caddy80;
      # Each per-service cert group must grant caddy (and any reloaders) read access;
      # the service feature declares `users.groups.<certGroup>.members = [ "caddy" … ];`
      # (as kanidm.nix does for the `idm` group today). Kept in the feature, not here,
      # since membership (kanidm also adds "kanidm") is service-specific.
    };
}
```

> Note today's kanidm challenge uses a bare `reverse_proxy localhost:<acmePort>` on the whole
> `http://` vhost rather than a `handle /.well-known/acme-challenge/*` wrapper. During the kanidm
> migration the parity diff (§5) will reveal that difference; either keep the exact current body via
> `extraCaddyConfig` on a challenge-specific entry, or normalize to the `handle` form as a reviewed,
> explicitly-justified change (it is functionally equivalent for ACME). The generator defaults to the
> `handle` form; per-module plans record which services need the verbatim current body.

### 3.5 `homelab-service-firewall` (nixos only)

Reads: the whole catalog. Filters: `host == networking.hostName`, `managedBy.firewall`. Emits:
`networking.firewall` openings for `listenPort` (per `access.scope`'s interface) plus any
`tls.challenge.via == "direct"` acmePort (on `tls.challenge.iface`). `scope == "funnel"` and
`scope == "none"` open nothing (Funnel ingress arrives via tailscaled loopback). Parent plan §2.7.

```nix
# features/homelab-service/firewall.nix
{ ... }:
{
  flake.modules.nixos.homelab-service-firewall =
    { config, lib, ... }:
    let
      mine = lib.filterAttrs
        (_: e: e.host == config.networking.hostName && e.managedBy.firewall)
        config.homelab.catalog;

      entries = lib.attrValues mine;

      # Listen-port openings, grouped by interface the access.scope selects.
      # public  -> allowedTCPPorts ; tailnet/host-list -> tailscale0 ; funnel/none -> none.
      portsFor = pred: lib.unique (lib.concatMap
        (e: lib.optionals (pred e) [ e.listenPort ])
        entries);

      publicListen  = portsFor (e: e.access.scope == "public");
      tailnetListen = portsFor (e: e.access.scope == "tailnet" || e.access.scope == "host-list");

      # direct-challenge acmePorts, grouped by tls.challenge.iface.
      acmePorts = pred: lib.unique (lib.concatMap
        (e: lib.optionals (e.tls.ca != null
                           && e.tls.challenge.via == "direct"
                           && pred e) [ e.tls.acmePort ])
        entries);
      publicAcme  = acmePorts (e: e.tls.challenge.iface == "public");
      tailnetAcme = acmePorts (e: e.tls.challenge.iface == "tailscale0");
    in
    {
      networking.firewall.allowedTCPPorts = publicListen ++ publicAcme;
      networking.firewall.interfaces.tailscale0.allowedTCPPorts = tailnetListen ++ tailnetAcme;
      # Baseline host ports (SSH 22, TS metrics 5252, radius 1812/1813, Technitium
      # 53/80/443/853) remain hand-listed in _private/<host>/security.nix — decision §5.1 #7.
    };
}
```

This reproduces aedilis's hand-copied `22481`/`22483` tailnet ACME openings (`tls.challenge = { via
= "direct"; iface = "tailscale0"; }`) and the shared `443` openings, without touching the baseline
infrastructure ports.

### 3.6 `homelab-service-dns` (nixos, aedilis only)

Reads: the **whole** catalog (every host). Filters: `managedBy.dns` **and** `dns.enable` — **no**
`host ==` filter (central DNS emits records for services on every host, including mini). Groups by
`zone`, creating each Primary zone on demand, and folds each group into
`services.technitium-server-complete.provision.ensureDnsRecords.zones`. Derives A/AAAA from
`constants.hosts.<host>.tailscale`. Parent plan §2.5.

```nix
# features/homelab-service/dns.nix
{ config, ... }@topLevel:
{
  flake.modules.nixos.homelab-service-dns =
    { config, lib, ... }:
    let
      c = config.constants;
      catLib = c.catalogLib;
      inherit (lib) filterAttrs attrValues groupBy concatMap mapAttrs;

      wanted = attrValues (filterAttrs (_: e: e.managedBy.dns && e.dns.enable) config.homelab.catalog);

      mkRecordsFor = e:
        let apex = catLib.fqdn e; in
        if e.dns.kind == "cname" then
          [ { CNAME = { name = apex; cname = e.dns.cnameTarget; }; } ]
        else if e.dns.kind == "public" then
          [ { A = { name = apex; address = e.dns.publicV4; }; }
            { AAAA = { name = apex; address = e.dns.publicV6; }; } ]
        else # tailnet: A/AAAA from the serving host's tailnet addresses
          let ts = c.hosts.${e.host}.tailscale; in
          [ { A = { name = apex; address = ts.v4; }; }
            { AAAA = { name = apex; address = ts.v6; }; } ];

      byZone = groupBy (e: e.zone) wanted;

      generatedZones = mapAttrs
        (_zoneName: svcs: {
          type = "Primary";
          records = concatMap mkRecordsFor svcs;
        })
        byZone;

      # Non-service outliers (nas LAN record, aedilis public endpoint identities) stay
      # explicit and merge into the matching zone — mirror the current nasRecords /
      # publicEndpointRecords in service-registry.nix. Shown as a static extra here.
      staticExtras = {
        "${c.baseDomain}".records =
          c.constants.dnsExtraRecords or [ ]; # nas + public endpoint records, moved out of the ts fold
      };
    in
    {
      # Zone-level merge: generated records + static extras converge into one zones attr.
      # (concrete merge uses lib.recursiveUpdate / per-zone record concat; the upsert-only
      #  provisioning semantics are unchanged — this only changes how the list is produced.)
      services.technitium-server-complete.provision.ensureDnsRecords.zones =
        lib.zipAttrsWith
          (_zone: vs: {
            type = "Primary";
            records = concatMap (z: z.records or [ ]) vs;
          })
          [ generatedZones staticExtras ];
    };
}
```

This deletes the `ts` table and the `tailnetRewrites` map in `service-registry.nix`: "which host
serves this name" becomes a property of the single catalog declaration, and `A`/`AAAA` come straight
from `constants.hosts.<host>.tailscale`. A brand-new zone needs no DNS-side change — a service simply
sets `zone = "other.example"` and the generator creates that Primary zone and populates it. The
record shape (`{ A = { name; address; }; }` attrTag) exactly matches
`technitium-provisioning/options.nix`'s `recordType`, and the upsert-only (no-delete) guarantee is
untouched.

### 3.7 `homelab-service-oidc` (nixos, augustus only)

Reads: the **whole** catalog. Filters: `managedBy.oidc` **and** `oidc.enable` — **no** `host ==`
filter (OIDC is centralized on augustus). Emits
`services.kanidm.provision.systems.oauth2.<clientId>`, reproducing today's per-service blocks (e.g.
planka's). Parent plan §2.6.

```nix
# features/homelab-service/oidc.nix
{ config, ... }:
{
  flake.modules.nixos.homelab-service-oidc =
    { config, lib, ... }:
    let
      catLib = config.constants.catalogLib;
      inherit (lib) filterAttrs mapAttrs' nameValuePair toList;

      wanted = filterAttrs (_: e: e.managedBy.oidc && e.oidc.enable) config.homelab.catalog;

      mkClient = _name: e:
        let
          base = catLib.url e;
          o = e.oidc;
          callbacks = toList o.callbackPath;             # str or list -> list
          originUrls = map (p: "${base}${p}") callbacks;
        in
        nameValuePair o.clientId ({
          displayName = o.displayName;
          # one or many callback URLs (homelab public client lists two)
          originUrl = if builtins.length originUrls == 1 then builtins.head originUrls else originUrls;
          originLanding = "${base}${o.landingPath}";
          scopeMaps = o.scopeMaps;          # verbatim
        }
        // lib.optionalAttrs (o.claimMaps != { }) { claimMaps = o.claimMaps; }
        // lib.optionalAttrs o.allowInsecureClientDisablePkce { allowInsecureClientDisablePkce = true; }
        // (if o.public
            then { public = true; }
            else { basicSecretFile = config.sops.secrets.${o.secretRef}.path; }));
    in
    {
      services.kanidm.provision.systems.oauth2 = mapAttrs' mkClient wanted;
    };
}
```

The sops secret itself remains in augustus's sops config; the generator only references it by
`secretRef`. `scopeMaps`/`claimMaps` pass through verbatim (the irreducibly service-specific part).
For planka this reproduces `originUrl = "${url}/oidc-callback"`, `originLanding = "${url}/"`,
`displayName = "Planka"`, `basicSecretFile = …planka_client_secret.path`,
`allowInsecureClientDisablePkce = true`, the `planka.access` scopeMap, and the `roles` claimMap.

---

## 4. How each current shape maps onto the catalog

| Current module                  | Shape today                                                                  | Catalog entry fields (`attrTag`)                                                                                                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/it-tools.nix`         | `reverse_proxy localhost:47309`                                              | `backend.reverseProxy.port=47309`, `tls.cert.shared={}`, `access.scope.tailnet={}`, `dns.tailnet={}`                                                                                                  |
| `services/planka.nix`           | `reverse_proxy` + full oauth2 block                                          | `backend.reverseProxy.port=1337`, `tls.cert.shared={}`, `oidc={client.basic.secretRef=…; callbackPath="/oidc-callback"; …}`                                                                           |
| `features/homelab-ui/caddy.nix` | `root * <pkg>` + `file_server` + tracing                                     | `backend.static.root=<pkg>`, `tls.cert.shared={}`                                                                                                                                                     |
| `services/kanidm.nix`           | explicit `tls … fullchain/key` + tracing + proxy; manual cert on `idm` group | `backend.raw={}`, `tls.cert.own={ca="internal"; acmePort=64073; certGroup="idm"; reloadServices=["kanidm.service"]; challenge.body.bare={};}`, `extraCaddyConfig` for the `tls_server_name` transport |
| `features/technitium/caddy.nix` | mTLS `client_auth` + path allowlist                                          | `tls.gate.mtlsAllowlist.trustPoolFile=…`, `extraCaddyConfig` for the `@node/@dns/@login` allowlist                                                                                                    |
| aedilis internal certs          | `security.acme.certs` + direct tailnet acmePort                              | `tls.cert.own={ca="internal"; challenge={via="direct"; iface="tailscale0";};}` (→ firewall opens 22481/22483)                                                                                         |
| `constants.dnsRecords.private`  | `ts` + `tailnetRewrites` fold                                                | per-entry `dns.tailnet={}` (non-null); DNS generator folds by `zone`                                                                                                                                  |

---

## 5. Operational equivalence — parity gates

Per [README](./README.md) and `.kiro/steering/validation.md`. **Before any Nix check, `git add` the
new `.nix` files** — flake eval reads the git tree; untracked new files are invisible to
`import-tree`. (Do not run these now; this is the gate the implementation PR and each per-module plan
must pass.)

The schema + generators land **behind the per-entry `managedBy.*` opt-in with every flag `false`**,
so introducing `features/homelab-service/` emits **nothing** — the first parity gate is that adding
the module is a no-op across every host:

```sh
# Caddy vhosts — must be byte-identical before/after introducing the module (all managedBy=false):
nix eval .#nixosConfigurations.augustus.config.services.caddy.virtualHosts --json
nix eval .#nixosConfigurations.aedilis.config.services.caddy.virtualHosts --json
nix eval .#nixosConfigurations.cicero.config.services.caddy.virtualHosts --json
nix eval .#nixosConfigurations.praeconinus.config.services.caddy.virtualHosts --json
```

Then, as **each service flips its `managedBy.*` flags**, diff the relevant surface on the owning host
before/after — the diff must be empty, or an explicitly-justified, reviewed change (the _only_
permitted intentional deviation is a flagged bug fix, e.g. the praeconinus `443→8443` finding):

```sh
# Vhost parity (owning host), per migrated service:
nix eval .#nixosConfigurations.augustus.config.services.caddy.virtualHosts --json

# ACME cert + challenge-vhost parity (cert-terminating services: kanidm/postgres/radius/aedilis):
nix eval .#nixosConfigurations.augustus.config.security.acme.certs --json
nix eval .#nixosConfigurations.aedilis.config.security.acme.certs --json

# OIDC client parity (augustus only):
nix eval .#nixosConfigurations.augustus.config.services.kanidm.provision.systems.oauth2 --json

# Firewall parity (per host) — service-derived openings must match today's hand-listed ports:
nix eval .#nixosConfigurations.augustus.config.networking.firewall.allowedTCPPorts --json
nix eval .#nixosConfigurations.aedilis.config.networking.firewall.interfaces.tailscale0.allowedTCPPorts --json

# DNS parity (aedilis) — generated zones must equal today's constants.dnsRecords.private:
nix eval .#nixosConfigurations.aedilis.config.services.technitium-server-complete.provision.ensureDnsRecords.zones --json
```

For **mini (darwin)** there is no `services.caddy`/`security.acme` to eval — diff the generated
Caddyfile text against the current hand-written one instead:

```sh
# Before/after the darwin Caddyfile backend (compare the rendered site blocks):
nix eval .#darwinConfigurations.mini.config.environment.etc."caddy_nix/catalog-sites.caddy".text --raw
# (and confirm the mini Caddyfile `import`s the fragment; global acme_ca/metrics/logging unchanged)
```

Recommended recipe per migration: capture the relevant `--json` to a file on the base revision, flip
`managedBy.*` + delete the hand-written block, re-capture, and `diff` (or `nix-diff` the whole host
closure). An empty diff certifies operational equivalence. After each step run
`nix run .#nixfmt -- $(git ls-files '*.nix' ':!:repos/**')` and `nix flake check`, and do a full
per-host `nixos-rebuild build --flake .#<host>` (and `darwin-rebuild build --flake .#mini`) before
deploying.

---

## 6. Implementation checklist (this module)

- [ ] `options.nix` — `homelab.catalog` schema (§2), published in both `nixos` and `darwin` classes.
- [ ] `lib.nix` — `constants.catalogLib` pure renderer (§3.1): `renderVhostBody`, `backendBlock`,
      `mtlsTlsLine`, `plainTlsLine`, `tracingBlock`, `fqdn`/`url`.
- [ ] `caddy-nixos.nix` — `services.caddy.virtualHosts` backend (§3.2), filters `host ==` +
      `managedBy.caddy`.
- [ ] `caddy-darwin.nix` — Caddyfile fragment backend (§3.3); **no** `security.acme`.
- [ ] `acme.nix` — `security.acme.certs` + `:80` challenge vhost (§3.4), only `tls.ca != null`.
- [ ] `firewall.nix` — `listenPort` + direct-challenge acmePort openings per interface (§3.5).
- [ ] `dns.nix` — `ensureDnsRecords.zones` grouped by `zone`, A/AAAA from `hosts.<h>.tailscale`
      (§3.6).
- [ ] `oidc.nix` — `kanidm.provision.systems.oauth2` fold (§3.7).
- [ ] `complete.nix` — role aggregators + per-host import matrix (§1).
- [ ] All generators gated on their per-entry `managedBy.<concern>`; introducing the module is a
      no-op (§5 first gate).
- [ ] `git add` the new files, then run the §5 parity gates + `nix flake check`.

---

## 7. Consolidated schema gaps surfaced by the per-module plans

The per-service plans in this directory each flagged schema/renderer needs locally. Collected here as
the authoritative pre-implementation to-do so the catalog + generators are complete before any
service migrates. Each item is **required for byte-exact operational equivalence** unless marked
optional. Cross-references point to the per-module plan that motivates it.

> **Notation:** items below were written against the original enum+boolean draft and refer to fields
> like `backend.kind = "raw"`, `tls.ca`, `tls.gate = "mtls"`, `tls.challenge.body = "bare"`. The
> implemented schema models these as `attrTag` variants — read them per the §2.0 mapping table
> (`backend.raw={}`, `tls.cert.own={…}`, `tls.gate.mtls={trustPoolFile=…}`,
> `tls.cert.own.challenge.body.bare={}`, etc.). The requirements themselves are unchanged.

### 7.1 Renderer / Caddy vhost body

1. **Standardize the upstream token on `127.0.0.1` (intentional, approved non-parity change).**
   Current modules are inconsistent: `it-tools`, `openwebui`, `planka`, `home-assistant` emit
   `reverse_proxy localhost:<port>`; `grafana`, `loki`, `homelab-api`/`homelab-ui` emit `127.0.0.1`.
   **Decision (operator):** the renderer emits **`127.0.0.1` for every entry** — do **not** preserve
   `localhost`. This is a deliberate, approved deviation from byte-parity: the operator hit real DNS
   resolution oddities where `localhost` intermittently failed while `127.0.0.1` worked, so forcing
   the numeric loopback is a **bugfix**, not drift. Consequence: the `--raw` Caddy parity gate for the
   `localhost`-sourced services (`it-tools`, `openwebui`, `planka`, `home-assistant`) will show
   exactly the `localhost → 127.0.0.1` substitution and nothing else; reviewers confirm that is the
   only difference. No `backend.upstreamHost` field is needed — `127.0.0.1` is hardcoded in the
   renderer. (it-tools, openwebui, planka, home-assistant, grafana, homelab-api, mini)
2. **mTLS is orthogonal to `tls.ca`, and composes with tracing.** `gate = "mtls"` must support BOTH
   a **cert-less** Caddy-managed server cert (`tls { client_auth … }` — loki-push, cicero, mini) AND
   an **explicit** cert (`tls <fullchain> <key> { client_auth … }` — technitium metrics). The
   `mtlsTrustPoolFile` + `tls.ca` combination selects which. Fix the renderer's block **ordering** to
   match source: loki emits `tls { client_auth }` → `tracing` → `reverse_proxy` (the draft had
   tracing first). (loki, technitium-caddy, cicero-observability, mini)
3. **Bespoke vhost bodies via a suppression flag.** Three vhosts are not expressible as
   backend+gate: kanidm's HTTPS-upstream `transport http { tls_server_name … }`, technitium metrics'
   mTLS **path allowlist** (`@node`/`@dns`/`@login`/`respond 404`), and praeconinus' Funnel base-path
   routing (`map`/`handle_path /api`/`/ui`). Add `backend.kind = "raw"` (or an explicit
   `extraCaddyConfig`-only mode) that **suppresses** the auto `backendBlock`/`plainTlsLine`/
   `tracingBlock` and emits the body verbatim from `extraCaddyConfig`. (kanidm, technitium-caddy,
   praeconinus)
4. **Metrics-only / no-upstream vhost.** `ca-monitoring` and `mini-caddy-metrics` have `metrics`/no
   `reverse_proxy` body. Support `backend.kind = "none"` (emit no backend block). (cicero-observability,
   mini)
5. **Static backend** (`root * <pkg>` + `header` + `file_server`) — already in the schema
   (`backend.kind = "static"`, `backend.root`); verify the `header /*.html Cache-Control` line is part
   of the static renderer. (homelab-ui, praeconinus /ui)

### 7.2 ACME cert generator

6. **`postRun` passthrough, and no implicit `caddy.service` reload.** postgres' cert uses
   `postRun = systemctl start postgresql-update-certs.service` and has **no** `reloadServices` at all.
   Certs whose consumer is not Caddy (postgres `postRun`; radius `podman-radiusd`; prometheus-client
   and cicero alloy-client → the **consumer**, not caddy) must NOT get a defaulted `caddy.service`
   reload. Add `tls.postRun` + make `tls.reloadServices` fully explicit (no implicit caddy reload
   unless the vhost actually uses the cert). (postgres, radius, prometheus, cicero-observability)
7. **Let's Encrypt cert with custom `email` + multi-unit reload.** technitium's public `dns` cert is
   LE (`server = LE directory`, `email = rae@…`, `group = cfg.group`, `reloadServices =
   [caddy, technitium-dns-server, technitium-provision]`). Add `tls.email` and ensure
   `tls.ca = "letsencrypt"` honors per-cert email + the reload list. (technitium-aedilis)
8. **Challenge-vhost body form must match per-service.** Some challenge vhosts are bare
   `reverse_proxy 127.0.0.1:<acmePort>` (kanidm, postgres, radius, technitium admin/metrics, cicero),
   others wrap in `handle /.well-known/acme-challenge/* { … } handle { redir … }` (technitium `dns`).
   The acme generator needs a `tls.challenge.body` selector (`bare` vs `handle+redir`) — defaulting to
   whichever is the common case and overridable. (Note: these are also standardized to `127.0.0.1`
   per #1; the current sources use `localhost` here too.) (kanidm, postgres, radius,
   technitium-aedilis, cicero-observability)
9. **~~Secondary challenge domains for one cert.~~ DROPPED.** kanidm currently serves a challenge
   vhost for **`ldap`** (`ldap.plato-splunk.media`) alongside `idm`. **Decision (operator):** LDAP is
   not used anywhere — the homelab is OIDC-exclusive — so the `ldap` Caddy route and its DNS record
   are **removed entirely** (an intentional, approved deviation; see kanidm.md §3 and dns-records.md).
   No `tls.extraChallengeDomains` field is needed in the schema. The kanidm server's own LDAP
   `bindaddress` config is left as-is for config parity, but nothing routes to it.
10. **Per-service cert group override.** The cert group defaults to the service name but must be
    overridable (kanidm → `idm`, postgres → `postgres-certs`, radius → `radiusd`, cicero →
    `cicero-observability`). The group-membership wiring (`users.groups.<g>.members = [ caddy … ]`)
    stays in the service's `service.nix` (it's service-specific). Decision §5.1 #6: **per-service
    groups**, no shared group. (kanidm, postgres, radius, cicero-observability)

### 7.3 Client-cert-only (no-vhost) services

11. **A service may own a cert + challenge + DNS but no vhost.** `prometheus-client` and the cicero
    **alloy** client cert are consumed outbound (scraping / Loki push); they need the cert, its `:80`
    challenge vhost, and an A/AAAA for the challenge to resolve, but **no** HTTPS vhost, and their
    `reloadServices` targets the **consumer** (`prometheus.service` / `alloy.service`). Add a
    `clientCertOnly` marker (or `backend.kind = "none"` + `tls.ca = internal` + no gate). Note:
    prometheus **also** currently serves a `prometheus` mTLS vhost — dropping it would be a behavior
    change, not a no-op; keep it. (prometheus, cicero-observability)

### 7.4 OIDC generator

12. **`landingPath` with no hardcoded `/` default.** home-assistant lands on `/auth/oidc/welcome`,
    planka/openwebui on `/`, homelab-api on `""` (bare origin, no trailing slash). `landingPath` must
    be a genuine per-entry value; the generator must not force `/`. (home-assistant, homelab-api)
13. **`allowInsecureClientDisablePkce` passthrough.** planka's client sets it `true`. Add the
    optional field (default `false`). (planka)
14. **`callbackPath`/`originUrl` as a list, including absolute URLs.** homelab-api and habitsync list
    multiple callbacks, some absolute (`http://localhost:4321/oauth/callback`,
    `habitsync://auth-callback`). Support `originUrl` being a list where entries may be absolute (not
    just `url + callbackPath`). (homelab-api, habitsync)
15. **`scopeMaps`/`claimMaps` pass through verbatim, order-preserving** (grafana/planka role maps,
    home-assistant `groups` scope, homelab-api's large permission `claimMaps.roles`). Already
    intended; call out order preservation for the `--json` gate. (grafana, planka, home-assistant,
    homelab-api)

### 7.5 Firewall generator

16. **Public, non-443, multi-protocol service ports are out of scope (stay baseline).** radius
    `1812/1813` TCP+UDP (public), minecraft `25565`, postgres `5432` (tailscale0) are
    service-attributable but the generator only models 443 + direct-challenge ACME ports. Per parent
    §5.1 #7 these remain **hand-listed** in `_private/<host>/security.nix`; the firewall plan proves
    the service-derived + baseline union equals today's set per host. (radius, firewall)
17. **Direct-tailnet ACME challenge ports** (`22481`, `22483` on aedilis `tailscale0`) ARE generated
    from `tls.challenge = { via = "direct"; iface = "tailscale0"; }`. (technitium-aedilis, firewall)

### 7.6 Host-level (not per-service) Caddy listen port

18. **Non-443 `https_port` is a host property, not a service one.** cicero runs Caddy with global
    `https_port 8443` (step-ca owns 443); praeconinus binds `8443` for Funnel (tailscaled owns 443);
    mini's Caddyfile has its own global block. The catalog models a per-entry `listenPort`
    (`https://<fqdn>:<port>`), but the **global** `https_port`/Caddyfile global options stay
    host-level config, not catalog-generated. Document the boundary. (cicero-observability,
    praeconinus, mini)

### 7.7 Darwin Caddyfile backend

19. **Fragment import mechanism.** The darwin backend emits a site-blocks fragment
    (`environment.etc."caddy_nix/catalog-sites.caddy".text`) that mini's existing Caddyfile `import`s;
    the mini-specific global block (`acme_ca`, `storage`, `metrics`, `debug`) stays hand-written. The
    parity gate is a `caddy adapt` → JSON diff (directive order/whitespace differ but are
    order-independent), not a raw text diff. (mini)

### 7.8 Approved intentional deviations + confirm-before-acting

These are the **only** permitted departures from a strict no-op; each is operator-approved.

20. **apprise DNS record removed (APPROVED).** `tailnetRewrites.apprise` survives but the service was
    removed; the operator approved deleting it. It is an intentional DNS set-difference — the
    dns-records set-equality gate will show exactly one dropped record (`apprise`) and nothing else.
    (dns-records)
21. **kanidm `ldap` route + DNS record removed (APPROVED).** The homelab is OIDC-exclusive and LDAP is
    unused; the operator approved removing the `http://ldap.plato-splunk.media` Caddy challenge vhost
    and the `ldap` A/AAAA record. Intentional deviations: the kanidm Caddy parity gate will show the
    `ldap` challenge vhost dropped, and the DNS gate will show the `ldap` record dropped. The kanidm
    server's own LDAP `bindaddress` setting is left untouched for config parity (nothing routes to
    it). (kanidm, dns-records)
22. **Upstream token standardized to `127.0.0.1` (APPROVED).** See §7.1 #1 — a deliberate bugfix for
    the `localhost` DNS-resolution oddity, not drift. The Caddy parity gate for `localhost`-sourced
    services shows exactly the `localhost → 127.0.0.1` substitution. (it-tools, openwebui, planka,
    home-assistant)
23. **praeconinus vhost may stay bespoke (decide at implementation).** The praeconinus plan recommends
    keeping its Funnel vhost as a `_private` override rather than catalog-izing a 1-off restricted
    host — pragmatic, and operational equivalence is trivially met. Not an approved deviation yet;
    decide during implementation. (praeconinus)

> **Sequencing implication:** items 1–15 (renderer/acme/oidc) must land in the generators **before**
> migrating the services that need them (see README execution order). Items 16–19 are host/firewall/
> darwin concerns handled in their respective steps. Items 20–23 are operator-approved intentional
> deviations (20 apprise, 21 kanidm ldap, 22 `127.0.0.1` standardization) plus one implementation-time
> decision (23 praeconinus). Note gap #9 was **dropped** (no `extraChallengeDomains` needed) now that
> the kanidm `ldap` route is removed rather than modeled.
