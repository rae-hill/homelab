# 06 — Stretch: Postgres Persistence, Redis Cache, Seams

Status: **non-committing**. Per README D6, v1 state is redux + localStorage. This doc sketches
feasible designs for the stretch goals (server-side history keyed by job category, redis response
cache) and — its actionable core — nails down the §E seams v1 must preserve so the stretch needs
no rework. Nothing here is v1 scope.

## Purpose & Scope

Stretch motivations, in assumed priority order:

1. **Tailor history across devices** — entries survive a localStorage clear and follow the user.
2. **Print-by-variant** — a stored entry id becomes printable server-side (§D).
3. **Response caching** — skip paying a second time for the identical listing+content+prompt.
4. **Category-keyed base states** — the longer-term "resume data keyed by job category" idea.

Explicitly out of scope: multi-instance homelab-api, analytics, sharing links, praeconinus (doc 05
keeps tailor dark there).

## Verified Current State (2026-11)

- **Postgres 17 is live on augustus.** `nix-config/modules/features/postgres/service.nix` wraps
  `services.peesequel` (`postgresql_17_jit`, port 5432, SSL from the ACME cert for
  `postgres-augustus.plato-splunk.media`, `services.postgresqlBackup` + restic failure-notifs).
  Augustus enables it in `_private/augustus/programs.nix:29–50` with `ensureDatabases = [ "jacob" "ca" ]`;
  **planka and habitsync add their own DB/user/password from their feature modules**
  (`features/habitsync/service.nix:28–46`, `features/planka/service.nix:40–56`) — the precedent to
  mirror, incl. the `services.peesequel.provisionPasswords` + sops-secret-path pattern.
