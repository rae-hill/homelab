# 03 — API Endpoint: `POST /resume/tailor`

> **Override note (2026-11-08):** pipeline failures are 500s with the nested cause chain
> rendered into the error message (doc 02 banner, `cdc7b6db8`) — the live service no longer
> produces degraded results, so "degraded is a 200" text below is historical. The
> degraded-passthrough handler test remains as a stub-level check that the handler passes
> service successes through unmodified.

## Purpose & Scope

Task **T3** (endpoint def + schemas + handler + authz chain + unit tests) and the e2e half of **T10**.
Contract _shapes_ belong to doc 01 (`ResumeTailorRequest/Response`, `FitReport`, `TailorMeta` in
`packages/homelab-services`, on `ContentPatchBase64` from `packages/shared`); the AI engine to doc 02
(`TailorService`). This doc owns `homelab-api` / `homelab-server` / authz / test wiring, mirroring
`.opencode/skills/adding-endpoints/SKILL.md`; out of scope: service impl (doc 02), nix/kanidm/env
(doc 05), the tab (doc 04). Wire contract (README.md:45–63):

```
POST /resume/tailor        (resource URI Resume_Tailor; Bearer auth)
payload: { listing: string, content: ContentPatchBase64, baseVersion: string }
success: { jobTitle, company, content: ContentPatchBase64, baseVersion, fit: FitReport, meta: TailorMeta }
```

## Verified Current State (the print chain, read from source 2026-11-07)

1. **URI literal** — `packages/homelab-services/src/schemas/resource-uris.ts:3–15`, `"Resume_Print"`
   at 14.
2. **Endpoint def** — `packages/homelab-api/src/homelab/resume/print.ts:6–37`: `URI` const
   `satisfies ResourceURIs.ResourceURIs` (6); Effect v4 options-object `HttpApiEndpoint.post("print",
   "/resume/print", { payload, query, success, error: [AuthorizationError, AuthenticationError,
   BadRequest, InternalServerError, HttpApiEncodeError], headers: Schemas.Token.TokenHeaders
   }).middleware(Middleware.AuthMiddleware)` (13–25; full path is the 2nd arg — no group `.prefix()`);
   `ResumePrintHandlerArgs = Types.Simplify<HttpApiEndpoint.Request<...>>` (29–31); `declare module
   "homelab-services/resource-uris"` augmentation `[URI]: ResumePrintHandlerArgs` (33–37).
3. **Registration** — `resume/index.ts:4–7` (`.add(Print.ResumePrint)` + `export * as Print`);
   `homelab/index.ts:9–15,20` (`.add(ResumeApi)`, `export * as ResumeEndpoints`).
4. **Handler** — `packages/homelab-server/src/handlers/resume/print.ts:11–29`: `Effect.fn`;
   `Middleware.CurrentIdentity` (13); `Services.AuthorizationService.canCreate(identity,
   "Resume_Print", args)` (14) — **authz is explicit; `AuthMiddleware` only authenticates** (house
   gotcha); service call (16); pipe args `Effect.tapError(Effect.logError)` +
   `Effect.mapError(flow(Match.value, Match.tag("PdfPrintError", err => new ApiErrors.InternalServerError(
   { message: err.message })), Match.orElse((_) => _)))` (18–28).
5. **Handler group** — `handlers/resume/index.ts:6–12`: `HttpApiBuilder.group(Homelab.HomelabApi,
   "resume", (h) => h.handle("print", handleResumePrint))`.
6. **Server wiring** — `src/api.ts:13–23`: `HttpApiBuilder.layer(Homelab.HomelabApi, { openapiPath:
   "/openapi.json" })` with `ResumeApiLive` provided (17) → **api.ts/main.ts need no change for the
   endpoint itself**; `main.ts:16–18` merges `HttpApiSwagger.layer(Homelab.HomelabApi)` so OpenAPI/
   Swagger entries come free. They move only via doc 02's new `Shell` aggregate (skill Step 3).
7. **URIToParams / exhaustive matcher** — `packages/homelab-services/src/resource-uris.ts:6–17`:
   `URIToParams` is the declare-module target; `URIMatchers` demands a key per `DeclaredURIs` ⇒ a
   missing FGA arm is a **type error**. `homelab-services-node/src/layers/
   fine-grained-authorization-service.ts:33–119` passes the matcher object to `ResourceURIs.match(...)`;
   `"Resume_Print": () => Effect.succeed(true as const)` at **118** (copy this arm; note `true as const`).
