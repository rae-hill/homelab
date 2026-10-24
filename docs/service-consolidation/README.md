# Service Consolidation — Per-Module Implementation Plans

This directory holds one concrete implementation plan per module affected by the
[service consolidation plan](../service-consolidation-plan.md). The parent plan defines the
**catalog registry + generators + colocated features** design; these documents are the
module-by-module execution plans for migrating onto it.

## Current status (updated 2026-10-23, morning session)

The keystone module and the first wave of service migrations are **implemented and committed**
(locally, on `main`, not pushed). The catalog schema uses the **`attrTag` discriminated-union**
style throughout (see [catalog-and-generators §2.0](./catalog-and-generators.md); the earlier
enum+boolean draft was fully converted). `nix flake check` passes for every host, and the attrTag
refactor was proven a byte-for-byte no-op against the pre-refactor revision (all hosts' caddy
vhosts + augustus certs/oauth2 identical modulo the inherent flake-`self` store-path hash).

| Area                                     | State                                                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `features/homelab-service/` (keystone)   | ✅ implemented (schema + 5 generators + renderer + role aggregators), attrTag style                                                                           |
| it-tools, grafana, openwebui, planka     | ✅ migrated (`managedBy.caddy`[`+oidc`]); vhost+OIDC on catalog                                                                                               |
| home-assistant, habitsync                | ✅ migrated (OIDC edge cases: non-`/` landing, public client w/ absolute callback)                                                                            |
| radius, kanidm, postgres                 | ✅ migrated (cert-terminating: `tls.cert.own`, bare challenge, postRun/reload variants)                                                                       |
| **loki, prometheus**                     | ⏳ TODO — mTLS (cert-less `tls { client_auth }`) + client-cert-only consumer                                                                                  |
| **homelab-ui, homelab-api**              | ⏳ TODO — static backend; dual secure+insecure vhost (`insecureHttp`) + public client                                                                         |
| **cicero-observability, mini**           | ⏳ TODO — cicero mTLS metrics vhosts; mini darwin Caddyfile backend                                                                                           |
| **technitium-caddy, technitium-aedilis** | ⏳ TODO — mTLS/OIDC admin+metrics vhosts; public LE `dns` cert + direct-tailnet challenge certs                                                               |
| **praeconinus**                          | ⏳ TODO (decision) — recommended to keep the Funnel vhost bespoke (`access.scope.funnel`)                                                                     |
| **firewall generator cutover**           | ⏳ DEFERRED — flip `managedBy.firewall` per host; set-equality gate vs baseline (needs go-ahead)                                                              |
| **DNS generator cutover**                | ⏳ DEFERRED — flip `managedBy.dns`, add `constants.dnsExtraRecords`, delete `ts`+`tailnetRewrites`; realize apprise+ldap removals (riskiest; hold for review) |

Only **augustus** currently imports a generator aggregate (`homelab-service-oidc-host`). aedilis,
cicero, praeconinus, and mini still need their aggregate import added when their services migrate.
Per-entry `managedBy.*` flags gate each generator, so migrated and un-migrated services coexist
without double-emitting. See the appended "Remaining work" entry in the
[overnight log](../service-consolidation-overnight-log.md) for the full task list and sequencing.

## Overriding principle: operational equivalence

**Deploying every revision in this directory must be a theoretical no-op.** The migration changes
_where_ configuration is declared (into colocated `features/<service>/` catalog entries read by
generators), not _what_ gets realized on each host. Each per-module plan therefore MUST:

1. **Capture the current emitted output** — the exact `services.caddy.virtualHosts.<url>.extraConfig`,
   `security.acme.certs.<domain>`, `services.kanidm.provision.systems.oauth2.<clientId>`,
   `networking.firewall` ports, and/or `ensureDnsRecords` entries the module produces today.
2. **Show the target catalog entry + generator output** and argue it renders the same config.
3. **Define a parity gate** — the `nix eval … --json` (or `--raw` for the mini Caddyfile) command to
   diff before/after, which must be empty or an explicitly-justified, reviewed change.
4. **Call out any discovered bug or approved deviation** as an explicitly-documented exception.

Nothing in a per-module plan should change runtime behavior **except** a deliberately-flagged bug fix
or an operator-approved deviation. The approved deviations (recorded in
[catalog-and-generators §7.8](./catalog-and-generators.md)) are:

- **Upstream token standardized to `127.0.0.1`** — a bugfix for a `localhost` DNS-resolution oddity;
  the `localhost`-sourced vhosts (`it-tools`, `openwebui`, `planka`, `home-assistant`) will show
  exactly that substitution in their parity gate.
- **apprise DNS record removed** — dead service, stale `tailnetRewrites` entry.
- **kanidm `ldap` route + DNS record removed** — the homelab is OIDC-exclusive; LDAP is unused. The
  kanidm server's own LDAP `bindaddress` config is left untouched for parity, but no Caddy route or
  DNS record points at it.
