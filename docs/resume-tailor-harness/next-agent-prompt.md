# Next-Agent Handoff Prompt — Resume Tailor Feature

Copy everything below the line into a fresh agent session.

---

You are continuing the **resume-tailor AI feature** in the homelab monorepo at
`/home/jacob/git/homelab`. The owner runs parallel agents in separate worktrees — work in the
worktree your session started in (`git worktree list` / `pwd` to confirm); do not switch or
create worktrees unless asked.

## Read first (in this order)

1. `AGENTS.md` — house rules (path resolution, validation, commits, harness).
2. `docs/resume-tailor-harness/README.md` — decisions **D1–D9**, wire contract, corrected repo
   facts, architecture diagram, task graph.
3. `docs/resume-tailor-harness/progress.md` — status table (every task + its commit hash),
   §Gotchas, **§Open items (your work queue)**, session log (how we got here, incl. the two
   interrupted-agent recoveries and the e2e/undici debugging story).
4. `docs/resume-tailor-harness/07-v2-plan.md` — **the v2 plan of record (T12–T19)**: owner
   directives M1–M12, clarifications C1–C3, verified current state, per-task designs, waves,
   gates. Docs 01–05 carry v2 override banners; doc 07 wins on conflicts.
5. Section docs as needed: `01-shared-state-and-contracts.md` (schemas/codec),
   `02-ai-pipeline.md` (OpenRouter two-stage pipeline, prompts, guards, evals),
   `03-api-endpoint.md` (endpoint/authz/tests), `04-frontend-ui.md` (tab/modal/redux/services),
   `05-nix-and-secrets.md` (sops/env/kanidm/deploy smoke), `06-stretch-db-and-cache.md`
   (postgres/redis stretch + seams). `resume-tailor-harness-initial-plan.md` is AI-craft
   reference ONLY — its repo facts are superseded by the README.

## State of the world (as of 2026-11-09)

- **v1 is SHIPPED and field-verified.** T1–T10 DONE and committed (every hash in the
  progress.md status table — it is canonical; the 2026-11-08 session-log entries tell the
  post-v1 fix-wave story). The owner deployed to augustus and confirmed **live tailoring works
  end-to-end against real OpenRouter** and **Tempo traces are good** (root spans resolve, log
  events visible).
- Validation all green at last run: root `yarn typecheck`, full `yarn test` (870+ unit tests),
  `yarn lint` (0 errors), FULL `e2e` suite incl. CI-mode (15 files, 111–112 passed + skips =
  the `RUN_TAILOR_LIVE`-gated live-AI test and, with `DISABLE_NETWORK_TESTS=true`, the health
  test), shellcheck gate, `nix build .#homelab-api .#homelab-ui .#resume-site`, and the
  augustus nix evals (secret path + env template + praeconinus-dark).
- **Degraded results no longer exist (owner override of D5, 2026-11-08, `cdc7b6db8`):** pipeline
  failures are 500s with the nested cause chain in the message (`describeErrorChain`); the
  OpenRouter client recovers non-2xx bodies past `filterStatusOk`. This proved itself in
  production the same day — it surfaced the URL-join 404 (`e7137e69d`) that the old code hid.
  Observability fixed (`c9f54b838`). CI-e2e-hang bounds landed (`b372d0713`).
- Secrets/slugs live: owner sops secret (`7077d7b2b444`) + augustus wiring (`e30f55bb2`);
  slugs pinned in env.ts (`cc692e5ea`): stage 2 `anthropic/claude-sonnet-5.5`, stage 1
  `openai/gpt-6-luna` (env-overridable, no rebuild needed). Absent key never breaks boot
  (Option-based env; praeconinus stays dark by design). Owner split kanidm groups
  (`9727a4ceb1ff`): `homelab.resume.printing` / `homelab.resume.tailoring`.
- **v2 is PLANNED (owner, 2026-11-09):** `07-v2-plan.md` is the plan of record for **T12–T19** —
  service extractions (validation-policy / listing-extraction / prompt-config with a `version`
  property / sanitization with truncation args / merge-delta + hashing), errors.ts retirement
  (raw nested error JSON), `Schemas.Tailoring` relocation, wire v2 (`request.policy` +
  JsonPatch-native `response.changes`), permissive prompts v2 (hard bound: no fabricated
  language/framework/runtime claims), frontend review-then-apply flow (Summary|Changes tabs +
  overwrite-confirm via `Equal.equals` — no more auto-apply or "Pre-tailor:" snapshots),
  Tempo→logs correlation + trace-id logging + `Redacted`-at-source, and GATED T19 (model-facing
  edits → Effect JsonPatch ops + path-allowlist policy). New decisions D10–D15; D1/D4 overridden.

## Your job

