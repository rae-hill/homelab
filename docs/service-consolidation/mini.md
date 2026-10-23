# mini — nix-darwin Caddyfile backend (hand-written global block + generated site blocks)

Status: **PROPOSED**
Date: 2026-10-22
Parent: [../service-consolidation-plan.md](../service-consolidation-plan.md) (esp. §2.2a darwin) ·
Index: [./README.md](./README.md) ·
Keystone: [./catalog-and-generators.md](./catalog-and-generators.md) (esp. §3.1 renderer, §3.3 darwin backend)

> **Operational-equivalence contract (from [./README.md](./README.md)):** deploying this revision
> MUST be a theoretical no-op. For mini (darwin) there is **no `services.caddy` / `security.acme`** to
> eval — the parity gate is **`nix eval --raw` of the rendered Caddyfile text**, which must be
> equivalent to the current hand-written Caddyfile (parent plan §2.2a / §4). The generated site
> blocks + the retained hand-written global block must together produce an operationally-equivalent
> Caddyfile.

mini is the **nix-darwin** host (aarch64-darwin Mac Mini). It fronts **Jellyfin** with Caddy, running
as a **`launchd.daemons.caddy`** unit against a **hand-written Caddyfile** in
`environment.etc."caddy_nix/Caddyfile"`. Crucially (verified against vendored `repos/nix-darwin`,
parent plan §2.2a / decision §5.1 #4): **nix-darwin has no `services.caddy` module and no
`security.acme` module** — only `security.pki` for the trust store. So:

- **Caddy backend is a Caddyfile fragment**, not `services.caddy.virtualHosts`.
- **ACME is Caddy-native** — the Caddyfile global block sets `acme_ca` + `acme_ca_root` pointing at
  step-ca, and Caddy fetches/renews certs itself. There is **no** `security.acme`, **no** HTTP-01
  challenge vhost, **no** loopback `acmePort`.
- **Trust** is `security.pki.certificateFiles` (the step-ca root) — already present on mini.
- **No DNS, no OIDC, no restic, no failure-notifs** on darwin (those are Linux/augustus/aedilis
  concerns). mini keeps its hand-written firewall (darwin firewall is out of scope).

Concerns emitted today: **V (Caddyfile, mTLS)** — four Caddy site blocks (two mTLS metrics vhosts,
one mTLS+rewrite metrics vhost, one plain reverse-proxy with a `/metrics` redirect). Nothing else.

---

## 0. Why mini is distinctive

Two things set mini apart from every NixOS per-service plan:

1. **Caddyfile text backend, not `services.caddy`.** The darwin Caddy generator (keystone §3.3)
   emits a **site-blocks fragment** (`environment.etc."caddy_nix/catalog-sites.caddy".text`) that the
   existing Caddyfile `import`s — the recommended option (b) in parent plan §2.2a. The mini-specific
   **global options** (`email`, `acme_ca`, `acme_ca_root`, `storage`, `admin off`, `metrics`,
   `debug`) stay **hand-written**, since they are not expressible through the catalog.
2. **Caddy-native ACME (no `security.acme`).** `tls.acmePort` / `tls.challenge` are **ignored** by
   the darwin backend (parent plan §2.2a); the generator emits **no** explicit `tls <fullchain>
   <key>` line for a non-mTLS vhost, so Caddy's global `acme_ca` issues/renews the server cert. For
   mTLS vhosts it emits only the `tls { client_auth … }` block (cert-less — Caddy's ACME supplies the
   server cert).

The darwin backend reuses the **same pure vhost-body renderer** (keystone §3.1 `renderVhostBody`) as
the NixOS backend, with `certDir = null` (parent plan §2.2a) — that shared renderer is the point of
the two-backend design.

---

## 1. Current state — emitted output captured verbatim

### 1.1 The module today: `_private/mini/programs.nix`

```nix
{ inputs, lib, config, pkgs, ... }:
let
  rootCert = ../../../../certs/alford-root.crt;
in
{
  programs.zsh = {
    enable = true;
    enableCompletion = true;
    enableSyntaxHighlighting = true;
  };

  environment.systemPackages = [
    pkgs.step-cli
  ];

  environment.etc."caddy_nix/Caddyfile".text = ''
    {
      email web@jacob-alford.dev
      acme_ca https://ca.plato-splunk.media/acme/http/directory
      acme_ca_root /etc/step/certs/root_ca.crt

      storage file_system /etc/caddy
      
      admin off
      metrics
      debug
    }

    https://mini-caddy-metrics.plato-splunk.media {
      tls {
        client_auth {
          mode require_and_verify
          trust_pool file {
            pem_file ${rootCert}
          }
        }
      }

      metrics
    }

    https://mini-jellyfin-metrics.plato-splunk.media {
      tls {
        client_auth {
          mode require_and_verify
          trust_pool file {
            pem_file ${rootCert}
          }
        }
      }
      
      rewrite / /metrics
      reverse_proxy 127.0.0.1:8096
    }

    https://jellyfin.plato-splunk.media {
      handle_path /metrics {
        redir https://mini-jellyfin-metrics.plato-splunk.media
      }

      reverse_proxy localhost:8096
    }
  '';

  launchd.daemons.caddy = {
    command = "${pkgs.caddy}/bin/caddy run --config /etc/caddy_nix/Caddyfile --adapter caddyfile";
    serviceConfig = {
      KeepAlive = true;
      RunAtLoad = true;
      StandardOutPath = "/etc/caddy/logs/caddy.info.log";
      StandardErrorPath = "/etc/caddy/logs/caddy.err.log";
    };
  };

  system.configurationRevision = inputs.self.rev or inputs.self.dirtyRev or null;
  system.primaryUser = "jacob";
  system.stateVersion = 6;
  nixpkgs.hostPlatform = "aarch64-darwin";
  nixpkgs.config.allowUnfree = true;
  nixpkgs.config.allowUnfreePredicate = pkg: builtins.elem (lib.getName pkg) [ ];
}
```

### 1.2 Host wiring: `hosts/mini.nix`

```nix
{ inputs, config, ... }:
let darwin = inputs.self.modules.darwin;
in {
  flake.darwinConfigurations.mini = inputs.nix-darwin.lib.darwinSystem {
    specialArgs = { inherit inputs; };
    modules = [
      inputs.sops-nix.darwinModules.sops
      inputs.nixvim.nixDarwinModules.nixvim
      darwin.darwin-base
      darwin.nixvim-complete
      darwin.homebrew
      ./../_private/mini/sops.nix
      ./../_private/mini/programs.nix
      { networking.hostName = "mini"; }
    ];
  };
}
```

> `networking.hostName = "mini"` exists on darwin (parent plan §2.2a confirms the `host ==`
> filter is portable). `security.pki.certificateFiles` (the step-ca root trust) is set in
> `darwin.darwin-base` or a sibling module — mini already trusts step-ca, so Caddy-native ACME works.

### 1.3 The global block (hand-written, stays hand-written)

```
{
  email web@jacob-alford.dev
  acme_ca https://ca.plato-splunk.media/acme/http/directory
  acme_ca_root /etc/step/certs/root_ca.crt

  storage file_system /etc/caddy

  admin off
  metrics
  debug
}
```

- `email` — ACME account email.
- `acme_ca` — step-ca's **HTTP** ACME directory (same URL as `c.ca.acmeDirectoryHttp` =
  `https://ca.plato-splunk.media/acme/http/directory`). **This is how mini does ACME**: Caddy-native,
  no NixOS `security.acme`.
