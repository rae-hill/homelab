# DNS Record Generation (`service-registry` → `homelab-service-dns`)

Status: **PROPOSED** · Highest-leverage migration, executed **LAST** · Index:
[README](./README.md) · Schema/generator: [catalog-and-generators.md](./catalog-and-generators.md)
(§3.6) · Parent: [service-consolidation-plan.md](../service-consolidation-plan.md) (§2.5)

This plan replaces the hand-maintained `tailnetRewrites` map + `ts` IP table in
`nix-config/modules/service-registry.nix` with the `homelab-service-dns` generator (defined in
[catalog-and-generators.md](./catalog-and-generators.md) §3.6), which folds `dns.enable` catalog
entries into `services.technitium-server-complete.provision.ensureDnsRecords.zones` on aedilis.

This is the **riskiest** migration in the consolidation: a Primary zone is fully authoritative, so any
name _dropped_ from the record set returns **NXDOMAIN** instead of falling through to public DNS (per
the warning in `technitium-aedilis/complete.nix`). It is therefore scheduled **last** — only after
every service has declared its catalog entry and every other generator (caddy / acme / firewall /
oidc) has already proven operational equivalence on its own. The non-negotiable gate here is
**exact set-equality** of the produced record set, before and after.

---

## 1. Current state — the full record set, verbatim

### 1.1 Where it comes from

`config.constants.dnsRecords.private` is built in `service-registry.nix` as:

```nix
dnsRecords.private."${baseDomain}" = {
  type = "Primary";
  records = tailnetRecords ++ nasRecords ++ publicEndpointRecords;
};
```

with `baseDomain = "plato-splunk.media"`, and consumed on aedilis by
`technitium-aedilis/complete.nix`:

```nix
provision.ensureDnsRecords = {
  enable = true;
  zones = c.dnsRecords.private;
};
```

The three source lists:

- **`tailnetRecords`** — `lib.concatLists (lib.mapAttrsToList mkTailnetRecords tailnetRewrites)`.
  For each `subdomain → hostKey` entry in `tailnetRewrites`, `mkTailnetRecords` emits an apex
  **A** (`ts.<hostKey>.v4`) and **AAAA** (`ts.<hostKey>.v6`).
- **`nasRecords`** — a single LAN-only **A** record (no AAAA).
- **`publicEndpointRecords`** — for each of `dns` and `aedilis`, an **A** + **AAAA** pointing at the
  public OVH addresses (`aedilisPublicV4 = 15.204.95.40`, `aedilisPublicV6 = 2604:2dc0:222::64d`).

The `ts` table (local to `service-registry.nix`, duplicating `constants.hosts.<name>.tailscale`):

| hostKey       | v4               | v6                          |
| ------------- | ---------------- | --------------------------- |
| `augustus`    | `100.95.250.77`  | `fd7a:115c:a1e0::6301:fa4d` |
| `cicero`      | `100.72.52.108`  | `fd7a:115c:a1e0::2801:3495` |
| `praeconinus` | `100.111.235.57` | `fd7a:115c:a1e0::b33a:eb39` |
| `nixos`       | `100.99.178.23`  | `fd7a:115c:a1e0::b01:b217`  |
| `mini`        | `100.111.29.21`  | `fd7a:115c:a1e0::db01:1d31` |
| `aedilis`     | `100.108.78.46`  | `fd7a:115c:a1e0::b43a:4e2f` |

> **Verified:** this `ts` table is byte-for-byte identical to `constants.hosts.<name>.tailscale.{v4,v6}`
> in `constants.nix` — the in-file comment admits they must be kept in sync. The generator reads
> `constants.hosts.<host>.tailscale` directly, eliminating the duplicate.

### 1.2 Every `tailnetRewrites` entry → target host → resulting records

28 rewrite entries, each producing an A + AAAA (56 records). FQDN = `<subdomain>.plato-splunk.media`.