**Execute the v2 plan: `docs/resume-tailor-harness/07-v2-plan.md` (T12–T19).** The old
"elicit the owner's quality suggestions first" item is RESOLVED — the suggestions became the v2
directives (M1–M12, 2026-11-09). Waves: **V2-A** T12→T13→T14 (serial — shared files) → **V2-B**
T15→T16→T19 (T19 is GATED on doc 07 §H evals + explicit owner go) ∥ T18 → **V2-C** T17.
**Full `e2e` suite runs LAST** (owner directive — subprocess-heavy). Per task: `yarn lint &&
yarn typecheck && yarn test` green, commit `--no-verify`, update progress.md (status table +
session log + gotchas). If a test resists diagnosis after ~2 attempts: commit, skip it with
`TODO(v2)`, flag it in progress.md — do NOT loop (owner directive). v1 loose ends (progress.md
§Open items 2–4) carry over: CI-green confirmation, browser checklist (T17 reworks that UI —
re-check after), redaction grep (folds into T18 acceptance). Sops remains owner-only (denied to
agents). **Keep progress.md current** — it is the handoff chain; update it BEFORE your context
runs low, and record any new gotcha you hit.

## House rules that bite (full list: progress.md §Gotchas)

- **YARN-only monorepo** (berry 4.14.1). node/yarn exist ONLY inside the devshell: run everything
  as `nix develop . --command bash -c '…'` from the repo root. NEVER npm/npx.
- Commits: `git commit --no-verify -m "…"` (the husky hook breaks agent shells); stage only what
  you touched; one commit per completed task; never push unless asked.
- The harness auto-formats every file you edit — never run formatters manually.
- `git add` NEW files before any `nix eval`/`nix build` (flakes read the git tree; untracked =
  invisible; a half-tracked tree caused a resume-site build failure once already). The
  homelab-api systemd module THROWS on a dirty tree at config-eval — commit before deploying.
- **No module-scoped mutable state in services** (owner directive): state lives in layer-owned
  Effect `Ref`s updated atomically (`Ref.modify`); `Mutex`/`Semaphore` when coordination is
  needed; time from `Clock.currentTimeMillis` (TestClock-testable), never `Date.now()`;
  configurable internals via `makeXService(…)` layer factories. Exemplar:
  `packages/homelab-services-node/src/layers/tailor-quota-service.ts`.
- **Never `NodeHttpClient.layerUndici`** — `undici` is not installed; it survives unit tests
  (services are stubbed) but crashes the rolldown bundle at server boot. Outbound HTTP = the
  global `FetchHttpClient` provided in `packages/homelab-server/src/main.ts`; services just
  `yield* HttpClient.HttpClient`.
- `scripts/stage-e2e-secrets.mjs` is idempotent (never overwrites): after changing key/role
  contracts, `rm packages/homelab-server/private/api-keys.json` (or `.env-serve-test`) and
  re-run so fixtures regenerate.
- `shared` barrel conventions: schemas namespaced (`ResumeContent.Schema.ContentState`,
  `Schemas.ResumeTailor.FitReport`), types+constants flat (`ResumeContent.ContentState` the TYPE,
  `ResumeContent.INITIAL_CONTENT_STATE`, `ResumeContent.ContentPatchBase64` — patch.ts is flat).
- e2e: devshell command `e2e [vitest-filters]` (wraps `scripts/e2e.sh`; own server on :54328;
  server logs in `.e2e-log-dump.txt`). Live-AI tests gated behind `RUN_TAILOR_LIVE` — they spend
  real money, ask the owner first.
- Any `yarn.lock` change ⇒ refresh `fetchYarnBerryDeps` hashes per the `nix-hashes` skill
  (homelab-api + homelab-ui + resume-site package.nix).

## Anti-loop protocol (learned the hard way — a 30-minute hang this session)

- NEVER re-run a hung or identically-failing long command more than twice.
- The `e2e` health-check loop spins FOREVER if the bundled server crashes at boot, printing
  nothing. On any hang: kill the process tree, then diagnose component-wise with short
  `timeout N …` runs — e.g. boot the server manually:
  `export HOMELAB_COMMIT_HASH=$(git rev-parse HEAD) && cd packages/homelab-server && ../../node_modules/.bin/dotenvx run -f .env-serve-test -- node ./dist/bundle/main.js`
  (rebuild the bundle first with `yarn workspace homelab-server build`), and read
  `.e2e-log-dump.txt`.
- If you hit the same error 3+ times or find yourself rewriting the same file repeatedly: STOP.
  Report to the owner/primary agent with the exact error, what you tried, and your hypothesis.
  Do not burn tokens retrying.

## Token-saving protocol (owner requirement)