- `acme_ca_root` — `/etc/step/certs/root_ca.crt`, the trust root Caddy uses to validate step-ca's
  ACME endpoint TLS.
- `storage file_system /etc/caddy` — cert/account storage on disk.
- `admin off` — no admin API.
- `metrics` — expose Caddy's own Prometheus metrics (served by the `mini-caddy-metrics` vhost).
- `debug` — debug logging.

> **The global block is NOT catalog-expressible.** `acme_ca`, `storage`, `admin off`, `metrics`,
> `debug`, `email` are whole-Caddyfile options with no per-service meaning. Per parent plan §2.2a
> option (b), these stay hand-written; only the **site blocks** are generated. This is the
> **darwin Caddyfile fragment import mechanism** gap flagged in §5.

### 1.4 The four site blocks (byte-exact targets)

**(1) `mini-caddy-metrics` — mTLS, Caddy's own metrics.**

```
https://mini-caddy-metrics.plato-splunk.media {
  tls {
    client_auth {
      mode require_and_verify
      trust_pool file {
        pem_file ${rootCert}
      }
    }
  }

  metrics
}
```

mTLS-gated; body is the lone `metrics` directive (Caddy's self-metrics, enabled by the global
`metrics`). No `reverse_proxy`. Cert-less `tls { client_auth … }` (Caddy ACME supplies the server
cert).