8. **Authorization chain** — `layers/authorization-service.ts:28–34`: `canCreate` = `canView(...)`
   **then** create-flag / create-permission / FGA-refine. `authorize` (52–61) passes on
   `identity.hasPermission(resource) || hasPermission(resource + "." + op)`; `hasFeatureFlag` (74–83)
   fails with `AuthorizationError.fromFeatureFlag`. Flags (`layers/feature-flag-service.ts:20–34`):
   enabled iff the set contains `"*"`, `<resource>.enabled`, or `<resource>.<op>.enabled`.
9. **Defaults record** — `homelab-services-node/test/authorization-service.test.ts:430–452`: exhaustive
   `defaults: Record<ResourceURIs.ResourceURIs, unknown>` (`"Resume_Print": {}` at 451) — a new URI
   without an entry breaks typecheck. `TestLayer(flags)` (406–414) composes the real chain.
10. **Unit-test template** — `packages/homelab-server/test/handlers/resume/print.test.ts`:
    `withIdentity` = `Layer.succeed(Middleware.CurrentIdentity, ...)` (8); stub `withPdfPrint` (11–17) —
    **HandlerTestLayer (test-utils/testing-layer.ts:137–150) provides neither PdfPrintService nor any
    future TailorService**; its `TestAuthorizationService` (50–59) is the _real_ node chain with
    `FEATURE_FLAGS: "*"` (38), so unit tests exercise real flag+role+FGA logic. Args factory carries
    `request/endpoint/group/headers/payload/query` (22–29); `authorizedIdentity` = `OIDCIdentity(email,
    HashSet.fromIterable(["Resume_Print"]))` (31–34).
11. **E2E template** — `packages/homelab-e2e-tests/src/resume/print.test.ts`: `describeWithChrome`
    env-gate (23); fixture encoded with the **shared** codec (33–107); DPoP flow `getToken(TEST_API_KEY)`
    → `createToken({ htu, htm: "POST", nonce, accessToken })` (111–135); guest (`headers: {}`) asserts
    **AuthorizationError**, not 401 (137–151); raw `HttpClient.post` for server-side 400 (184–200);
    success timeout `120_000` (236). `makeApiClient` = `HttpApiClient.make(Homelab.HomelabApi, ...)`
    (test-utils/api-client.ts:9–13) — **no codegen**: `client.resume.print` derives from `HomelabApi`
    at type level ⇒ `client.resume.tailor` appears identically; the browser pattern
    (`packages/resume/src/state/homelab/print.ts:65–73`, Bearer id_token, no DPoP for remote issuers)
    is what doc 04 clones.
12. **E2E API-key contract** — `scripts/stage-e2e-secrets.mjs:67–95`: staged `api-keys.json` gives
    `test-api-key-1` `Resume_Print` (81); `test-limited-api-key-1` only `Config_Certs`+`OAuth_Token`
    (87); comment 61–65: this list must match the e2e assertions. `FEATURE_FLAGS=*` there (163) and in
    `.env-serve-test:6`, `.env-local:6`, node testing-layer.ts:18.
13. **Nix (doc 05 owns; verified for cross-ref)** — `systemd-service.nix:81–85` `cfg.featureFlags`
    defaults `["*"]`; 204–205 emit `FEATURE_FLAGS=<f>.enabled,...`; 105–119 API-key permissions is a
    **closed `lib.types.enum`** (drift point, prod-only). `oidc.nix:53–75` claim map
    `resume.printing → ["Resume_Print"]`; praeconinus (`_private/praeconinus/programs.nix:23–31`)
    enumerates flags and omits `Resume_Print` — endpoint dark there.
14. **Schema/error homes** — `schemas/resume.ts` holds print's schemas; barrel `schemas/index.ts:26`
    exports `Resume`. Doc 01 (source of truth for shapes) places tailor schemas in a **new sibling
    `schemas/resume-tailor.ts`** + new barrel entry `export * as ResumeTailor` (doc 01 §E) — the barrel
    **is** touched, contradicting the planning brief's "resume.ts, no barrel change"; doc 01 wins.
    `ApiErrors` = `errors/http-errors.ts`; `TokenHeaders` = `schemas/token.ts:15–19` (all optional).
    **Gotcha:** `BadRequest` requires `reason` from the closed literal `BadRequestReasonsSchema`
    (`errors/http-errors.ts:37–53`) — new reason literal needed (file 3).

