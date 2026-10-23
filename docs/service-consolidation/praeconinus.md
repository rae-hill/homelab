# praeconinus — Restricted Tailscale-Funnel Deployment

Status: **PROPOSED** · Per-module plan under the
[service consolidation plan](../service-consolidation-plan.md) · Schema +
generators: [catalog-and-generators.md](./catalog-and-generators.md) · Index:
[README](./README.md)

praeconinus is the odd host. It serves **only** the homelab UI + API, over **Tailscale Funnel**, at
the tailnet hostname `praeconinus.neko-bicolor.ts.net` — **not** a `plato-splunk.media` subdomain. Its
single Caddy vhost binds `:8443` (not `:443`), does **base-path routing** (`/api`, `/ui`) with a
bespoke query-preserving redirect, imports **no** OIDC and **no** DNS generators, and opens **no**
firewall port for the service itself. This document captures the current config verbatim, explains the
`443 → 8443` Funnel mechanism, maps the host onto the catalog schema, and makes a **pragmatic
recommendation** about whether the vhost is worth catalog-izing at all.

The overriding constraint, as everywhere in this directory, is **operational equivalence**: deploying
any revision described here must be a theoretical no-op (see [README](./README.md)). praeconinus is a
one-off restricted host; the bar for touching it is "can we prove `nix eval` is byte-identical," and
the recommendation (§5) is weighted accordingly.

---

## 1. Current state — captured verbatim

### 1.1 The host (`modules/hosts/praeconinus.nix`)

praeconinus is an `aarch64-linux` host that imports a deliberately **short** module list — far shorter
than augustus. It takes `system-base`, `caddy`, `homelab-api-service`, and
`homelab-secret-provisioner`, plus its private `_private/praeconinus/*` files. Notably absent: any
Kanidm/OIDC module, any Technitium/DNS module, any of the other app services. That short list is the
structural expression of "restricted deployment."

```nix
modules = [
  inputs.home-manager.nixosModules.home-manager
  inputs.nixvim.nixosModules.nixvim
  inputs.sops-nix.nixosModules.sops

  nixos.system-base
  nixos.caddy
  nixos.homelab-api-service
  nixos.homelab-secret-provisioner

  ./../_private/praeconinus/hardware.nix
  ./../_private/praeconinus/security.nix
  ./../_private/praeconinus/users.nix
  ./../_private/praeconinus/sops.nix
  ./../_private/praeconinus/system.nix
  ./../_private/praeconinus/programs.nix

  { networking.hostName = "praeconinus"; }
];
```

### 1.2 The homelab-api service (`_private/praeconinus/programs.nix`)

The API runs in a **restricted** configuration — `requiresKanidm = false`, no API keys, and a narrow
`featureFlags` allowlist (cert downloads, wifi config view/create, DNS view, certs view). Its
`originUrl` is the Funnel hostname with a `/api` base path, **not** a subdomain:

```nix
services.homelab-api = {
  enable = true;
  originUrl = "https://praeconinus.neko-bicolor.ts.net/api";
  privateKeySecretPath = config.sops.secrets.homelab_api_jwk_password.path;
  requiresKanidm = false;
  apiKeys = { };
  featureFlags = [
    "Config_Wifi.view"
    "Config_Wifi.create"
    "Config_Certs.view"
    "Config_DNS.view"
    "Cert_Root"
    "Cert_Intermediate"
    "Cert_Combined"
  ];
};

services.homelab-secret-provisioner = {
  enable = true;
  privateKeyPasswordFile = config.sops.secrets.homelab_api_jwk_password.path;
  apiKeys = { };
};
```

### 1.3 The `:8443` Funnel vhost — the verbatim body to preserve

This is the single most important artifact on the host. Every byte must survive the migration (if any)
unchanged. The vhost key is `https://praeconinus.neko-bicolor.ts.net:8443` — a **non-standard listen
port** — and the body does base-path routing with a query-preserving redirect:

```nix
services.caddy.virtualHosts."https://praeconinus.neko-bicolor.ts.net:8443" = {
  extraConfig = ''
    map {query} {fullquery} {
        ~(.+)   "?$1"
        default ""
    }

    @toUI path / /ui
    redir @toUI /ui/{fullquery} permanent

    handle_path /api/* {
        reverse_proxy 127.0.0.1:35427
    }

    handle_path /ui/* {
        root * ${uiPkg}
        header /*.html Cache-Control "no-cache, must-revalidate"
        file_server
    }
  '';
};
```

where `uiPkg = inputs.self.packages.aarch64-linux.homelab-ui`.

What each piece does — this is the semantic contract the catalog would have to reproduce exactly:

- **`map {query} {fullquery}`** — captures the incoming query string into `{fullquery}`, prefixing it
  with `?` when non-empty and emitting the empty string otherwise. This lets the redirect below carry
  the original query through without a dangling `?`.
- **`@toUI path / /ui`** + **`redir @toUI /ui/{fullquery} permanent`** — any request to the bare root
  `/` or to `/ui` (no trailing slash) is `301`-redirected to `/ui/` with the preserved query. This is
  what makes the Funnel root load the UI.
- **`handle_path /api/*`** — strips the `/api` prefix and reverse-proxies to the local homelab-api on
  `127.0.0.1:35427` (the API's registry port, `constants.services.homelab.port = 35427`). `handle_path`
  (not `handle`) is significant: it removes the matched prefix before proxying, so the backend sees
  `/status`, not `/api/status`.
- **`handle_path /ui/*`** — strips `/ui` and serves the static `homelab-ui` build from the Nix store
  package, with a no-cache header on HTML so clients always revalidate the entrypoint. Again
  `handle_path` strips the `/ui` prefix so the static root is addressed from its own root.

This single vhost multiplexes **two** services (API + static UI) under **one** hostname via base-path
routing — fundamentally different from the rest of the fleet, where each service gets its own
subdomain vhost.

### 1.4 Tailscale + Funnel wiring (`_private/praeconinus/system.nix`)

```nix
services.tailscale.enable = true;
services.tailscale.extraSetFlags = [ "--webclient" ];

systemd.services.tailscaled.environment.TS_PERMIT_CERT_UID = "caddy";
```

- `services.tailscale.enable` joins the tailnet.
- `--webclient` enables the local Tailscale web UI.
- **`TS_PERMIT_CERT_UID = "caddy"`** is the load-bearing line for the Funnel/TLS story: it authorizes
  the `caddy` user to call `tailscale cert` / fetch the node's Tailscale-issued TLS material, so Caddy
  can terminate TLS for `praeconinus.neko-bicolor.ts.net` using the cert tailscaled manages. Without
  it, Caddy could not obtain the Funnel hostname's certificate.

(The host also runs `resolved` against NextDNS with DoT — unrelated to the service vhost but part of
why praeconinus is a self-contained public-facing box.)

### 1.5 Firewall (`_private/praeconinus/security.nix`) — captured verbatim

```nix
networking.firewall = {
  enable = true;

  interfaces = {
    tailscale0 = {
      allowedTCPPorts = [
        22
        443
        5252
      ];
      allowedUDPPorts = [ 5252 ];
    };
  };

  allowedTCPPorts = [ 443 ];
};
```

The two facts that matter for the catalog mapping:

- **Public `allowedTCPPorts = [ 443 ]`** — the public interface opens `443`, which is where **Funnel
  ingress** lands (tailscaled terminates it; see §2).
- **`tailscale0` opens `22 443 5252` (+ `5252/udp`)** — SSH, the tailnet-side `443`, and the Tailscale
  metrics exporter. These are baseline/infra ports (§2.7 of the parent plan), **not** derived from the
  service vhost.
- **`8443` is NOT in any firewall list.** The service's own listen port is never opened externally —
  the single most important firewall observation, explained next.

---

## 2. The `443 → 8443` Funnel mechanism (parent-plan finding)

The parent plan's §5.2 open question #1 investigated and resolved this; this section restates the
mechanism in full because the whole catalog mapping hinges on it.

**Why does Caddy bind `:8443` instead of `:443`?** Not because of a local port clash with another app
on praeconinus — the UI and API share the one vhost. It is a direct consequence of **Tailscale Funnel
semantics**:

1. With `services.tailscale.enable` + Funnel active, **tailscaled** is the component that terminates
   public TLS for the node's `*.ts.net` name and performs **Funnel ingress**. tailscaled therefore
   occupies the node's **`:443`** for inbound Funnel traffic — that is why the firewall opens public
   `443` (ingress reaches tailscaled there).
2. Funnel can forward incoming connections to a **local backend**, but only on one of **Funnel's three
   permitted ports: `443`, `8443`, `10000`**. Since tailscaled itself holds `443`, Caddy is configured
   on **`8443`** — the next allowed Funnel target port.
3. **`TS_PERMIT_CERT_UID = "caddy"`** lets Caddy fetch the Tailscale cert so that the TLS Caddy serves
   on `:8443` presents the correct `praeconinus.neko-bicolor.ts.net` certificate to Funnel.
4. Crucially, **Funnel reaches Caddy over loopback** (tailscaled → `127.0.0.1:8443`), **not** across an
   external interface. That is why the firewall **does not and must not open `8443`**: there is no
   external path to it. Opening it would be both unnecessary and a (small) attack-surface regression.

So the live topology is:

```
public client ──TLS──▶ tailscaled (Funnel ingress, node :443)
                           │ loopback
                           ▼
                       Caddy :8443  ──┬─ handle_path /api/* ─▶ 127.0.0.1:35427 (homelab-api)
                                      └─ handle_path /ui/*  ─▶ file_server <homelab-ui pkg>
```

> The stale `docs/praeconinus-host-plan.md` still documents an original `:443` design. It is **wrong
> for the live host** — the deployed config is `:8443`, for the Funnel reason above. Any migration must
> preserve `:8443` and must **not** "fix" it back to `443`.

This finding is the one place a catalog mapping could introduce a bug: a naive generator that assumes
`listenPort = 443` and opens `443` on the public interface for the service would be wrong on two counts
(wrong port; and it must open **nothing** for a Funnel service). The schema already anticipates this
(§3).

---

## 3. How the catalog models praeconinus

The schema in [catalog-and-generators.md](./catalog-and-generators.md) already carries every field
praeconinus needs; this section shows the mapping. Whether we should actually _use_ it here is §5.

### 3.1 The fields that make praeconinus expressible

| praeconinus trait                          | Catalog field                                                    | Notes                                                           |
| ------------------------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------- |
| Funnel hostname, not a subdomain           | `subdomain` + `zone`                                             | `subdomain = "praeconinus"`, `zone = "neko-bicolor.ts.net"`     |
| Non-standard listen port `:8443`           | `listenPort = 8443`                                              | drives the vhost key suffix `:8443` in the caddy generator      |
| Funnel ingress, no firewall opening        | `access.scope = "funnel"`                                        | firewall generator opens **nothing** for funnel scope           |
| No OIDC client                             | `oidc.enable = false` (default)                                  | augustus-only OIDC generator never sees it (praeconinus ≠ host) |
| No DNS record                              | `dns.enable = false` (default)                                   | Funnel name resolves via Tailscale, not Technitium              |
| Shares Caddy/Tailscale cert, no manual TLS | `tls.ca = null` (default)                                        | no `security.acme.certs` entry; no `:80` challenge vhost        |
| Bespoke base-path routing body             | `extraCaddyConfig` (the whole `map`/`redir`/`handle_path` block) | the escape hatch from parent plan §2.3                          |

Per the parent plan's `accessType`, **`scope = "funnel"`** is a first-class enum value whose documented
behavior is exactly praeconinus's: "Tailscale Funnel ingress (tailscaled owns `:443`; Caddy listens on
`:8443`; **NO** firewall opening)." So the firewall generator, filtering `host == "praeconinus"`,
contributes **zero** ports — the host keeps its hand-listed baseline `22 / 443 / 5252` (+ the public
`443` that is Funnel ingress, which is infrastructure, not service-derived).

### 3.2 What a catalog entry would look like

The catch: praeconinus multiplexes **two** backends (API + static UI) under **one** vhost with
base-path routing, whereas the catalog's `backend` field models a **single** upstream. There is no
clean `backend = reverseProxy` **or** `static` that captures "`/api/*` → proxy _and_ `/ui/*` → static
_and_ a root redirect." The honest mapping pushes the **entire** routing body through
`extraCaddyConfig` and leaves `backend` as a near-nominal placeholder:

```nix
# features/homelab-api/catalog.nix  (praeconinus-scoped entry — illustrative)
homelab.catalog.homelab-api-praeconinus = {
  subdomain  = "praeconinus";
  zone       = "neko-bicolor.ts.net";
  host       = "praeconinus";
  listenPort = 8443;                 # Funnel target port; vhost key becomes …ts.net:8443

  # The backend is nominal — the real routing is two handle_path blocks below.
  backend = { kind = "reverseProxy"; port = 35427; };

  tls.ca = null;                      # Caddy/Tailscale-managed cert; no security.acme.certs
  access.scope = "funnel";            # Funnel ingress; firewall opens nothing for this entry
  dns.enable = false;                 # Funnel name is not a Technitium record
  oidc.enable = false;                # restricted: no OIDC client

  # The whole bespoke body, byte-for-byte, via the escape hatch:
  extraCaddyConfig = ''
    map {query} {fullquery} {
        ~(.+)   "?$1"
        default ""
    }

    @toUI path / /ui
    redir @toUI /ui/{fullquery} permanent

    handle_path /api/* {
        reverse_proxy 127.0.0.1:35427
    }

    handle_path /ui/* {
        root * ${uiPkg}
        header /*.html Cache-Control "no-cache, must-revalidate"
        file_server
    }
  '';
};
```