**(2) `mini-jellyfin-metrics` — mTLS + rewrite, scrapes Jellyfin's `/metrics`.**

```
https://mini-jellyfin-metrics.plato-splunk.media {
  tls {
    client_auth {
      mode require_and_verify
      trust_pool file {
        pem_file ${rootCert}
      }
    }
  }

  rewrite / /metrics
  reverse_proxy 127.0.0.1:8096
}
```

mTLS-gated; `rewrite / /metrics` rewrites every request path to `/metrics`, then reverse-proxies to
Jellyfin on `127.0.0.1:8096`.

**(3) `jellyfin.plato-splunk.media` — plain reverse-proxy + `/metrics` redirect.**

```
https://jellyfin.plato-splunk.media {
  handle_path /metrics {
    redir https://mini-jellyfin-metrics.plato-splunk.media
  }

  reverse_proxy localhost:8096
}
```

The public Jellyfin vhost. `handle_path /metrics { redir … }` redirects any `/metrics` hit to the
mTLS metrics vhost (so unauthenticated scrape attempts bounce to the gated endpoint); everything else
reverse-proxies to Jellyfin on `localhost:8096`. **No mTLS** — this is the user-facing site, served
with a Caddy-managed step-ca server cert (global `acme_ca`).

> **Token notes** across all blocks: `rootCert` = the Nix store path of `certs/alford-root.crt`
> (interpolated). Upstream tokens: block (2) uses `127.0.0.1:8096`; block (3) uses `localhost:8096`
> today, but the renderer standardizes on **`127.0.0.1`** (operator-approved, catalog-and-generators
> §7.8 #22) — so block (3)'s generated body becomes `reverse_proxy 127.0.0.1:8096` (an approved
> deviation; `caddy adapt` treats it as equivalent anyway). Preserve `rewrite / /metrics` and
> `handle_path /metrics { redir … }` exactly; cert-less `tls { client_auth … }` for the two mTLS
> blocks (no `tls <fullchain> <key>` prefix). The original has some trailing-whitespace lines (e.g. a
> blank line with spaces after `storage` and after the client_auth block in block 2) — the generated
> text does **not** need to reproduce incidental trailing whitespace **provided the parity gate treats
> it as equivalent** (see §4: compare with whitespace-insensitive diff, or accept a reviewed
> whitespace-only delta — Caddyfile semantics are insensitive to it).

### 1.5 The launchd daemon (stays as-is)

```nix
launchd.daemons.caddy = {
  command = "${pkgs.caddy}/bin/caddy run --config /etc/caddy_nix/Caddyfile --adapter caddyfile";
  serviceConfig = {
    KeepAlive = true;
    RunAtLoad = true;
    StandardOutPath = "/etc/caddy/logs/caddy.info.log";
    StandardErrorPath = "/etc/caddy/logs/caddy.err.log";
  };
};
```

- Runs `caddy run --config /etc/caddy_nix/Caddyfile --adapter caddyfile` — so the daemon reads the
  **same** `/etc/caddy_nix/Caddyfile` whether or not we split out a fragment. Caddy reloads itself;
  there is **no** `reloadServices` concept on darwin (parent plan §2.2a: cert reload is n/a — Caddy
  manages its own certs).
- `KeepAlive`/`RunAtLoad` keep it running and start it at load.
- **This daemon is unchanged by the migration** — it still points at `/etc/caddy_nix/Caddyfile`. As
  long as that file (with the `import`ed fragment) renders the equivalent config, the daemon behaves
  identically.

### 1.6 Properties to preserve (invariants)

- **Global block verbatim**: `email`, `acme_ca` (step-ca http directory), `acme_ca_root`, `storage`,
  `admin off`, `metrics`, `debug`.
- **Four site blocks**, exact: (1) mTLS `metrics`; (2) mTLS `rewrite / /metrics` →
  `reverse_proxy 127.0.0.1:8096`; (3) `handle_path /metrics { redir … }` +
  `reverse_proxy localhost:8096`.
