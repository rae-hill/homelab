# Technitium Provisioning Module + `ensureDnsRecords` — Plan

Status: **IMPLEMENTED** (2026-10-14)
Date: 2026-10-13 (updated 2026-10-14)

> **Implementation note (2026-10-14):** Delivered as `features/technitium-provisioning/`
> with two refinements over the original plan:
>
> - **Record types are a tagged union (`lib.types.attrTag`)**, not a flat record with
>   nullable fields. Each record is `{ <TYPE> = { name; ttl?; …type-specific fields }; }`
>   (e.g. `{ A = { name = "@"; address = "100.64.0.1"; }; }`). Per-type required fields
>   are enforced by the module system at eval time, so the runtime validation /
>   assertions from the first cut are **removed** — an A record missing `address`, or an
>   A record carrying an `exchange`, now fails `nix eval`. See §5.
> - **The shared token is served by a socket-activated broker**, not a group-readable
>   file. `technitium-provision-token.socket` (Accept=yes, `root:<tokenGroup>` mode 0660)
>   spawns a per-connection `technitium-provision-token@` template that validates a
>   cached token against a stored deadline, lazily refreshes via the admin password if
>   elapsed (flock-guarded), and writes the token to the connection (`StandardOutput=socket`).
>   Consumers fetch it with `socat - UNIX-CONNECT:<sock>`. Only the broker service user
>   reads the admin password + token cache; the group gates socket access only. The
>   previous `wait.service` is gone (the broker + each consumer's `wait_for_api` cover
>   readiness). See §4.

> **Decisions locked (2026-10-13):** O1 server-only generic module; O2 dedicated
> token broker gated by service-account group (refined to a socket broker — see note);
> O3 plain-Nix values with a **shared public/private record source of truth** reusable
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

The pre-refactor provisioner authenticated as `admin` on every run (via `adminPasswordFile`),
checked `.status == "ok"` on every call, and was fail-fast. The fail-fast + status-check behaviour
is kept; the `admin`-login behaviour was **replaced** by a dedicated least-privilege `provisioner`
user served through a token broker (see §3+ As-Built), and the metrics-user creation was dropped
(now manual).

---

## 3. As-Built Layout

```
nix-config/modules/features/
├── technitium/                        # GENERIC server (server-only; no provisioning)
│   ├── options.nix                    # services.technitium-server-complete.* (server options)
│   ├── service.nix                    # Technitium service + first-boot env bootstrap
│   ├── caddy.nix                      # Admin UI + metrics vhosts
│   ├── complete.nix                   # aggregates options/service/caddy (NO provision import)
│   └── kanidm.nix                     # augustus-side OIDC client (unchanged)
└── technitium-provisioning/           # API-driven provisioning (opt-in, imported per host)
    ├── options.nix                    # services.technitium-server-complete.provision.* + ensureDnsRecords (attrTag)
    ├── lib.nix                        # flake-parts module: config.constants.technitiumProvisioning.{preamble,baseRuntimeInputs}
    ├── token.nix                      # socket broker: technitium-provision-token.socket + technitium-provision-token@ template
    ├── settings.nix                   # technitium-provision-settings.service (DNSSEC + QPM rate limits)
    ├── encrypted-dns.nix              # technitium-provision-encrypted-dns.service (PKCS#12 + DoH/DoT/DoQ)
    ├── records.nix                    # technitium-provision-records.service (ensureDnsRecords, upsert-only)
    ├── shellcheck.nix                 # registers the provisioning scripts into the flake.lintedShellScripts gate
    └── complete.nix                   # aggregates options+token+settings+encrypted-dns+records + the target
```

Notes:

- `technitium` is **server-only**. Hosts opt into provisioning by importing
  `technitium-provisioning` explicitly (aedilis does, via `technitium-aedilis`).
- `lib.nix` is a flake-parts module exposing `config.constants.technitiumProvisioning`
  (`preamble` — a shell snippet builder with `wait_for_api` / `fetch_token` / `api_call`;
  and `baseRuntimeInputs`). It is **not** a sourced shell library; each unit prepends the
  `preamble` string to its script.
