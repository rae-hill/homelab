# Cover-Letter Generator — Progress Log

## 2026-11-18 — Planning

Plan of record written (README + docs 01–05) after owner Q&A settled CL-D1…CL-D12:
PDF-bytes-only response, listing+tailored-patch request, SailPoint-only server-side
exemplar with an append-and-bump seam, dedicated `Resume_CoverLetter` authz, everything
(template + signature + letterloom) committed to the repo. `repos/typst.ts` vendored at
v0.7.0 (commit `08a46ecfd`); vendored-repo tables updated in AGENTS.md + the
effect-services skill.

## 2026-11-19 — CL-T1: assets + dependency (commit `a1c60e98c`)

- `packages/homelab-services-node/assets/typst/` created: `templates/letter.typ`
  (letterloom layout adapted from the SailPoint letter), `images/signature.PNG`,
  `typst/packages/preview/letterloom/3.0.0/` (Unlicense — OQ1 resolved, vendored verbatim
  from the universe tarball).
- `yarn add @myriaddreamin/typst-ts-node-compiler@0.7.0`; rolldown externals extended
  (`"@myriaddreamin/typst-ts-node-compiler"`, `/^@myriaddreamin\//`); `missing-hashes.json`
  auto-populated.
- **Smoke render verified end-to-end** (native binding, offline letterloom via
  `XDG_DATA_HOME`, shadow-mapped letter data, signature image): 1-page PDF, `%PDF` magic,
  and the injected probes (`#import "evil"`, `*bold*`, `$x^2$`, `@cite`, `// comment`)
  rendered LITERAL — CL-D10 confirmed empirically; PDF visually inspected (layout matches
  the SailPoint letter; no tofu/overlaps).
- Template fixes found by the smoke test (plan corrections):
  - `#for` loop bodies must be MARKUP blocks (`[ ... ]`) — code-mode `{ #p }` is a syntax
    error ("the character `#` is not valid in code").
  - Shadow keys must be ABSOLUTE (workspace-joined) paths — relative keys silently miss
    (probe-verified). The renderer joins `workspace + relativePath` before `mapShadow`.
  - `mainFilePath` resolves against cwd, not workspace — pass an absolute path.
  - letterloom 3.0.0 PANICS on empty `to-address` (it is in the default `required-fields`);
    the template passes `required-fields` without `"to-address"` (letterloom treats
    removed fields as absent).
  - The letter data shadow lives at `<assets>/templates/letter.json` (template-relative
    `json("letter.json")` resolution).

## 2026-11-19 — CL-T2: shared cleanup cache + decorator (commit `fd83da1e3`)

- `ListingCleanupCacheService` (def + Ref-backed LRU/TTL impl, 100 entries / 72h,
  TestClock-friendly, infallible by contract).
- `CachedResumeListingExtractionServiceLive` — same-tag decorator over the raw stage-1
  impl (refactored into `makeResumeListingExtractionServiceImpl` for composition); key =
  `sha256(hygienized listing):promptVersion:schemaVersion:cleanupModel` (exact-hash only).
- `ExtractionResult.fromCache` added; `TailorMeta.cacheHit` now reflects stage-1 cache
  hits (D9 seam activated; semantics documented in the schema).
- `shell/tailor.ts`: quota + cache moved to RIn; `main.ts` gained `SharedAiInfra`
  (quota + cache provided ONCE over the merged Tailor+CoverLetter aggregates — single
  instances guaranteed).
- Tests: cache TTL/LRU/overwrite/expiry + decorator hit/miss/key-scheme/failure-passthrough
  (10 new). Suite green (750 services-node tests at the time).

## 2026-11-19 — CL-T3/T4/T5: cover-letter services (commit `27fda60e8`)

- `CoverLetterPromptConfigService` (`cl-v1-2026-11`/`cl-v1`): static system prefix
  (persona + hard rules), `<exemplar name="sailpoint-2026">` block from
  `layers/cover-letter/exemplars.ts` (append + bump version to extend — CL-D3), user
  message = job title/company + content digest + nonce-delimited cleaned listing.