| #  | subdomain               | → host        | A (v4)           | AAAA (v6)                   |
| -- | ----------------------- | ------------- | ---------------- | --------------------------- |
| 1  | `idm`                   | `augustus`    | `100.95.250.77`  | `fd7a:115c:a1e0::6301:fa4d` |
| 2  | `ldap` ⚠removed         | `augustus`    | `100.95.250.77`  | `fd7a:115c:a1e0::6301:fa4d` |
| 3  | `openwebui`             | `augustus`    | `100.95.250.77`  | `fd7a:115c:a1e0::6301:fa4d` |
| 4  | `radius`                | `augustus`    | `100.95.250.77`  | `fd7a:115c:a1e0::6301:fa4d` |
| 5  | `home-assistant`        | `augustus`    | `100.95.250.77`  | `fd7a:115c:a1e0::6301:fa4d` |
| 6  | `dev-tools`             | `augustus`    | `100.95.250.77`  | `fd7a:115c:a1e0::6301:fa4d` |
| 7  | `planka`                | `augustus`    | `100.95.250.77`  | `fd7a:115c:a1e0::6301:fa4d` |
| 8  | `postgres-augustus`     | `augustus`    | `100.95.250.77`  | `fd7a:115c:a1e0::6301:fa4d` |
| 9  | `augustus`              | `augustus`    | `100.95.250.77`  | `fd7a:115c:a1e0::6301:fa4d` |
| 10 | `homelab-api`           | `augustus`    | `100.95.250.77`  | `fd7a:115c:a1e0::6301:fa4d` |
| 11 | `homelab`               | `augustus`    | `100.95.250.77`  | `fd7a:115c:a1e0::6301:fa4d` |
| 12 | `apprise` ⚠removed      | `augustus`    | `100.95.250.77`  | `fd7a:115c:a1e0::6301:fa4d` |
| 13 | `habitsync`             | `augustus`    | `100.95.250.77`  | `fd7a:115c:a1e0::6301:fa4d` |
| 14 | `prometheus`            | `augustus`    | `100.95.250.77`  | `fd7a:115c:a1e0::6301:fa4d` |
| 15 | `grafana`               | `augustus`    | `100.95.250.77`  | `fd7a:115c:a1e0::6301:fa4d` |
| 16 | `loki-push`             | `augustus`    | `100.95.250.77`  | `fd7a:115c:a1e0::6301:fa4d` |
| 17 | `prometheus-client`     | `augustus`    | `100.95.250.77`  | `fd7a:115c:a1e0::6301:fa4d` |
| 18 | `ca`                    | `cicero`      | `100.72.52.108`  | `fd7a:115c:a1e0::2801:3495` |
| 19 | `cicero`                | `cicero`      | `100.72.52.108`  | `fd7a:115c:a1e0::2801:3495` |
| 20 | `cicero-metrics`        | `cicero`      | `100.72.52.108`  | `fd7a:115c:a1e0::2801:3495` |
| 21 | `ca-monitoring`         | `cicero`      | `100.72.52.108`  | `fd7a:115c:a1e0::2801:3495` |
| 22 | `nixos`                 | `nixos`       | `100.99.178.23`  | `fd7a:115c:a1e0::b01:b217`  |
| 23 | `ollama`                | `mini`        | `100.111.29.21`  | `fd7a:115c:a1e0::db01:1d31` |
| 24 | `mini-caddy-metrics`    | `mini`        | `100.111.29.21`  | `fd7a:115c:a1e0::db01:1d31` |
| 25 | `mini-jellyfin-metrics` | `mini`        | `100.111.29.21`  | `fd7a:115c:a1e0::db01:1d31` |
| 26 | `praeconinus`           | `praeconinus` | `100.111.235.57` | `fd7a:115c:a1e0::b33a:eb39` |
| 27 | `dns-admin`             | `aedilis`     | `100.108.78.46`  | `fd7a:115c:a1e0::b43a:4e2f` |
| 28 | `dns-metrics`           | `aedilis`     | `100.108.78.46`  | `fd7a:115c:a1e0::b43a:4e2f` |

