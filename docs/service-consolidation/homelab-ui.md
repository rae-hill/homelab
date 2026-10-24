# homelab-ui — Catalog Migration (augustus, static frontend)

Status: **PROPOSED**
Date: 2026-10-22
Parent: [../service-consolidation-plan.md](../service-consolidation-plan.md) ·
Index: [./README.md](./README.md) ·
Keystone: [./catalog-and-generators.md](./catalog-and-generators.md) ·
Reference pattern: [./it-tools.md](./it-tools.md) ·
Sibling: [./homelab-api.md](./homelab-api.md)

> homelab-ui is an existing **feature module** (`features/homelab-ui/{complete,caddy}.nix`) being
> **modernized** onto the catalog. It is the canonical **static `file_server`** case: Caddy serves a
> built package root rather than reverse-proxying an app. Its only cross-cutting surface is **one
> Caddy vhost** (V, static) with a tempo-gated tracing span — no OIDC, no manual TLS cert, no
> firewall opening, and no runtime systemd unit (the package is built, not run).
>
> **Operational-equivalence contract (from [./README.md](./README.md)):** deploying this revision
> MUST be a theoretical no-op. The migration changes _where_ the vhost is declared (into
> `features/homelab-ui/catalog.nix` read by the caddy-nixos generator), never _what_ gets realized.
> **Zero** permitted intentional deviations — the single vhost `extraConfig` must render
> byte-identical (static `root`/`header`/`file_server` block, with the tracing gate).

---

## 0. Scope & what makes homelab-ui distinctive

Concerns emitted today (per the [index](./README.md)): **V (static)** — exactly one Caddy vhost that
serves static files. It is `low`-complexity but it is the **only** service whose
`backend.static` is set, so it is the end-to-end exercise of the catalog's static backend:

- **Static backend** — `root * <uiPkg>` + a `header /*.html Cache-Control` directive + `file_server`,
  instead of `reverse_proxy`. The keystone `catalogLib.backendBlock` (`backend.static`) models
  exactly this shape ([catalog-and-generators §3.1](./catalog-and-generators.md)).
- **Tempo-gated tracing** — a `tracing { span homelab-ui }` block emitted only when
  `config.services.tempo.enable`, identical mechanism to homelab-api.
- **Package root as the backend** — the `backend.static.root` is a derivation
  (`inputs.self.packages.x86_64-linux.homelab-ui`), not a port. This is the schema's `backend.static.root`
  path field.

What stays out of scope / absent:

- **No OIDC** — the UI is a static SPA; auth is handled by the API. No Kanidm client.
- **No manual TLS cert** — shares Caddy's managed cert (`tls.cert.shared = { }`), no `security.acme.certs`,
  no challenge vhost.
