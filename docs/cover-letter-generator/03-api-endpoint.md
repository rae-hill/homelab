# 03 — API Endpoint: POST /resume/cover-letter

Covers CL-T6. Follows the `adding-endpoints` skill checklist end-to-end; the live precedents are
`resume/tailor.ts` (JSON request, authz chain, error mapping) and `resume/print.ts` (binary success
schema). Effect v4 options-object endpoint style throughout.

## A) Request schema — `homelab-services/src/schemas/resume-cover-letter.ts`

Registered in `schemas/index.ts` as `export * as ResumeCoverLetter from "./resume-cover-letter.js"`
(→ `Schemas.ResumeCoverLetter`). Mirrors `ResumeTailorRequest` (CL-D2):

```ts
export const ResumeCoverLetterRequest = Schema.Struct({
  listing: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200_000)), // same bounds as tailor
  content: ResumeContent.ContentPatchBase64,   // decoded to ContentState at the HttpApi EDGE
  baseVersion: Schema.String,
})
```

No response schema here — success is binary (below). No policy object in v1 (validation is
server-fixed, doc 01 §D); if per-request knobs ever appear they follow the `TailorValidationPolicy`
all-defaulted-fields pattern.

## B) Endpoint definition — `homelab-api/src/homelab/resume/cover-letter.ts`

```ts
export const URI = "Resume_CoverLetter" satisfies ResourceURIs.ResourceURIs
export type URI = typeof URI

const PdfMagicFilter = /* identical %PDF magic check as print.ts's PdfBytes — extract/share if tidy */

export const CoverLetterPdfBytes = Schema.Uint8Array.pipe(
  Schema.check(PdfMagicFilter),
  HttpApiSchema.asUint8Array({ contentType: "application/pdf" }),
)

export const ResumeCoverLetter = HttpApiEndpoint.post("cover-letter", "/resume/cover-letter", {
  payload: Schemas.ResumeCoverLetter.ResumeCoverLetterRequest,
  success: CoverLetterPdfBytes,
  error: [
    ApiErrors.AuthorizationError,
    ApiErrors.AuthenticationError,
    ApiErrors.BadRequest,
    ApiErrors.InternalServerError,
    ApiErrors.HttpApiEncodeError,
  ],
  headers: Schemas.Token.TokenHeaders,
}).middleware(Middleware.AuthMiddleware)

export type ResumeCoverLetterEndpoint = typeof ResumeCoverLetter
export type ResumeCoverLetterHandlerArgs = Types.Simplify<HttpApiEndpoint.Request<ResumeCoverLetter>>

declare module "homelab-services/resource-uris" {
  interface URIToParams { [URI]: ResumeCoverLetterHandlerArgs }
}
```

Register in `homelab/resume/index.ts`:
`ResumeApi = HttpApiGroup.make("resume").add(Print.ResumePrint).add(Tailor.ResumeTailor).add(CoverLetter.ResumeCoverLetter)`
+ `export * as CoverLetter from "./cover-letter.js"`. The typed client grows
`client.resume["cover-letter"]` automatically (frontend consumes it in doc 04).