- **Delegate to cheaper models** via the subagent `model` param:
  `qwencloud-token-plan-personal/qwen3.8-flash` for prescriptive, pattern-mirroring work (doc/skill
  checklists, mechanical edits); `qwencloud-token-plan-personal/qwen3.7-plus` for design-heavy
  code; the `explore` agent for read-only codebase research. Keep the primary model for synthesis,
  review, and cross-cutting decisions.
- Subagent prompts must be self-contained: exact file paths, which doc sections to read, scope
  boundaries (files they may/may not touch), validation commands, and a terse report format
  (<40 lines). Include: "no git mutations; no formatters; NEVER use the write tool on
  pre-existing files (edit only); yarn only via nix develop".
- Parallel subagents ONLY on disjoint file scopes. If two must touch a shared file (e.g. a barrel
  `index.ts`), serialize them, or instruct: "re-read the shared file immediately before editing —
  the edit tool's exact-match failure is your protection".
- If a subagent returns an anomalous completion (a generic greeting, a cancellation, or a report
  that doesn't match disk), AUDIT the working tree (`git status`, read key files) and re-dispatch
  a FRESH agent in "audit-and-complete" mode listing exactly what exists and what's missing.
  This recovered two interrupted tasks cleanly — don't resume possibly-corrupted sessions.
- Keep your own context lean: filter long outputs (`| tail`, `| grep`), read targeted line
  ranges, and prefer writing findings into progress.md over holding them in context.

## Validation gate (before every commit)

```sh
nix develop . --command bash -c 'yarn typecheck && yarn test && yarn lint'
# plus, when relevant:
#   yarn workspace resume build          (resume changes)
#   nix build .#homelab-api .#resume-site  (lockfile/nix changes; git-add new files first)
#   e2e src/resume                        (server/API changes)
```

## Key decisions cheat-sheet (full text: README §Confirmed decisions)

D1 auto-apply + preset snapshot (`Pre-tailor: <title> — <date>`, `onCollision:"suffix"`;
manual preset saves still default to `"overwrite"` = legacy behavior) — **OVERRIDDEN by v2 D13:
no auto-apply, no snapshots; review-then-apply from the Changes tab**. D2 blurb/aboutMe are
ContentState fields (defaults = the old hard-coded strings). D3 base64 JSON-Patch-only wire in
both directions, patches vs the frozen versioned `INITIAL_CONTENT_STATE` (`v1`), the
decode-to-ContentState schema sits in the HttpApi edge codecs (typed code never sees base64;
entries re-encode for storage). D4 no per-edit review — server merge+guards are authoritative,
the rendered resume is the review surface (partially overridden by v2 D13: the modal's Changes
tab is the pre-apply review surface). D5 two-model pipeline: extractive-only cleanup +
title/company extraction (cheap), constrained ID-addressed edits + fit report (main);
**OVERRIDDEN 2026-11-08: failures are 500s with cause chains, never degraded 200s**
(`meta.degraded` stays in the schema, always false). D6 redux + versioned
localStorage for now. D7 details view = plain centered Dialog over the settings sheet. D8 small
SOLID services; browser impls + tests in `packages/homelab-services-browser` (resume has no test
infra by design). D9 NO cache in v1 (`meta.cacheHit` always false; caching arrives as a
decorator layer with the doc-06 persistence work). Quota: 10/day/subject + 100/day global,
`TailorQuotaExceeded` → 400. Auth: `Resume_Tailor` resource URI (middleware authenticates;
handler calls `canCreate`; kanidm `resume.printing` group grants the role).

**v2 decisions (2026-11-09, README D10–D15 / doc 07):** D10 pipeline logic behind opaque
services (4 owner-named + `ResumeContentMergeService` + `HashingServiceSha256`; `Schemas.Tailoring`;
`Schema.fromJsonString` parsing). D11 validation is policy-driven — `TailorValidationPolicy` on
the wire, default = DISABLED; tag rule = `requireTagsGloballyAvailable`; delta guard allows
`add`. D12 raw nested error JSON (`TailorError.error` → `InternalServerError.error`;
`describeErrorChain` gone; format tests skipped `TODO(v2)`). D13 review-then-apply (Summary |
Changes tabs; confirm modal only on apply-from-Changes-tab and only when content ≠
`INITIAL_CONTENT_STATE` via `Equal.equals`; server-provided JsonPatch-native `changes`). D14
prompt v2 permissiveness (rewrite + add bullets; never fabricate language/framework/runtime
claims; `promptVersion`/`schemaVersion` → v2). D15 observability (trace_id in JSON log lines;
Grafana `tracesToLogsV2` custom query `{unit="homelab-api.service"} |= "$__traceID"`; `Redacted`
at source replaces manual key-pattern redaction).

Good luck — and update progress.md before your context fills. :salute:
