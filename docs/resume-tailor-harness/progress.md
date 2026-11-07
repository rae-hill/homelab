# Resume Tailor — Progress & Session Handoffs

Living document. Update after every work session (and before context gets tight) so any agent can
pick up cold. Convention follows `docs/remote-printing-feature/progress.md`.

**Cold-start instructions for the next agent:** read [`README.md`](./README.md) (decisions D1–D9,
wire contract, task graph) → the section doc for your task → the sources it cites. House rules:
`AGENTS.md` + `.opencode/skills/` (`validation`, `adding-endpoints`, `effect-services`, `frontend`
does NOT apply to `packages/resume` — it's React/RTK/Chakra, not the SolidJS homelab-frontend).

## Status

| Task | Doc | Scope one-liner                                                                            | Status                                                                                         | Commit         |
| ---- | --- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | -------------- |
| T1   | 01  | Extract content schemas+defaults to `shared`; extend `ContentState` (blurb/aboutMe)        | **done** (barrel is `export * as Schema`, so schemas are `ResumeContent.Schema.X`; types flat) | `62d248e97683` |
| T2   | 01  | `ContentPatchBase64` codec (decode-to-state) + wire schemas in homelab-services            | **in progress**                                                                                | —              |
| T3   | 03  | `POST /resume/tailor` endpoint + handler + `Resume_Tailor` authz chain + unit tests        | planned                                                                                        | —              |
| T4   | 02  | `TailorService`/`OpenRouterClientService`/`TailorQuotaService` tags + env + layer skeleton | planned                                                                                        | —              |
| T5   | 02  | Cleanup stage + prompts + model-facing wire schemas                                        | planned                                                                                        | —              |
| T6   | 02  | Validation pipeline + merge + quota + evals                                                | planned                                                                                        | —              |
| T7   | 04  | NEW `homelab-services-browser` pkg + entry-store/preset services + thin tailor slice       | planned                                                                                        | —              |
| T8   | 04  | Tailoring tab + details modal + auto-apply flow + blurb/aboutMe wiring                     | planned                                                                                        | —              |
| T9   | 05  | sops key + env template + kanidm claim + enum drift fix + local dev                        | **partial done** (§§2,4,5,7 committed; §1 owner sops edit + §3 augustus wiring deferred)       | `f5f02a6fd9b9` |
| T10  | 03  | e2e tests (vitest; live-AI gated)                                                          | planned                                                                                        | —              |
| T11+ | 06  | Stretch: postgres persistence, category bases, cache decorator (NOT v1, D9)                | deferred                                                                                       | —              |

Waves (README task graph): **A:** T1→T2→T3. **B (parallel after T2):** T7 and T4→T5→T6.
**C:** T8 (after T3+T7), T9 any time, T10 last. Every task ends with
`yarn lint && yarn typecheck && yarn test` green (+ `nix build .#checks.x86_64-linux.shellcheck`
if shell text changed; `git add` new `.nix` files BEFORE any `nix eval`/`nix build`).

## Human-only / owner decisions (blocking flags)

- **Sops encryption (T9.1):** agents must NOT run `sops` (denied). Owner runs
  `sops edit nix-config/secrets/augustus.yaml` and adds `homelab_api_openrouter_key` (doc 05 §1).
- **Model slugs (README OQ1, blocks T5 go-live not T5 code):** owner picks stage-1/stage-2 slugs;
  env-overridable, pin dated slugs.
- **Kanidm group (README OQ5):** doc 05 §5 recommends Option A (reuse `resume.printing` claim map).
- **Deploy:** `systemd-service.nix` throws on a dirty git tree — commit before deploying.

## Gotchas learned so far (carry forward)

- `yarn.lock` changes (T7 adds the `homelab-services-browser` workspace) ⇒ refresh
  `fetchYarnBerryDeps` hashes per the `nix-hashes` skill (`homelab-api` + `homelab-ui` package.nix).
- Permissions enums are duplicated in `secret-provisioner.nix`/`systemd-service.nix` and already
  drifted (`Resume_Print` missing in the former) — T9.2 fixes both + adds `Resume_Tailor`.
- `featureFlags` option REPLACES (augustus keeps `["*"]`); praeconinus stays dark (owner-confirmed).
- `JsonPatch.apply` throws; `toDifferJsonPatch.diff` takes TYPED values (encodes internally);
  `decodeTo` getters bridge `From.Type ↔ To.Encoded` (doc 01 §D has the verified chain).
- Chakra v3 Dialog: `placement` is center/top/bottom only; details view is a plain centered modal (D7).
- **shared barrel convention (verified T1):** `packages/shared/src/index.ts` exports namespaces
  (`export * as ResumeContent`), and each module's `index.ts` re-exports TYPES flat but SCHEMAS
  under `export * as Schema`. So from a consumer: types are `ResumeContent.ContentState`,
  schemas/values are `ResumeContent.Schema.ContentState` and `ResumeContent.INITIAL_CONTENT_STATE`
  (constants are values re-exported flat). Doc 01's sketches wrote flat `ResumeContent.ContentState`
  for the SCHEMA — that is the TYPE; use `.Schema.` for the schema object. Same for `Schemas.OptionalWithDefault`.
- Formatters run automatically via the harness — never manually; commits use `--no-verify`.

## Session log

### 2026-11-07 — planning session (complete)

- Explored repo via subagents (resume app, api/server chain, shared/services, nix/sops); corrected
  the external agent's initial plan against reality (README §"Corrected repo facts").
- Owner decisions captured: D1 auto-apply+preset snapshot; D2 extend ContentState; D3 base64
  JSON-Patch-only wire with decode-to-state schema (owner's design); D4 no review step; D5 two-model
  pipeline; D6 local state now; D7 plain details modal; D8 small SOLID services +
  `homelab-services-browser` (tests there; resume gets no test infra); D9 NO cache in v1 (lands with
  persistence work). Cypress UI e2e = backlog (doc 03).
- Wrote docs 01–06 via cheaper-model subagents (qwen3.7-plus ×3, qwen3.8-flash ×3), reviewed
  end-to-end, fixed cross-doc inconsistencies (codec sketch, replace-only invariant → merge delta,
  TailorMeta nullable stages + listingHash, quota restored, edge-decode semantics).
- Committed planning docs: `7ea36e9d1ab7`.
- **Next:** Wave A — T1 (doc 01) via subagent, review, validate, commit; then T2; then T3.
  T9 nix-only parts run in parallel with T1 (augustus sops/programs wiring DEFERRED until the
  owner adds the `homelab_api_openrouter_key` ENC value — declaring it before would break eval).

### 2026-11-07 — implementation wave A

- **T1 done** (`62d248e97683`, qwen3.7-plus subagent, reviewed): `shared/src/resume-content/`
  (schemas + `INITIAL_CONTENT_STATE` + `CONTENT_DEFAULTS_VERSION="v1"` + blurb/aboutMe via
  `OptionalWithDefault` moved to `shared/src/schemas/`), compat re-exports in print-config,
  resume `content-defaults.ts` deleted, tests incl. old-blob compat + print purity. Full tree
  green (typecheck, 676 tests, lint 0 errors) — re-verified by the coordinating agent.
  Deviation: module barrel namespaces schemas (`ResumeContent.Schema.*`) per the print-config
  convention — see Gotchas. Components still render hard-coded constants until T8.
- **T9 partial** (`f5f02a6fd9b9`, qwen3.8-flash subagent, reviewed): nix option + env-template
  conditional, kanidm claim (Option A), permissions-enum drift fixed (both enums now
  Resume_Print + Resume_Tailor), `.env-local` + `stage-e2e-secrets.mjs` dummy key. Deferred:
  owner `sops edit` (§1) then the 2-line augustus wiring (§3, exact lines in the T9 report).
- **Next:** T2 (patch codec + wire schemas) → T3 (endpoint) → wave B (T4–T6 ∥ T7) → T8 → T10.
