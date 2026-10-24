# homelab-api — Catalog Migration (augustus, FULL deployment)

Status: **PROPOSED**
Date: 2026-10-22
Parent: [../service-consolidation-plan.md](../service-consolidation-plan.md) ·
Index: [./README.md](./README.md) ·
Keystone: [./catalog-and-generators.md](./catalog-and-generators.md) ·
Reference pattern: [./it-tools.md](./it-tools.md)

> homelab-api is **not** a new service — it is an existing **feature module** (already multi-file:
> `features/homelab-api/{complete,caddy,kanidm,systemd-service}.nix`). This plan **modernizes** its
> two cross-cutting surfaces (Caddy vhosts + Kanidm OIDC client) onto the catalog + generators. The
> runtime (`systemd-service.nix`) and the secret provisioner stay **untouched** — they are not
> catalog concerns.
>
> **Operational-equivalence contract (from [./README.md](./README.md)):** deploying this revision
> MUST be a theoretical no-op. The migration changes _where_ the vhost/OIDC config is declared (into
> `features/homelab-api/catalog.nix` + `oidc.nix` read by the generators), never _what_ gets
> realized. There are **zero** permitted intentional deviations for homelab-api — both vhosts'
> `extraConfig` and the `oauth2.homelab` client must render byte/structure-identical.

---

## 0. Scope & what makes homelab-api distinctive

Concerns emitted today (per the [index](./README.md)): **V O** — Caddy vhosts and an OIDC client. It
is the `high`-complexity case because it exercises three catalog features no other service combines:

1. **A DUAL vhost** — the secure `https://homelab-api.plato-splunk.media` **and** a plain-HTTP
   `http://homelab-api.plato-splunk.media` variant, each carrying the **same** tempo-gated tracing
   block. No other service declares an insecure http sibling vhost.
2. **Tempo-gated tracing** — a `tracing { span homelab-api }` block emitted only when
   `config.services.tempo.enable`. The keystone renderer (`catalogLib.tracingBlock`,
   [catalog-and-generators §3.1](./catalog-and-generators.md)) already models exactly this.
3. **A PUBLIC OIDC client with a LIST `originUrl` and large `claimMaps`** — `public = true` (PKCE, no
   secret), two callback URLs, two scopeMaps, and a `roles` claimMap mapping two groups to long
   permission lists.

What stays out of scope (explicitly **untouched**):

- `features/homelab-api/systemd-service.nix` — the `services.homelab-api` options, the sops env
  template, the hardened `systemd.services.homelab-api` unit. Skimmed only for context (it defines
  `PORT=35427`, `HOST=127.0.0.1`, the OIDC endpoint, Tempo OTLP wiring, etc.). **Not** a catalog
  concern; it is the service runtime and remains verbatim.