## Design

### Endpoint def — `packages/homelab-api/src/homelab/resume/tailor.ts` (NEW)

```typescript
import type { Types } from "effect"
import { HttpApiEndpoint } from "effect/http-api"
import { ApiErrors, Middleware, type ResourceURIs, Schemas } from "homelab-services"

export const URI = "Resume_Tailor" satisfies ResourceURIs.ResourceURIs
export type URI = typeof URI

export const ResumeTailor = HttpApiEndpoint.post("tailor", "/resume/tailor", {
  payload: Schemas.ResumeTailor.ResumeTailorRequest, // shapes: doc 01
  success: Schemas.ResumeTailor.ResumeTailorResponse, // JSON (unlike print's PDF bytes)
  error: [
    ApiErrors.AuthorizationError,
    ApiErrors.AuthenticationError,
    ApiErrors.BadRequest,
    ApiErrors.InternalServerError,
    ApiErrors.HttpApiEncodeError,
  ],
  headers: Schemas.Token.TokenHeaders,
}).middleware(Middleware.AuthMiddleware)

export type ResumeTailorEndpoint = typeof ResumeTailor
export type ResumeTailorHandlerArgs = Types.Simplify<HttpApiEndpoint.Request<ResumeTailorEndpoint>>

declare module "homelab-services/resource-uris" {
  interface URIToParams {
    [URI]: ResumeTailorHandlerArgs
  }
}
```

No `query` (print has `theme`; tailor needs none) — args factory omits `query`; endpoint name
`"tailor"` ⇒ `client.resume.tailor` (State 11).

### Patch codec ⇒ who decodes (D3 consequence)

`ContentPatchBase64` is a `decodeTo` codec (base64 → patch ops → apply-to-defaults → `ContentState`;
doc 01 §D) that D3 puts **directly in the endpoint definitions**. So `args.payload.content` is already
a **`ContentState`** at handler entry (invalid base64/patch/apply fails at HttpApi request-decode ⇒
4xx, print-e2e:184–200 style), and the response's `content` is auto-encoded back to a base64 patch vs
the frozen defaults by the success codec (the shared codec's encode side diffs against
`INITIAL_CONTENT_STATE` — doc 01 §D; nobody hand-encodes). Nit for doc 02: its comment says the _handler_ decodes — it happens at the HttpApi edge.

**Listing bounds:** doc 01 §E drafts bare `Schema.String`; recommend `minLength(1)` +
`maxLength(200_000)` abuse bounds only — **doc 02 truncates server-side** (~20k middle-cut,
initial-plan §11), so the schema max stays well above it. Violations ⇒ request-decode 400s.

### Handler — `packages/homelab-server/src/handlers/resume/tailor.ts` (NEW)

```typescript
export const handleResumeTailor = Effect.fn("handleResumeTailor")(
  function*(args: Homelab.ResumeEndpoints.Tailor.ResumeTailorHandlerArgs) {
    const identity = yield* Middleware.CurrentIdentity
    yield* Services.AuthorizationService.canCreate(identity, "Resume_Tailor", args)

    const { listing, content, baseVersion } = args.payload
    if (baseVersion !== CONTENT_DEFAULTS_VERSION) { // from shared, doc 01
      return yield* new ApiErrors.BadRequest({
        message:
          `Stale baseVersion '${baseVersion}'; server is on '${CONTENT_DEFAULTS_VERSION}'. Reload to refresh defaults.`,
        reason: "resume-tailor-base-version-mismatch",
      })
    }
    // TailorService.tailorResume (doc 02: subject, listing, ContentState, baseVersion) validates/merges
    // and degrades internally (meta.degraded=true + unchanged content) — degraded is a 200, never a 500.
    // subject = caller's stable identifier from `identity` (verify accessor in identity.ts) for quota.
    return yield* Services.TailorService.tailorResume(
      subjectOf(identity),
      listing,
      content,
      baseVersion,
    )
  },
  Effect.tapError(Effect.logError),
  Effect.mapError(
    flow(
      Match.value,
      Match.tag(
        "TailorQuotaExceeded", // doc 02 §A/§H — 4xx, not 500: user-facing spend cap
        (err) =>
          new ApiErrors.BadRequest({
            message: `Daily tailor quota exceeded; retry in ~${err.retryAfterSeconds}s.`,
            reason: "resume-tailor-quota-exceeded",
          }),
      ),
      Match.tag(
        "TailorError",
        (err) => new ApiErrors.InternalServerError({ message: err.message }),
      ),
      Match.orElse((_) => _),
    ),
  ),
)
```