- **mTLS trust pool** = `certs/alford-root.crt` for (1)/(2).
- **Caddy-native ACME** — no `security.acme`, no challenge vhost, no `acmePort`.
- **launchd daemon** points at `/etc/caddy_nix/Caddyfile`, unchanged.
- **No DNS/OIDC/restic/failure-notifs** emitted.

---

## 2. Target state — darwin catalog entries + retained global block

mini imports the darwin `homelab-service-apphost` aggregate (keystone §1: `homelab-catalog` +
`homelab-service-caddy` darwin backend — **no** acme/dns/oidc/firewall). The three site blocks the
catalog can express become catalog entries; the global block + the launchd daemon stay hand-written;
the existing Caddyfile is reduced to the global block + an `import` of the generated fragment.

### 2.1 Catalog entries

Three entries (the `mini-caddy-metrics`, `mini-jellyfin-metrics`, and `jellyfin` vhosts). `backend`
is typed; the bespoke bits (`metrics` directive, `rewrite`, `handle_path redir`) flow through
`extraCaddyConfig` (keystone §2 escape hatch):

```nix
# features/mini-jellyfin/catalog.nix   (new colocated feature for the darwin host)
{ config, ... }:
let
  rootCert = config.constants.ca.rootCert;   # certs/alford-root.crt (same store path as today)
in
{
  homelab.catalog = {
    # (1) Caddy self-metrics, mTLS. No backend — just the `metrics` directive.
    mini-caddy-metrics = {
      subdomain = "mini-caddy-metrics";
      host = "mini";
      # backend has no upstream: use a "none"/extraConfig-only shape. The `metrics`
      # directive is emitted via extraCaddyConfig (see §5 gap: metrics-only vhost).
      backend = { kind = "reverseProxy"; port = null; };   # see §5 #2 (no-upstream vhost)
      tls = {
        gate = "mtls";
        mtlsTrustPoolFile = rootCert;
        mtlsServerCert = null;           # cert-less; Caddy-native ACME server cert
        ca = null;                       # darwin ignores ACME anyway (no security.acme)
      };
      extraCaddyConfig = ''
        metrics
      '';
      dns.enable = false;                 # mini-caddy-metrics A/AAAA stays in tailnetRewrites
    };

    # (2) Jellyfin metrics scrape, mTLS + rewrite.
    mini-jellyfin-metrics = {
      subdomain = "mini-jellyfin-metrics";
      host = "mini";
      backend = { kind = "reverseProxy"; port = 8096; };   # 127.0.0.1:8096
      tls = {
        gate = "mtls";
        mtlsTrustPoolFile = rootCert;
        mtlsServerCert = null;
        ca = null;
      };
      extraCaddyConfig = ''
        rewrite / /metrics
      '';
      dns.enable = false;
    };

    # (3) Public Jellyfin, plain reverse-proxy + /metrics redirect.
    jellyfin = {
      subdomain = "jellyfin";
      host = "mini";
      backend = { kind = "reverseProxy"; port = 8096; };   # 127.0.0.1:8096 (renderer std; was localhost)
      tls.ca = null;                      # Caddy-native server cert; no gate
      extraCaddyConfig = ''
        handle_path /metrics {
          redir https://mini-jellyfin-metrics.plato-splunk.media
        }
      '';
      dns.enable = false;
    };
  };
}
```

### 2.2 Retained hand-written global block + `import`

Per parent plan §2.2a option (b), the existing Caddyfile is reduced to the **global block + an
`import`** of the generated fragment; the launchd daemon still reads
`/etc/caddy_nix/Caddyfile`:

```nix
# features/mini-jellyfin/caddy-host.nix   (darwin: global options the catalog can't express + import)
{ pkgs, ... }:
{
  flake.modules.darwin.mini-jellyfin-caddy-host =
    { pkgs, ... }:
    {
      environment.etc."caddy_nix/Caddyfile".text = ''
        {
          email web@jacob-alford.dev
          acme_ca https://ca.plato-splunk.media/acme/http/directory
          acme_ca_root /etc/step/certs/root_ca.crt

          storage file_system /etc/caddy

          admin off
          metrics
          debug
        }

        import /etc/caddy_nix/catalog-sites.caddy
      '';

      launchd.daemons.caddy = {
        command = "${pkgs.caddy}/bin/caddy run --config /etc/caddy_nix/Caddyfile --adapter caddyfile";
        serviceConfig = {
          KeepAlive = true;
          RunAtLoad = true;
          StandardOutPath = "/etc/caddy/logs/caddy.info.log";
          StandardErrorPath = "/etc/caddy/logs/caddy.err.log";
        };
      };
    };
}
```