- **No firewall opening** — nothing to bind; served by Caddy on `443`, a baseline host opening.
- **No `service.nix` / systemd unit / failure-notifs** — there is no process to run; the package is
  built and served statically (parent plan §2.0: "a static frontend like homelab-ui has no
  `service.nix`/`oidc.nix` — just `catalog.nix` and `complete.nix`").
- **No `package.nix` change** — the `homelab-ui` package derivation stays as-is; the catalog only
  references the built output.

> **The frontend origin `homelab` belongs to homelab-ui.** homelab-ui's vhost key is
> `svc.frontendUrl = https://homelab.plato-splunk.media` (subdomain `homelab`), **distinct** from
> homelab-api's `homelab-api` subdomain. The OIDC callbacks/landing in the
> [homelab-api plan](./homelab-api.md) point at this `homelab` origin, but the **DNS record and vhost
> for `homelab`** are owned by **this** (homelab-ui) feature. The two features deliberately split:
> homelab-api owns `homelab-api`, homelab-ui owns `homelab`.

---

## 1. Current state — emitted output captured verbatim

### 1.1 The static Caddy vhost: `features/homelab-ui/caddy.nix`

```nix
{ config, inputs, ... }:
let
  svc = config.constants.services.homelab;
  pkg = inputs.self.packages.x86_64-linux.homelab-ui;
in
{
  flake.modules.nixos.homelab-ui-caddy =
    { config, lib, ... }:
    let
      tracingBlock = lib.optionalString config.services.tempo.enable ''
        tracing {
          span homelab-ui
        }
      '';
    in
    {
      services.caddy.virtualHosts."${svc.frontendUrl}" = {
        extraConfig = ''
          ${tracingBlock}root * ${pkg}
          header /*.html Cache-Control "no-cache, must-revalidate"
          file_server
        '';
      };
    };
}
```

### 1.2 `features/homelab-ui/complete.nix`

```nix
{ inputs, ... }:
{
  flake.modules.nixos.homelab-ui = {
    imports = with inputs.self.modules.nixos; [
      homelab-ui-caddy
    ];
  };
}
```

### 1.3 Constants it reads: the `homelab` entry in `service-registry.nix`

```nix
homelab = {
  subdomain   = "homelab-api";
  frontendUrl = mkUrl "homelab";   # "https://homelab.plato-splunk.media"   <-- the UI vhost key
  # … (url, insecureUrl, port, clientId, oidcEndpoint — consumed by homelab-api, not the UI)
};
```

with `mkUrl = subdomain: "https://${subdomain}.plato-splunk.media"`, so
`svc.frontendUrl = https://homelab.plato-splunk.media`. The package is
`inputs.self.packages.x86_64-linux.homelab-ui` (a store path at eval, e.g.
`/nix/store/<hash>-homelab-ui`).

### 1.4 The resolved emitted Caddy output (Tempo **disabled**)

When `config.services.tempo.enable == false` (`tracingBlock == ""`), augustus realizes a single
vhost:

```nix
services.caddy.virtualHosts."https://homelab.plato-splunk.media".extraConfig = ''
  root * /nix/store/<hash>-homelab-ui
  header /*.html Cache-Control "no-cache, must-revalidate"
  file_server
'';
```

### 1.5 The resolved emitted Caddy output (Tempo **enabled**)

When `config.services.tempo.enable == true`, `tracingBlock` is the 3-line heredoc

```
tracing {
  span homelab-ui
}
```

(trailing newline), interpolated **before** `root *` via `${tracingBlock}root * …`. The body becomes:

```
tracing {
  span homelab-ui
}
root * /nix/store/<hash>-homelab-ui
header /*.html Cache-Control "no-cache, must-revalidate"
file_server
```

(trailing newline).

> **Byte-exact notes:**
>
> - The static block is three lines: `root * <pkg>`, then `header /*.html Cache-Control "no-cache,
>   must-revalidate"`, then `file_server`, each newline-separated with a single trailing newline.
> - The `header` directive value is **quoted** exactly `"no-cache, must-revalidate"` (comma + space).
> - `<pkg>` interpolates the **store path** of the `homelab-ui` derivation — so the vhost body embeds
>   a hash. The parity gate (§4) compares the fully-realized string, meaning the generator must
>   reference the **same** package (`inputs.self.packages.x86_64-linux.homelab-ui`) so the store path
>   matches. (If the package rebuilds for an unrelated reason the hash changes equally on both sides,
>   so the diff stays empty as long as both reference the identical derivation.)
> - `${tracingBlock}root *` concatenation: tempo-on prepends the tracing heredoc (with its trailing
>   newline) directly before `root *`; tempo-off yields the bare 3-line static block. The keystone
>   `renderVhostBody` reproduces this by prepending `tracingBlock hostCfg "homelab-ui"` then the
>   static `backendBlock`.

### 1.6 Properties to preserve (invariants checklist)

- **Single static vhost** keyed `https://homelab.plato-splunk.media` (subdomain `homelab`).
- **Static backend** — `root * <uiPkg>` + `header /*.html Cache-Control "no-cache, must-revalidate"`
  - `file_server` (not `reverse_proxy`).
- **Tempo-gated tracing** — `tracing { span homelab-ui }` iff `services.tempo.enable`; nothing when
  disabled.
- **Same package store path** — references `inputs.self.packages.x86_64-linux.homelab-ui`.
- **No OIDC, no cert, no firewall, no systemd unit, no failure-notifs** — none exist; none added.
- **`homelab` DNS record owned here** — subdomain `homelab` → augustus (homelab-api owns the separate
  `homelab-api` record).

---

## 2. Catalog schema fit — static backend already supported

Unlike [homelab-api](./homelab-api.md), homelab-ui forces **no new schema beyond the existing static
backend**. The keystone already covers it:

### 2.1 Static backend (`backend.static`, `backend.static.root`)

The keystone `backend` attrTag (`catalog-and-generators §2`) already has:

```nix
backend = mkOption {
  type = types.attrTag {
    reverseProxy = mkOption { type = types.submodule { options.port = mkOption { type = types.port; }; }; };
    static = mkOption {
      type = types.submodule {
        options.root = mkOption { type = types.path;
          description = "Static site root (a package/derivation)."; };
      };
    };
    # … none, raw variants
  };
};
```

and `catalogLib.backendBlock` (`§3.1`) already emits the exact 3-line static body:

```nix
backendBlock = e:
  if e.backend ? reverseProxy
  then "reverse_proxy localhost:${toString e.backend.reverseProxy.port}\n"
  else ''
    root * ${e.backend.static.root}
    header /*.html Cache-Control "no-cache, must-revalidate"
    file_server
  '';
```

This is byte-identical to today's static block (same `header /*.html Cache-Control` directive, same
quoted value, same `file_server`). **No schema gap** — the keystone author wrote the static renderer
against this exact module.