Mirrors print.ts:11–29 including its `Match.tag` shape (only `message`, no `error:` field). Declared
errors (`AuthorizationError`, `BadRequest`) pass through `Match.orElse` untouched; only `TailorError`
(doc 02: provider dead, unparseable output after retry, patch-apply throw) ⇒ `InternalServerError`.
**Timeouts**: the ~60s × 2-stage budget lives **in the service layer** (doc 02, per-stage
`Effect.timeout`); the handler adds none. No proxy concern — vhost is a plain
`reverse_proxy 127.0.0.1:35427` with no in-flight timeout (README.md:85 corrected fact; §14 worry moot).

### Authz chain (what actually gates the endpoint)

`AuthMiddleware` authenticates only (auth-middleware.ts:102 hands the token Option to
`AuthenticationService`, which yields `GuestIdentity` when absent — authentication-service.ts:45; hence
guest e2e expects 403, not 401). `canCreate` then runs `authorization-service.ts:21–34`:

1. **Feature flag** `Resume_Tailor` — view step first (`canView`), then create; off ⇒
   `AuthorizationError.fromFeatureFlag` (403). Names (feature-flag-service.ts:20–34): `*`,
   `Resume_Tailor.enabled`, `Resume_Tailor.<op>.enabled`. dev/test/e2e all run `FEATURE_FLAGS=*`
   (State 10/12) — invisible there. Prod: augustus defaults `["*"]`; gating = add `"Resume_Tailor"` to
   `cfg.featureFlags`, rendered as `Resume_Tailor.enabled` by the unit template
   (systemd-service.nix:204–205). praeconinus omits it → dark (README OQ 3; doc 05).
2. **Role check**: `Resume_Tailor` or `Resume_Tailor.<op>` in the identity's set
   (authorization-service.ts:58); roles arrive via the kanidm `claimMaps.roles` claim (oidc.nix:53–75;
   new group vs. reusing `resume.printing` = README OQ 5 — doc 05 owns).
3. **FGA refine**: arm beside line 118; v1 unconditional `Effect.succeed(true as const)`. The arm
   receives full handler args via `URIToParams` — a typed seam for later refinement (e.g. quotas).
4. **Guests**: `GuestIdentity.permissions` (identity.ts:52–63) gets **no** `Resume_Tailor.*` — not
   guest-accessible.

## File-by-File Changes

Re-verified against source + docs 01/02. **ADDED** = omitted by the brief yet required; **NO-OP** = brief expected a change, none needed:

1. `homelab-services/src/schemas/resource-uris.ts` — append `"Resume_Tailor"` after line 14.
   Type-gates the FGA matcher, defaults record, `AuthorizationError.resource`.
2. `homelab-services/src/schemas/resume-tailor.ts` + `schemas/index.ts` barrel — **owned by doc 01**
   (`ResumeTailorRequest/Response`, `FitReport`, `TailorMeta`); brief said `resume.ts` with no barrel —
   doc 01 §E says sibling file + `export * as ResumeTailor`; **doc 01 wins**. T3 consumes
   `Schemas.ResumeTailor.*`.
3. `homelab-services/src/errors/http-errors.ts` — **ADDED**: `BadRequestReasonsSchema` (37–41) gains
   `"resume-tailor-base-version-mismatch"` and `"resume-tailor-quota-exceeded"` (`reason` is
   required; the list is closed).
4. `homelab-api/src/homelab/resume/tailor.ts` — **NEW** (sketch above). Without the declare-module
   augmentation the FGA matcher object fails to compile (resource-uris.ts:12–14).
5. `homelab-api/src/homelab/resume/index.ts` — `.add(Tailor.ResumeTailor)` + `export * as Tailor`;
   `homelab/index.ts` **NO-OP**.
6. `homelab-server/src/handlers/resume/tailor.ts` — **NEW** (sketch above).
7. `homelab-server/src/handlers/resume/index.ts` — `.handle("tailor", handleResumeTailor)`;
   `api.ts`/`main.ts` **NO-OP** for the endpoint (group already wired, api.ts:17) — they move only with
   doc 02's `Shell` aggregate providing `TailorServiceLive`.