- `buildContentDigest`: employers/roles/visible bullets/tags/skills — NOTE the plan's
  caveat was WRONG: `ContentState.experience` DOES carry company/roles, so letters can
  ground in real employment specifics (ids and hidden bullets excluded).
- `layers/cover-letter/validation.ts`: paragraph count/size bounds, subject bounds,
  zero-width/bidi/control scrub (a test caught the missing `\u202A-\u202E` range —
  bidi-override spoofing vector — now stripped); hard-fail, no trimming.
- `Schemas.CoverLetter.CoverLetterGeneration` (node-side strict wire schema) +
  prompt snapshot-style tests (no pattern/minLength/minItems/maxItems creep).
- `CoverLetterTemplateService`: pure — `buildLetter` → `{ mainFilePath:
  "templates/letter.typ", shadows: { "templates/letter.json": <utf8 JSON> } }`;
  `toName` = company ?? "Hiring Team"; JSON.stringify is the only escaping layer.
- `DocumentRenderingServiceTypst`: `TypstCompilerLike` injection (HtmlToDocxLike
  precedent); lazy singleton compiler created inside `Effect.try`; semaphore-serialized
  renders; EVERY throwing napi call in its own `Effect.try`/`Effect.sync`; flow =
  resetShadow → mapShadow(abs) → compile → warnings-to-log → diagnostics-to-typed-error →
  pdf(doc) → evictCache(10); unconfigured `TYPST_ASSETS_DIR` = typed CALL-TIME failure
  (feature-dark, server still boots — OpenRouter-key precedent).
- `CoverLetterService` orchestrator: hygiene → shared quota → cached stage 1 → stage 2
  generation (4k tokens, 60s, ONE decode retry with the decoder error appended as
  assistant+correction) → validation → template → render → `%PDF` magic check → meta-only
  logging. `CoverLetterError{message, error}` raw-nested-cause (D12); quota passes through.
- `shell/cover-letter.ts` aggregate (T15 nesting respected); `main.ts` merged provide.
- Tests: prompts (6), validation (7), template (3), typst renderer fakes (8), pipeline (8).

## 2026-11-19 — CL-T6: endpoint + authz (commit `b281cd147`)

- `Schemas.ResumeCoverLetter.ResumeCoverLetterRequest` (listing 1–200k, ContentPatchBase64,
  baseVersion); `CoverLetterPdfBytes` success schema (%PDF magic filter +
  `asUint8Array({contentType: "application/pdf"})`, print.ts precedent).
- `POST /resume/cover-letter` endpoint def + group registration; `Resume_CoverLetter`
  resource URI + FGA arm + authz-test record; BadRequest reasons
  `resume-cover-letter-{base-version-mismatch,quota-exceeded}`.
- Handler: canCreate → stale-baseVersion 400 → `Services.CoverLetterService.generateCoverLetter`
  accessor only (WHAT not HOW); TailorQuotaExceeded → 400, CoverLetterError → 500.
- 7 handler unit tests (incl. feature-flag-off). Full repo green at commit: lint 0 errors,
  typecheck clean, 835 services-node + 74 server tests.
- Bundle verified: rolldown build OK; `require("@myriaddreamin/typst-ts-node-compiler")`
  resolves from `dist/bundle` and compiles `%PDF` in the bundle context.

## 2026-11-19 — CL-T7: frontend (commit `cef60885a`, delegated + reviewed)

- `RESUME_COVER_LETTER_ROLE` in shared; `state/homelab/cover-letter.ts`
  (requestCoverLetter via typed HttpApiClient + Bearer id_token, downloadCoverLetter
  blob→anchor with `cover-letter-<slug>-<date>.pdf`); `useCanCoverLetter`;
  `useDownloadCoverLetter` (busy+elapsed timer, stale-baseVersion guard,
  ContentPatchBase64 decode, reason-specific toasts).
- `ActionsTab` (teal full-width button, `Working… Ns`, orange role hint, disabled unless
  success|degraded with a contentPatch) wired as the third details-modal tab.
