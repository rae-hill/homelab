# Technitium Provisioning Module + `ensureDnsRecords` — Plan

Status: **planning** (nothing implemented yet)
Date: 2026-10-13

> **Decisions locked (2026-10-13):** O1 server-only generic module; O2 dedicated
> token-refresher service + shared token file gated by service-account group; O3
> plain-Nix values with a **shared public/private record source of truth** reusable
> across hosts; O4 **upsert-only / strictly idempotent — never delete** (the "ensure"
> semantics); O6 per-host provisioner, and provisioning units must surface failures
> in Grafana (node-exporter `systemd` collector metrics + Alloy journald logs). See §4–§6, §9.

> Scope: extract the provisioning logic currently baked into
> `features/technitium/provision.nix` into a dedicated, reusable
> **`technitium-provisioning`** feature module; split the single oneshot into a set
> of smaller systemd units wired together with a hierarchical `Requires=`/`After=`
> call-stack; and add a new **`ensureDnsRecords`** option that declaratively
> reconciles authoritative zones + records against a Technitium server via its
> HTTP API. The goal is to deploy DNS records declaratively from Nix to both
> **private (Tailscale)** and **public** authoritative servers that will be stood
> up on future hosts.

> This feature is being built ahead of use. Aedilis stays a **recursive resolver**
> (unchanged behaviour). The new authoritative hosts do not exist yet; this plan
> delivers the module + options so those hosts can be stood up declaratively later.

---

## 1. Motivation & End State

Today the provisioning is a single monolithic `technitium-provision.service` oneshot
living inside the generic `technitium` feature (`provision.nix`). It:

- waits for the API (`/api/status`),
- logs in as `admin`,
- sets DNSSEC validation + QPM rate limits (`settings/set`),
- converts the managed PEM → PKCS#12 and enables DoH/DoT/DoQ,
- creates the `metrics-readonly` group + `prometheus` metrics user + TOTP.

The user wants two things:

1. **Extraction + decomposition.** Pull provisioning into its own
   `technitium-provisioning` feature and split the one oneshot into **several
   smaller oneshots** chained with `Requires=`/`After=` so the call-stack is
   explicit and each concern can fail/retry independently.
2. **A new `ensureDnsRecords` capability.** A Nix option describing authoritative
   zones and their records; a provisioning unit calls `zones/create` +
   `zones/records/add` (and reconciles/prunes) so DNS records are declared in Nix
   and pushed to the server on every deploy.

End state use-case:

- **Private authoritative server(s)** on the tailnet: host a zone (or split-horizon
  view) whose `A`/`AAAA` records point at Tailscale `100.x` / ULA addresses — these
  never touch Route53.
- **Public authoritative server(s)**: host the same zones' public records,
  declaratively, so zone management moves out of the Route53 console into this repo.
- Both are driven by the same `ensureDnsRecords` option shape; which records go to
  which host is a per-host Nix decision.

---

## 2. Current State (what we're refactoring)

| File                                | Role today                                                           |
| ----------------------------------- | -------------------------------------------------------------------- |
| `features/technitium/options.nix`   | `services.technitium-server-complete.*` schema (incl. `provision.*`) |
| `features/technitium/service.nix`   | Technitium service + first-boot env bootstrap                        |
| `features/technitium/provision.nix` | **Single** `technitium-provision` oneshot (all provisioning)         |
| `features/technitium/caddy.nix`     | Admin UI + metrics vhosts                                            |
| `features/technitium/complete.nix`  | Aggregates options/service/provision/caddy                           |
| `features/technitium/kanidm.nix`    | augustus-side OIDC client (unchanged)                                |
| `features/technitium-aedilis/*`     | aedilis wiring (acme, observability, option values)                  |

The provisioner authenticates as `admin` on every run (via `adminPasswordFile`),
checks `.status == "ok"` on every call, and is fail-fast. We keep all of that.

---

## 3. Target Layout