### 2.2 Tempo-gated tracing — already handled

As with homelab-api, `catalogLib.tracingBlock hostCfg name` emits `tracing { span <name> }` iff
`hostCfg.services.tempo.enable`. The span name is the catalog **entry name**, so the entry MUST be
named `homelab-ui` for the span to read `span homelab-ui`. `renderVhostBody` prepends it before the
static backend block, reproducing `${tracingBlock}root * …`.

### 2.3 One genuine verification point: the `backend.static.root` path value

`backend.static.root` is `types.path`. The catalog entry must set it to **the same derivation**
the current module references (`inputs.self.packages.x86_64-linux.homelab-ui`) so the embedded store
path matches byte-for-byte. The entry reads the package from `inputs.self.packages` exactly as
`caddy.nix` does today — no indirection, no rebuild trigger. (The keystone renderer interpolates
`${e.backend.static.root}`, which stringifies the derivation to its out-path, identical to `${pkg}` today.)

> This is the only schema interaction worth calling out, and it is already supported — `types.path`
> accepts a derivation and stringifies to the store path. The static backend is strictly less
> demanding than homelab-api's dual-vhost / list-originUrl needs; homelab-ui is the clean
> static-backend proof the keystone renderer works.

---

## 3. Target state — colocated feature layout

homelab-ui is already a feature directory. The migration **adds** `catalog.nix`, **removes**
`caddy.nix`, and updates `complete.nix`. There is **no** `service.nix`/`oidc.nix` (no runtime, no
OIDC), matching the parent-plan static-frontend shape (§2.0).

```
features/homelab-ui/
├── catalog.nix    # NEW — homelab.catalog.homelab-ui = { backend.static.root = <pkg>; … }
├── caddy.nix      # REMOVED — replaced by catalog.nix + caddy-nixos generator
└── complete.nix   # UPDATED — import homelab-ui-catalog instead of homelab-ui-caddy
```

### 3.1 `features/homelab-ui/catalog.nix`

```nix
{ config, inputs, ... }:
let
  svc = config.constants.services.homelab;
  pkg = inputs.self.packages.x86_64-linux.homelab-ui;   # SAME derivation referenced by caddy.nix today
in
{
  flake.modules.nixos.homelab-ui-catalog =
    { ... }:
    {
      homelab.catalog.homelab-ui = {
        # entry name MUST be "homelab-ui" so the tracing span reads `span homelab-ui`.
        subdomain = "homelab";               # -> fqdn homelab.plato-splunk.media == svc.frontendUrl
        zone = "plato-splunk.media";         # default baseDomain; stated for clarity
        host = "augustus";                   # the FULL deployment runs on augustus

        backend.static.root = pkg;           # root * <store path> + header + file_server

        # Shares Caddy's managed cert (no manual ACME cert, no challenge vhost).
        tls.cert.shared = { };

        access.scope.tailnet = { };          # reachable over tailscale0; 443 is a baseline opening

        dns.tailnet = { };                   # emit homelab A/AAAA on aedilis (reproduces tailnetRewrites)
        # dns.tailnet -> A/AAAA from constants.hosts.augustus.tailscale.

        # No oidc block (oidc = null) -> OIDC generator skips it. No firewall opening (443 baseline).
      };
    };
}
```

