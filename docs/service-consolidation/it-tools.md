# it-tools — Reference Migration (simplest service)

Status: **PROPOSED**
Date: 2026-10-22
Parent: [../service-consolidation-plan.md](../service-consolidation-plan.md) ·
Index: [./README.md](./README.md)

> **This is the reference per-service plan.** it-tools is the simplest externally-reachable service:
> a plain reverse-proxy container with **no OIDC**, **no manual TLS cert** (it shares Caddy's managed
> cert), and **no new firewall opening** (443 is already open on augustus). Every other per-service
> plan in this directory mirrors the structure here: (1) capture current output verbatim, (2) show
> the new feature layout + catalog entry, (3) argue operational equivalence, (4) give the exact
> parity gate, (5) a step-by-step checklist.
>
> **Operational-equivalence contract (from [./README.md](./README.md)):** deploying this revision
> MUST be a theoretical no-op. The migration changes _where_ config is declared, never _what_ gets
> realized. For it-tools there are **zero** permitted intentional deviations — the vhost extraConfig,
> the container, and failure-notifs must all render byte-identical.

---

## 0. Why it-tools is the reference

Concerns emitted today (per the index): **V F** — a Caddy vhost and a firewall-relevant 443 (already
open). No ACME cert (C), no OIDC client (O), no DNS record that this module itself owns (the
`dev-tools` A/AAAA record lives in the centralized `tailnetRewrites` map, not in the module). That
makes it the minimal end-to-end exercise of the catalog + generators:

- **Caddy generator** must reproduce one `reverse_proxy` vhost on augustus.
- **DNS generator** must reproduce the existing `dev-tools.plato-splunk.media` A/AAAA record (today
  sourced from `tailnetRewrites`), so this plan also seeds the DNS-parity method the other services
  reuse.
- **Firewall generator** must _not_ add anything new (443 is baseline, already open) — it only has to
  avoid regressing.
- **failure-notifs** stays attached to `podman-it-tools`, unchanged, colocated with the container.

No cert group, no OIDC scope/claim maps, no mTLS, no base-path rewrites — nothing bespoke to carry
over. If the parity gate is clean here, the pattern is sound.

---

## 1. Current state — emitted output captured verbatim

### 1.1 The module today: `nix-config/modules/services/it-tools.nix`

```nix
{ config, ... }:
let
  c = config.constants;
  svc = c.services.it-tools;
in
{
  flake.modules.nixos.it-tools =
    { config, lib, pkgs, ... }:
    {
      virtualisation.oci-containers.containers = {
        it-tools = {
          image = "sharevb/it-tools:latest";
          ports = [ "127.0.0.1:${builtins.toString svc.port}:8080" ];
        };
      };

      services.caddy.virtualHosts."${svc.url}" = {
        extraConfig = ''
          reverse_proxy localhost:${builtins.toString svc.port}
        '';
      };

      services.failure-notifs.attachServices = [
        "podman-it-tools"
      ];
    };
}
```

### 1.2 Constants it reads: `nix-config/modules/service-registry.nix`

The `it-tools` entry (lines ~274–278):

```nix
it-tools = {
  subdomain = "dev-tools";
  domain = mkDomain "dev-tools";   # -> "dev-tools.plato-splunk.media"
  url = mkUrl "dev-tools";         # -> "https://dev-tools.plato-splunk.media"
  port = 47309;
};
```

with the shared helpers (lines 7–10):

```nix
baseDomain = "plato-splunk.media";
mkDomain = subdomain: "${subdomain}.${baseDomain}";
mkUrl    = subdomain: "https://${mkDomain subdomain}";
```

So `svc.url` = `https://dev-tools.plato-splunk.media` and `svc.port` = `47309`.

### 1.3 The DNS record (centralized, in `tailnetRewrites`)

The module itself emits **no** DNS record. The `dev-tools` hostname resolves because
`service-registry.nix` lists it in the hand-maintained `tailnetRewrites` map (line ~46):

```nix
tailnetRewrites = {
  # …
  dev-tools = "augustus";
  # …
};
```

Each entry becomes an **apex A + AAAA** record under `plato-splunk.media`, pointing at the host's
tailnet addresses from the local `ts` table:

```nix
ts.augustus.v4 = "100.95.250.77";
ts.augustus.v6 = "fd7a:115c:a1e0::6301:fa4d";
```

i.e. today's effective record set for this service is:

```
dev-tools.plato-splunk.media.  A     100.95.250.77
dev-tools.plato-splunk.media.  AAAA  fd7a:115c:a1e0::6301:fa4d
```

emitted into the `plato-splunk.media` Primary zone on **aedilis** via
`services.technitium-server-complete.provision.ensureDnsRecords.zones` (fed from
`constants.dnsRecords.private`). The DNS generator (plan
[./dns-records.md](./dns-records.md)) must reproduce exactly this pair.

### 1.4 The resolved emitted Caddy output

After `${svc.url}` / `${svc.port}` interpolation, augustus realizes:

```nix
services.caddy.virtualHosts."https://dev-tools.plato-splunk.media" = {
  extraConfig = ''
    reverse_proxy localhost:47309
  '';
};
```

> **Byte note + approved deviation:** the heredoc body today is a single line `reverse_proxy
> localhost:47309` followed by a trailing newline. **The generator standardizes the upstream token on
> `127.0.0.1`** (operator-approved — see [catalog-and-generators §7.8 #22](./catalog-and-generators.md);
> the operator hit real DNS oddities where `localhost` intermittently failed). So the generated body
> is `reverse_proxy 127.0.0.1:47309\n`, and the parity gate (§4) will show **exactly** the
> `localhost → 127.0.0.1` substitution — the single approved, reviewed diff — with the same single
> trailing newline and no leading indentation. Everything else about the vhost is unchanged.

### 1.5 The firewall (already satisfied, no module contribution)

it-tools opens **nothing**. Its container binds `127.0.0.1:47309` (loopback only), and the public
entrypoint is Caddy on `443`, which augustus already opens in
`nix-config/modules/_private/augustus/security.nix`:

```nix
networking.firewall.allowedTCPPorts = [
  80
  443
  # radius
  1812
  1813
];
```

So there is **no it-tools-attributable firewall rule to migrate** — the firewall generator must add
nothing for this service. (443 is a baseline/shared opening owned by the host, per parent plan
decision §5.1 #7.)

### 1.6 Properties to preserve (checklist of invariants)

- **No OIDC.** it-tools has no Kanidm client; the catalog entry omits `oidc` entirely → OIDC
  generator emits nothing.
- **No manual TLS cert.** The vhost names no cert and shares Caddy's managed cert → `tls.cert.shared
  = { }`, no `security.acme.certs` entry, no challenge vhost (parent plan §2.4).
- **443 already open on augustus.** No new firewall opening.
- **failure-notifs unchanged.** `attachServices = [ "podman-it-tools" ]` stays, colocated with the
  container in `service.nix`.
- **Container image/ports unchanged.** `sharevb/it-tools:latest`, `127.0.0.1:47309:8080`.

---

## 2. Target state — colocated feature layout

Replace the single `services/it-tools.nix` with a `features/it-tools/` directory following the
parent plan §2.0 convention. it-tools has **no** `options.nix` (no service-specific options) and
**no** `oidc.nix` (no OIDC):

```
features/it-tools/
├── catalog.nix     # homelab.catalog.it-tools = { … }  (the networking contract ONLY)
├── service.nix     # oci-container it-tools + failure-notifs.attachServices (the runtime)
└── complete.nix    # flake.modules.nixos.it-tools = { imports = [ it-tools-catalog it-tools-service ]; }
```

Rationale for the split (per parent plan §2 / §5.1 #2):

- **`catalog.nix`** holds only the cross-cutting networking facts the generators consume. It does
  **not** hold the container or failure-notifs.
- **`service.nix`** holds the runtime (`virtualisation.oci-containers.containers.it-tools`) **and**
  `services.failure-notifs.attachServices = [ "podman-it-tools" ]` — failure-notifs is tied to the
  **service declaration** (the systemd unit the feature defines), so it lives next to the unit it
  names, never in the catalog.
- **`complete.nix`** is what `hosts/augustus.nix` imports (as `nixos.it-tools` today). Importing it
  both realizes the container **and** registers the catalog entry; the host's generators pick it up.

### 2.1 `features/it-tools/catalog.nix`

```nix
{ config, ... }:
let
  # Port stays a single source of truth. During the transition it may still read
  # constants.services.it-tools.port; once constants.services.* is retired the port
  # lives here (or in a feature options.nix). Kept as constants for now to avoid
  # changing the value's provenance in the reference migration.
  svc = config.constants.services.it-tools;
in
{
  homelab.catalog.it-tools = {
    subdomain = "dev-tools";
    # zone defaults to constants.baseDomain = "plato-splunk.media"; stated for clarity.
    zone = "plato-splunk.media";
    host = "augustus";

    backend.reverseProxy.port = svc.port; # 47309

    # Shares Caddy's managed cert — no manual ACME cert, no challenge vhost.
    tls.cert.shared = { };

    # Reachable over the tailnet (opens nothing new: 443 is a baseline host opening).
    access.scope.tailnet = { };

    # Emit the dev-tools A/AAAA record on aedilis (reproduces today's tailnetRewrites entry).
    dns.tailnet = { };
    # dns.tailnet -> A/AAAA from constants.hosts.augustus.tailscale.
  };
}
```

Notes:

- **No `oidc` block** → OIDC generator skips it.
- **`tls.cert.shared = { }`** → ACME generator skips it (no cert, no challenge vhost, shares Caddy's
  managed cert — parent plan §2.4).
- **`access.scope.tailnet = { }`** documents reachability; the firewall generator maps `tailnet` to
  `tailscale0`, but since 443 is already a baseline opening owned by the host, nothing new is added
  (parent plan §2.7 / §5.1 #7).
- **`dns.tailnet = { }`** → the DNS generator (on aedilis) emits
  `dev-tools.plato-splunk.media` A/AAAA from `constants.hosts.augustus.tailscale.{v4,v6}`, replacing
  the `tailnetRewrites.dev-tools = "augustus"` line.

### 2.2 `features/it-tools/service.nix`

Verbatim carry-over of the runtime + failure-notifs (unchanged behavior):

```nix
{ config, ... }:
let
  svc = config.constants.services.it-tools;
in
{
  flake.modules.nixos.it-tools-service =
    { ... }:
    {
      virtualisation.oci-containers.containers.it-tools = {
        image = "sharevb/it-tools:latest";
        ports = [ "127.0.0.1:${builtins.toString svc.port}:8080" ];
      };

      services.failure-notifs.attachServices = [
        "podman-it-tools"
      ];
    };
}
```

> The container block and `attachServices` are copied **exactly** from today's module — same image
> tag, same `127.0.0.1:${port}:8080` mapping, same attached unit name. No behavioral change.

### 2.3 `features/it-tools/complete.nix`

```nix
{ ... }:
{
  flake.modules.nixos.it-tools = {
    imports = [
      # catalog.nix contributes homelab.catalog.it-tools (consumed by the host generators)
      # service.nix contributes the container + failure-notifs
    ];
    # In the dendritic tree, catalog.nix/service.nix publish into
    # flake.modules.nixos.{it-tools-catalog,it-tools-service}; complete.nix aggregates
    # them so hosts/augustus.nix keeps importing a single `nixos.it-tools`.
  };
}
```

> The exact aggregation idiom mirrors existing `features/<name>/complete.nix`
> (e.g. `cicero-observability`, `acme-client-cert`). The key property: `hosts/augustus.nix` continues
> to import **one** name (`nixos.it-tools`), and that import both realizes the container and
> registers the catalog entry. The host separately imports the generator modules
> (`homelab-service-caddy`, `-dns` on aedilis, `-firewall`) once, per parent plan §2.2 / §5.2 #2.

### 2.4 What the Caddy generator must render for it-tools

The generator (parent plan §2.3) filters catalog entries to `host == config.networking.hostName`
(so this only materializes on augustus), and for a `backend.reverseProxy` entry renders the vhost
body. For it-tools it produces:

```nix
services.caddy.virtualHosts."https://dev-tools.plato-splunk.media".extraConfig = ''
  reverse_proxy 127.0.0.1:47309
'';
```

Two requirements for the reference renderer (these generalize to every reverse-proxy service):

1. **Upstream token is `127.0.0.1` (approved standardization).** Today's module writes
   `reverse_proxy localhost:${port}`. The generator's reverseProxy renderer emits **`127.0.0.1`** for
   every service — an operator-approved deviation (catalog-and-generators §7.8 #22) that fixes a real
   DNS-resolution oddity where `localhost` intermittently failed. For it-tools this is the **one**
   expected diff in the parity gate: `localhost:47309 → 127.0.0.1:47309`.
2. **Trailing newline, no indentation.** The rendered `extraConfig` is the single line
   `reverse_proxy 127.0.0.1:47309\n`. No leading whitespace, exactly one trailing newline — matching
   the `''…''` heredoc shape today.

The vhost **key** must remain the full `https://dev-tools.plato-splunk.media` (derived from
`<subdomain>.<zone>` → `mkUrl`), identical to `svc.url` today.

---

## 3. Operational equivalence argument

Deploying this revision changes nothing on any host **except** the approved `localhost → 127.0.0.1`
upstream substitution. Per surface:

### 3.1 Caddy vhost (augustus) — one approved diff

- **Key:** `https://dev-tools.plato-splunk.media` derived as `mkUrl "dev-tools"` =
  `"https://" + "dev-tools" + "." + "plato-splunk.media"`. The catalog derives `url` from
  `<subdomain>.<zone>` with the same base domain, so the attribute key is identical.
- **Body:** old renders `reverse_proxy localhost:47309\n`; new renders `reverse_proxy
  127.0.0.1:47309\n`. Same port, same single trailing newline — the **only** difference is the
  approved `localhost → 127.0.0.1` token (functionally equivalent; a deliberate bugfix).
- **Nothing else** on the vhost (no `tls`, no `client_auth`, no `handle`, no tracing span — it-tools
  has none today), so there is no extra config to accidentally add or drop.

### 3.2 DNS (aedilis) — same A/AAAA pair reproduced

- Today: `tailnetRewrites.dev-tools = "augustus"` → apex A `100.95.250.77` + AAAA
  `fd7a:115c:a1e0::6301:fa4d` in the `plato-splunk.media` Primary zone.
- New: `dns.tailnet = { }; host = "augustus"` → the DNS generator emits A/AAAA
  from `constants.hosts.augustus.tailscale.{v4,v6}`. Those MUST equal the `ts.augustus` values
  (`100.95.250.77` / `fd7a:115c:a1e0::6301:fa4d`) — the parent plan notes `ts` is a duplicate of
  `constants.hosts.<name>.tailscale` and is deleted only after the DNS parity diff is clean
  (parent plan §2.5 / §3 step 6). The emitted record set is therefore identical.
- **Upsert-only semantics preserved:** the provisioning feature only upserts (never deletes), so even
  if DNS migration lands separately from the Caddy move, no record is removed. This plan does not
  change the provisioning mechanism, only the record source.

> **Sequencing:** the Caddy/feature move (steps below) and the DNS generator cutover are independent.
> it-tools' `dns.tailnet = { }` is declared now, but the `dev-tools` A/AAAA record continues to be
> produced by `tailnetRewrites` until the DNS generator is switched on and `tailnetRewrites` is
> deleted ([./dns-records.md](./dns-records.md), parent plan §3 step 9). During the overlap the record
> is produced by exactly one source at a time (the DNS plan deletes the `tailnetRewrites` entry in the
> same change that enables generator output), so there is never a duplicate or a gap. The it-tools DNS
> parity is verified as part of that DNS-records migration, using the same before/after eval in §4.3.

### 3.3 Firewall (augustus) — no change

- it-tools opens nothing today; `access.scope.tailnet` maps to `tailscale0`, but 443 is a
  baseline host opening (owned by `_private/augustus/security.nix`, not service-attributable). The
  firewall generator adds **no** new port for it-tools. `networking.firewall` must be byte-identical.

### 3.4 failure-notifs (augustus) — unchanged

- `services.failure-notifs.attachServices` still contains `"podman-it-tools"`, now sourced from
  `service.nix` instead of `services/it-tools.nix`. NixOS merges the list by concatenation, so the
  final merged list on augustus is identical.

### 3.5 Container (augustus) — unchanged

- `virtualisation.oci-containers.containers.it-tools` is copied verbatim (image, loopback port map).
  The resulting `podman-it-tools.service` is identical.

**Conclusion:** every realized attribute (Caddy vhost, DNS records, firewall ports, failure-notifs
list, container unit) is identical before and after. The deploy is a theoretical no-op, with zero
permitted intentional deviations.

---

## 4. Parity gate (exact commands)

> **Prerequisite (from `.kiro/steering/validation.md`):** flake eval reads the **git tree**. Before
> any eval, `git add` the new `features/it-tools/*.nix` files (and keep the old
> `services/it-tools.nix` until the "after" eval passes). Untracked new `.nix` files are invisible to
> `import-tree` and will produce a misleading "missing attribute" error.

### 4.1 Caddy vhost — the primary gate

Run **before** the migration (on the current tree) and capture the output:

```sh
nix eval \
  '.#nixosConfigurations.augustus.config.services.caddy.virtualHosts."https://dev-tools.plato-splunk.media".extraConfig' \
  --raw
```

Expected **before** (byte-for-byte):

```
reverse_proxy localhost:47309
```

Expected **after** (the approved substitution):

```
reverse_proxy 127.0.0.1:47309
```

(single line + trailing newline, each).

Run the **same** command **after** the migration. The two `--raw` outputs must differ by **only** the
`localhost → 127.0.0.1` token. A convenient one-shot diff (stash/commit between captures, or eval two
worktrees):

```sh
# before:
nix eval '.#nixosConfigurations.augustus.config.services.caddy.virtualHosts."https://dev-tools.plato-splunk.media".extraConfig' --raw > /tmp/ittools-vhost.before
# after:
nix eval '.#nixosConfigurations.augustus.config.services.caddy.virtualHosts."https://dev-tools.plato-splunk.media".extraConfig' --raw > /tmp/ittools-vhost.after
diff /tmp/ittools-vhost.before /tmp/ittools-vhost.after   # expect ONLY the localhost->127.0.0.1 line
```

The expected diff is exactly one changed line (`localhost` → `127.0.0.1`). Any **other** difference is
a **fail** (the reference migration
permits no intentional deviation).

### 4.2 Whole-vhosts sanity (catches accidental key change or extra attrs)

```sh
nix eval '.#nixosConfigurations.augustus.config.services.caddy.virtualHosts' --json \
  | jq '."https://dev-tools.plato-splunk.media"'
```

Before/after JSON for this key must match (confirms no stray `tls`/`serverAliases`/etc. crept in and
the key string is unchanged).

### 4.3 DNS parity (verified with the dns-records migration)

```sh
nix eval \
  '.#nixosConfigurations.aedilis.config.services.technitium-server-complete.provision.ensureDnsRecords.zones' \
  --json \
  | jq '."plato-splunk.media".records | map(select(.name == "dev-tools"))'
```

Before/after must contain the same A (`100.95.250.77`) and AAAA (`fd7a:115c:a1e0::6301:fa4d`)
records for `dev-tools`. (Run as part of [./dns-records.md](./dns-records.md) when the DNS generator
is switched on.)

### 4.4 Firewall + failure-notifs no-change checks

```sh
# firewall: byte-identical before/after
nix eval '.#nixosConfigurations.augustus.config.networking.firewall.allowedTCPPorts' --json
nix eval '.#nixosConfigurations.augustus.config.networking.firewall.interfaces.tailscale0.allowedTCPPorts' --json

# failure-notifs still attaches podman-it-tools
nix eval '.#nixosConfigurations.augustus.config.services.failure-notifs.attachServices' --json \
  | jq 'index("podman-it-tools") != null'   # -> true

# container unchanged
nix eval '.#nixosConfigurations.augustus.config.virtualisation.oci-containers.containers.it-tools' --json
```

### 4.5 Build gate

```sh
nix run .#nixfmt -- $(git ls-files '*.nix' ':!:repos/**')
nix flake check
nixos-rebuild build --flake .#augustus        # closure builds; compare store path if desired
```

---

## 5. Step-by-step migration checklist

> Depends on the catalog schema + generators already existing
> ([./catalog-and-generators.md](./catalog-and-generators.md), parent plan §3 step 1). This plan is
> step 2 — the reference service.

1. **Capture baseline.** Run §4.1 (Caddy vhost `--raw`), §4.2 (whole-vhost JSON), §4.4 (firewall /
   failure-notifs / container). Save outputs to `/tmp/ittools-*.before`. These are the equivalence
   oracle.

2. **Create the feature directory** `nix-config/modules/features/it-tools/`:
   - `catalog.nix` — the `homelab.catalog.it-tools` entry from §2.1
     (`subdomain = "dev-tools"`, `host = "augustus"`,
     `backend.reverseProxy.port = 47309`, `tls.cert.shared = { }`,
     `access.scope.tailnet = { }`, `dns.tailnet = { }`). **No `oidc`.**
   - `service.nix` — the container + `failure-notifs.attachServices = [ "podman-it-tools" ]`,
     copied verbatim from §2.2.
   - `complete.nix` — aggregate both into `flake.modules.nixos.it-tools` (§2.3), preserving the
     import name `hosts/augustus.nix` already uses.

3. **Opt the service into the Caddy generator.** Per the parent plan's incremental opt-in
   (step 1: `managedBy.caddy` flag), ensure augustus's Caddy generator now renders it-tools' vhost
   **instead of** the hand-written one.

4. **Delete the hand-written vhost.** Remove the `services.caddy.virtualHosts."${svc.url}"` block —
   it now comes from the generator. (Keep `services/it-tools.nix` otherwise untouched only if any
   part is not yet moved; the goal is to delete the whole file once `complete.nix` fully replaces it.)

5. **Remove the old module** `nix-config/modules/services/it-tools.nix` once `features/it-tools/`
   fully supersedes it. Confirm `hosts/augustus.nix` still imports `nixos.it-tools` (now provided by
   `complete.nix`).

6. **Stage the new files for Nix eval:** `git add nix-config/modules/features/it-tools/` and
   `git rm`/stage the deletion of `services/it-tools.nix`. (Required — see §4 prerequisite.)

7. **Run the parity gate.** Re-run §4.1/§4.2/§4.4 → `/tmp/ittools-*.after`; `diff` each against
   `.before`. **The Caddy vhost diff shows exactly the approved `localhost → 127.0.0.1` line; all
   other diffs MUST be empty.** If anything else differs, fix the generator/catalog (common culprits:
   missing/extra trailing newline, changed vhost key, leading indentation).

8. **DNS (deferred to the dns-records migration).** Leave `tailnetRewrites.dev-tools = "augustus"` in
   place for now; it-tools' `dns.tailnet = { }` is declared but the record is still produced by
   `tailnetRewrites`. When [./dns-records.md](./dns-records.md) switches on the DNS generator, verify
   §4.3 parity and delete the `tailnetRewrites` entry in that same change.

9. **Format + check + build.** `nix run .#nixfmt -- …`, `nix flake check`,
   `nixos-rebuild build --flake .#augustus`. All must pass.

10. **Deploy as a near-no-op.** Every realized attribute is identical **except** the approved
    `localhost → 127.0.0.1` upstream token; the `podman-it-tools` container, the vhost key, and
    failure-notifs are unchanged on augustus.

---

## 6. Migration checklist (condensed)

- [ ] Baseline captured (§4.1/§4.2/§4.4 → `*.before`)
- [ ] `features/it-tools/catalog.nix` — catalog entry (no OIDC, `tls.cert.shared = { }`,
      `access.scope.tailnet = { }`, `dns.tailnet = { }`)
- [ ] `features/it-tools/service.nix` — container + `failure-notifs.attachServices` (verbatim)
- [ ] `features/it-tools/complete.nix` — aggregates to `flake.modules.nixos.it-tools`
- [ ] Caddy generator opted in; hand-written vhost deleted
- [ ] Old `services/it-tools.nix` removed; `hosts/augustus.nix` import name preserved
- [ ] New files `git add`ed (Nix sees the git tree)
- [ ] **Parity gate green:** Caddy vhost `--raw` diff = only the approved `localhost → 127.0.0.1` line
      (§4.1); whole-vhost JSON otherwise matches (§4.2); firewall / failure-notifs / container
      unchanged (§4.4)
- [ ] DNS parity deferred to [./dns-records.md](./dns-records.md) (§4.3), `tailnetRewrites.dev-tools`
      removed there
- [ ] `nix run .#nixfmt`, `nix flake check`, `nixos-rebuild build --flake .#augustus` all pass
- [ ] Deployed — confirmed near-no-op (only the approved upstream-token change)

---

## 7. Notes for the plans that mirror this one

- **The shared reverse-proxy renderer standardizes on `127.0.0.1` + single trailing newline** (§2.4):
  every reverse-proxy service inherits the `localhost → 127.0.0.1` substitution as its one approved
  parity-gate diff — verify the renderer once here, then only the per-service _delta_ (OIDC maps, cert
  group, mTLS block, base-path rewrites) needs re-arguing in the other plans.
- **`tls.cert.shared = { }` is the common case** (shared Caddy managed cert). Only manual-TLS services
  (kanidm, postgres, radius, aedilis technitium) diverge with a `security.acme.certs` entry and a
  per-service `tls.cert.own.certGroup` (parent plan §5.1 #6).
- **failure-notifs always lives in `service.nix`**, never the catalog — it belongs to the service's
  systemd unit (parent plan §5.1 #2). Services with a `restic` backup or `services.*` block put those
  in `service.nix` too.
- **DNS is centralized on aedilis** and migrated once (dns-records plan); per-service plans only
  declare their `dns.*` variant and verify their record survives the cutover with the §4.3 eval.