- There is **no** `wait.nix` and **no** `metrics-user.nix`. Readiness is handled by
  `wait_for_api` in the preamble (and the broker's own API-wait); the metrics user is
  created manually.

---

## 4. systemd Call-Stack + socket token broker

```
technitium-dns-server.service
        │  (After/Requires)
        ▼
technitium-provision-token.socket            # Accept=yes, root:<tokenGroup> mode 0660
        │   on connect spawns:
        └─► technitium-provision-token@ (template, oneshot, StandardOutput=socket)
                 logs in as <apiUser> via apiPasswordFile; caches token+deadline in a
                 broker-only StateDirectory (/var/lib/<tokenCacheDir>, 0700); flock-guarded;
                 lazily refreshes when tokenTtlSeconds elapsed; prints token to the socket.

Consumer oneshots (each After/Requires technitium-provision-token.socket; fetch token via socat):
        ├─► technitium-provision-settings.service        # DNSSEC validation + QPM rate limits
        ├─► technitium-provision-encrypted-dns.service   # PEM→PKCS#12 + enable DoH/DoT/DoQ  (After/Wants certReadyUnits)
        └─► technitium-provision-records.service          # ensureDnsRecords (After settings.service)
                ▼
        technitium-provision.target                       # wantedBy multi-user.target; sub-units pull in via wantedBy
```

### Token broker (the shared secret, group-gated via a socket)

- **`technitium-provision-token.socket`** — a socket-activated Unix socket at
  `provision.tokenSocketPath` (default `/run/technitium-provision/token.sock`),
  `Accept = "yes"`, `SocketMode = "0660"`, `SocketUser = <service user>`,
  `SocketGroup = provision.tokenGroup`. Only members of `tokenGroup` can connect.
- **`technitium-provision-token@`** — per-connection template oneshot
  (`StandardInput`/`StandardOutput = "socket"`). Runs as the service user, which alone
  can read `provision.apiPasswordFile` and the token cache. On each connection it:
  1. takes a `flock` on a lock file in the cache dir (serialises concurrent connections),
  2. if the cached token's stored deadline hasn't elapsed, emits the cached token,
  3. otherwise logs in as **`provision.apiUser`** (the dedicated least-privilege user —
     **not** `admin`) with `provision.apiPasswordFile`, writes the new token + a
     `now + provision.tokenTtlSeconds` deadline into the `StateDirectory`
     (`/var/lib/${provision.tokenCacheDir}`, mode `0700`), and emits it.
     There is **no timer**: refresh is lazy/on-demand. There is **no shared token file**:
     the cache is broker-user-only and consumers never read it directly.
- **Consumers** (`settings`/`encrypted-dns`/`records`) run with
  `SupplementaryGroups = [ provision.tokenGroup ]` and fetch the token in the shared
  `preamble` via `fetch_token` → `socat - UNIX-CONNECT:$TOKEN_SOCKET`. They never see
  `apiPasswordFile`; they fail loud if the socket returns an empty token.

### Dependency rules

- `technitium-provision-token@` and `.socket`: the socket is `wantedBy = sockets.target`;
  the template orders `After = technitium-dns-server.service`.
- Each consumer: `After`/`Requires` `technitium-dns-server.service` and
  `technitium-provision-token.socket`; `wantedBy = technitium-provision.target`.
- `technitium-provision-encrypted-dns.service`: additionally `After`/`Wants`
  `provision.certReadyUnits` (the ACME unit producing the public DNS cert).
- `technitium-provision-records.service`: additionally `After`
  `technitium-provision-settings.service` (cosmetic ordering).
- `technitium-provision.target`: `wantedBy = multi-user.target`; sub-units pull
  themselves in via their own `wantedBy`.

### Security model

- socket: `root:<tokenGroup>` mode `0660` → only `tokenGroup` may connect.
- `apiUser` password: owner-only sops secret, read only by the broker service user.
- token cache: `StateDirectory` mode `0700`, broker-user-only (never group-exposed).
- The `apiUser` is least-privilege (`Settings:Modify` + `Zones:Modify`, no
  `Administration`), created manually — so a leak of the broker credential cannot create
  users or escalate.

---

## 5. `ensureDnsRecords` option — tagged union (attrTag)

Records are a **tagged union** (`lib.types.attrTag`): the attribute key is the record
type, and each tag carries exactly the fields that type requires. Per-type required
fields are enforced by the module system **at eval time** — there is **no** runtime
validation / `type` enum / nullable-field assertion.

```nix
provision.ensureDnsRecords = {
  enable = true;              # mkEnableOption
  zones = {                   # attrsOf (zone submodule), keyed by zone name
    "home.plato-splunk.media" = {
      type = "Primary";                 # enum [ "Primary" "Forwarder" ], default "Primary"
      useSoaSerialDateScheme = true;    # default true
      records = [
        { A    = { name = "augustus.home.plato-splunk.media"; address = "100.64.0.1"; ttl = 300; }; }
        { AAAA = { name = "augustus.home.plato-splunk.media"; address = "fd7a:115c:a1e0::1"; }; }
        { CNAME = { name = "www.home.plato-splunk.media"; cname = "home.plato-splunk.media"; }; }
        { MX   = { name = "@"; exchange = "mx.home.plato-splunk.media"; preference = 10; }; }
        { CAA  = { name = "@"; tag = "issue"; value = "letsencrypt.org"; }; }   # flags defaults to 0
      ];
    };
  };
};
```

Per-type fields (all share `name` and optional `ttl`):

| Type    | Required fields                        |
| ------- | -------------------------------------- |
| `A`     | `address`                              |
| `AAAA`  | `address`                              |
| `CNAME` | `cname`                                |
| `TXT`   | `text`                                 |
| `MX`    | `exchange`, `preference`               |
| `NS`    | `nameServer`                           |
| `SRV`   | `priority`, `weight`, `port`, `target` |
| `CAA`   | `flags` (default 0), `tag`, `value`    |

- `name = "@"` or `""` → the zone apex (API `domain = <zone>`); otherwise an FQDN.
- The `address` field maps to the Technitium `ipAddress` API param (A/AAAA); other fields
  map 1:1 (`records.nix` `typeParams`).

### Shared public/private source of truth (O3)

`config.constants.dnsRecords.{public,private}` holds the record sets. Each host wires the
slice it serves: `provision.ensureDnsRecords.zones = config.constants.dnsRecords.private;`
(tailnet host) or `.public` (public authoritative host). Tailscale addresses live only in
`private` and are served by tailnet-only hosts — never Route53.

---

## 6. Records upsert logic (`records.nix`) — strictly idempotent, no deletion

`technitium-provision-records.service` (prepends the `preamble`, which fetches the
`apiUser` session token from the broker socket):

1. `GET /api/zones/list` once → existing zone names.
2. For each declared zone: if absent, `POST /api/zones/create?zone=…&type=…&useSoaSerialDateScheme=…`
   (guarded by the list check); then upsert each declared record via
   `GET /api/zones/records/add?zone=…&domain=…&type=…&overwrite=true` + the type-specific
   value params (+ `ttl` if set).
3. **No deletion, ever.** No `records/get` diffing, no `records/delete`, no `zones/delete`.
   Records added manually or by other processes are preserved. `overwrite=true` converges
   the declared RRset on every run; re-runs are no-ops when already converged.

---

## 7. Wiring / Aggregation

- `technitium-provisioning/complete.nix` imports: `*-options`, `*-token`, `*-settings`,
  `*-encrypted-dns`, `*-records`, plus an inline module defining
  `systemd.targets.technitium-provision`. (`shellcheck.nix` is a separate flake-parts
  module that registers the scripts into `flake.lintedShellScripts`; it is not in the
  NixOS imports list.)
- `technitium/complete.nix` is server-only (no provision import).
- `technitium-aedilis/complete.nix` imports `technitium` + `technitium-provisioning` +
  the aedilis ACME/observability layers, and sets the option values — including
  `provision.apiUser = "provisioner"` and
  `provision.apiPasswordFile = config.sops.secrets.technitium_provisioner_password.path`.
  aedilis sets **no** `ensureDnsRecords` (recursive resolver).

### Future host (illustrative)

```nix
services.technitium-server-complete = {
  enable = true;
  domain = "...";
  recursion.mode = "Deny";                 # authoritative-only
  provision = {
    apiUser = "provisioner";
    apiPasswordFile = config.sops.secrets.technitium_provisioner_password.path;
    ensureDnsRecords = {
      enable = true;
      zones = config.constants.dnsRecords.private;   # or .public
    };
  };
};
```

---

## 8. Failure Surfacing in Grafana (O6)

Provisioning units are real systemd units, so failures surface via:

- **Metrics:** the node-exporter `systemd` collector exports
  `node_systemd_unit_state{name=~"technitium-provision.*",state="failed"} == 1`. Alert on
  it (with a short `for:` to tolerate first-boot `Restart=on-failure` retries).
- **Logs:** Alloy ships journald to augustus Loki with a `unit` label; filter
  `{hostname="<host>", unit=~"technitium-provision.*"}`.

Both are already wired on aedilis via `technitium-aedilis-observability`. Any provisioning
host should run node-exporter (systemd collector) + Alloy.

---

## 9. Options Reference

`services.technitium-server-complete.provision.*`:

| Option                    | Meaning                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `enable`                  | Run the provisioning units.                                                                       |
| `apiUser`                 | Dedicated least-privilege API user the broker logs in as (created manually).                      |
| `apiPasswordFile`         | Path to the `apiUser` password (owner-only sops secret).                                          |
| `tokenGroup`              | Service-account group allowed to connect to the broker socket (default `technitium-provision`).   |
| `tokenSocketPath`         | Broker Unix socket path (default `/run/technitium-provision/token.sock`).                         |
| `tokenCacheDir`           | StateDirectory name for the broker's token+deadline cache (default `technitium-provision-token`). |
| `tokenTtlSeconds`         | Token freshness window; lazy refresh after it elapses (default `1800`).                           |
| `provisionDoTDoQCert`     | Convert the encryptedDns cert → PKCS#12 and enable DoH/DoT/DoQ (needs `Settings:Modify`).         |
| `certReadyUnits`          | Units the encrypted-dns unit orders `after`/`wants` (the ACME cert unit).                         |
| `ensureDnsRecords.enable` | Enable declarative zone/record upsert (needs `Zones:Modify`).                                     |
| `ensureDnsRecords.zones`  | `attrsOf` zone (type/useSoaSerialDateScheme/records); records are the attrTag union.              |
| `_lintScripts` (internal) | Script packages harvested by the ShellCheck gate.                                                 |

Removed vs. the original design: `provision.adminPasswordFile`, `provision.metricsUser.*`,
`provision.tokenRefreshInterval` (there is no timer).

---

## 10. API Reference (used calls)

| Operation   | Endpoint                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------- |
| Readiness   | `GET /api/status` (unauthenticated)                                                             |
| Login       | `GET /api/user/login?user=<apiUser>&pass=…&includeInfo=false` → `.token` (cached by the broker) |
| List zones  | `GET /api/zones/list`                                                                           |
| Create zone | `POST /api/zones/create?zone=…&type=…&useSoaSerialDateScheme=…` (only when absent)              |
| Upsert rec. | `GET /api/zones/records/add?zone=…&domain=…&type=…&…&overwrite=true`                            |
| Settings    | `GET /api/settings/set?dnssecValidation=…&qpm…` and the DoH/DoT/DoQ enable call                 |

Only these are used. **No** `records/get`, `records/delete`, `zones/delete` (upsert-only),
and **no** `admin/*` user/group/permission calls (users created manually). All calls check
`.status == "ok"` and surface `.errorMessage` on failure.

---

## 11. ShellCheck Gate

The provisioning scripts are built with `config.constants.shell.mkScript` (a
`writeShellApplication` wrapper → ShellCheck in `checkPhase`), and each unit stashes its
script package in the internal `provision._lintScripts` list. `shellcheck.nix` harvests
that list from the aedilis config into `flake.lintedShellScripts`, which the Linux-only
`checks.shellcheck` aggregate builds under `nix flake check`. See
`docs/shellcheck-nix-test-plan.md`.