Notes:

- **`subdomain = "homelab"`** (not `homelab-api`) — the UI origin. This resolves to
  `https://homelab.plato-splunk.media`, exactly today's `svc.frontendUrl` vhost key.
- **`backend.static.root = pkg`** — drives the `root * <pkg>` + `header` + `file_server`
  block via the keystone static renderer (§2.1).
- **`tls.cert.shared = { }`** — shares Caddy's managed cert; no cert, no challenge vhost.
- **No `oidc`** — the static UI has no Kanidm client.
- **`dns.tailnet = { }`** — the DNS generator (aedilis) emits
  `homelab.plato-splunk.media` A/AAAA from `constants.hosts.augustus.tailscale`, replacing
  `tailnetRewrites.homelab = "augustus"`. (The `homelab-api` record is owned by the homelab-api
  feature, not here.)
- **No `tls.insecureHttp`** — the UI has no http sibling vhost (that is a homelab-api-only need).

### 3.2 `features/homelab-ui/complete.nix` (updated imports)

```nix
{ inputs, ... }:
{
  flake.modules.nixos.homelab-ui = {
    imports = with inputs.self.modules.nixos; [
      homelab-ui-catalog    # NEW — contributes homelab.catalog.homelab-ui (static vhost)
      # homelab-ui-caddy  REMOVED — vhost now from the caddy-nixos generator
    ];
  };
}
```

> `hosts/augustus.nix` keeps importing the single `nixos.homelab-ui`; the `homelab-service-caddy`
> generator is imported once by augustus via the `homelab-service-oidc-host` aggregator (keystone §1
> import matrix). Importing the feature registers the catalog entry; the generator renders it.

### 3.3 What the caddy-nixos generator must render

Filtered to `host == augustus`, `backend.static`:

```nix
services.caddy.virtualHosts."https://homelab.plato-splunk.media".extraConfig = ''
  <tracingBlock>root * /nix/store/<hash>-homelab-ui
  header /*.html Cache-Control "no-cache, must-revalidate"
  file_server
'';
```

where `<tracingBlock>` is empty (Tempo off) or the `tracing {\n  span homelab-ui\n}\n` heredoc
(Tempo on), and `<hash>-homelab-ui` is the identical store path the current module references.

---

## 4. Operational equivalence — parity gate (exact commands)

> **Prerequisite (`.kiro/steering/validation.md`):** flake eval reads the **git tree**. `git add` the
> new `features/homelab-ui/catalog.nix` and stage the removal of `caddy.nix` before any eval —
> untracked new `.nix` files are invisible to `import-tree`. (Do not run these now; this is the gate
> the implementation PR must pass.)

### 4.1 Static vhost parity — `--raw`, Tempo OFF and ON

Capture before/after; diff must be empty. **Run twice** — Tempo disabled (augustus default) and
forcing `services.tempo.enable = true` — to prove the tracing gate behaves identically.

```sh
nix eval \
  '.#nixosConfigurations.augustus.config.services.caddy.virtualHosts."https://homelab.plato-splunk.media".extraConfig' \
  --raw > /tmp/ui-vhost.before      # (….after after migration)
diff /tmp/ui-vhost.before /tmp/ui-vhost.after   # must be empty
```

Expected body (Tempo OFF), byte-for-byte:

```
root * /nix/store/<hash>-homelab-ui
header /*.html Cache-Control "no-cache, must-revalidate"
file_server
```

Expected body (Tempo ON):

```
tracing {
  span homelab-ui
}
root * /nix/store/<hash>-homelab-ui
header /*.html Cache-Control "no-cache, must-revalidate"
file_server
```