- **pg_hba reality** (`postgres/service.nix:156–182`): non-superuser access is `local sameuser … peer map=superuser_map`
  (unix socket, OS user → same-name role), `hostssl sameuser … 127.0.0.1/32 scram-sha-256`
  (localhost TLS + password — planka's on-host path, `features/planka/service.nix:100`), and remote
  `hostssl … cert map=cert_map` (step-ca client cert). `sameuser` means **database name must equal
  role name**.
- **homelab-server is stateless today.** Grep across `packages/*/src`: zero DB clients (only resume
  tag-cloud strings like "PostgreSQL"). homelab-api's systemd user defaults to `homelab-api`
  (`features/homelab-api/systemd-service.nix:42`) and it runs **on augustus**, same box as postgres.
- **Redis: dependency declared, nothing deployed, nothing imported.** `redis: ^6.3.1` in
  `packages/{homelab-server,homelab-services-node,homelab-e2e-tests}/package.json`, resolved to
  **6.3.1** in `yarn.lock:11426`; zero `from "redis"`/`createClient` hits in src/test. No
  `services.redis` anywhere in nix-config. The 26.05 module lives at
  `repos/nixpkgs-26.05/nixos/modules/services/databases/redis.nix` (not `servers/` as earlier drafts
  assumed): `services.redis.servers.<name>.{enable, port, bind, unixSocket, requirePassFile, save,
  appendOnly, maxclients, settings…}`.
- **Effect SQL support exists upstream but is uninstalled.** Vendored `repos/effect` @ 4.1.2: the
  core SQL API lives **in `effect` itself** (`repos/effect/packages/effect/src/sql/`: `SqlClient`,
  `SqlResolver`, `SqlSchema`, `Migrator`) — there is **no standalone `@effect/sql` package** in that
  tree. The driver is `@effect/sql-pg` 4.1.2 (`repos/effect/packages/sql/pg/`), implementing the PG
  wire protocol natively (`PgProtocol.ts`, no runtime dep on npm `pg`/`postgres`; `password` accepts
  `Redacted`; a `host` beginning with `/` is a **unix socket path**, `PgConnection.ts:68`). Neither
  is in `yarn.lock` yet; porsager `postgres` isn't installed either. **Recommendation:
  `@effect/sql-pg`** — house style (Effect layers, `Redacted`, `Migrator`), no driver dependency.
  Not over-committing: spike against the pinned tag before building on it.

## A — Postgres Persistence Sketch

**Purpose:** server-side tailor history for the signed-in subject + per-category base states.

```sql
CREATE TABLE tailor_entries (
  id            uuid PRIMARY KEY,          -- client-generated, stable (D6 seam E1)
  subject       text NOT NULL,             -- Identity.identifier from CurrentIdentity
  created_at    timestamptz NOT NULL DEFAULT now(),
  job_title     text NOT NULL,
  company       text,
  category      text,                      -- nullable, reserved; unused in v1 (seam E6)
  listing_hash  char(64) NOT NULL,         -- sha256(normalized listing) — cache key ingredient
  listing_text  text NOT NULL,
  base_version  text NOT NULL,             -- CONTENT_DEFAULTS_VERSION of the frozen base
  content_patch text NOT NULL,             -- ContentPatchBase64, stored VERBATIM (seam E2)
  fit_report    jsonb NOT NULL,
  meta          jsonb NOT NULL,            -- TailorMeta + raw provider outputs (initial-plan §11)
  status        text NOT NULL DEFAULT 'active'  -- 'active' | 'deleted' (soft-delete for sync)
);
CREATE INDEX tailor_entries_subject_created ON tailor_entries (subject, created_at DESC);

CREATE TABLE resume_content_by_category (
  subject       text NOT NULL,
  category      text NOT NULL,             -- pk-ish: PRIMARY KEY (subject, category)
  base_version  text NOT NULL,
  content_patch text NOT NULL,             -- category base as a patch vs the frozen global base
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject, category)
);
```

**Interaction with doc 01's frozen-base registry:** `INITIAL_CONTENT_STATE` v1 (+ future v2, v3)
stays the single canonical base. Category "bases" are **not** new registry entries — they are rows
storing `base_version + patch-against-that-base`, decoded by the exact same `ContentPatchBase64`
chain. Because base+version travels with every row (seam E2), old rows remain decodable regardless
of registry drift; the alternative (minting per-category frozen bases into `shared`) would leak
user-derived content into a code artifact and is rejected.

**Access path (homelab-api is on augustus, so keep it on-host):**

1. Provisioned via habitsync/planka precedent: a feature-module block adding
   `services.postgresql.ensureDatabases`/`ensureUsers` for one `sameuser` role/db pair (name it
   without hyphens, e.g. `tailor`, to dodge PG identifier quoting), password via sops →
   `services.peesequel.provisionPasswords`, restic already covers backups.
2. **Transport decision: prefer the unix socket.** pg_hba gives `local sameuser … peer` — the
   service's OS user `homelab-api` peer-maps (via the existing `superuser_map` catch-all) to a
   same-name role; to connect as role `tailor`, add one `identMap` line mapping
   `homelab-api → tailor`, exactly the pattern `cert_map` already uses. `@effect/sql-pg` accepts
   `host: "/run/postgresql"`-style socket paths. No password, no TLS, no secret, no port exposure —
   strictly fewer moving parts than the planka-style localhost `hostssl`+scram path (which remains
   the fallback if the socket path is awkward in the service sandbox). The tailscale+mTLS
   `hostssl … cert` remote path is only for **other hosts** talking to augustus' postgres; for that,
   `.opencode/skills/adding-client-certs/SKILL.md` is the mechanism (a `client-<use>` provisioner +
   serial→user template), but praeconinus is dark for tailor (README open question #3), so don't.
3. Client layer: a `TailorStoreService` tag+def in `homelab-services`, Live layer in
   `homelab-services-node/src/layers/` (house pattern per README "Backend chain facts"), wrapping
   `PgPool`/`SqlClient`; connection string from `packages/homelab-server/src/env.ts`
   (`Config.String(...)`, same shape as the OpenRouter key wiring in doc 05).

**Auth:** every query filters by `subject` = `Identity.identifier` from `CurrentIdentity`
(`packages/homelab-services/src/middleware/auth-middleware.ts`; identity type in
`packages/homelab-services/src/identity.ts`). New endpoints (list / get / delete / `POST …/sync`)
would follow doc 03's endpoint-def + `canCreate`/resource-URI authz pattern — sketch only.

## B — Migration Path from localStorage (doc 04's tailor slice)

- v1 keeps working **offline and signed-out**: localStorage stays the write path of record; the
  server is never on the hot path.
- On sign-in, a **one-shot PUSH sync**: client posts entries whose id is not yet server-known
  (`INSERT … ON CONFLICT (id) DO NOTHING` — server-side dedupe keyed by the stable id, seam E1).
  Afterwards, writes are server-first with localStorage as cache (or dual-path; the difference is
  invisible as long as ids are stable).
- **Conflict policy: server wins, per-entry.** Entries are immutable AI outputs (README D4's
  stance); only `status` (soft-delete) and `category`/annotation fields mutate, and those merge
  idempotently (delete-wins, last-annotation-wins). No content merges, ever.
- What v1 must guarantee for this to be painless: **stable client-generated ids**
  (`crypto.randomUUID()` at entry creation, never regenerated on recall/re-save);
  `baseVersion` + `contentPatch` stored **verbatim** end-to-end; `listingHash` recorded (seam E3 —
  **adopted**: `TailorMeta` carries `listingHash`, doc 01 §E; doc 02 §H computes it).

## C — Redis Response Cache Sketch

**Key:** `sha256(normalizedListing + contentHash + promptVersion + schemaVersion + modelSlugs)` —
the scheme doc 02 reserves (v1 computes the hashes into `TailorMeta` but implements **NO cache**,
per D9). When this work activates — together with persistence — the cache lands as a **decorator
layer** over doc 02 §B's small-service composition (`TailorService`/`OpenRouterClientService`),
first in-process LRU, backend swappable without pipeline changes. **Value:** full response JSON
**plus raw provider outputs**, preserving the bad-render-vs-bad-model diagnosis from initial-plan §11.

**Exact-hash only — the warning carried verbatim:** semantic / near-match caching across similar
listings will **silently return a resume tailored to a different job** (initial-plan §11:477–481).
Any future "smart" cache must re-verify grounding against the new listing; treating that as a
stretch of a stretch.

**Deployment cost, if it ever happens:** `services.redis.servers.tailor-cache` on augustus with
`bind = "127.0.0.1"` (or `port = 0` + `unixSocket` — homelab-api is co-located), `save`/`appendOnly`
off (cache-only instance), `settings.maxmemory ≈ 128mb`, `maxmemory-policy allkeys-lru`, client-side
TTLs (24–72h; prompt/model pins version the key anyway). Per the port-assignments skill: an entry in
`nix-config/modules/service-registry.nix` + a row in `docs/port-assignments.md`; localhost bind means
**no** firewall change in `_private/augustus/security.nix`. Client: the already-declared
`redis@6.3.1` — write **v6** `createClient` calls (verified against the lockfile pin, not docs).

**Honest cost/benefit:** homelab-api is **one box, one instance**. Redis buys only cache survival
across deploys/restarts and future multi-instance sharing; the LRU's hit-rate that matters is
"same user re-pastes the same listing against the same content" — plausibly rare. **Staging
recommendation (when this phase starts, per D9 — v1 ships NO cache): LRU decorator first →
instrument `meta.cacheHit` → redis only when telemetry shows restarts are
eating real spend, or a second instance appears.** The middle step (LRU snapshot to disk on shutdown)
is probably not worth building either; skip straight to redis if that day comes.

## D — Print `?variant=` (deferred)

Server-side entries enable printing a tailored variant **without the SPA**: resolve a stored entry
id to `base_version + content_patch → ContentState`, feed the existing print/puppeteer pipeline (a
`GET` param on `/resume/print` or a resolve-then-print step). This deliberately breaks print's
current **statelessness** — today every print request carries its full config and the server keeps
no print state — so it changes cache/retention/security posture of the print path and needs its own
decision. Defer; just ensure entries have stable ids addressable server-side (seam E1 does this).

## E — Seams v1 Must Preserve (actionable core)

1. **E1 Stable entry ids** — client-generated uuid at creation; used verbatim as DB PK and sync key.
2. **E2 `baseVersion` on every stored patch**, patch stored **verbatim** (never re-diffed against a
   mutable "latest") — README wire contract + doc 01's frozen-base registry already require this.
3. **E3 `listingHash` + `contentHash` + `promptVersion` + `schemaVersion` in `meta`** — the cache
   key must be recomputable from a stored row alone. **ADOPTED**: `listingHash` added to doc 01 §E's
   `TailorMeta`; computation specified in doc 02 §H.
4. **E4 Small-service composition around the provider call (doc 02 §B)** — the cache inserts as a
   decorator LAYER via composition when this phase starts (D9: nothing in v1); key scheme fixed
   (§C); backend (LRU → redis) swappable.
5. **E5 Persistence isolated behind one module in the tailor slice** (doc 04) — localStorage
   repository today, server-backed repository later, redux unaware.
6. **E6 `category` reserved and nullable** in the client entry shape (and wire meta if cheap) —
   unused in v1, present so `resume_content_by_category` needs no client migration.
7. **E7 Delete = soft-delete semantics friendly** — a v1 delete that also leaves a tombstone
   timestamp in localStorage makes the future server `status='deleted'` merge trivial.

## Rough Sequencing

1. v1 (docs 01–05) with all §E seams — **the only commitment here**.
2. Postgres persistence + push sync + history endpoints **after the UI stabilizes** (entry shape
   churn stops when the details-modal/recall flows settle).
3. Print-by-variant only after entries are server-side (§D).
4. Cache arrives WITH this persistence phase (D9 — nothing in v1): LRU decorator first, redis only
   if `cacheHit` telemetry justifies it (single-box honesty, §C); the composition seam (E4) means
   zero pipeline rework when/if it happens.
5. Category-keyed bases last — depends on real usage and README open question #2's drift cadence.

## Open Questions

- Role/db name under the `sameuser` constraint (`tailor`? `homelab_api`?) and the one added
  `identMap` line vs. localhost `hostssl` scram fallback — settle during the §A spike.
- Retention/size of `listing_text` (cap at §11's 20k truncation? store cleaned-listing only?) and
  whether `meta`'s raw provider outputs are trimmed before persisting.
- Guest (signed-out) entries: push-at-sign-in means history created anonymously is claimed by
  whoever signs in first on that device — acceptable?
- Migrations: `effect/sql/Migrator` checked into the repo vs. hand-run DDL for a one-person feature.
- Does a cache hit still spend the per-subject token bucket? (initial-plan §11 quota vs §11 cache —
  presume yes-but-free, decide with doc 02.)

## Cross-References

- **Doc 01** — frozen `INITIAL_CONTENT_STATE` registry, `ContentPatchBase64` decode chain,
  `TailorMeta` (carries `listingHash` — E3 resolved).
- **Doc 02** — small-service composition (E4 insertion point), `contentHash`/`listingHash`
  computation, quota; cache-hit-vs-quota interaction (OQ below — moot until caching exists).
- **Doc 03** — endpoint pattern the future store endpoints copy; print pipeline context.
- **Doc 04** — tailor slice + versioned localStorage key (E5/E7), stable ids (E1).
- **README** D6 (seams), wire contract; **initial-plan** §11 (exact-hash-only warning, raw-output
  storage, quota), §14 (server-side persistence / `?variant=` question).