- Review fixes: kanidm group name in the constant's JSDoc (`homelab.resume.coverletter`).

## 2026-11-19 — CL-T8: nix + e2e (commit `3e62a1981` + follow-up, delegated + reviewed)

- package.nix: sharp patchelf loop SCOPED (it stamped sharp's RPATH onto every `.node` —
  latent hazard fixed), @myriaddreamin closure copy + glibc/libstdc++ RPATH + fail-closed
  build-time typst smoke compile, assets → `$out/lib/typst-assets`; yarn hashes refreshed
  (api + ui) via the nix-hashes procedure; `nix build .#homelab-api` green.
- systemd `typstAssetsDir` option (null default = dark; augustus opts in — reading the
  flake package directly because the pre-existing `services.homelab-api.pkg` option is a
  latent `mkPackageOption` misuse that throws when forced); `Resume_CoverLetter` in both
  permission enums; kanidm group + rae membership + oidc scope/claim maps; praeconinus
  verified dark (no TYPST env, no flag).
- e2e: cover-letter.test.ts (authz/guest/stale/raw-400 + `RUN_COVER_LETTER_LIVE`-gated
  success, cache double-call, `COVER_LETTER_SAMPLE_PATH` artifact); staged TEST_API_KEY
  gained `Resume_CoverLetter`.
- **XDG_DATA_HOME removed from the design** (was CL-D9's mechanism): a vitest run with
  XDG_DATA_HOME pointed at the git-tracked assets dir collected `vitest/` + `mimeapps.list`
  pollution — the hazard is structural to pointing XDG at a shared tree. Since letterloom
  is self-contained, the template now imports it **by path**
  (`../vendor/letterloom-3.0.0/src/lib.typ`), assets moved `typst/packages/...` →
  `vendor/letterloom-3.0.0/`, and NO XDG env exists anywhere (flake/e2e/systemd/tests).
  Devshell also keeps TYPST_ASSETS_DIR out (`${self}` = stale read-only store snapshot;
  e2e.sh + the live test resolve the live worktree path themselves).

## 2026-11-19 — CL-T9: verification (full-stack, zero OpenRouter spend)

- **Live-render unit test** (`document-rendering-service-typst-live.test.ts`): REAL native
  compiler + committed assets → PDF with `%PDF` magic; real diagnostics surfaced for a
  missing template. Runs everywhere (assets are committed).
- **Stubbed full-stack e2e**: local stub OpenRouter (branches on
  `response_format.json_schema.name`) + `OPENROUTER_BASE_URL` override +
  `RUN_COVER_LETTER_LIVE=1`: handler → auth (DPoP) → quota → cached cleanup → generation →
  validation → REAL typst render → `%PDF` through the typed client. 6/6 cover-letter e2e
  pass; server log shows `Stage 1 (cleanup) cache hit` with trace_id + promptVersion
  annotations; spans confirmed: `handleResumeCoverLetter`,
  `CoverLetterService.generateCoverLetter`, `DocumentRenderingServiceTypst.renderPdf`.
- **Rendered PDF visually verified** (twice — smoke + full pipeline): letterloom layout,
  sender block, date, recipient from stage-1 extraction, bold "Regarding the …" subject,
  signature image, footer; ALL markup probes (`#import`, `*bold*`, `$x^2$`, `@cite`)
  render LITERAL (CL-D10 proven end-to-end).
- **Production closure render**: the nix-built `$out` bundle + `$out/lib/typst-assets`
  renders a PDF with zero env beyond the workspace (no XDG) — deployment-equivalent proof.
- **Full e2e suite**: 118 passed, 3 skipped (money-gated live blocks only).
- Full repo: lint 0 errors, typecheck clean, 837 services-node + 74 server unit tests,
  shellcheck + nixfmt green.
- Remaining before deploy: owner runs with a REAL OpenRouter key
  (`RUN_COVER_LETTER_LIVE=1` against openrouter.ai) for model-quality review, kanidm
  group deploy + re-login for the claim, and the manual tailor→Actions→download pass.