> The darwin Caddy generator (keystone §3.3) writes `environment.etc."caddy_nix/catalog-sites.caddy"
> .text` — the three site blocks. The hand-written Caddyfile `import`s it. The launchd daemon is
> unchanged (same `--config /etc/caddy_nix/Caddyfile`). **Caddyfile `import` is a native directive**,
> so Caddy assembles the equivalent full config at parse time.

### 2.3 What the darwin Caddy generator must render (fragment)

The generator (keystone §3.3), filtering `host == mini && managedBy.caddy`, renders one site block
per entry via the shared `renderVhostBody` with `certDir = null`:

```
https://mini-caddy-metrics.plato-splunk.media {
  tls {
    client_auth {
      mode require_and_verify
      trust_pool file {
        pem_file /nix/store/…-alford-root.crt
      }
    }
  }
  metrics
}

https://mini-jellyfin-metrics.plato-splunk.media {
  tls {
    client_auth {
      mode require_and_verify
      trust_pool file {
        pem_file /nix/store/…-alford-root.crt
      }
    }
  }
  rewrite / /metrics
  reverse_proxy 127.0.0.1:8096
}

https://jellyfin.plato-splunk.media {
  reverse_proxy localhost:8096
  handle_path /metrics {
    redir https://mini-jellyfin-metrics.plato-splunk.media
  }
}
```