(single trailing newline, no leading indentation, identical `<hash>` on both sides). Any non-empty
`diff` is a FAIL — no intentional deviation permitted.

> The store-path hash must match because both sides reference the same
> `inputs.self.packages.x86_64-linux.homelab-ui` derivation. If the hashes differ, the catalog entry
> is pointing at a different package reference — fix the `root = pkg` provenance, not the renderer.

### 4.2 Whole-vhosts sanity (catches a dropped vhost or stray attr)

```sh
nix eval '.#nixosConfigurations.augustus.config.services.caddy.virtualHosts' --json \
  | jq '."https://homelab.plato-splunk.media"'
```

Before/after JSON for this key must match — confirms the key is unchanged and no stray
`tls`/`reverse_proxy`/`serverAliases` crept in (static vhost names no cert).

### 4.3 No-change checks (no OIDC, no cert, no firewall, no unit)

```sh
# homelab-ui contributes NO oauth2 client — the oauth2 attrset must be unchanged:
nix eval '.#nixosConfigurations.augustus.config.services.kanidm.provision.systems.oauth2' --json \
  | jq 'has("homelab-ui")'      # -> false (no UI client ever existed)

# no security.acme cert for the UI origin:
nix eval '.#nixosConfigurations.augustus.config.security.acme.certs' --json \
  | jq 'has("homelab.plato-splunk.media")'   # -> false

# firewall unchanged (443 baseline; no service-attributable opening):
nix eval '.#nixosConfigurations.augustus.config.networking.firewall.allowedTCPPorts' --json
```

### 4.4 DNS parity (deferred to the dns-records migration)

The `homelab` A/AAAA record (→ augustus) stays produced by `tailnetRewrites` until
[./dns-records.md](./dns-records.md) switches on the DNS generator. `dns.tailnet = { }` here declares
intent; verify at cutover:

```sh
nix eval \
  '.#nixosConfigurations.aedilis.config.services.technitium-server-complete.provision.ensureDnsRecords.zones' \
  --json | jq '."plato-splunk.media".records | map(select(.name=="homelab"))'
```

Before/after must contain the same A (`100.95.250.77`) and AAAA (`fd7a:115c:a1e0::6301:fa4d`) records
for `homelab` (from `constants.hosts.augustus.tailscale`, equal to the `ts.augustus` values). This is
the **`homelab`** record only — the sibling **`homelab-api`** record is owned by the
[homelab-api plan](./homelab-api.md) §5.5.

### 4.5 Build gate

```sh
nix run .#nixfmt -- $(git ls-files '*.nix' ':!:repos/**')
nix flake check
nixos-rebuild build --flake .#augustus       # closure builds; diff store path if desired
```

---

## 5. Step-by-step migration checklist

> Depends on the keystone catalog schema + generators existing
> ([./catalog-and-generators.md](./catalog-and-generators.md)) with the static backend renderer
> (already specified — no homelab-ui-specific schema delta). Parent plan §3 groups homelab-ui with
> the low-complexity services (step 3).

1. **Capture baseline** (the equivalence oracle): §4.1 (vhost `--raw`, Tempo OFF **and** ON), §4.2
   (whole-vhost JSON), §4.3 (no-oauth2 / no-cert / firewall). Save to `/tmp/ui-*.before`.

2. **Create `features/homelab-ui/catalog.nix`** — the `homelab.catalog.homelab-ui` entry from §3.1
   (`subdomain = "homelab"`, `host = "augustus"`, `backend.static.root =
   inputs.self.packages.x86_64-linux.homelab-ui`, `tls.cert.shared = { }`, `access.scope.tailnet = { }`,
   `dns.tailnet = { }`). Entry name MUST be `homelab-ui` (tracing span). **No `oidc`.**

3. **Opt the entry into the caddy generator** (`managedBy.caddy = true;` per the keystone incremental
   opt-in) so the caddy-nixos generator renders the static vhost **instead of** the hand-written
   module.

4. **Delete `features/homelab-ui/caddy.nix`.** Its output now comes from the generator.