But note the **collision** with the shared vhost-body renderer. The renderer
(`constants.catalogLib.renderVhostBody`, parent plan §3.1) always appends `backendBlock e` **before**
`extraCaddyConfig`. For `backend.kind = "reverseProxy"` that would prepend a stray
`reverse_proxy localhost:35427` line **above** the `map`/`redir`/`handle_path` block — changing the
emitted body and breaking operational equivalence. So a faithful mapping would additionally require
**either**:

- a new `backend.kind = "none"` (renderer emits no backend directive, only `extraCaddyConfig`), **or**
- a `renderVhostBody` branch that suppresses `backendBlock` when `extraCaddyConfig` fully owns routing.

Both are schema changes introduced _solely_ to accommodate this one host. That is the crux of the
recommendation.

### 3.3 Generators praeconinus would (not) import

Per the parent plan's per-host import matrix, praeconinus imports `homelab-service-apphost`
(caddy + acme + firewall) and **no** dns/oidc generators. Given §3.1:

- **caddy** — would emit the `:8443` vhost from `extraCaddyConfig` (modulo the backend-block collision
  in §3.2).
- **acme** — no-op: `tls.ca == null`, so no `security.acme.certs` and no `:80` challenge vhost.
- **firewall** — no-op: `access.scope == "funnel"` opens nothing; baseline `22 / 443 / 5252` stays
  hand-listed in `_private/praeconinus/security.nix`.
- **dns / oidc** — not imported at all, so the restricted posture is structural, not just a disabled
  flag.

---

## 4. Operational-equivalence parity gate

If praeconinus is migrated, the gate is the same `nix eval` diff used elsewhere — captured on the
`praeconinus` host specifically:

```sh
# Vhost parity — the :8443 vhost body must be byte-identical before/after.
nix eval .#nixosConfigurations.praeconinus.config.services.caddy.virtualHosts --json

# Firewall parity — must remain exactly { public TCP [443]; tailscale0 TCP [22 443 5252], UDP [5252] }.
nix eval .#nixosConfigurations.praeconinus.config.networking.firewall --json

# ACME parity — must remain empty (no catalog cert for a Funnel/Caddy-managed-cert host).
nix eval .#nixosConfigurations.praeconinus.config.security.acme.certs --json
```

The vhost diff is the sharp one: the `map`/`redir`/`handle_path` body is whitespace- and
directive-sensitive, and the backend-block collision in §3.2 would show up here immediately as a spurious
leading `reverse_proxy` line. An empty diff on all three certifies equivalence.

Per `.kiro/steering/validation.md`, **`git add` any new `.nix` files before evaluating** — `import-tree`
only sees the git tree; untracked new files are invisible and will make the entry silently absent.