Single-member binary success (unlike print's two-member union) — no content-type discrimination
needed; response is always `application/pdf`. **No `Content-Disposition`** — same stance as
`/resume/print`: the browser download is driven by the client-side anchor `download` attribute,
so the header would add nothing (the cert/mobile-config handlers' `appendPreResponseHandler`
pattern stays unused here).

## C) Authorization chain (CL-D4)

1. **Resource URI literal**: add `"Resume_CoverLetter"` to `ResourceURISchema` in
   `homelab-services/src/schemas/resource-uris.ts`.
2. **FGA matcher arm**: `homelab-services-node/src/layers/fine-grained-authorization-service.ts` —
   `"Resume_CoverLetter": () => Effect.succeed(true as const)` (same trivial arm as the other two
   Resume URIs; authz reduces to feature flag + role claim).
3. **Feature flag**: `canCreate` chains `hasFeatureFlag("Resume_CoverLetter", "create")` —
   augustus runs `FEATURE_FLAGS=*` (auto-enabled); praeconinus's explicit list omits `Resume_*`
   (stays dark — README OQ3 of the tailor harness stands).
4. **Role claim**: kanidm group `homelab.resume.coverletter` → `Resume_CoverLetter` claim mapping
   (doc 05). Guest identity: NO permissions (not guest-accessible).
5. **Test params record**: add `"Resume_CoverLetter": {}` to the
   `Record<ResourceURIs.ResourceURIs, unknown>` in `homelab-services-node/test/authorization-service.test.ts`
   (missing entry = type error — intentional drift gate).

## D) Handler — `homelab-server/src/handlers/resume/cover-letter.ts`

```ts
export const handleResumeCoverLetter = Effect.fn("handleResumeCoverLetter")(
  function*(args: Homelab.ResumeEndpoints.CoverLetter.ResumeCoverLetterHandlerArgs) {
    const identity = yield* Middleware.CurrentIdentity
    yield* Services.AuthorizationService.canCreate(identity, "Resume_CoverLetter", args)

    if (args.payload.baseVersion !== ResumeContent.CONTENT_DEFAULTS_VERSION) {
      return yield* new ApiErrors.BadRequest({
        message: `baseVersion mismatch: got ${args.payload.baseVersion}, expected ${ResumeContent.CONTENT_DEFAULTS_VERSION}`,
        reason: "resume-cover-letter-base-version-mismatch",
      })
    }

    // The handler names WHAT; the services own HOW (owner design directive):
    return yield* Services.CoverLetterService.generateCoverLetter(
      identity.identifier,
      args.payload.listing,
      args.payload.content,      // ContentState — decoded at the edge by ContentPatchBase64
      args.payload.baseVersion,
    )
  },
  Effect.tapError(Effect.logError),
  Effect.mapError(
    flow(
      Match.value,
      Match.tag("TailorQuotaExceeded", (e) => new ApiErrors.BadRequest({
        message: `AI quota exhausted; retry in ${e.retryAfterSeconds}s`,
        reason: "resume-cover-letter-quota-exceeded",
      })),
      Match.tag("CoverLetterError", (e) => new ApiErrors.InternalServerError({
        message: e.message, error: e.error,
      })),
      Match.orElse((_) => _),
    ),
  ),
)
```

(Exact error-constructor field names follow the live `tailor.ts` handler at implementation time —
D12's raw-nested-error shape is the contract.)

Register in `handlers/resume/index.ts`:
`.handle("tailor", handleResumeTailor).handle("cover-letter", handleResumeCoverLetter)`.

**`main.ts` wiring** — per doc 01 §A: provide `Shell.CoverLetter.Aggregate` and restructure the
tailor/cover-letter provides so `TailorQuotaServiceLive` + `ListingCleanupCacheServiceLive` are
ONE shared memoized instance under a single `Layer.provide` of the merged aggregates.

## E) Env additions

`homelab-server/src/env.ts` (`EnvLive`):

```ts
openRouterCoverLetterModel: Config.withDefault(
  Config.String("OPENROUTER_COVER_LETTER_MODEL"), "anthropic/claude-sonnet-5.5"),
typstAssetsDir: Config.option(Config.String("TYPST_ASSETS_DIR")),
```

+ `EnvDef` fields/accessors in `homelab-services/src/config/env.ts` (doc 01 §E) + BOTH testing
layers (`homelab-server/test-utils/testing-layer.ts`, `homelab-services-node/test-utils/testing-layer.ts`
— `TestConfigProvider` map AND `makeTestEnvWithFlags` defaults: `"test-cover-letter-model"`,
`Option.none()`; the render-gated suites override `TYPST_ASSETS_DIR` to the repo assets path).

## F) Unit tests — `homelab-server/test/handlers/resume/cover-letter.test.ts`

House idiom (`@effect/vitest`, `HandlerTestLayer`, `withIdentity`, args factory, descriptive
`assert` messages). Stub: `withCoverLetter()` — `Layer.succeed(CoverLetterService, { generateCoverLetter:
() => Effect.succeed(new Uint8Array([0x25, 0x50, 0x44, 0x46, ...])) })` (`%PDF`), merged over
`HandlerTestLayer`.

| Group         | Cases                                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| authorization | identity without `Resume_CoverLetter` → `AuthorizationError`; guest → `AuthorizationError`                 |
| validation    | stale `baseVersion` → `BadRequest` (reason `resume-cover-letter-base-version-mismatch`)                    |
| quota         | service fails `TailorQuotaExceeded{retryAfterSeconds}` → `BadRequest` (reason `resume-cover-letter-quota-exceeded`) |
| happy path    | authorized identity → `%PDF` bytes returned verbatim                                                        |
| error mapping | `CoverLetterError{message,error}` → `InternalServerError` with raw nested `error`                          |

## G) E2E tests — `homelab-e2e-tests/src/resume/cover-letter.test.ts`

Mirrors `tailor.test.ts` + `print.test.ts`: typed client `client.resume["cover-letter"]`,
`TEST_API_KEY` / `TEST_LIMITED_API_KEY` + DPoP (`getToken` → `createToken` with
`htu: ENDPOINT_URL, htm: "POST"`), fixture content via the shared `ContentPatchBase64` codec.

- **Always-run**: limited token → `AuthorizationError`; guest → `AuthorizationError`; malformed
  `content` (non-base64) → 400; stale `baseVersion` → 400 + reason.
- **Gated full pipeline** (`describeLive` on `RUN_COVER_LETTER_LIVE`, requires staged
  `OPENROUTER_API_KEY_FILE` + `TYPST_ASSETS_DIR`; 180–240 s timeout): real listing fixture →
  assert `%PDF` magic + byte length; optional artifact write via `COVER_LETTER_SAMPLE_PATH`
  (print.test.ts's `DOCX_SAMPLE_PATH` precedent). **Second call with the SAME listing** → assert
  server logs/metrics show the cleanup cache hit if observable from outside; otherwise the
  latency drop is the smoke signal (keep the assertion soft — exact-hash cache behavior is
  unit-tested in doc 01 §A).
- The `e2e` devshell command bootstraps fixtures via `scripts/stage-e2e-secrets.mjs` — add the
  two env vars there (doc 05). Full suite runs LAST (owner directive from the v2 plan stands).

## Checklist (skill-canonical)

- [ ] `schemas/resume-cover-letter.ts` + barrel registration
- [ ] Endpoint def + `resume/index.ts` registration (no new group — `resume` exists)
- [ ] `Resume_CoverLetter` in `schemas/resource-uris.ts` + FGA matcher arm + authz test record
- [ ] Handler + `handlers/resume/index.ts` registration + `main.ts` aggregate/shared-infra wiring
- [ ] Env: `OPENROUTER_COVER_LETTER_MODEL`, `TYPST_ASSETS_DIR` (+ both testing layers)
- [ ] Unit tests (authorization / validation / quota / happy / error-mapping)
- [ ] E2E tests (always-run + gated live)
- [ ] kanidm group + claim map (doc 05); guest permissions NOT touched