```
nix-config/modules/features/
├── technitium/                        # generic server (service/caddy/options) — stays
│   ├── options.nix                    # EXTEND: move provision.* here-stay or split (see §4)
│   ├── service.nix                    # unchanged
│   ├── caddy.nix                      # unchanged
│   ├── complete.nix                   # drop technitium-provision import; see §7
│   └── kanidm.nix                     # unchanged
└── technitium-provisioning/           # NEW feature: all API-driven provisioning
    ├── options.nix                    # NEW: services.technitium-server-complete.provision.* (incl. ensureDnsRecords)
    ├── lib.nix                        # NEW: shared shell helpers (api_call, token read, readiness) as a writeShellApplication library
    ├── token.nix                      # NEW: technitium-provision-token.service + .timer (refreshes shared session token)
    ├── wait.nix                       # NEW: technitium-provision-wait.service (readiness gate)
    ├── settings.nix                   # NEW: technitium-provision-settings.service (DNSSEC + rate limit)
    ├── encrypted-dns.nix              # NEW: technitium-provision-encrypted-dns.service (PKCS#12 + DoH/DoT/DoQ)
    ├── metrics-user.nix               # NEW: technitium-provision-metrics-user.service (group+user+TOTP)
    ├── records.nix                    # NEW: technitium-provision-records.service (ensureDnsRecords, upsert-only)
    └── complete.nix                   # NEW: aggregates the provisioning submodules + target oneshot
```

Design notes:

- **Keep the option namespace** `services.technitium-server-complete.*`. The new
  module declares the `provision.*` options (moved out of the generic `options.nix`),
  so `technitium` and `technitium-provisioning` share one config surface. The
  generic server module no longer needs to know about provisioning internals.
- **`technitium/complete.nix` stops importing provisioning (O1: server-only).** The
  generic `technitium` feature is server-only (service + caddy + options-minus-provision).
  Hosts opt into provisioning by importing `technitium-provisioning` explicitly. This
  is safe: `technitium` is currently consumed **only** by `technitium-aedilis`, and
  aedilis has never been deployed — no back-compat shim needed.