---

## 5. Recommendation — keep it a bespoke `_private` override

**Do not catalog-ize praeconinus's vhost. Leave it as the hand-written `_private/praeconinus/programs.nix`
override it is today.** The catalog's value is eliminating _repeated_ drift across subdomain / port /
clientId / DNS / firewall for the ~15 services that each repeat the same five-surface boilerplate.
praeconinus shares **none** of that shape:

1. **It is a genuine one-off.** A single restricted host, a single vhost, serving a Funnel hostname that
   appears nowhere else. There is no second instance to keep in sync, so there is no drift for the
   catalog to prevent — the catalog's entire reason for existing does not apply here.
2. **It fits the single-backend model poorly.** The vhost multiplexes two backends under one hostname
   with base-path routing and a query-preserving redirect. The honest mapping shoves the **whole** body
   through `extraCaddyConfig` with a nominal `backend`, so the "typed, self-documenting entry" benefit
   evaporates — the real logic is an opaque string either way.
3. **It would force schema changes for one host.** Faithful rendering requires a new `backend.kind =
   "none"` (or a renderer special-case) purely to stop the shared renderer prepending a stray
   `reverse_proxy` line (§3.2). Adding schema surface to the keystone module to accommodate exactly one
   host is a poor trade — it taxes every future reader of the schema for a single caller.
4. **Operational equivalence is the paramount constraint, and the bespoke override already satisfies it
   trivially** — by being unchanged. Migrating introduces a real (if catchable) risk of a non-no-op
   diff (the backend-block collision) for **zero** reduction in drift. The risk/reward is inverted
   versus a normal service.
5. **The restricted posture is already expressed structurally** by praeconinus's short host module list
   (no OIDC/DNS modules imported). That is clearer, and harder to get subtly wrong, than a catalog entry
   with four disabled flags.

**What praeconinus _should_ adopt from this work, if anything:** only the pieces that reduce real
duplication without the single-backend mismatch — and even those are optional:

- The `homelab-ui` static build is already referenced the same way here (`inputs.self.packages.
  aarch64-linux.homelab-ui`) as in the augustus UI feature; no change needed.
- If the firewall generator lands fleet-wide, praeconinus can import `homelab-service-firewall` **only
  if** it declares its service with `access.scope = "funnel"` so the generator contributes nothing —
  but since the generator would emit **zero** ports for this host, importing it buys nothing over the
  three hand-listed baseline ports. Prefer leaving `_private/praeconinus/security.nix` as-is.

In short: praeconinus is the explicit exception the catalog design already anticipated (parent plan
§5.2 #1 calls it out as "falls out naturally" precisely because it declares _nothing_ in the shared
matrix). The most faithful expression of "it declares nothing shared" is to **not** add it to the
shared registry at all. Document the `:8443` Funnel rationale inline in `programs.nix` (a short comment
referencing this doc) so the next reader does not "fix" the port, and stop there.

---

## 6. Checklist (this module)

- [ ] **Decision: no migration.** Keep the `:8443` vhost in `_private/praeconinus/programs.nix` as a
      bespoke override (§5).
- [ ] Add an inline comment above the `:8443` vhost explaining the Funnel `443 → 8443` mechanism
      (tailscaled owns `:443`; Caddy on `:8443`; loopback ingress; **do not** open `8443`), referencing
      this doc and parent plan §5.2 #1, so the port is not mistakenly "corrected."
- [ ] If, contrary to this recommendation, praeconinus is later migrated: add `backend.kind = "none"`
      (or a `renderVhostBody` suppression branch) to the keystone schema **first** (§3.2), then set the
      entry per §3.2 with the full body in `extraCaddyConfig`, import only `homelab-service-apphost`
      (no dns/oidc), and prove the §4 parity gate is an empty diff — the `:8443` port and the empty
      firewall/acme contribution are the equivalence-critical invariants.
- [ ] Leave `_private/praeconinus/security.nix` unchanged either way: `access.scope = "funnel"` emits
      no ports, so the hand-listed baseline `22 / 443 / 5252` remains the source of truth.