8. `homelab-services-node/src/layers/fine-grained-authorization-service.ts` —
   `"Resume_Tailor": () => Effect.succeed(true as const)` beside 118 (exhaustiveness).
9. `homelab-services-node/test/authorization-service.test.ts` — `"Resume_Tailor": {}` in `defaults`
   (430–452) (exhaustive Record).
10. `packages/homelab-server/test/handlers/resume/tailor.test.ts` — **NEW** (Test Plan).
11. `packages/homelab-e2e-tests/src/resume/tailor.test.ts` — **NEW** (Test Plan).
12. `scripts/stage-e2e-secrets.mjs` — **ADDED**: `"Resume_Tailor"` in `test-api-key-1` permissions
    (after 81) — this staged file, not the nix enum, grants e2e keys their roles (contract comment
    61–65). Prod analog (nix enum 105–119 + kanidm claim) = doc 05.

## Task Breakdown

**T3 — endpoint + authz + handler + unit tests** (needs doc 01 T1/T2: `ContentPatchBase64`,
`CONTENT_DEFAULTS_VERSION`, `resume-tailor.ts`; doc 02's `TailorService` tag+def+`TailorError` must
exist, even stubbed). Files 1, 3–10. Done when:

- `yarn typecheck` green — the type chain _is_ the wiring test: missing URI literal, FGA arm, defaults
  entry, or augmentation each breaks compilation.
- `yarn test` + `yarn lint` green (new tests + services-node authz suite + regressions).
- `client.resume.tailor` resolves — proven by the e2e file compiling even while its live test skips.
- Endpoint appears at `/openapi.json` + swagger UI (free; verified api.ts:13, main.ts:16–18).

**T10-e2e** — files 11–12 after T6+T9; done when `e2e src/resume` passes (live test skips in CI).

## Test Plan

### Unit — `packages/homelab-server/test/handlers/resume/tailor.test.ts` (mirror print.test.ts)

Scaffolding: `withIdentity` (8); `withTailor(impl?)` = `Layer.succeed(
Services.TailorService.TailorService, { tailorResume: () => Effect.succeed(sampleTailorResponse),
...impl })` (withPdfPrint pattern 11–17); `tailorArgs(overrides?)` = `{ request, endpoint, group,
headers }` (first four `{} as any`) + `payload: { listing, content: <ContentState>, baseVersion:
CONTENT_DEFAULTS_VERSION }` — **no `query`**; `content` is typed `ContentState` because the codec
decodes at the edge. `authorizedIdentity` = `OIDCIdentity("user@example.com",
HashSet.fromIterable(["Resume_Tailor"]))` — the bare URI satisfies both view and create role steps
(authorization-service.ts:58). Provide via `Layer.mergeAll(withIdentity, HandlerTestLayer, withTailor)`;
`sampleTailorResponse` = fully populated doc-01 response (minimal `FitReport`, full `TailorMeta`).

- `describe("authorization")`:
  - empty-roles identity ⇒ `Effect.flip` ⇒ `assert` on `instanceof ApiErrors.AuthorizationError` with
    the mandatory descriptive message (skill 373–379).
  - `new Identity.GuestIdentity()` ⇒ AuthorizationError.
  - flag-off ⇒ AuthorizationError. HandlerTestLayer always has `*`, so override the AuthorizationService
    key: `flagOffAuth = Layers.AuthorizationService.AuthorizationServiceLive.pipe(Layer.provideMerge(
    Layers.FineGrainedAuthorizationService.FineGrainedAuthorizationServiceLive), Layer.provideMerge(
    TestSerialNumberConfig), Layer.succeed(FeatureFlagService, { enabled: () => false }))` (mirrors
    services-node `TestLayer`, authorization-service.test.ts:406–414), then per skill line 382:
    `Layer.provideMerge(HandlerTestLayer, flagOffAuth)`.
- `describe("happy path")`:
  - returns the stub's response verbatim (deep-equal).
  - forwards `subject`/`listing`/`content`/`baseVersion` positionally to `tailorResume` (calls-recorder,
    print.test.ts 86–107).
  - **degraded passthrough**: stub returns `meta.degraded: true` + unchanged content ⇒ still a 200 with
    the same value (D4; never a 500).
  - **quota**: stub fails `TailorQuotaExceeded` ⇒ flip ⇒ `instanceof ApiErrors.BadRequest` with
    `reason === "resume-tailor-quota-exceeded"` (doc 02 §H).