> **Directive-order note (§5 #4).** Today, block (3) writes `handle_path` **before** `reverse_proxy`;
> the shared `renderVhostBody` (keystone §3.1) appends `extraCaddyConfig` **after** the `backendBlock`
> — so the generated order is `reverse_proxy` then `handle_path`. Caddyfile semantics are **order-
> independent** for `handle_path` vs `reverse_proxy` (Caddy sorts directives by its own precedence),
> so this is operationally equivalent — but it is a **textual** difference. The parity gate (§4) must
> therefore compare **adapted/normalized** Caddyfile JSON (`caddy adapt`), not raw text, OR accept a
> reviewed directive-order-only delta. Similarly block (2)'s `rewrite` then `reverse_proxy` order is
> preserved by appending `rewrite` via `extraCaddyConfig` after… wait: the renderer appends
> `extraCaddyConfig` after `backendBlock`, yielding `reverse_proxy` then `rewrite`, whereas today it is
> `rewrite` then `reverse_proxy`. Again order-equivalent for Caddy, but if byte-parity is desired, add
> a `preBackendCaddyConfig` escape hatch (§5 #4) so `rewrite`/mTLS-adjacent directives can be emitted
> **before** the backend.

---

## 3. Operational equivalence argument

Because darwin has no `services.caddy`/`security.acme` to eval, equivalence is argued and gated on the
**rendered Caddyfile** (parent plan §2.2a / §4).

### 3.1 Global block — unchanged

The global block (`email`, `acme_ca`, `acme_ca_root`, `storage`, `admin off`, `metrics`, `debug`)
stays hand-written verbatim in `caddy-host.nix` (§2.2). Caddy-native ACME is preserved — same
`acme_ca`/`acme_ca_root`, same storage. No `security.acme` is introduced (none exists on darwin).

### 3.2 Site blocks — semantically equivalent (textual order may differ)

- **(1) `mini-caddy-metrics`**: cert-less mTLS `tls { client_auth { … pem_file <rootCert> … } }` +
  `metrics`. The renderer emits the same mTLS block (shared with cicero/technitium — keystone §3.1
  `mtlsTlsLine` cert-less variant) and the `metrics` directive via `extraCaddyConfig`. Equivalent.
- **(2) `mini-jellyfin-metrics`**: cert-less mTLS + `rewrite / /metrics` +
  `reverse_proxy 127.0.0.1:8096`. `backend.port = 8096` and the renderer's global `127.0.0.1` upstream
  (§7.8 #22) reproduce the `127.0.0.1:8096` token exactly. `rewrite` ordering is order-equivalent
  (§2.3 note).
- **(3) `jellyfin`**: `reverse_proxy localhost:8096` + `handle_path /metrics { redir … }`. The
  renderer emits `127.0.0.1:8096` (approved `localhost → 127.0.0.1` standardization — the one expected
  diff for this block; `caddy adapt` treats it as equivalent). `handle_path` via `extraCaddyConfig`.
  Order-equivalent (§2.3 note).

### 3.3 launchd daemon — unchanged

The daemon still runs `caddy run --config /etc/caddy_nix/Caddyfile --adapter caddyfile`. The Caddyfile
now `import`s the fragment, but the **assembled** config Caddy parses is equivalent. KeepAlive,
RunAtLoad, log paths unchanged.

### 3.4 No new surfaces

No `security.acme` (none on darwin), no DNS (mini records stay in `tailnetRewrites`; aedilis's DNS
generator still folds the whole catalog later — a mini-hosted service gets its record from the Linux
DNS host, parent plan §2.2/§2.2a), no OIDC, no restic, no failure-notifs, no firewall change (mini
keeps hand-written rules — out of scope).

**Conclusion:** the assembled Caddyfile is operationally equivalent — identical global block, three
site blocks with identical gates/upstreams/directives (modulo Caddy-order-independent directive
sequence). The daemon is unchanged. The deploy is a theoretical no-op. The only candidate deviations
(directive order; `localhost` vs `127.0.0.1` upstream token) are either Caddy-order-equivalent or
preserved via the §5 escape hatches.

---

## 4. Parity gate (exact commands)

> **Prerequisite (from `.kiro/steering/validation.md`):** flake eval reads the **git tree**. Before
> any eval, `git add` the new `features/mini-jellyfin/*.nix` files; keep `_private/mini/programs.nix`'s
> Caddyfile until the "after" eval passes. For darwin there is **no `services.caddy`/`security.acme`**
> to eval — gate on the **Caddyfile text** (parent plan §2.2a / §4).

### 4.1 Assembled Caddyfile text — primary gate

```sh
# before (current hand-written Caddyfile):
nix eval '.#darwinConfigurations.mini.config.environment.etc."caddy_nix/Caddyfile".text' --raw \
  > /tmp/mini-caddyfile.before
# after (global block + import of generated fragment):
nix eval '.#darwinConfigurations.mini.config.environment.etc."caddy_nix/Caddyfile".text' --raw \
  > /tmp/mini-caddyfile.after
# and the generated fragment:
nix eval '.#darwinConfigurations.mini.config.environment.etc."caddy_nix/catalog-sites.caddy".text' --raw \
  > /tmp/mini-sites.after
```

Because option (b) splits the file, the "after" top-level Caddyfile differs textually (it `import`s a
fragment). The meaningful equivalence is on the **assembled** config. Two acceptable gates:

1. **Semantic (recommended): adapt both to JSON and diff.** Caddy's adapter normalizes directive
   order and whitespace:
   ```sh
   # before: adapt the single current Caddyfile
   caddy adapt --config <(cat /tmp/mini-caddyfile.before) --adapter caddyfile | jq -S . > /tmp/mini.before.json
   # after: assemble global + fragment (mimic the import), then adapt
   cat /tmp/mini-caddyfile.after | sed "s#import /etc/caddy_nix/catalog-sites.caddy#$(cat /tmp/mini-sites.after)#" \
     | caddy adapt --adapter caddyfile | jq -S . > /tmp/mini.after.json
   diff /tmp/mini.before.json /tmp/mini.after.json   # must be empty (semantic equivalence)
   ```
   An empty diff of the adapted JSON **certifies operational equivalence** regardless of directive
   order / whitespace.
2. **Textual (stricter, optional).** Concatenate the global block + fragment in place of the `import`
   and `diff` against the current Caddyfile. Expect only whitespace / directive-order deltas, each of
   which must be explicitly reviewed as Caddy-order-equivalent (§2.3 / §5 #4).

### 4.2 Fragment spot checks (byte-level directives)

```sh
nix eval '.#darwinConfigurations.mini.config.environment.etc."caddy_nix/catalog-sites.caddy".text' --raw
# confirm, per block:
#  - mini-caddy-metrics: tls { client_auth … pem_file <alford-root.crt store path> … } + metrics
#  - mini-jellyfin-metrics: same mTLS + rewrite / /metrics + reverse_proxy 127.0.0.1:8096
#  - jellyfin: reverse_proxy localhost:8096 + handle_path /metrics { redir https://mini-jellyfin-metrics… }
#  - the pem_file path is the SAME store path as certs/alford-root.crt today
```

### 4.3 launchd + trust no-change checks

```sh
# daemon unchanged (still --config /etc/caddy_nix/Caddyfile)
nix eval '.#darwinConfigurations.mini.config.launchd.daemons.caddy.command' --raw
# expect: /nix/store/…-caddy/bin/caddy run --config /etc/caddy_nix/Caddyfile --adapter caddyfile

# trust root unchanged (step-ca root in security.pki)
nix eval '.#darwinConfigurations.mini.config.security.pki.certificateFiles' --json
```

### 4.4 Build gate

```sh
nix run .#nixfmt -- $(git ls-files '*.nix' ':!:repos/**')
nix flake check
darwin-rebuild build --flake .#mini
```

---

## 5. Schema / mechanism gaps flagged

These are the catalog-schema and darwin-mechanism shortfalls this module surfaces. Resolve in
[./catalog-and-generators.md](./catalog-and-generators.md) before migrating mini.

1. **darwin Caddyfile fragment import mechanism (host-config gap).** The mini **global block**
   (`email`, `acme_ca`, `acme_ca_root`, `storage`, `admin off`, `metrics`, `debug`) is not
   catalog-expressible. Per parent plan §2.2a option (b), the darwin backend emits a **site-blocks
   fragment** (`environment.etc."caddy_nix/catalog-sites.caddy".text`) that a **hand-written Caddyfile
   `import`s**, leaving the global options untouched. This is the recommended, least-invasive approach;
   the implementation must (a) write the fragment file, and (b) retain a hand-written Caddyfile that
   `import`s it + the unchanged launchd daemon (§2.2). Alternative (a) — generate the whole Caddyfile
   including global options — would require modeling Caddy global options in the catalog (a host-level
   `catalogHost.<host>.caddyGlobal` block), parallel to the cicero `https_port` host-config gap
   ([./cicero-observability.md](./cicero-observability.md) §5 #1). Not recommended for mini.
2. **No-upstream (metrics-only) vhost.** The `mini-caddy-metrics` block has **no** `reverse_proxy` —
   just the `metrics` directive. The catalog `backend.kind` enum is `reverseProxy | static`, both of
   which emit an upstream directive. Add a `backend.kind = "none"` (or allow `port = null` to emit no
   backend directive) so a vhost can be body-only (`extraCaddyConfig` supplies `metrics`). Without
   this the renderer would emit a spurious `reverse_proxy` line.
3. **~~Explicit upstream host token~~ RESOLVED by global `127.0.0.1` standardization.** Block (2) uses
   `reverse_proxy 127.0.0.1:8096`; block (3) uses `reverse_proxy localhost:8096`. The renderer
   standardizes on **`127.0.0.1`** for all reverse-proxy backends (operator-approved, §7.8 #22), so
   block (2) matches exactly and block (3) gets the approved `localhost → 127.0.0.1` substitution (the
   one expected diff; `caddy adapt` treats it as equivalent anyway). No per-entry host-token field is
   needed. (Same resolution as the
   it-tools reference, [./it-tools.md](./it-tools.md) §2.4.)
4. **Directive ordering (pre/post backend).** The shared `renderVhostBody` appends `extraCaddyConfig`
   **after** the `backendBlock`. Today block (2) has `rewrite` **before** `reverse_proxy`, and block
   (3) has `handle_path` **before** `reverse_proxy`. Caddyfile directive order is **semantically
   irrelevant** (Caddy sorts by its own precedence), so the adapted-JSON parity gate (§4.1 option 1)
   passes regardless. If **textual** byte-parity is wanted, add a `preBackendCaddyConfig` (lines
   emitted before the backend directive) so `rewrite`/`handle_path` can precede `reverse_proxy`
   exactly as today.
5. **Caddy-native ACME on darwin (no `security.acme`, `tls.acmePort`/`challenge` ignored).** Not a gap
   so much as a **confirmed design point** (parent plan §2.2a / decision §5.1 #4): the darwin backend
   emits **no** cert config. `tls.ca`, `tls.acmePort`, `tls.challenge` are **ignored** for
   `host == mini` entries; the server cert comes from the global `acme_ca`. The catalog entries above
   set `ca = null` for clarity, but even `ca = "internal"` would be ignored on darwin. Document this
   so a future contributor doesn't expect a `security.acme.certs` entry for a mini service.

---

## 6. Migration checklist (condensed)

- [ ] Baseline captured: §4.1 (current Caddyfile `--raw` → adapted JSON), §4.3 (launchd command,
      pki trust) → `*.before`
- [ ] Keystone schema gaps resolved: fragment-import darwin backend (§5 #1), `backend.kind = "none"`/
      `port = null` no-upstream vhost (§5 #2), explicit upstream host token (§5 #3), optional
      `preBackendCaddyConfig` / adapted-JSON parity approach (§5 #4); confirm darwin ignores ACME (§5 #5)
- [ ] `features/mini-jellyfin/catalog.nix` — three entries (`mini-caddy-metrics`,
      `mini-jellyfin-metrics`, `jellyfin`) with `host = "mini"`, mTLS gates + `mtlsTrustPoolFile =
      c.ca.rootCert` + `mtlsServerCert = null` for (1)/(2), `extraCaddyConfig` for `metrics` /
      `rewrite` / `handle_path redir`, upstream `127.0.0.1:8096` (2) vs `localhost:8096` (3),
      `dns.enable = false` (§2.1)
- [ ] `features/mini-jellyfin/caddy-host.nix` — hand-written global block + `import
      /etc/caddy_nix/catalog-sites.caddy` + unchanged `launchd.daemons.caddy` (§2.2)
- [ ] darwin Caddy generator opted in (`managedBy.caddy`) → emits `caddy_nix/catalog-sites.caddy`
- [ ] mini imports darwin `homelab-service-apphost` (caddy + catalog only; no acme/dns/oidc/firewall)
- [ ] old Caddyfile site blocks removed from `_private/mini/programs.nix` (global block + daemon moved
      to `caddy-host.nix`, or left if preferred — but the four site blocks are now generated)
- [ ] New files `git add`ed (Nix sees the git tree)
- [ ] **Parity gate green:** adapted-JSON diff of assembled Caddyfile empty (§4.1 option 1); fragment
      spot checks correct (§4.2); launchd command + pki trust unchanged (§4.3)
- [ ] DNS deferred: `tailnetRewrites.{mini-caddy-metrics,mini-jellyfin-metrics} = "mini"` (and any
      `jellyfin`/`ollama`) stay until [./dns-records.md](./dns-records.md); mini records folded by the
      **aedilis** DNS generator (central DNS, cross-platform — parent plan §2.2/§2.2a)
- [ ] `nix run .#nixfmt`, `nix flake check`, `darwin-rebuild build --flake .#mini` all pass
- [ ] Deployed — confirmed no-op (assembled Caddyfile semantically identical; daemon unchanged)

---

## 7. Cross-references

- **The shared vhost-body renderer** (keystone §3.1 `renderVhostBody`) is reused by **both** the
  NixOS and darwin Caddy backends with `certDir = null` on darwin — mini is the exercise that proves
  the two-backend design (parent plan §2.2a). The cert-less `tls { client_auth … }` mTLS variant
  (§5-shared with [./cicero-observability.md](./cicero-observability.md) §5 #4 and
  [./technitium-caddy.md](./technitium-caddy.md)) must land in the shared renderer.
- **darwin has no `security.acme`** (verified against vendored `repos/nix-darwin`, parent plan
  §2.2a / decision §5.1 #4): Caddy-native ACME via the global `acme_ca`. No challenge vhost, no
  `acmePort`, no cert reload.
- **Central DNS is cross-platform**: mini-hosted services still get A/AAAA records from the **aedilis**
  DNS generator (it folds the whole catalog regardless of host platform) — see
  [./dns-records.md](./dns-records.md) (parent plan §2.2/§2.5).
- **Upstream host-token standardization** (`localhost → 127.0.0.1`) is a global, operator-approved
  renderer default (it-tools reference [./it-tools.md](./it-tools.md) §2.4); block (3)'s jellyfin
  upstream gets it, verified via the `caddy adapt` JSON diff.