### 1.3 `nasRecords` (non-tailnet LAN outlier)

| subdomain | type | address         | notes                             |
| --------- | ---- | --------------- | --------------------------------- |
| `nas`     | A    | `10.76.100.190` | private LAN v4 only — **no AAAA** |

### 1.4 `publicEndpointRecords` (public OVH identities)

These must stay resolvable because the Primary zone is authoritative (anything absent → NXDOMAIN).
They point at the **public** OVH addresses, **not** the tailnet addresses.

| subdomain | A (public v4)  | AAAA (public v6)     |
| --------- | -------------- | -------------------- |
| `dns`     | `15.204.95.40` | `2604:2dc0:222::64d` |
| `aedilis` | `15.204.95.40` | `2604:2dc0:222::64d` |

### 1.5 Full current set — totals

- `tailnetRecords`: 28 × (A + AAAA) = **56 records**
- `nasRecords`: **1 record** (A only)
- `publicEndpointRecords`: 2 × (A + AAAA) = **4 records**
- **Grand total: 61 records** in `plato-splunk.media` (Primary).

> Record shape is the `technitium-provisioning` attrTag (`records.nix` / `options.nix`):
> `{ A = { name = <fqdn>; address = <ip>; }; }` and `{ AAAA = { name = <fqdn>; address = <ip>; }; }`,
> with an optional `ttl`. The generated set must emit the **same attrTag shape** so the provisioning
> script's `typeParams` / `renderRecord` path is byte-identical.

---

## 2. Classification of every current record

Each current name falls into exactly one of four buckets. This drives **how** the generator produces
it (service-derived) vs. **whether** it must be retained as an explicit non-service extra.

### 2.1 Service-derived — generated from a catalog entry (`dns.enable` + `host`)

These correspond to a real catalog service. Each is emitted by the DNS generator from that service's
`dns.enable = true` + `dns.kind = "tailnet"` + `host`, with A/AAAA from
`constants.hosts.<host>.tailscale`. The subdomain is the service's `subdomain` field.

| current subdomain       | → host     | owning catalog service / plan                              |
| ----------------------- | ---------- | ---------------------------------------------------------- |
| `idm`                   | `augustus` | `kanidm` (`services.kanidm` — subdomain `idm`)             |
| `openwebui`             | `augustus` | `openwebui`                                                |
| `radius`                | `augustus` | `radius`                                                   |
| `home-assistant`        | `augustus` | `home-assistant`                                           |
| `dev-tools`             | `augustus` | `it-tools` (subdomain `dev-tools`)                         |
| `planka`                | `augustus` | `planka`                                                   |
| `postgres-augustus`     | `augustus` | `postgres` (subdomain `postgres-augustus`)                 |
| `homelab-api`           | `augustus` | `homelab-api` (subdomain `homelab-api`)                    |
| `homelab`               | `augustus` | `homelab-ui` (frontend; subdomain `homelab`)               |
| `habitsync`             | `augustus` | `habitsync`                                                |
| `prometheus`            | `augustus` | `prometheus`                                               |
| `grafana`               | `augustus` | `grafana`                                                  |
| `ca`                    | `cicero`   | `step-ca` (subdomain `ca`)                                 |
| `cicero-metrics`        | `cicero`   | `cicero-observability` (metrics subdomain — see §2.4)      |
| `ca-monitoring`         | `cicero`   | `cicero-observability` / step-ca metrics (see §2.4)        |
| `ollama`                | `mini`     | `ollama` (mini-hosted; still gets its record from aedilis) |
| `mini-caddy-metrics`    | `mini`     | mini Caddy metrics (metrics subdomain — see §2.4)          |
| `mini-jellyfin-metrics` | `mini`     | mini Jellyfin metrics (metrics subdomain — see §2.4)       |
| `dns-admin`             | `aedilis`  | `technitium` admin UI (subdomain `dns-admin`)              |
| `dns-metrics`           | `aedilis`  | `dns-metrics` (Technitium metrics — see §2.4)              |