- `describe("error cases")`:
  - `tailorArgs({ baseVersion: "v0-bogus" })` ⇒ flip ⇒ `instanceof ApiErrors.BadRequest` and
    `reason === "resume-tailor-base-version-mismatch"`.
  - stub fails `new Services.TailorService.TailorError({ message: ..., error: null })` ⇒ flip ⇒
    `instanceof ApiErrors.InternalServerError` (print.test.ts 111–130).

### E2E — `packages/homelab-e2e-tests/src/resume/tailor.test.ts`

`ENDPOINT_URL` = `BASE_URL` + `/resume/tailor` (print e2e line 25); fixture content = a minimal
`ContentState` — the typed client encodes it to base64 patch automatically (anti-drift payoff as in
print.test.ts:27–107).

- `describe("authorization")`: `getToken(TEST_LIMITED_API_KEY)` + DPoP `htm: "POST"` ⇒
  AuthorizationError; `headers: {}` (guest) ⇒ AuthorizationError — print e2e 111–151.
- `describe("validation")`: stale `baseVersion` with `TEST_API_KEY` ⇒ 400 + mismatch `reason` (handler
  path); raw `HttpClient.post` with a garbage base64 `content` string ⇒ 400 (edge-decode path — print
  e2e 184–200 idiom; raw because the typed client refuses non-`ContentState` blobs, note 175–181).
- `describe("success — live AI")`: env-gated like `describeWithChrome` (23) but on an explicit opt-in —
  `process.env.RUN_TAILOR_LIVE ? describe : describe.skip` — so CI never spends provider money; dev
  enables once doc 05 puts the OpenRouter key in `.env-serve-test`. Full
  `client.resume.tailor({ payload, headers: { dpop, authorization } })`; assert `jobTitle` non-empty,
  response `content` round-trips through the client codec, `fit`/`meta` present; explicit `180_000`
  timeout (2×60s stages + margin; print used 120_000).

**Backlog (owner request, 2026-11-07):** Cypress-based browser e2e for the Tailoring-tab flow
(paste → submit → auto-apply → details modal → recall) is a planned LATER addition, once cypress
tooling exists in the repo (none today) — not part of v1/T10. v1 browser-side coverage = the
API-level vitest e2e in this file + manual UI checks (doc 04).

## Open Questions

1. `RUN_TAILOR_LIVE` as the e2e opt-in name vs. probing the OpenRouter key server-side — doc 02/05.
2. baseVersion check placement: handler `BadRequest` (this doc) vs. folded into doc 01's payload schema
   — handler keeps the message actionable; belt-and-braces if both.
3. ~~`minLength(1)`/`maxLength(200_000)` need doc 01 adoption~~ — **RESOLVED**: doc 01 §E adopted the
   bounds on `listing`.
4. ~~Doc 02 wording nit (handler-vs-edge decode, §Design)~~ — **RESOLVED**: doc 02 §A/§B now state the
   edge-decode + typed-`ContentState` service contract explicitly.

## Cross-References

- **README.md** — wire contract 45–63; D3/D4; proxy fact 85; chain facts 89–97; OQ 3/5.
- **Doc 01** — `ContentPatchBase64`, `CONTENT_DEFAULTS_VERSION`, request/response shapes in
  `schemas/resume-tailor.ts` (consumed, never redefined). **Doc 02** — `TailorService` tag+def
  (`tailorResume`) + `TailorError`, hygiene/truncation, per-stage timeouts, degraded contract, `Shell`
  aggregate → `main.ts`.
- **Doc 04** — client consumption via `HttpApiClient.make(Homelab.HomelabApi, ...)`, mirroring
  `packages/resume/src/state/homelab/print.ts:65–73`.
- **Doc 05** — kanidm role claim (`oidc.nix:53–75`), prod `cfg.featureFlags`
  (`systemd-service.nix:81–85, 204–205`), permissions-enum drift (105–119), OpenRouter secret/env.
- **`.opencode/skills/adding-endpoints/SKILL.md`** — canonical 5-step checklist; this file list maps to
  it plus the drifts marked **ADDED** (http-errors reason literal, stage-e2e-secrets permissions).