- **praeconinus `443→8443` Funnel finding** — documented; may stay a bespoke override.

## Module inventory

Grouped by host. "Concerns" = which of the five cross-cutting surfaces the module currently emits
(V = Caddy vhost, C = ACME cert, O = OIDC client, F = firewall, D = DNS).

### augustus (primary app host)

| Module                        | Concerns   | Complexity | Plan                                     |
| ----------------------------- | ---------- | ---------- | ---------------------------------------- |
| `services/it-tools.nix`       | V F        | trivial    | [it-tools.md](./it-tools.md)             |
| `services/openwebui.nix`      | V O        | low        | [openwebui.md](./openwebui.md)           |
| `services/grafana.nix`        | V O        | low        | [grafana.md](./grafana.md)               |
| `services/planka.nix`         | V O        | low        | [planka.md](./planka.md)                 |
| `services/home-assistant.nix` | V O        | low        | [home-assistant.md](./home-assistant.md) |
| `services/habitsync.nix`      | V O        | low        | [habitsync.md](./habitsync.md)           |
| `services/loki.nix`           | V (mTLS)   | medium     | [loki.md](./loki.md)                     |
| `services/kanidm.nix`         | V C O*     | high       | [kanidm.md](./kanidm.md)                 |
| `services/postgres.nix`       | V C        | medium     | [postgres.md](./postgres.md)             |
| `services/radius.nix`         | V C        | medium     | [radius.md](./radius.md)                 |
| `services/prometheus.nix`     | C (client) | medium     | [prometheus.md](./prometheus.md)         |
| `features/homelab-api/*`      | V O        | high       | [homelab-api.md](./homelab-api.md)       |
| `features/homelab-ui/*`       | V (static) | low        | [homelab-ui.md](./homelab-ui.md)         |

\* kanidm registers no OIDC client itself but its vhost uses a manual TLS cert and a bespoke
reverse-proxy transport; it is the canonical manual-TLS / per-service-cert-group case.

### aedilis (authoritative DNS + Technitium)

| Module                          | Concerns      | Complexity | Plan                                             |
| ------------------------------- | ------------- | ---------- | ------------------------------------------------ |
| `features/technitium-aedilis/*` | V C F         | high       | [technitium-aedilis.md](./technitium-aedilis.md) |
| `features/technitium/caddy.nix` | V (mTLS/OIDC) | high       | [technitium-caddy.md](./technitium-caddy.md)     |
| DNS source (`service-registry`) | D             | high       | [dns-records.md](./dns-records.md)               |

### cicero (certificate authority)

| Module                            | Concerns | Complexity | Plan                                                 |
| --------------------------------- | -------- | ---------- | ---------------------------------------------------- |
| `features/cicero-observability/*` | V C      | medium     | [cicero-observability.md](./cicero-observability.md) |

### praeconinus (Tailscale Funnel)

| Module                              | Concerns        | Complexity | Plan                               |
| ----------------------------------- | --------------- | ---------- | ---------------------------------- |
| `_private/praeconinus/programs.nix` | V (Funnel:8443) | high       | [praeconinus.md](./praeconinus.md) |

### mini (nix-darwin)

| Module                       | Concerns            | Complexity | Plan                 |
| ---------------------------- | ------------------- | ---------- | -------------------- |
| `_private/mini/programs.nix` | V (Caddyfile, mTLS) | medium     | [mini.md](./mini.md) |

### Cross-cutting (not per-service)

| Module                            | Role                                                 | Plan                                                     |
| --------------------------------- | ---------------------------------------------------- | -------------------------------------------------------- |
| `features/homelab-service/` (new) | Catalog schema + the five generators                 | [catalog-and-generators.md](./catalog-and-generators.md) |
| `_private/<host>/security.nix`    | Firewall: service-derived openings vs baseline infra | [firewall.md](./firewall.md)                             |

## Recommended execution order

Follows the parent plan §3: catalog+generators first, then one reference service end-to-end
(`it-tools`), then the remaining low-complexity services, then cert-terminating services, then
firewall, then DNS, with mini exercised alongside to validate the darwin Caddyfile backend.

1. [catalog-and-generators.md](./catalog-and-generators.md)
2. [it-tools.md](./it-tools.md) (reference pattern)
3. openwebui, grafana, planka, home-assistant, habitsync, homelab-ui
4. kanidm, postgres, radius, prometheus, loki (cert-terminating / mTLS)
5. homelab-api
6. cicero-observability, mini
7. [firewall.md](./firewall.md)
8. technitium-caddy, technitium-aedilis
9. [dns-records.md](./dns-records.md) (last — delete `ts` + `tailnetRewrites`)