### 2.2 Host-apex records — the hosts themselves, NOT services

These resolve a **host's own name** to its tailnet address. They are not a service's vhost; they are
the machine. They cannot be owned by a service catalog entry (there is no "augustus service"). **The
subdomain equals a real hostname.**

| current subdomain | → host (self) | resolution model                              |
| ----------------- | ------------- | --------------------------------------------- |
| `augustus`        | `augustus`    | host apex A/AAAA → `augustus` tailnet address |
| `cicero`          | `cicero`      | host apex A/AAAA → `cicero` tailnet address   |
| `nixos`           | `nixos`       | host apex A/AAAA → `nixos` tailnet address    |
| `praeconinus`     | `praeconinus` | host apex A/AAAA → `praeconinus` tailnet addr |

> `aedilis` is **not** in this list as a tailnet apex: its only apex records are the **public** OVH
> identities in `publicEndpointRecords` (§2.3), not a tailnet A/AAAA. `mini` has **no** host-apex
> tailnet record today (only `ollama` / `mini-*-metrics` service names point at mini).

**Decision:** host apexes are retained as **explicit extras** fed from `constants.hosts` (see §3.2),
not generated by the service DNS fold. They are infrastructure identity, not a service contract.

### 2.3 Non-service outliers — explicit extras, not catalog-derived

| current name       | bucket                   | retained how                                                      |
| ------------------ | ------------------------ | ----------------------------------------------------------------- |
| `nas` (A only)     | LAN device, no tailnet   | explicit extra (static A `10.76.100.190`, no AAAA)                |
| `dns` (A+AAAA)     | public endpoint identity | explicit extra → public OVH `15.204.95.40` / `2604:2dc0:222::64d` |
| `aedilis` (A+AAAA) | public endpoint identity | explicit extra → public OVH (same as `dns`)                       |

These have no service semantics (or point at **public**, not tailnet, IPs) and must remain to avoid
NXDOMAIN. They stay as a hand-maintained `dnsExtraRecords`-style list merged into the zone (§3.2).

### 2.4 Metrics subdomains that belong to a service

Several names are **metrics/observability endpoints of a service**, not standalone services. They
should be emitted by the owning service's feature — either as the service's own `subdomain` (when the
metrics endpoint _is_ the catalog entry) or via an additional `dns`-only sub-entry the feature
contributes. Each still points at the same host as its parent.

| metrics subdomain       | belongs to                        | → host     | how to emit                                                                              |
| ----------------------- | --------------------------------- | ---------- | ---------------------------------------------------------------------------------------- |
| `dns-metrics`           | Technitium metrics (aedilis)      | `aedilis`  | `dns-metrics` catalog entry (`subdomain=dns-metrics`), already a service in the registry |
| `cicero-metrics`        | cicero observability              | `cicero`   | `cicero-observability` feature contributes entry                                         |
| `ca-monitoring`         | step-ca metrics                   | `cicero`   | `cicero-observability` / step-ca feature contributes entry                               |
| `mini-caddy-metrics`    | mini Caddy metrics                | `mini`     | mini feature contributes a `dns`-only entry                                              |
| `mini-jellyfin-metrics` | mini Jellyfin metrics             | `mini`     | mini feature contributes a `dns`-only entry                                              |
| `prometheus-client`     | prometheus client-scrape endpoint | `augustus` | `prometheus` feature contributes entry (see plan)                                        |
| `loki-push`             | loki push endpoint                | `augustus` | `loki` feature contributes entry                                                         |