5. **Update `complete.nix`** (§3.2): replace the `homelab-ui-caddy` import with `homelab-ui-catalog`.

6. **Stage for Nix eval:** `git add nix-config/modules/features/homelab-ui/catalog.nix` and stage the
   `git rm` of `caddy.nix`.

7. **Run the parity gate.** Re-capture §4.1–§4.3 → `/tmp/ui-*.after`; `diff` each against `.before`.
   **All diffs MUST be empty** (both Tempo modes for the vhost). Common culprits: a changed store-path
   provenance (different `pkg` reference → hash mismatch); missing/extra trailing newline; the
   `header` directive value re-quoted or re-ordered; tracing block placement.

8. **DNS deferred** — leave `tailnetRewrites.homelab = "augustus"` in place; verify §4.4 at the
   dns-records cutover (the `homelab` record, distinct from `homelab-api`).

9. **Format + check + build.** `nix run .#nixfmt -- …`, `nix flake check`,
   `nixos-rebuild build --flake .#augustus`. All must pass.

10. **Deploy as a no-op.** The single static vhost renders identically; nothing else changes. The
    switch is a theoretical no-op.

---

## 6. Migration checklist (condensed)

- [ ] Baseline captured: vhost `--raw` (Tempo OFF **and** ON), whole-vhost JSON, no-oauth2/no-cert/
      firewall → `*.before`
- [ ] `features/homelab-ui/catalog.nix` — static entry (`subdomain = "homelab"`,
      `backend.static.root = <uiPkg>`, `tls.cert.shared = { }`, `access.scope.tailnet = { }`,
      `dns.tailnet = { }`, entry named `homelab-ui`, **no `oidc`**)
- [ ] `caddy.nix` removed; `complete.nix` imports `homelab-ui-catalog` instead of `homelab-ui-caddy`
- [ ] No `service.nix`/`oidc.nix` created (static frontend has no runtime/OIDC)
- [ ] `package.nix` **untouched**
- [ ] New file `git add`ed, deletion staged
- [ ] **Parity gate green:** vhost `--raw` diff empty (Tempo OFF **and** ON, §4.1); whole-vhost JSON
      match (§4.2); no UI oauth2 client, no UI cert, firewall unchanged (§4.3); same `<pkg>` store
      path on both sides
- [ ] DNS parity deferred to [./dns-records.md](./dns-records.md) — `homelab` record confirmed at
      cutover (§4.4); distinct from the `homelab-api` record owned by homelab-api
- [ ] `nix run .#nixfmt`, `nix flake check`, `nixos-rebuild build --flake .#augustus` pass
- [ ] Deployed — confirmed no-op

---

## 7. Relationship to the homelab-api plan

homelab-ui and homelab-api share the single `constants.services.homelab` registry entry but own
**different** subdomains and surfaces. The split is intentional and worth stating so neither plan
double-owns a record or vhost:

| Surface                                      | Owner                           | Key / detail                                                                    |
| -------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------- |
| `homelab-api` vhost (secure + insecure http) | [homelab-api](./homelab-api.md) | `https://homelab-api…` + `http://homelab-api…`, `reverse_proxy 127.0.0.1:35427` |
| `homelab` (frontend) vhost                   | **homelab-ui (this plan)**      | `https://homelab…`, static `root`/`file_server`                                 |
| `homelab-api` DNS record                     | [homelab-api](./homelab-api.md) | A/AAAA → augustus                                                               |
| `homelab` DNS record                         | **homelab-ui (this plan)**      | A/AAAA → augustus                                                               |
| Kanidm `oauth2.homelab` client               | [homelab-api](./homelab-api.md) | public, callbacks hang off the `homelab` (frontend) origin                      |
| Tracing span                                 | both                            | `span homelab-api` (api) / `span homelab-ui` (ui) — entry-name driven           |

The OIDC client registered by homelab-api points its callbacks/landing at **this** feature's
`homelab` origin, but homelab-ui itself registers **no** OIDC client — it is a static file server. The
only coupling is that both must agree the `homelab` origin resolves to augustus, which the catalog
makes explicit (homelab-ui's `subdomain = "homelab"; host = "augustus"`).