- `homelab-secret-provisioner` (imported by `complete.nix`) — unchanged.
- **Firewall** — homelab-api binds `127.0.0.1:35427` (loopback); the public entrypoint is Caddy on
  `443`/`80`, both already baseline host openings in `_private/augustus/security.nix`. No
  service-attributable firewall rule to migrate (parent plan §5.1 #7).
- **DNS** — the `homelab-api` **and** `homelab` A/AAAA records are produced centrally from
  `tailnetRewrites` on aedilis and migrate with [./dns-records.md](./dns-records.md), not here (§3.4).

> **praeconinus runs a DIFFERENT, restricted homelab-api.** This plan covers the **augustus FULL
> deployment** only. praeconinus serves a base-path-rewritten homelab-api/ui over Tailscale Funnel on
> `:8443` with its own vhost in `_private/praeconinus/programs.nix` (and no Kanidm OIDC client — OIDC
> is augustus-only). That restricted deployment is covered by its own plan
> ([./praeconinus.md](./praeconinus.md), parent plan §5.2 #1); nothing here changes praeconinus. The
> two deployments share a package but have independent vhosts and catalog entries.

---

## 1. Current state — emitted output captured verbatim

### 1.1 The dual Caddy vhosts: `features/homelab-api/caddy.nix`

```nix
{ config, ... }:
let
  c = config.constants;
  svc = c.services.homelab;
in
{
  flake.modules.nixos.homelab-api-caddy =
    { config, lib, ... }:
    let
      tracingBlock = lib.optionalString config.services.tempo.enable ''
        tracing {
          span homelab-api
        }
      '';
    in
    {
      services.caddy.virtualHosts."${svc.url}" = {
        extraConfig = ''
          ${tracingBlock}reverse_proxy 127.0.0.1:${builtins.toString svc.port}
        '';
      };

      services.caddy.virtualHosts."${svc.insecureUrl}" = {
        extraConfig = ''
          ${tracingBlock}reverse_proxy 127.0.0.1:${builtins.toString svc.port}
        '';
      };
    };
}
```

Two vhosts, identical bodies, differing only in key (`svc.url` secure vs `svc.insecureUrl` http).

### 1.2 Constants it reads: `service-registry.nix` (the `homelab` entry)

```nix
homelab = {
  subdomain = "homelab-api";
  domain = mkDomain "homelab-api";               # "homelab-api.plato-splunk.media"
  oidcEndpoint = mkOidcEndpoint "homelab";       # idm …/oauth2/openid/homelab/.well-known/openid-configuration
  clientId = "homelab";
  url = mkUrl "homelab-api";                      # "https://homelab-api.plato-splunk.media"
  frontendUrl = mkUrl "homelab";                  # "https://homelab.plato-splunk.media"
  insecureUrl = mkInsecureUrl "homelab-api";      # "http://homelab-api.plato-splunk.media"
  port = 35427;
  hmacFileName = "hmac.secret";
};
```

with the shared helpers (lines 7–11):

```nix
baseDomain    = "plato-splunk.media";
mkDomain      = subdomain: "${subdomain}.${baseDomain}";
mkUrl         = subdomain: "https://${mkDomain subdomain}";
mkInsecureUrl = subdomain: "http://${mkDomain subdomain}";
```

So the two vhost keys resolve to:

- secure: `https://homelab-api.plato-splunk.media`
- insecure: `http://homelab-api.plato-splunk.media`

and `svc.port` = `35427`.

### 1.3 The resolved emitted Caddy output (Tempo **disabled**)

When `config.services.tempo.enable == false` (so `tracingBlock == ""`), augustus realizes **two**
vhosts with identical single-line bodies:

```nix
services.caddy.virtualHosts."https://homelab-api.plato-splunk.media".extraConfig = ''
  reverse_proxy 127.0.0.1:35427
'';
services.caddy.virtualHosts."http://homelab-api.plato-splunk.media".extraConfig = ''
  reverse_proxy 127.0.0.1:35427
'';
```

### 1.4 The resolved emitted Caddy output (Tempo **enabled**)

When `config.services.tempo.enable == true`, `tracingBlock` is the 3-line heredoc

```
tracing {
  span homelab-api
}
```

(with a trailing newline), interpolated **before** `reverse_proxy` via `${tracingBlock}reverse_proxy
…`. Each vhost body becomes:

```
tracing {
  span homelab-api
}
reverse_proxy 127.0.0.1:35427
```

(trailing newline). **Both** vhosts carry the identical tracing block.

> **Byte-exact notes (both must be reproduced):**
>
> - Upstream token is **`127.0.0.1`** (NOT `localhost` — this differs from it-tools/planka, which use
>   `localhost`). The generator's reverseProxy renderer must emit `127.0.0.1` for this entry.
> - `${tracingBlock}reverse_proxy` concatenation: when Tempo is on, the tracing heredoc's trailing
>   newline sits directly before `reverse_proxy`; when off, `tracingBlock == ""` and the body is just
>   `reverse_proxy 127.0.0.1:35427\n`. The keystone `catalogLib.renderVhostBody` reproduces this by
>   prepending `tracingBlock hostCfg "homelab-api"` then the backend block.
> - Single trailing newline, no leading indentation, on both vhosts.

### 1.5 The PUBLIC OIDC client: `features/homelab-api/kanidm.nix`

```nix
services.kanidm.provision.systems.oauth2."${svc.clientId}" = {   # clientId = "homelab"
  public = true;

  originUrl = [
    "${svc.frontendUrl}/oauth/callback"       # https://homelab.plato-splunk.media/oauth/callback
    "http://localhost:4321/oauth/callback"    # local dev callback (VERBATIM literal)
  ];
  originLanding = "${svc.frontendUrl}";         # https://homelab.plato-splunk.media
  displayName = "Homelab";

  scopeMaps = {
    "homelab.admins" = [ "openid" "profile" "email" ];
    "homelab.access" = [ "openid" "profile" "email" ];
  };

  claimMaps.roles = {
    joinType = "array";
    valuesByGroup = {
      "homelab.admins" = [
        "Config_Wifi" "Config_Certs" "Config_DNS"
        "Status_Health" "Status_Self" "OAuth_ClaimCheck"
      ];
      "homelab.access" = [
        "Config_Wifi" "Config_Certs" "Config_DNS"
        "Status_Self" "OAuth_ClaimCheck"
      ];
    };
  };
};
```

**Irreducible, must pass through verbatim:**

- `public = true` (no `basicSecretFile`).
- `originUrl` is a **LIST of two** — the derived `${frontendUrl}/oauth/callback` **and** the hardcoded
  local-dev literal `http://localhost:4321/oauth/callback`. Note the callbacks hang off
  **`frontendUrl`** (`homelab.plato-splunk.media`), NOT `url` (`homelab-api…`). This is unusual: the
  OIDC callbacks target the **frontend** origin while the service's own vhost is the API origin.
- `originLanding = frontendUrl` (the frontend root, not the API).
- `displayName = "Homelab"`.
- Two `scopeMaps` (`homelab.admins`, `homelab.access`), each `[ "openid" "profile" "email" ]`.
- `claimMaps.roles` with `joinType = "array"` and `valuesByGroup` mapping `homelab.admins` →
  `[Config_Wifi Config_Certs Config_DNS Status_Health Status_Self OAuth_ClaimCheck]` and
  `homelab.access` → the same **minus `Status_Health`** (access lacks the health scope). These two
  lists differ; the generator must not conflate them.

### 1.6 Properties to preserve (invariants checklist)

- **DUAL vhost** — exactly two vhosts (`https://` + `http://`, same `homelab-api` subdomain), each
  with identical body.
- **Tempo-gated tracing** — `tracing { span homelab-api }` on **both** vhosts iff
  `services.tempo.enable`; nothing when disabled.
- **Upstream `127.0.0.1:35427`** (not `localhost`) on both.
- **Public OIDC client** `homelab` — `public = true`, **list** `originUrl` of two (one derived off
  `frontendUrl`, one literal localhost:4321), `originLanding = frontendUrl`, two scopeMaps, the
  asymmetric `roles` claimMap.
- **Runtime untouched** — `systemd-service.nix`, the sops env template, the hardened unit, and
  `homelab-secret-provisioner` are not catalog concerns and do not change.
- **praeconinus unaffected** — its restricted deployment is a separate plan.

---

## 2. Catalog schema gaps this service exposes

homelab-api is the service that stress-tests the schema. Three discussion points the keystone
([./catalog-and-generators.md](./catalog-and-generators.md)) must satisfy:

### 2.1 (a) The DUAL vhost (secure + insecure http) — second entry vs `insecureUrl` flag?

Today a single module emits **two** `services.caddy.virtualHosts` keys (`https://…` and `http://…`)
with identical bodies. The catalog's `caddy-nixos` generator maps **one entry → one vhost key**
(`"https://${fqdn e}"`, optionally `:listenPort`). It has **no** notion of an http sibling. Two
candidate designs:

- **Option A — a `tls.insecureHttp` flag on the entry.** Add a boolean to `tlsType`; when true, the
  caddy-nixos generator emits a **second** vhost keyed `http://${fqdn e}` with the **same**
  `renderVhostBody` output. One catalog entry, generator fans out to two vhosts. Pros: one
  declaration, the http sibling is obviously tied to the service, impossible to drift its body from
  the secure one (same renderer call). Cons: the generator's `mapAttrs'` becomes a `concatMap`/
  `listToAttrs` to allow one entry → ≥1 vhost.
- **Option B — a second catalog entry** (e.g. `homelab-api-insecure`) with `subdomain =
  "homelab-api"` and a marker making its key `http://` instead of `https://`. Pros: no generator
  fan-out change. Cons: duplicates subdomain/host/backend/tracing across two entries (exactly the
  drift the catalog exists to kill), and needs a schema escape to force the `http://` scheme + skip
  DNS/firewall double-counting.

**Recommendation: Option A (`tls.insecureHttp` flag).** It keeps the "one declaration per service"
invariant and guarantees the two bodies are byte-identical because they come from the same
`renderVhostBody` call. Proposed schema addition (keystone `tlsType`):

```nix
insecureHttp = mkOption {
  type = types.bool;
  default = false;
  description = ''
    Also emit a plain-HTTP (http://<fqdn>) vhost with the SAME body as the secure
    vhost. Used by homelab-api, which serves an insecure http sibling of its secure
    vhost. The generator renders both from one renderVhostBody call so their bodies
    can never drift. Does NOT create a second DNS record or firewall opening (the
    http vhost reuses the service's existing name/ports).
  '';
};
```

and the generator change (keystone §3.2) — one entry yields one or two name/value pairs:

```nix
mkVhosts = name: e:
  let
    body = catLib.renderVhostBody { hostCfg = config; entry = e; inherit name; certDir = … ; };
    secure = lib.nameValuePair "https://${catLib.fqdn e}" { extraConfig = body; };
    insecure = lib.nameValuePair "http://${catLib.fqdn e}" { extraConfig = body; };
  in
  [ secure ] ++ lib.optional e.tls.insecureHttp insecure;
# services.caddy.virtualHosts = listToAttrs (concatMap (n: e: mkVhosts n e) …);
```

> The listen-port suffix (`:8443`) logic is orthogonal and only applies to the Funnel case; the
> insecure sibling here is plain `:80` (Caddy's default for an `http://` site key), matching today.

### 2.2 (b) Tempo-gated tracing — already handled by the renderer

No new schema is needed. `catalogLib.tracingBlock hostCfg name` (keystone §3.1) emits `tracing { span
<name> }` **iff** `hostCfg.services.tempo.enable`, byte-identical to this module's `tracingBlock`.
`renderVhostBody` prepends it to the backend block exactly as `${tracingBlock}reverse_proxy …` does
today. The span name is the catalog **entry name** (`homelab-api`) — so the entry MUST be named
`homelab-api` for the span to read `span homelab-api`. Because the flag drives both the secure and
insecure vhost through the same renderer, both get the tracing block together, matching §1.4.

### 2.3 (c) Public OIDC client with LIST `originUrl` + big claimMaps — schema already supports it

The keystone `oidcType` (§3.7) already covers every piece:

- `public = true` → the generator emits `{ public = true; }` and omits `basicSecretFile`.
- `callbackPath` is `types.either str (listOf str)`; the generator does `toList callbackPath` then
  `map (p: "${base}${p}")`, emitting a **list** `originUrl` when >1. **BUT** note the subtlety below
  about the base origin.
- `scopeMaps` / `claimMaps` are passed **verbatim** (`attrsOf (listOf str)` and `attrs`), so the
  asymmetric `roles` claimMap flows through unchanged.

**The one genuine gap: the callback/landing base is `frontendUrl`, not the service `url`.** The
keystone generator derives `base = catLib.url e` (= `https://<subdomain>.<zone>` = the API origin
`https://homelab-api…`). But homelab-api's callbacks/landing hang off the **frontend** origin
`https://homelab.plato-splunk.media`. And the second callback is a **non-derivable literal**
(`http://localhost:4321/oauth/callback`). Two schema additions are required (discussed in §4):

1. an `oidc.originBase` override (default = the entry's `url`) so a service can point callbacks at a
   different origin (here the frontend); and
2. support for **absolute** callback URLs in `callbackPath` (a full `http(s)://…` string is used
   verbatim rather than appended to the base), to carry the `localhost:4321` literal.

These are the only real schema deltas homelab-api forces. Everything else (public, scopeMaps,
claimMaps) is already expressible.

---

## 3. Target state — colocated feature layout

homelab-api is **already** a feature directory. The migration **adds** `catalog.nix` + `oidc.nix`,
**replaces** `caddy.nix` + `kanidm.nix` with catalog entries consumed by the generators, and updates
`complete.nix`'s imports. `systemd-service.nix` is **unchanged**.

```
features/homelab-api/
├── systemd-service.nix   # UNCHANGED — services.homelab-api options + hardened unit + sops env
├── catalog.nix           # NEW — homelab.catalog.homelab-api = { … } (vhost networking contract)
├── oidc.nix              # NEW — the OIDC slice fed into the catalog entry (public, list originUrl, claimMaps)
├── caddy.nix             # REMOVED — replaced by catalog.nix + caddy-nixos generator
├── kanidm.nix            # REMOVED — replaced by oidc.nix + oidc generator
└── complete.nix          # UPDATED imports (drop homelab-api-caddy/homelab-kanidm; keep service + provisioner)
```

### 3.1 `features/homelab-api/catalog.nix`

```nix
{ config, ... }:
let
  svc = config.constants.services.homelab;   # transition: still read the registry entry
in
{
  flake.modules.nixos.homelab-api-catalog =
    { ... }:
    {
      homelab.catalog.homelab-api = {
        # entry name MUST be "homelab-api" so the tracing span reads `span homelab-api`.
        subdomain = "homelab-api";           # -> fqdn homelab-api.plato-splunk.media, url https://…
        zone = "plato-splunk.media";         # default baseDomain; stated for clarity
        host = "augustus";                   # the FULL deployment runs on augustus

        backend.reverseProxy.port = svc.port;   # 35427 (renderer hardcodes 127.0.0.1 upstream)

        # Shares Caddy's managed cert (no manual ACME cert, no challenge vhost).
        tls = {
          cert.shared = { };
          insecureHttp = true;               # ALSO emit http://homelab-api.plato-splunk.media (§2.1)
          # gate defaults to tls.gate.none; app-handled OIDC is documentation-only (no Caddy auth).
        };

        access.scope.tailnet = { };          # reachable over tailscale0; 443/80 are baseline openings

        dns.tailnet = { };                   # emit homelab-api A/AAAA on aedilis (reproduces tailnetRewrites)

        # OIDC slice defined in oidc.nix (merged into this same entry); see §3.2.
      };
    };
}
```

> **Upstream token.** The shared renderer standardizes on **`127.0.0.1`** for every reverse-proxy
> service (operator-approved — catalog-and-generators §7.8 #22). homelab-api already uses `127.0.0.1`
> today, so this vhost is byte-identical with **no** approved deviation here (unlike it-tools/planka/
> openwebui/home-assistant, which see the `localhost → 127.0.0.1` substitution). No
> `backend.upstreamHost` field is needed — the earlier proposal is dropped.

### 3.2 `features/homelab-api/oidc.nix` (the OIDC slice merged into the entry)

```nix
{ config, ... }:
let
  svc = config.constants.services.homelab;
in
{
  flake.modules.nixos.homelab-api-oidc =
    { ... }:
    {
      homelab.catalog.homelab-api.oidc = {
        clientId = svc.clientId;             # "homelab" (NOT the entry name "homelab-api")
        client.public = { };                 # PKCE, no basicSecretFile
        displayName = "Homelab";

        # Callbacks/landing hang off the FRONTEND origin, not the API url -> override base.
        originBase = svc.frontendUrl;        # https://homelab.plato-splunk.media  (§2.3 gap #1)

        callbackPath = [
          "/oauth/callback"                  # appended to originBase -> …homelab…/oauth/callback
          "http://localhost:4321/oauth/callback"  # ABSOLUTE literal, used verbatim (§2.3 gap #2)
        ];
        landingPath = "/";                   # originLanding = originBase + "/" = frontendUrl + "/"

        scopeMaps = {
          "homelab.admins" = [ "openid" "profile" "email" ];
          "homelab.access" = [ "openid" "profile" "email" ];
        };

        claimMaps.roles = {
          joinType = "array";
          valuesByGroup = {
            "homelab.admins" = [
              "Config_Wifi" "Config_Certs" "Config_DNS"
              "Status_Health" "Status_Self" "OAuth_ClaimCheck"
            ];
            "homelab.access" = [
              "Config_Wifi" "Config_Certs" "Config_DNS"
              "Status_Self" "OAuth_ClaimCheck"
            ];
          };
        };
      };
    };
}
```

> `clientId = "homelab"` is critical: the Kanidm oauth2 attribute key must stay `homelab` (the entry
> is named `homelab-api`, but `oidc.clientId` defaults to the entry name and is overridden here).
> The `oidcEndpoint` the runtime consumes (`mkOidcEndpoint "homelab"`) also keys off `homelab`, so
> clientId MUST remain `homelab` for the discovery URL and the registered client to match.

### 3.3 `features/homelab-api/complete.nix` (updated imports)

```nix
{ inputs, ... }:
{
  flake.modules.nixos.homelab-api = {
    imports = with inputs.self.modules.nixos; [
      homelab-secret-provisioner    # UNCHANGED
      homelab-api-service           # UNCHANGED (systemd-service.nix)
      homelab-api-catalog           # NEW — contributes homelab.catalog.homelab-api (vhost)
      homelab-api-oidc              # NEW — contributes the .oidc slice of that entry
      # homelab-api-caddy  REMOVED  — vhosts now from the caddy-nixos generator
      # homelab-kanidm     REMOVED  — oauth2 client now from the oidc generator
    ];
  };
}
```

> `hosts/augustus.nix` keeps importing the single `nixos.homelab-api`; the generators
> (`homelab-service-caddy`, `homelab-service-oidc`) are imported once by augustus via the
> `homelab-service-oidc-host` aggregator (keystone §1 import matrix). Importing the feature registers
> the catalog entry; the generators render it.

### 3.4 What the generators must render

**caddy-nixos generator** (with the `tls.insecureHttp` fan-out from §2.1) must produce **two** vhosts
on augustus:

```nix
services.caddy.virtualHosts."https://homelab-api.plato-splunk.media".extraConfig = ''
  <tracingBlock>reverse_proxy 127.0.0.1:35427
'';
services.caddy.virtualHosts."http://homelab-api.plato-splunk.media".extraConfig = ''
  <tracingBlock>reverse_proxy 127.0.0.1:35427
'';
```

where `<tracingBlock>` is empty when `services.tempo.enable == false`, else the
`tracing {\n  span homelab-api\n}\n` heredoc — identical on both vhosts.

**oidc generator** (augustus only) must produce:

```nix
services.kanidm.provision.systems.oauth2.homelab = {
  public = true;
  displayName = "Homelab";
  originUrl = [
    "https://homelab.plato-splunk.media/oauth/callback"
    "http://localhost:4321/oauth/callback"
  ];
  originLanding = "https://homelab.plato-splunk.media/";
  scopeMaps = { "homelab.admins" = [ "openid" "profile" "email" ]; "homelab.access" = [ "openid" "profile" "email" ]; };
  claimMaps.roles = { joinType = "array"; valuesByGroup = { … }; };
};
```

> **Watch the landing trailing slash.** Today `originLanding = "${svc.frontendUrl}"` =
> `https://homelab.plato-splunk.media` (**no** trailing slash). The keystone generator computes
> `originLanding = "${base}${landingPath}"`. With `landingPath = "/"` and `base = frontendUrl` that
> yields `https://homelab.plato-splunk.media/` **with** a trailing slash — a **mismatch**. To stay
> byte-exact either set `landingPath = ""` (empty) so the landing equals `frontendUrl` exactly, or
> make `landingPath` default to `""` rather than `"/"`. **Recommendation: set `landingPath = ""`** in
> `oidc.nix` so `originLanding` reproduces today's no-slash value. The §5 JSON parity gate will catch
> this if missed — it is the single most likely source of a non-empty diff for this service.

---

## 4. Schema gaps homelab-api forces (summary for the keystone plan)

These are the concrete `features/homelab-service/options.nix` deltas this service requires. Each is
additive and defaulted so existing entries are unaffected (operational no-op for other services).

| Gap                                 | Field (keystone type)                            | Why                                                        | Default (no-op for others)                           |
| ----------------------------------- | ------------------------------------------------ | ---------------------------------------------------------- | ---------------------------------------------------- |
| Dual secure+insecure vhost          | `tls.insecureHttp : bool`                        | emit `http://` sibling with same body (§2.1)               | `false`                                              |
| Reverse-proxy upstream host         | _n/a — renderer hardcodes `127.0.0.1`_           | approved global standardization (§7.8 #22); no field       | — (dropped)                                          |
| OIDC callback/landing base override | `oidc.originBase : nullOr str`                   | callbacks hang off `frontendUrl`, not the API `url` (§2.3) | `null` → use entry `url`                             |
| Absolute callback URLs              | `callbackPath` entries may be full `http(s)://…` | carry the `localhost:4321` literal verbatim (§2.3)         | append-to-base behavior unchanged for relative paths |
| Landing without trailing slash      | `oidc.landingPath` default `""`                  | reproduce no-slash `originLanding` (§3.4)                  | `""` (or per-entry override)                         |

Generator-side implications (keystone §3.2 / §3.7):

- caddy-nixos: one entry → one-or-two vhosts via `lib.optional e.tls.insecureHttp` (switch
  `mapAttrs'` → `concatMap` + `listToAttrs`).
- oidc: `base = e.oidc.originBase or (catLib.url e)`; and for each `callbackPath` entry,
  `if lib.hasPrefix "http" p then p else "${base}${p}"` so absolute URLs pass through and relative
  ones append.

None of these alter any other service's rendered output (all defaults preserve current behavior), so
introducing them is itself a no-op — consistent with the keystone's "module introduction is a no-op"
gate.

---

## 5. Operational equivalence — parity gates (exact commands)

> **Prerequisite (`.kiro/steering/validation.md`):** flake eval reads the **git tree**. `git add` the
> new `features/homelab-api/{catalog,oidc}.nix` and stage the removal of `caddy.nix`/`kanidm.nix`
> before any eval — untracked new `.nix` files are invisible to `import-tree` and yield misleading
> "missing attribute" errors. (Do not run these now; this is the gate the implementation PR must
> pass.)

### 5.1 Dual vhost parity — `--raw` each vhost, Tempo OFF and ON

Both vhosts, captured before/after; diffs must be empty. **Run twice** — once with Tempo disabled
(augustus default) and once forcing `services.tempo.enable = true` — to prove the tracing gate
behaves identically.

```sh
# SECURE vhost:
nix eval \
  '.#nixosConfigurations.augustus.config.services.caddy.virtualHosts."https://homelab-api.plato-splunk.media".extraConfig' \
  --raw > /tmp/api-secure.before     # (….after after migration; diff must be empty)

# INSECURE http vhost:
nix eval \
  '.#nixosConfigurations.augustus.config.services.caddy.virtualHosts."http://homelab-api.plato-splunk.media".extraConfig' \
  --raw > /tmp/api-insecure.before   # (….after; diff must be empty)
```

Expected body (Tempo OFF), both vhosts, byte-for-byte:

```
reverse_proxy 127.0.0.1:35427
```

Expected body (Tempo ON), both vhosts:

```
tracing {
  span homelab-api
}
reverse_proxy 127.0.0.1:35427
```

(each with a single trailing newline, no leading indentation, `127.0.0.1` not `localhost`). Any
non-empty `diff` is a FAIL — no intentional deviation is permitted for homelab-api.

### 5.2 Whole-vhosts sanity (catches a dropped sibling or stray attr)

```sh
nix eval '.#nixosConfigurations.augustus.config.services.caddy.virtualHosts' --json \
  | jq '{secure:."https://homelab-api.plato-splunk.media", insecure:."http://homelab-api.plato-splunk.media"}'
```

Before/after must match — confirms **both** keys still exist (dual vhost preserved) and no extra
`tls`/`serverAliases` crept in.

### 5.3 OIDC client parity — `--json` the `oauth2.homelab` client

```sh
nix eval \
  '.#nixosConfigurations.augustus.config.services.kanidm.provision.systems.oauth2.homelab' \
  --json > /tmp/api-oauth2.before    # (….after; diff must be empty)
diff <(jq -S . /tmp/api-oauth2.before) <(jq -S . /tmp/api-oauth2.after)   # must be empty
```

Assert the irreducible fields explicitly:

```sh
jq '{public, displayName, originUrl, originLanding, scopeMaps, claimMaps}' /tmp/api-oauth2.after
# public == true
# originUrl == ["https://homelab.plato-splunk.media/oauth/callback","http://localhost:4321/oauth/callback"]
# originLanding == "https://homelab.plato-splunk.media"   (NO trailing slash — see §3.4)
# scopeMaps.{homelab.admins,homelab.access} == ["openid","profile","email"]
# claimMaps.roles.joinType == "array"
# claimMaps.roles.valuesByGroup."homelab.admins" includes Status_Health; "homelab.access" does NOT
```

The key under `oauth2` MUST be `homelab` (clientId), not `homelab-api` (entry name).

### 5.4 No-change checks (runtime, firewall, provisioner untouched)

```sh
# systemd unit + sops env template unchanged (runtime is out of scope):
nix eval '.#nixosConfigurations.augustus.config.systemd.services.homelab-api' --json > /tmp/api-unit.after
nix eval '.#nixosConfigurations.augustus.config.sops.templates."homelab-api-env".content' --raw > /tmp/api-env.after
#   diff both against pre-migration captures -> must be empty

# firewall unchanged (443/80 are baseline; no service-attributable opening):
nix eval '.#nixosConfigurations.augustus.config.networking.firewall.allowedTCPPorts' --json
```

### 5.5 DNS parity (deferred to the dns-records migration)

The `homelab-api` **and** `homelab` A/AAAA records (both → augustus) stay produced by
`tailnetRewrites` until [./dns-records.md](./dns-records.md) switches on the DNS generator. `dns.tailnet
= { }` here declares intent; verify at cutover:

```sh
nix eval \
  '.#nixosConfigurations.aedilis.config.services.technitium-server-complete.provision.ensureDnsRecords.zones' \
  --json | jq '."plato-splunk.media".records | map(select(.name=="homelab-api" or .name=="homelab"))'
```

> **Note the two names.** The API vhost lives at `homelab-api`, but the frontend origin `homelab`
> (used by the OIDC callbacks/landing) is a **separate** name also pointing at augustus — today both
> are `tailnetRewrites` entries (`homelab-api = "augustus"; homelab = "augustus";`). The `homelab`
> record is owned by the **homelab-ui** catalog entry (its `subdomain = "homelab"`), see
> [./homelab-ui.md](./homelab-ui.md) §3.1 — homelab-api only owns the `homelab-api` record. Confirm
> both survive the cutover; the split of ownership between the two features is intentional.

### 5.6 Build gate

```sh
nix run .#nixfmt -- $(git ls-files '*.nix' ':!:repos/**')
nix flake check
nixos-rebuild build --flake .#augustus       # closure builds; diff store path if desired
```

---

## 6. Step-by-step migration checklist

> Depends on the keystone catalog schema + generators existing with the §4 deltas
> ([./catalog-and-generators.md](./catalog-and-generators.md)). Comes **after** the simple reference
> services (parent plan §3: homelab-api is step 5, a `high`-complexity migration).

1. **Add the §4 schema deltas** to `features/homelab-service/options.nix` (`tls.insecureHttp`,
   `oidc.originBase`, absolute-callback handling, `landingPath` default `""`) and the matching
   generator logic (keystone §3.2 fan-out, §3.7 base override, and the global `127.0.0.1` upstream
   standardization). Verify introducing them is a no-op for already-migrated services (re-run their
   parity gates).

2. **Capture baseline** (the equivalence oracle): §5.1 (both vhosts `--raw`, Tempo OFF **and** ON),
   §5.2 (whole-vhost JSON), §5.3 (`oauth2.homelab` JSON), §5.4 (unit + env + firewall). Save to
   `/tmp/api-*.before`.

3. **Create `features/homelab-api/catalog.nix`** — the `homelab.catalog.homelab-api` entry from §3.1
   (`subdomain = "homelab-api"`, `host = "augustus"`, `backend.reverseProxy.port = 35427`,
   `tls = { cert.shared = { }; insecureHttp = true; }`, `access.scope.tailnet = { }`, `dns.tailnet = { }`).
   Entry name MUST be `homelab-api` (tracing span). (Upstream is `127.0.0.1` via the renderer — no
   per-entry field.)

4. **Create `features/homelab-api/oidc.nix`** — the `.oidc` slice from §3.2 (`client.public = { }`,
   `clientId = "homelab"`, `originBase = frontendUrl`, list `callbackPath` incl. the absolute
   `localhost:4321` literal, `landingPath = ""`, both scopeMaps, the asymmetric `roles` claimMap).

5. **Opt the entry into the caddy + oidc generators** (`managedBy.caddy = true;
   managedBy.oidc = true;` per the keystone incremental opt-in) so the generators render the two
   vhosts and the `homelab` oauth2 client **instead of** the hand-written modules.

6. **Delete `features/homelab-api/caddy.nix` and `kanidm.nix`.** Their output now comes from the
   generators.

7. **Update `complete.nix`** (§3.3): drop `homelab-api-caddy` and `homelab-kanidm` from imports; add
   `homelab-api-catalog` and `homelab-api-oidc`; keep `homelab-secret-provisioner` and
   `homelab-api-service`. **Do not touch `systemd-service.nix`.**

8. **Stage for Nix eval:** `git add nix-config/modules/features/homelab-api/{catalog,oidc}.nix` and
   stage the `git rm` of `caddy.nix`/`kanidm.nix`.

9. **Run the parity gate.** Re-capture §5.1–§5.4 → `/tmp/api-*.after`; `diff` each against `.before`.
   **All diffs MUST be empty** (both Tempo modes for the vhosts; `jq -S` normalized for oauth2).
   Common culprits: `localhost` vs `127.0.0.1`; missing http sibling (insecureHttp not wired); tracing
   block on only one vhost; `originLanding` trailing slash (§3.4); `originUrl` emitted as a single
   string instead of a 2-element list; clientId keyed as `homelab-api` instead of `homelab`.

10. **DNS deferred** — leave `tailnetRewrites.{homelab-api,homelab} = "augustus"` in place; verify §5.5
    at the dns-records cutover.

11. **Format + check + build.** `nix run .#nixfmt -- …`, `nix flake check`,
    `nixos-rebuild build --flake .#augustus`. All must pass.

12. **Deploy as a no-op.** Every realized attribute (both vhosts, the `homelab` oauth2 client, the
    unchanged unit/env/provisioner, firewall) is identical; the switch is a theoretical no-op. The
    praeconinus restricted deployment is unaffected (separate plan).

---

## 7. Migration checklist (condensed)

- [ ] Keystone §4 schema deltas added (`tls.insecureHttp`, `oidc.originBase`, absolute callbacks,
      `landingPath` default `""`, global `127.0.0.1` upstream) + generator fan-out/base override;
      re-verified no-op for already-migrated services
- [ ] Baseline captured: both vhosts `--raw` (Tempo OFF **and** ON), whole-vhost JSON,
      `oauth2.homelab` JSON, unit/env/firewall → `*.before`
- [ ] `features/homelab-api/catalog.nix` — dual vhost entry (`insecureHttp = true`, `tls.cert.shared = { }`,
      `access.scope.tailnet = { }`, `dns.tailnet = { }`, entry named `homelab-api`)
- [ ] `features/homelab-api/oidc.nix` — public client, `clientId = "homelab"`,
      `originBase = frontendUrl`, list `callbackPath` (incl. `localhost:4321` literal),
      `landingPath = ""`, both scopeMaps, asymmetric `roles` claimMap
- [ ] `caddy.nix` + `kanidm.nix` removed; `complete.nix` imports updated (drop
      `homelab-api-caddy`/`homelab-kanidm`, add `homelab-api-catalog`/`homelab-api-oidc`)
- [ ] `systemd-service.nix` + `homelab-secret-provisioner` **untouched**
- [ ] New files `git add`ed, deletions staged
- [ ] **Parity gate green:** both vhosts `--raw` diff empty (Tempo OFF **and** ON, §5.1); whole-vhost
      JSON match (§5.2); `oauth2.homelab` `--json` diff empty incl. no-slash landing + 2-element
      originUrl list + `homelab` key (§5.3); unit/env/firewall unchanged (§5.4)
- [ ] DNS parity deferred to [./dns-records.md](./dns-records.md) — both `homelab-api` **and**
      `homelab` records confirmed at cutover (§5.5); `homelab` record owned by homelab-ui entry
- [ ] `nix run .#nixfmt`, `nix flake check`, `nixos-rebuild build --flake .#augustus` pass
- [ ] Deployed — confirmed no-op; praeconinus restricted deployment unaffected