> **`ldap` (entry #2) — REMOVED (operator-approved).** This was the Kanidm LDAP interface alias
> (`constants.services.kanidm.ldapDomain = ldap.plato-splunk.media`), pointing at `augustus` like
> `idm`. **Decision (operator):** the homelab is OIDC-exclusive and LDAP is unused, so the `ldap`
> Caddy route **and** this DNS record are **removed entirely** (see [kanidm.md](./kanidm.md) §2.1.1
> and [catalog-and-generators §7.8 #21](./catalog-and-generators.md)). The `kanidm` feature
> contributes **only** the `idm` record; it does **not** emit any `ldap`/`kanidm-ldap` entry. The
> `ldap` A/AAAA pair is a **second** intentional, flagged set-difference in the gate (alongside
> `apprise`, §2.5). The kanidm server's own LDAP `bindaddress` config is left untouched for parity,
> but nothing resolves or routes to `ldap.plato-splunk.media` anymore.

### 2.5 Removed records — `apprise` (entry #12) + `ldap` (entry #2)

Two records are **intentionally dropped** (operator-approved) — the only permitted deviations from
exact set-equality:

**`apprise` (→ augustus)** is a rewrite for a service that **no longer exists**. Per
`.kiro/steering/nix-services.md` and confirmed in-tree: the Apprise container was **removed** —
`services/failure-notifs.nix` documents "Apprise is no longer involved" / "that indirection was
unreliable," and a repo-wide search finds **no** `apprise` service module, container, or Caddy vhost.
The only surviving reference is the dangling `apprise = "augustus";` line in `tailnetRewrites`.

**`ldap` (→ augustus)** is the Kanidm LDAP alias, removed because LDAP is unused (§2.4).

**Action (both):** the operator has **approved** removing both. Neither has an owning catalog service,
so they are simply **not emitted**. Document them in the migration PR as the two justified
set-differences (two record pairs removed: `apprise` A+AAAA and `ldap` A+AAAA). The set-equality gate
(§4) must therefore show **exactly** those two pairs dropped and nothing else.

<!-- Historical note: earlier drafts treated apprise as "confirm-before-dropping" and ldap as a
     service-derived secondary name to preserve. Both are now operator-approved removals. -->

- **~~If unconfirmed~~:** no longer applicable — both removals are approved. (Retained below only as a
  description of the fallback that is no longer needed.) A temporary explicit extra (§3.2) pointing at
  augustus would keep the set exactly equal, but — since both removals are approved — this fallback is
  not used; both names are simply dropped and the authoritative zone will correctly NXDOMAIN them.

Both `apprise` and `ldap` are the only records that are neither clean service-derived entries nor
intentional infrastructure extras — they are the two approved deletions.

### 2.6 Hosts whose apex is currently in `tailnetRewrites`

Flagged per the task: the rewrite table currently carries **host-apex** names mixed in with service
names — `augustus`, `cicero`, `nixos`, `praeconinus` (§2.2). These are the entries that must move out
of the service fold into the host-apex extras (§3.2), since no service owns them. `aedilis` appears
as an apex too but only via the **public** `publicEndpointRecords`, not the tailnet fold.

---

## 3. Proposed generator + extras design

The generator mechanism is defined authoritatively in
[catalog-and-generators.md](./catalog-and-generators.md) §3.6 (`homelab-service-dns`). This section
specifies how **this** zone's full set is reproduced: service-derived records from the fold, plus the
explicit non-service extras merged in.

### 3.1 Service-derived records (the fold)

`homelab-service-dns` (aedilis only; folds the **whole** catalog regardless of each service's host)
emits, for every entry with `managedBy.dns && dns.enable`:

- `dns.kind == "tailnet"` → `{ A = { name = <fqdn>; address = hosts.<host>.tailscale.v4; }; }` +
  the matching `AAAA` from `.v6`.
- grouped by `zone` (default `plato-splunk.media`), one Primary zone per group.

This reproduces every §2.1 service name and every §2.4 metrics name (each contributed by its owning
feature) — all with A/AAAA read from `constants.hosts`, which is **identical** to the retired `ts`
table. It does **not** emit `ldap` (removed, §2.4) or `apprise` (removed, §2.5). "Which host serves
this name" becomes a property of the single catalog declaration.

### 3.2 Non-service extras (host apexes + nas + public endpoints)

The §2.2/§2.3 records have no service owner and are retained as an explicit, hand-maintained extras
list, merged into the same zone. (`apprise` and `ldap` are **not** retained — both are approved
removals, §2.5.) Model them as a new `constants.dnsExtraRecords` (moved out of the `ts` fold,
replacing `nasRecords` + `publicEndpointRecords` and adding the host apexes that leave
`tailnetRewrites`):

```nix
# in constants (replaces nasRecords/publicEndpointRecords; host apexes move here
# out of tailnetRewrites). Host-apex A/AAAA read from constants.hosts.<h>.tailscale.
constants.dnsExtraRecords = let
  hosts = config.constants.hosts;
  mkHostApex = h: [
    { A    = { name = "${h}.${baseDomain}"; address = hosts.${h}.tailscale.v4; }; }
    { AAAA = { name = "${h}.${baseDomain}"; address = hosts.${h}.tailscale.v6; }; }
  ];
  publicEndpoint = sub: [
    { A    = { name = "${sub}.${baseDomain}"; address = "15.204.95.40"; }; }
    { AAAA = { name = "${sub}.${baseDomain}"; address = "2604:2dc0:222::64d"; }; }
  ];
in
  # host apexes (§2.2)
  (lib.concatMap mkHostApex [ "augustus" "cicero" "nixos" "praeconinus" ])
  # nas LAN outlier (§2.3) — A only, no AAAA
  ++ [ { A = { name = "nas.${baseDomain}"; address = "10.76.100.190"; }; } ]
  # public OVH identities (§2.3)
  ++ publicEndpoint "dns"
  ++ publicEndpoint "aedilis";
  # NOTE: `apprise` deliberately omitted (dropped as cruft, §2.5). If operator
  # cannot confirm it is unused, temporarily append:
  #   ++ [ { A = { name = "apprise.${baseDomain}"; address = hosts.augustus.tailscale.v4; }; }
  #        { AAAA = { name = "apprise.${baseDomain}"; address = hosts.augustus.tailscale.v6; }; } ]
```

The `homelab-service-dns` generator merges these extras into the matching zone's record list
(per [catalog-and-generators.md](./catalog-and-generators.md) §3.6, `staticExtras` →
`lib.zipAttrsWith` record concat). The merge is a **set union**; order is irrelevant because the
provisioning path is upsert-only and the equality gate (§4) is order-independent.

### 3.3 What gets deleted from `service-registry.nix`

Once the fold + extras produce the equal set and aedilis imports `homelab-service-dns`:

- delete the `ts` table (duplicate of `constants.hosts.*.tailscale`);
- delete the `tailnetRewrites` map, `mkTailnetRecords`, `tailnetRecords`;
- delete `nasRecords`, `aedilisPublicV4/V6`, `publicEndpointRecords` (folded into `dnsExtraRecords`);
- replace `constants.dnsRecords.private` with the generator output (or keep a thin derived alias
  during transition). `technitium-aedilis/complete.nix` keeps
  `provision.ensureDnsRecords.zones = <generated>` — only the **source** of the attrset changes, not
  the provisioning mechanism or its upsert-only guarantee.

---

## 4. Operational-equivalence gate — exact set-equality

**This is the critical gate.** The generated
`ensureDnsRecords.zones."plato-splunk.media".records` set must be **exactly equal, as an
order-independent set, as a multiset of records**, to the current one — modulo the **two** explicitly
flagged deletions, `apprise` and `ldap` (§2.5). Any other difference means a name silently NXDOMAINs
or a wrong IP is served.

### 4.1 Dump before/after

Capture the full provisioned zones attr on aedilis on the **base** revision (before the migration)
and on the **migrated** revision:

```sh
# BEFORE (base revision): capture the current hand-maintained set
nix eval --json \
  .#nixosConfigurations.aedilis.config.services.technitium-server-complete.provision.ensureDnsRecords.zones \
  > /tmp/dns-before.json

# AFTER (migrated revision, with homelab-service-dns imported on aedilis): capture the generated set
nix eval --json \
  .#nixosConfigurations.aedilis.config.services.technitium-server-complete.provision.ensureDnsRecords.zones \
  > /tmp/dns-after.json
```

> Remember the `.kiro/steering/validation.md` rule: **`git add` the new `homelab-service-dns` files
> before** the AFTER eval — flake eval reads the git tree, and untracked new `.nix` files are
> invisible to `import-tree` (a "missing module/attr" error is almost always an unstaged new file).

### 4.2 Set-comparison with jq (order-independent)

Normalize each zone's record list into a **sorted set of canonical record strings**, then diff. The
attrTag shape is `{ "<TYPE>": { "name": …, "address": … } }`, so flatten to `TYPE|name|value`:

```sh
# Canonicalize: for the baseDomain zone, map each record to a sorted "TYPE|name|value"
# line set. Handles A/AAAA (address), CNAME (cname), and is order-independent.
canon() {
  jq -r '
    ."plato-splunk.media".records[]
    | to_entries[0] as $r
    | ($r.key) as $type
    | ($r.value.name) as $name
    | ($r.value.address // $r.value.cname // $r.value.text // "?") as $val
    | "\($type)|\($name)|\($val)"
  ' "$1" | LC_ALL=C sort -u
}

canon /tmp/dns-before.json > /tmp/dns-before.set
canon /tmp/dns-after.json  > /tmp/dns-after.set

# Exact set-equality gate: must show ONLY the flagged apprise + ldap removals (4 lines).
diff -u /tmp/dns-before.set /tmp/dns-after.set && echo "DNS SET EQUAL ✓"
```

Interpretation:

- **Only the four lines** `-A|apprise…`, `-AAAA|apprise…`, `-A|ldap…`, `-AAAA|ldap…` → the two
  intended removals (§2.5), both operator-approved; document in the PR.
- **Empty diff** → would mean `apprise`/`ldap` are still present; they should be **gone**, so expect
  exactly those four `-` lines, not an empty diff.
- **Any other `+`/`-` line** → a real regression (a dropped name = NXDOMAIN, or a wrong/extra IP).
  **Do not proceed.** Fix the catalog/extras until only the four approved removals remain.

### 4.3 Belt-and-suspenders: count + multiset check

```sh
# Record counts: 61 today → 57 after (apprise A+AAAA and ldap A+AAAA dropped = 4 fewer).
echo "before: $(wc -l < /tmp/dns-before.set)   after: $(wc -l < /tmp/dns-after.set)"

# Symmetric difference, explicit (should show only the apprise + ldap pairs = 4 lines):
comm -3 /tmp/dns-before.set /tmp/dns-after.set
```

Also confirm the **zone-level** attrs are unchanged (`type = "Primary"`, same zone key):

```sh
jq -S '{type: ."plato-splunk.media".type, n: (."plato-splunk.media".records|length)}' /tmp/dns-before.json
jq -S '{type: ."plato-splunk.media".type, n: (."plato-splunk.media".records|length)}' /tmp/dns-after.json
```

---

## 5. Migration checklist

This runs **last** (parent plan §3 step 6; README execution order step 9). Prerequisite: **every**
service already declares its catalog entry and **all** other generators (caddy / acme / firewall /
oidc) have passed their own parity gates. Only then touch DNS.

- [ ] **Precondition:** confirm every §2.1 service and every §2.4 metrics name has a catalog entry
      with `subdomain`, `host`, `dns.enable = true`, `dns.kind = "tailnet"`. Cross-check the §1.2
      table — all 28 rewrite names (minus host apexes, minus the removed `apprise` **and `ldap`**)
      must be covered by a service or a feature-contributed `dns`-only entry (`loki-push`,
      `prometheus-client`, `cicero-metrics`, `ca-monitoring`, `mini-*-metrics`). **`ldap` is NOT
      covered** — it is intentionally removed (§2.4).
- [ ] Add `constants.dnsExtraRecords` with host apexes (`augustus`, `cicero`, `nixos`,
      `praeconinus`), `nas` (A only), and the public `dns` / `aedilis` endpoints (§3.2). Do **not**
      add `apprise` or `ldap`.
- [ ] **Removals (§2.5, operator-approved):** `apprise` and `ldap` are dropped — ensure neither is
      emitted by the fold or added to `dnsExtraRecords`. Both are expected in the gate's diff.
- [ ] Wire `homelab-service-dns`'s `staticExtras` to read `constants.dnsExtraRecords`.
- [ ] Add the `homelab-service-dns` import to aedilis (via `homelab-service-dns-host`, see
      [catalog-and-generators.md](./catalog-and-generators.md) §1 import matrix). **`git add`** the
      new files (flake eval reads the git tree).
- [ ] Capture `/tmp/dns-before.json` on the base revision (§4.1).
- [ ] Switch `technitium-aedilis/complete.nix`'s `ensureDnsRecords.zones` to the generated output
      (or confirm the generator sets it directly). Capture `/tmp/dns-after.json`.
- [ ] **Run the set-equality gate (§4.2 + §4.3): the diff MUST show ONLY the four approved removal
      lines** (`apprise` A+AAAA, `ldap` A+AAAA). Do not proceed on any other difference.
- [ ] Only after a clean gate: delete `ts`, `tailnetRewrites` (incl. the `apprise` and `ldap`
      entries), `mkTailnetRecords`, `tailnetRecords`, `nasRecords`, `aedilisPublicV4/V6`,
      `publicEndpointRecords` from `service-registry.nix`.
- [ ] `nix run .#nixfmt -- $(git ls-files '*.nix' ':!:repos/**')` then `nix flake check`.
- [ ] `nixos-rebuild build --flake .#aedilis` and verify the `technitium-provision-records` unit's
      rendered upsert script has the expected count (57 `upsert A/AAAA` calls, down from 61).
- [ ] Deploy to aedilis; after activation, spot-check resolution of a sample from each bucket over
      the tailnet:
      `sh
      for n in idm.plato-splunk.media augustus.plato-splunk.media nas.plato-splunk.media \
               dns.plato-splunk.media cicero-metrics.plato-splunk.media; do
        dig +short "$n" @100.108.78.46 A; dig +short "$n" @100.108.78.46 AAAA
      done
      # and confirm the removed names now NXDOMAIN:
      dig +short ldap.plato-splunk.media @100.108.78.46; dig +short apprise.plato-splunk.media @100.108.78.46`
      Confirm `idm`/host-apexes resolve to tailnet IPs, `nas` to `10.76.100.190` (A only), `dns`/
      `aedilis` to the public OVH IPs, and that `ldap`/`apprise` return **no answer** (NXDOMAIN) —
      matching the intended post-migration state.

---

## 6. Risk summary

- **Authoritative Primary zone = no fallthrough.** A dropped name returns NXDOMAIN, not a public
  answer. The §4 set-equality gate is the hard stop; it is non-optional and order-independent.
- **`ts` ≡ `constants.hosts`.** Verified identical today, so reading tailnet IPs from
  `constants.hosts.<host>.tailscale` in the fold cannot change any address — the comment in
  `service-registry.nix` already warns they must stay in sync; the migration removes the duplication
  that made that drift possible.
- **Host apexes + public endpoints are not services** and are retained as explicit extras; failing to
  move them out of the fold would silently drop four tailnet apexes and the two public identities.
- **`apprise` and `ldap` are the only two intended deviations** (both operator-approved removals,
  §2.5); everything else must be a zero-diff no-op. The gate's symmetric difference must contain
  exactly those four `-` lines and nothing more.