- **Shared shell helpers** (`api_call`, token read, readiness poll) are factored into a
  single `writeShellApplication` library sourced by each unit's script, so the
  fail-fast error handling is defined once (today it's duplicated inline).

---

## 4. systemd Call-Stack (hierarchical `depends-on`) + shared token (O2)

Replace the single `technitium-provision.service` with a chain of oneshots plus a
dedicated **token-refresher** service. Each oneshot is `Type=oneshot`,
`RemainAfterExit=true`, `Restart=on-failure`, runs as `cfg.user`/`cfg.group`, and is
gated by its own enable condition.

```
technitium-dns-server.service
        │  (After/Requires)
        ▼
technitium-provision-wait.service            # polls /api/status until the API answers
        │
        ▼
technitium-provision-token.service (+ .timer)  # logs in w/ adminPasswordFile → writes shared token file
        │                                        # owned by root:<tokenGroup>, mode 0640
        │  (After/Requires; sub-units read the token via tokenGroup membership)
        ├─► technitium-provision-settings.service        # DNSSEC validation + QPM rate limits
        │
        ├─► technitium-provision-encrypted-dns.service   # PEM→PKCS#12 + enable DoH/DoT/DoQ   (After: certReadyUnits)
        │
        ├─► technitium-provision-metrics-user.service    # metrics-readonly group + user + TOTP
        │
        └─► technitium-provision-records.service          # ensureDnsRecords (upsert-only)
                │
                ▼
        technitium-provision.target                       # convenience target: wants all enabled sub-units
```

### Shared token service (O2)

The user's requirement: each unit refers to a **shared secret**, kept up to date by a
**dedicated service**, with access controlled via **service-account group membership**.
Implementation:

- **`technitium-provision-token.service`** (oneshot + `.timer`): logs in as `admin`
  using `adminPasswordFile` (the existing sops secret) and writes the resulting
  **session token** to a shared file (default `/run/technitium-provision/token`) in a
  `RuntimeDirectory`. The file is `root:<tokenGroup>` mode `0640`; the directory is
  `0750`. A `.timer` refreshes it before the session timeout elapses (session tokens
  are the admin user's; interval derived from a configurable
  `provision.token.refreshInterval`, default e.g. `6h`, well under Technitium's
  default session lifetime).
  - _Why a session token, not a non-expiring API token:_ Technitium `createToken`
    yields a **non-expiring** bearer (APIDOCS §"Create API Token"). A long-lived
    non-expiring token on disk is a worse secret-at-rest posture than a short-lived
    session token refreshed by a timer. The refresher pattern is the whole point of
    "a service dedicated to keeping that secret up to date." (If you later prefer a
    non-expiring token for simplicity, the refresher can create one instead — a
    one-line swap; flagged as a sub-decision but defaulting to session tokens.)
  - On failure the refresher **truncates/blanks** the token file (mirroring the
    augustus metrics-token hardening in the security audit §6) so sub-units fail loud
    with a clear "no token" error rather than silently using a stale/expired token.
- **`provision.tokenGroup`** (new option, default `technitium-provision`): a dedicated
  service-account group. The token file is group-readable by it; each provisioning
  sub-unit runs with `SupplementaryGroups = [ cfg.provision.tokenGroup ]` so it can
  read the token. This is the "access controlled through service-account group
  membership" requirement — the token is **not** world-readable and sub-units never
  see the admin password, only the derived token.

### Dependency rules

- `technitium-provision-wait.service`: `After=`/`Requires=` `technitium-dns-server.service`;
  polls `/api/status` (bounded ~60s; `Restart=on-failure` covers longer startups). No
  login here — purely a readiness gate.
- `technitium-provision-token.service`: `After=`/`Requires=` the wait unit; produces
  the shared token. `.timer` keeps it fresh.
- Every provisioning sub-unit: `After=`/`Requires=` `technitium-provision-token.service`
  (which transitively requires wait + dns-server). Reads the shared token file; never
  logs in itself.
- `technitium-provision-encrypted-dns.service` additionally gets `After=`/`Wants=`
  `cfg.provision.certReadyUnits` (the ACME unit), as the monolith does today.
- `technitium-provision-records.service`: `After=technitium-provision-settings.service`
  (cosmetic ordering for readable logs). Zones-before-records is handled **inside** the
  records unit (create zone if missing, then upsert records), not via unit ordering.
- `technitium-provision.target`: `wantedBy=multi-user.target`, `wants=` each enabled
  sub-unit + the token service. One handle (`systemctl status
  technitium-provision.target`) for the whole stack.

### Rationale

Each concern becomes an independently retriable unit. A late ACME cert only churns
`technitium-provision-encrypted-dns.service`; the records/settings units aren't blocked
behind it. The shared-token service means a credential problem surfaces in exactly one
place (the token unit) instead of five, and sub-units are reduced to "read token → do
one job."

### Metrics-user TOTP interaction (note)

The metrics-user unit still does its **own** login as the `prometheus` user for the
`2fa/init`/`2fa/enable` dance (that must authenticate as that user, not admin). Only
the **admin-privileged** API calls use the shared admin token. This is unchanged from
the monolith; just scoped to the one unit that needs a non-admin login.

---

## 5. New Option: `ensureDnsRecords` (upsert-only, strictly idempotent — O4)

Add under `services.technitium-server-complete.provision`:

```nix
provision.ensureDnsRecords = {
  enable = mkEnableOption "declarative authoritative zones + record upsert";

  # NO prune / NO delete. "ensure" = strict upsert of the DECLARED records only.
  # Undeclared records (added manually or by other processes) are left untouched.
  # There is deliberately no deletion path (see O4).

  zones = mkOption {
    type = attrsOf (submodule {
      options = {
        type = mkOption {
          type = enum [ "Primary" "Forwarder" ];   # start with Primary; Forwarder optional
          default = "Primary";
        };
        useSoaSerialDateScheme = mkOption { type = bool; default = true; };
        records = mkOption {
          type = listOf (submodule {
            options = {
              name = mkOption { type = str; };          # FQDN; "@"/"" = zone apex
              type = mkOption { type = enum [ "A" "AAAA" "CNAME" "TXT" "MX" "NS" "SRV" "CAA" ]; };
              ttl  = mkOption { type = nullOr int; default = null; };
              # type-specific value fields (only the relevant one is used):
              ipAddress = mkOption { type = nullOr str; default = null; };   # A / AAAA
              cname     = mkOption { type = nullOr str; default = null; };   # CNAME
              text      = mkOption { type = nullOr str; default = null; };   # TXT
              exchange  = mkOption { type = nullOr str; default = null; };   # MX
              preference= mkOption { type = nullOr int; default = null; };   # MX
              nameServer= mkOption { type = nullOr str; default = null; };   # NS
              # SRV / CAA fields added as needed (priority/weight/port/target, flags/tag/value)
            };
          });
          default = [ ];
        };
      };
    });
    default = { };
    example = {
      "home.plato-splunk.media" = {
        type = "Primary";
        records = [
          { name = "augustus.home.plato-splunk.media"; type = "A";    ipAddress = "100.x.y.z"; }
          { name = "augustus.home.plato-splunk.media"; type = "AAAA"; ipAddress = "fd7a:..."; }
        ];
      };
    };
  };
};
```

Design decisions:

- **Upsert-only, no deletion (O4).** The reconciler **never** deletes zones or records.
  Each declared record is written with `overwrite=true` so the declared RRset converges
  to the Nix value on every deploy, but anything **not** declared here — records added
  by hand or by another process — is left completely alone. This is the "ensure"
  contract: idempotent, additive, non-destructive. No `prune`, no
  `zones/records/delete`, no `zones/delete` anywhere in the module.
- **Keyed by zone name** (`attrsOf`), records as a list → maps to `zones/create?zone=<k>`
  (guarded by a `zones/list` check so an existing zone isn't re-created) then
  `zones/records/add?domain=<rec.name>&zone=<k>&...&overwrite=true`.
- **Type-tagged value fields.** The generator emits only the relevant `--data-urlencode`
  for `type`. A Nix-level assertion validates the required field per `type` is non-null
  (e.g. `A` ⇒ `ipAddress != null`, `CNAME` ⇒ `cname != null`).
- **`name` ergonomics (O5):** `"@"` or `""` → the zone apex (`domain=<zone>`); any other
  value is passed through as an FQDN.

### Shared public/private source of truth (O3)

The record set is **data**, so it lives in one place and is referenced by multiple
hosts. Add a shared constants surface (in `service-registry.nix` or a dedicated
`modules/dns-records.nix`) exposing two attrsets:

```nix
config.constants.dnsRecords = {
  public  = { "<zone>" = { records = [ ... public IPs ... ]; }; };   # for public authoritative hosts
  private = { "<zone>" = { records = [ ... tailscale 100.x / ULA ... ]; }; }; # for tailnet hosts
};
```

Each host's `technitium-<host>/complete.nix` then wires the slice it serves:

```nix
# a public authoritative host:
provision.ensureDnsRecords.zones = config.constants.dnsRecords.public;

# a private (tailscale) authoritative host:
provision.ensureDnsRecords.zones = config.constants.dnsRecords.private;

# a host serving both (if ever desired): lib.recursiveUpdate public private, or
# merge per-zone record lists.
```

This gives a single source of truth per audience, reusable across any number of
Technitium hosts, with each host picking `public` / `private` (or a merge). Tailscale
IPs stay out of Route53 by construction — they only ever appear in the `private` set,
consumed by tailnet-only hosts. Plain Nix values (O3): Tailscale addresses are
tailnet-gated so committing them is fine; no sops needed for record data.

---

## 6. Records Upsert Logic (`records.nix`) — strictly idempotent, no deletion

The `technitium-provision-records.service` script (sourcing the shared helpers, reading
the shared admin token from §4):

1. **Read token** from the shared token file (fail loud if absent/blank).
2. **List zones once:** `GET /api/zones/list` → set of existing zone names.
3. **For each declared zone:**
   - If absent from the list, `POST /api/zones/create?zone=<zone>&type=<type>&useSoaSerialDateScheme=<...>`.
     (Guarded by the list check — Technitium errors on creating an existing zone.) If
     present, leave it as-is (never re-create, never delete).
   - **Upsert each declared record:**
     `GET /api/zones/records/add?zone=<zone>&domain=<name|zone-for-apex>&type=<type>&<value params>&overwrite=true`
     (+ `ttl` if set). `overwrite=true` makes the declared RRset converge to the Nix
     value every run without stacking duplicates.
4. **That's it — no enumeration-and-diff, no deletion.** Undeclared records are never
   read for pruning and never removed. Server-managed records (`SOA`, apex `NS`,
   `RRSIG`, `NSEC*`, `DNSKEY`) are untouched because we only ever `add`-with-overwrite
   the records we declare.

Fail-fast: reuse the `api_call` helper (`.status == "ok"` + `errorMessage` surfacing),
exactly as the current monolith does.

**Idempotency guarantee:** list-before-create + `overwrite=true` on every declared
record means re-running on every `nixos-rebuild switch` converges to exactly the
declared state for the declared records, and is a no-op when already converged. Because
`ExecStart` embeds the derivation path of the generated script, changing the record set
in Nix produces a new unit → systemd re-runs it on switch (same mechanism the current
provisioner relies on for cert renewals). Non-declared records and manual edits persist
across runs — the module is purely additive/upserting.

---

## 7. Wiring / Aggregation Changes

### `technitium-provisioning/complete.nix` (NEW)

```nix
flake.modules.nixos.technitium-provisioning = {
  imports = with inputs.self.modules.nixos; [
    technitium-provisioning-options
    technitium-provisioning-token
    technitium-provisioning-wait
    technitium-provisioning-settings
    technitium-provisioning-encrypted-dns
    technitium-provisioning-metrics-user
    technitium-provisioning-records
  ];
};
```

### `technitium/complete.nix` (EDIT — O1 server-only)

Drop `technitium-provision` from the generic aggregate. The generic `technitium`
feature becomes server-only (service + caddy + options-minus-provision). Hosts opt
into provisioning by importing `technitium-provisioning`. No back-compat shim —
`technitium` is consumed only by `technitium-aedilis` today and aedilis is undeployed.

### `technitium-aedilis/complete.nix` (EDIT)

Add `inputs.self.modules.nixos.technitium-provisioning` to `imports`. aedilis's
option values already set `provision.*`; it simply does **not** set
`provision.ensureDnsRecords.enable` (stays a recursive resolver, no authoritative
zones). No behavioural change for aedilis.

### Future host (illustrative, not built here) — O6: per-host provisioner

Each Technitium host runs **its own** provisioner (its own `technitium-provision.target`

- sub-units), fed from the **shared** record source of truth (§5, O3). The host picks
  which audience it serves:

```
features/technitium-<newhost>/complete.nix
  imports = [ technitium technitium-provisioning <acme/observability as needed> ];
  services.technitium-server-complete = {
    enable = true;
    domain = "...";
    recursion.mode = "Deny";                       # authoritative-only
    encryptedDns.enable = <true for public, false/omitted for tailnet-only>;
    provision.ensureDnsRecords = {
      enable = true;
      # Shared source of truth; this host serves the private (tailscale) set:
      zones = config.constants.dnsRecords.private;
      # (a public host would use config.constants.dnsRecords.public)
    };
  };
```

No per-host record duplication: the `zones` value is a reference to the shared
constants, so updating a record in one place propagates to every host that consumes
that audience on the next deploy.

---

## 8. Failure Surfacing in Grafana (O6)

The user wants provisioning-unit failures visible in Grafana. Two complementary
signals, both already partly wired on aedilis via `technitium-aedilis-observability`:

1. **Metrics (primary alert signal):** the node-exporter `systemd` collector is already
   enabled (`observability.nix`), which exports
   `node_systemd_unit_state{name="<unit>",state="failed"} == 1` for every unit. Because
   the provisioning oneshots are real systemd units, their failures appear automatically
   — **no extra wiring needed** beyond making sure the units exist on a host that runs
   the observability layer. Add a Grafana alert / dashboard panel on
   `node_systemd_unit_state{name=~"technitium-provision.*",state="failed"} == 1`.
   - Caveat: a `oneshot` with `RemainAfterExit=true` that **succeeded** shows `active`;
     one that **failed** shows `failed`. A unit that is retrying (`Restart=on-failure`)
     flaps `activating`/`failed` — the alert should fire on `failed` with a short `for:`
     to avoid noise during first-boot retries.
2. **Logs (triage):** Alloy already ships journald to augustus Loki with a `unit` label
   (`observability.nix` relabels `__journal__systemd_unit → unit`). The provisioners'
   fail-fast `echo ... >&2 ; exit 1` messages (and the `errorMessage` surfacing) land in
   Loki filterable by `{hostname="<host>", unit=~"technitium-provision.*"}`. No change
   needed — the existing `loki.source.journal "systemd"` captures all units.

Action items for this feature:

- Ensure any host running the provisioner **also runs** `node-exporter` (systemd
  collector) + Alloy. Today that's folded into `technitium-aedilis-observability`; for
  future authoritative hosts, factor the observability layer so it can be reused (it's
  already gated by `observability.enable`, so a future `technitium-<host>` layer can set
  the same option values). Consider promoting `observability.nix` out of
  `technitium-aedilis` into a shared layer if more than one host needs it (follow-up,
  not required for the module itself).
- Add a Grafana alert rule for `node_systemd_unit_state{name=~"technitium-provision.*",state="failed"}`
  (and optionally the DNS server unit) when the first authoritative host is stood up.
- **systemd `OnFailure` notifications** (augustus pattern, `nix-services.md`): the
  `failure-notifs` module is augustus-only today. If a future authoritative host should
  push Pushover alerts on provisioning failure, attach the provisioning units via
  `services.failure-notifs.attachServices` **on that host** (requires the host to run
  the failure-notifs service). Out of scope for the module; noted for host bring-up.

---

## 9. Firewall / Ports / Registry

- **No new ports** for the provisioning feature itself (it talks to the loopback
  `webHttpPort`).
- A **public authoritative** host will need public `53/udp + 53/tcp` open (per
  `aedilis-host-plan.md` §7a: authoritative DNS requires plain 53). A **private
  tailnet** authoritative host firewalls 53 to `tailscale0`. These are per-host
  `_private/<host>/security.nix` concerns, decided when those hosts are created —
  **out of scope** for this module, but noted so the firewall posture is explicit.
- Update `docs/port-assignments.md` only when the future hosts are added, not now.

---

## 10. Resolved Decisions

All open questions from the first draft are now decided:

- **O1 — generic module scope:** `technitium` is **server-only**. Provisioning is a
  separate `technitium-provisioning` feature imported explicitly. No back-compat shim
  (aedilis is the only consumer and is undeployed).
- **O2 — credential sharing:** a dedicated **`technitium-provision-token.service`**
  (+ `.timer`) logs in with the admin sops password and writes a **shared session
  token** to `/run/technitium-provision/token`, owned `root:<tokenGroup>` mode `0640`.
  Provisioning sub-units read it via **`tokenGroup` membership** (`SupplementaryGroups`)
  and never see the admin password. Blank-on-failure so stale tokens don't cause silent
  401s. (Session token refreshed by timer, preferred over a non-expiring API token for
  secret-at-rest hygiene.)
- **O3 — record values:** plain Nix (Tailscale IPs are tailnet-gated, fine to commit).
  A **shared source of truth** `config.constants.dnsRecords.{public,private}` is
  referenced by each host; no per-host duplication.
- **O4 — deletion:** **never.** The reconciler is strictly **upsert-only**
  (`add&overwrite=true` + guarded `create`). No prune, no `records/delete`, no
  `zones/delete`. Manual/other-process records are preserved — "ensure" = idempotent
  additive convergence of declared records only.
- **O5 — `name` ergonomics:** accept both; `"@"`/`""` → zone apex, otherwise FQDN.
- **O6 — topology + observability:** each host runs its own provisioner fed from the
  shared record source; private vs public is a per-host choice of
  `dnsRecords.private` / `dnsRecords.public`. Provisioning-unit failures surface in
  Grafana via the node-exporter `systemd` collector metric
  (`node_systemd_unit_state{...,state="failed"}`) and Alloy journald logs (both already
  wired; see §8).

### Remaining sub-decisions (low-stakes, defaulted)

- **Token kind:** session token refreshed by timer (default) vs. non-expiring
  `createToken`. Defaulting to session token; trivial to swap if you prefer one token.
- **Observability layer reuse:** keep `observability.nix` under `technitium-aedilis`
  for now; promote to a shared layer when the second host appears (follow-up).

---

## 11. Implementation Order

1. **Create `technitium-provisioning/options.nix`** — move `provision.*` out of
   `technitium/options.nix`; add `tokenGroup`, `token.refreshInterval`, and the
   `ensureDnsRecords` schema + per-type assertions.
2. **Add the shared record source of truth** — `config.constants.dnsRecords.{public,private}`
   in `service-registry.nix` (or a new `modules/dns-records.nix`).
3. **`technitium-provisioning/lib.nix`** — shared shell helpers (`api_call`, token read,
   readiness poll) as a reusable `writeShellApplication` library.
4. **`token.nix`** — `technitium-provision-token.service` + `.timer`; `tokenGroup`;
   `/run/technitium-provision` RuntimeDirectory; blank-on-failure.
5. **Split the monolith** into `wait.nix`, `settings.nix`, `encrypted-dns.nix`,
   `metrics-user.nix` — behaviour-preserving extraction of the current script, each a
   oneshot wired per §4 (reading the shared token), plus `technitium-provision.target`.
6. **`records.nix`** — implement `ensureDnsRecords` upsert-only (guarded create + add
   w/ overwrite; no deletion) per §6.
7. **`technitium-provisioning/complete.nix`** — aggregate.
8. **Edit `technitium/complete.nix`** (drop provision import → server-only) and
   **`technitium-aedilis/complete.nix`** (add `technitium-provisioning` import;
   optionally set `provision.tokenGroup`). aedilis sets no `ensureDnsRecords`.
9. **Validate:** `nix eval .#nixosConfigurations.aedilis.config.system.build.toplevel.drvPath`
   must still succeed with identical effective provisioning behaviour (aedilis has no
   `ensureDnsRecords`; only the unit split + token service differ). Confirm augustus
   unaffected. Format with `nix run .#nixfmt` + `dprint fmt`.
10. **Docs:** add a `technitium-authoritative-host` runbook stub describing how to stand
    up a future private/public authoritative host using `ensureDnsRecords` + the shared
    record source, and the Grafana alert on `node_systemd_unit_state`.

> **No functional change to aedilis.** Behaviour-preserving for the existing
> deployment: observable differences are (a) `technitium-provision` → the token service
>
> - `technitium-provision.target` + sub-units, and (b) each sub-unit reading a shared
>   token instead of logging in inline. The `ensureDnsRecords` path is dormant until a
>   host enables it.

---

## 12. Relevant Technitium API Reference (from `repos/technitium-dnsserver/APIDOCS.md`)

| Operation   | Endpoint                                                                      | Key params                                                             |
| ----------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Readiness   | `GET /api/status`                                                             | (unauthenticated)                                                      |
| Login       | `GET /api/user/login?user=admin&pass=…&includeInfo=false`                     | returns `.token` (session token for the shared token file)             |
| List zones  | `GET /api/zones/list`                                                         | → `.response.zones[].name` (guards create)                             |
| Create zone | `POST /api/zones/create?zone=<z>&type=Primary&useSoaSerialDateScheme=…`       | only when absent from list; never on an existing zone                  |
| Upsert rec. | `GET /api/zones/records/add?zone=<z>&domain=<fqdn>&type=<T>&…&overwrite=true` | `ipAddress`/`cname`/`text`/`exchange`+`preference`/`nameServer`, `ttl` |

Only these endpoints are used. **No** `zones/records/get`, `zones/records/delete`, or
`zones/delete` — the module is strictly upsert-only (O4), so there is no diffing or
deletion path. All calls check `.status == "ok"` and surface `.errorMessage` on failure
(existing `api_call` helper pattern). Server-managed record types (`SOA`, apex `NS`,
`RRSIG`, `NSEC*`, `DNSKEY`) are never touched because the module only `add`s the records
it declares.
