# Remote Printing Feature — Implementation Plan

Phased plan for server-side resume PDF printing. Work top-to-bottom; each phase ends in a
committable state. Update [`progress.md`](./progress.md) after every phase/session.

**Effect v4 note:** the monorepo was just upgraded to Effect 4 (`repos/effect` @ 4.1.2).
The `adding-endpoints` skill still shows v3 style (`.addSuccess`/`.addError` chains,
`@effect/platform` imports). Current v4 style — verified against
`packages/homelab-api/src/homelab/` — is:

```ts
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api"

export const MyEndpoint = HttpApiEndpoint.post("my-endpoint", "/group/my-endpoint", {
  payload: PayloadSchema,
  query: QuerySchema,
  success: SuccessSchema,
  error: [ApiErrors.AuthorizationError /* … */],
  headers: Schemas.Token.TokenHeaders,
}).middleware(Middleware.AuthMiddleware)
```

Update the skill doc when touching endpoints (Phase 4).

---

## Phase 0 — Planning docs ✅

This directory: `README.md` (vision/architecture/decisions), `plan.md` (this file),
`progress.md` (handoff log).

---

## Phase 1 — `shared` package (rename + schema extraction + OIDC services)

### 1a. Rename `homelab-shared` → `shared`

- `git mv packages/homelab-shared packages/shared`
- `packages/shared/package.json`: `"name": "shared"`, `repository.directory`,
  description; **drop unused node deps** `@effect/platform-node`, `bufferutil`,
  `utf-8-validate` (verified unused in `src/`) → browser-safe. Keep `effect`, `type-fest`.
- Update workspace deps `"homelab-shared": "workspace:*"` → `"shared": "workspace:*"` in:
  `homelab-services`, `homelab-services-node`, `homelab-api`, `homelab-server`
  (package.json).
- Update imports `from "homelab-shared"` → `from "shared"` in:
  - `homelab-services-node/src/layers/{oidc-authentication-service,dpop-token-validator-service,nonce-service,token-issuer-service,claim-check-service}.ts`
  - `homelab-services/src/schemas/OAuth.ts`, `homelab-services/src/utils/fix-jwks-for-jose.ts`
  - `homelab-services-node/test-utils/dpop.ts`
  - (re-grep to catch stragglers, incl. `Constants.BASE_KEY` etc.)
- `yarn install` to refresh `yarn.lock` → **`nix-hashes` skill**: update
  `fetchYarnBerryDeps` hashes in `nix-config/modules/features/homelab-api/package.nix`
  and `homelab-ui/package.nix`.
- Validate: `yarn lint`, `yarn typecheck`, `yarn test`.

### 1b. Extract print-config schemas from resume → `shared`

Move from `packages/resume/src/state/print-config/` to `packages/shared/src/print-config/`:

- `schema.ts` — all Effect schemas (`PersistedPrintConfig`, `PrintConfigState`,
  `Toggles`, `SectionLayout`, `HeaderDescription`, content schemas, …).
- `content-types.ts` — content type derivations (schema-derived types only).
- New `codec.ts` — the wire codecs from resume's `persistence.ts` minus localStorage:
  - `PersistedJson = Schema.fromJsonString(PersistedPrintConfig)`
  - `PersistedBase64 = Schema.StringFromBase64.pipe(Schema.decodeTo(PersistedJson))`
  - `decodeBase64Config` / `encodeBase64Config` (Result-based; no console logging in
    shared — return `Result`, let callers log)
  - `ConfigBase64String` — a `Schema.String` refinement that **validates** the blob
    decodes to a `PersistedPrintConfig` but keeps the wire type `string` (used by the API
    payload so the handler can forward the original base64 to the resume URL).
- Barrel: `packages/shared/src/index.ts` → `export * as PrintConfig from "./print-config/index.js"`
  (respect the package's `effect.generateExports`/`generateIndex` codegen config — run
  `yarn workspace shared codegen` if present, else follow existing barrel style).
- Types derive from schemas (`Schema.Schema.Type<typeof …>`); move the derived-type
  block from resume `types.ts` into shared as well.

**Stays in resume** (site-specific data/UI): `content-defaults.ts`
(`initialContentState` — real resume content), `initialPrintConfigState`, redux
`slice.ts`/`store.ts`/`provider.tsx`/`hooks.ts`, localStorage persistence wrapper
(re-pointed at `shared` codecs), all components.

- resume `package.json`: add `"shared": "workspace:*"` dep; update imports in
  `src/state/print-config/{types,persistence,hooks}.ts`, `content-types` consumers.
- Unit tests in `packages/shared/test/` (vitest): base64 round-trip, invalid base64 →
  `Result.Failure`, `ConfigBase64String` refinement rejects garbage.

### 1c. Reusable Effect OIDC services in `shared`

**Resolved by research (session 1 — see progress.md for the full findings):**

- **No DPoP needed in the browser.** `AuthenticationService`
  (`homelab-services-node/src/layers/authentication-service.ts`) only enforces DPoP for
  **local-issuer** tokens (the API-key `/oauth/token` path used by automation/e2e).
  Kanidm-issued tokens (remote issuer, JWKS from `KANIDM_OPENID_PROVIDER_URL`) skip DPoP
  entirely — `Authorization: Bearer <token>` is sufficient.
- **The bearer token must be the kanidm `id_token`** (not the access token): the server's
  `jwtVerify` requires `aud: "homelab"` + `email` + `roles` claims, which kanidm puts in
  the id_token (claim-map roles land there). This mirrors homelab-frontend's existing
  (quirky but load-bearing) behavior — `WifiPage.tsx` sends `t.id_token`.
- homelab-frontend hand-rolls PKCE + code exchange in Effect (`src/lib/auth/*`) with no
  library. For `shared` we use **`oidc-client-ts`** (user preference) wrapped in Effect
  services — it handles PKCE, state, nonce, storage, and expiry.

Modules under `packages/shared/src/oidc/` — **exposed via a `./oidc` subpath export**
(`"exports": { ".": …, "./oidc": "./src/oidc/index.ts" }`) so node-side consumers of
`shared` never pull the browser-only `oidc-client-ts` into their bundles:

- `config.ts` — Effect `Schema.Struct` for client config: `authority` (kanidm
  client-scoped discovery base, e.g. `https://idm.plato-splunk.media/oauth2/openid/homelab`),
  `clientId` (`"homelab"`), `redirectUri`, `scope` (default `"openid profile email"`),
  `postLogoutRedirectUri?`.
- `auth-service.ts` — `AuthService` (`Context.Service` v4 style): `login()` (redirect),
  `handleRedirectCallback()`, `getUser(): Option<OidcUser>` (session-storage backed,
  expiry-aware), `signout()`. `OidcUser` = `{ idToken, accessToken, profile: { email?,
  name?, roles? } , expiresAt }` mapped from oidc-client-ts `User`. Errors:
  `Data.TaggedError("AuthError")`. Impl wraps `UserManager` (`WebStorageStateStore` +
  `sessionStorage`); all promise calls via `Effect.tryPromise`.
- `reachability.ts` — `checkReachable(apiBaseUrl): Effect<boolean>`: unauthenticated
  `GET {api}/status/health` via fetch-in-Effect; **any** HTTP response (even 4xx) proves
  tailscale reachability; only network errors mean unreachable. (`/status/health` is
  guest-accessible: `GuestIdentity` carries `Status_Health.view`.)

Typed API calls (`HttpApiClient` over `homelab-api`) live in **resume**, not shared —
`shared` must not depend on `homelab-api` (cycle: homelab-api → homelab-services →
shared). resume gains `homelab-api` as a workspace dep; vite tree-shakes the definitions
(homelab-frontend proves this bundling works; homelab-services is browser-safe — jose v6
is Web-Crypto based, no `node:` imports in the definition package).

---

## Phase 2 — resume: network check + OIDC login

### 2a. Redux `homelab` slice (network + auth state)

New `packages/resume/src/state/homelab/`:

- `slice.ts` — state: `{ reachable: boolean | null /* null = unknown */, checking:
  boolean, auth: { status: "signedOut" | "signInPending" | "signedIn", email?,
  roles? }, error? }`; reducers for each transition.
- `store.ts` — add `homelab` reducer to `makeStore()` (single app store now holds
  `printConfig` + `homelab`).
- Effects (not promises) drive state: on app mount (root route loader or provider
  effect), run `checkReachable` from `shared` via `Effect.runPromise` (or a managed
  runtime — see `src/constants/effects.constants.ts` for existing patterns), dispatch
  results. Login/callback/logout likewise dispatch into the slice.
- Hooks: `useHomelabReachable()`, `useHomelabAuth()`, `useLogin()`, `useLogout()`.

### 2b. UI

- **Login button**: shown only when `reachable === true` and signed out (user's spec).
  Placement: `Header` (right side, next to color-mode toggle) — hidden in print
  (`@media print { display: none }`). When signed in: show avatar/email + logout, and
  gate the download FAB (Phase 6).
- **Callback route**: `src/routes/oauth-callback.tsx` (path `/oauth/callback`, matching
  the kanidm redirect URI) — completes the PKCE flow via shared `AuthService`, then
  navigates back to `/`.

### 2c. Build-time env

Vite bakes env at build time → add to `packages/resume/.env.production` (public values
only; nothing secret):

- `VITE_HOMELAB_API_URL=https://homelab-api.plato-splunk.media`
- `VITE_KANIDM_OIDC_URL` (kanidm OAuth2 discovery base — same value the server uses via
  `KANIDM_OPENID_PROVIDER_URL`)
- `VITE_OIDC_CLIENT_ID=homelab` (existing kanidm client; see 2d)
- CI: `.github/workflows/resume-deploy{,-manual}.yml` — values are public, can be
  committed in `.env.production`; no secrets needed.

### 2d. Server-side prerequisites (nix + kanidm) — “adopt homelab server callbacks”

- `nix-config/modules/features/homelab-api/oidc.nix`:
  - `callbackPath`: add absolute literal `"https://resume.rae-hill.dev/oauth/callback"`
    (absolute entries are used verbatim, like the localhost one). Add dev URL
    `http://localhost:5173/oauth/callback` (vite dev port) for local testing.
  - `scopeMaps`: add `"resume.printing" = [ "openid" "profile" "email" ];` so group
    members can complete the flow.
  - `claimMaps.roles.valuesByGroup`: add `"resume.printing" = [ "Resume_Print" ];`.
- **Kanidm group provisioning** (resolved): `nix-config/modules/features/kanidm/service.nix`
  — add `"resume.printing" = { };` to `provision.groups` and list it under
  `provision.persons.jacob.groups` (+ `rae` — the resume's owner; confirm with user).
- **CORS** (resolved): `homelab-server/src/api.ts` uses `HttpRouter.cors()` with **no
  options** → Effect v4 defaults to `access-control-allow-origin: *`, reflecting
  requested headers. Cross-origin calls from `resume.rae-hill.dev` with a Bearer header
  **already work — no CORS change strictly required**. Optional hardening: env-driven
  `allowedOrigins` allowlist (default stays wildcard when unset so unknown consumers —
  dashboards, mobileconfig downloads — don't break). Decision: keep wildcard, document;
  revisit if the user wants tightening.
- Auth middleware already ingests the `roles` claim (`Constants.JWT_ROLES_KEY`) into
  `OIDCIdentity` permissions — no server code change needed for role plumbing. Server
  requires `aud: "homelab"`, claims `email` + `roles` → the browser must send the kanidm
  **id_token** as Bearer (see 1c).

### 2e. Verification

- Manual (user): tailscale on → site shows login → kanidm redirect → back to site
  signed in; tailscale off → no login UI, no errors beyond the reachability flag.

---

## Phase 3 — resume: `importPrintSettings` query param

- `src/routes/__root.tsx`: extend `RootSearch` with
  `importPrintSettings?: string` and `theme?: "light" | "dark"` and `printMode?: boolean`
  (validate/whitelist in `validateSearch` — plain strings; TanStack Router keeps them).
- Apply-once effect (root component or print-config provider): when
  `importPrintSettings` present → `PrintConfig.decodeBase64Config(value)` (shared
  codec) → on success `dispatch(applyConfig(state))`; on failure log + ignore (never
  render the raw value). **No HTML is ever produced from the param** — it flows
  base64 → `Schema` decode → redux state → React text nodes only, so React's default
  escaping covers XSS; do not use `dangerouslySetInnerHTML` anywhere near this.
- After applying, strip the param from the URL (`navigate({ search: prev => ({ …prev,
  importPrintSettings: undefined }), replace: true })`) so refresh/repeat navigation
  doesn't re-apply stale config.
- `theme` param: force color mode (`next-themes` `setTheme(theme)`) before first paint
  where possible; `theme` absent → user's stored preference.
- **Readiness signal for puppeteer**: after config applied + theme set + fonts/images
  settled, mark `document.documentElement.dataset.printReady = "true"` (attribute
  selector `[data-print-ready]` is what puppeteer waits for). Set it even when the
  param is absent (so plain navigations are printable too). Gate on Redux state so it
  fires after `applyConfig`.
- Unit-testable helper: `parsePrintSettingsSearch(search): Result<PersistedConfig,
  SchemaError>` in shared or resume `util.ts`.

---

## Phase 4 — homelab-api: `POST /resume/print`

New group `resume` (prefix baked into paths, per current style):

- `packages/homelab-services/src/schemas/resource-uris.ts`: add `"Resume_Print"` to
  `ResourceURISchema` (feature flags/permission strings derive automatically).
- `packages/homelab-services/src/schemas/resume.ts` (new):
  - `ResumePrintRequest = Schema.Struct({ config: PrintConfig.ConfigBase64String })`
    (schema from `shared`; homelab-services gains a `shared` dep — it already has one).
  - `ResumePrintQuery = Schema.Struct({ theme: Schema.Literals(["light", "dark"]) })`
    (default `"light"`? — decide: make it optional with default via
    `Schemas.Optionals.OptionalWithDefault` if that's the house pattern).
  - Success: PDF bytes — `HttpApiSchema.Uint8Array()` equivalent in v4 (check
    `effect/http-api` exports; binary → `application/octet-stream`. FE downloads via
    blob so exact content-type is cosmetic; optionally set `application/pdf` via v4
    encoding options if available).
- `packages/homelab-api/src/homelab/resume/print.ts`:

  ```ts
  export const URI = "Resume_Print" satisfies ResourceURIs.ResourceURIs
  export const ResumePrint = HttpApiEndpoint.post("print", "/resume/print", {
    payload: Schemas.Resume.ResumePrintRequest,
    query: Schemas.Resume.ResumePrintQuery,
    success: <Uint8Array schema>,
    error: [ApiErrors.AuthorizationError, ApiErrors.AuthenticationError,
            ApiErrors.BadRequest, ApiErrors.InternalServerError,
            ApiErrors.HttpApiEncodeError],
    headers: Schemas.Token.TokenHeaders,
  }).middleware(Middleware.AuthMiddleware)
  ```

  Plus `declare module "homelab-services/resource-uris"` URIToParams augmentation.
- `packages/homelab-api/src/homelab/resume/index.ts`:
  `HttpApiGroup.make("resume").add(Print.ResumePrint)`; register `ResumeApi` +
  `export * as ResumeEndpoints` in `src/homelab/index.ts`.
- Update the **`adding-endpoints` skill** (`.opencode/skills/adding-endpoints/SKILL.md`)
  to Effect v4 syntax while here (user asked to refresh stale docs).

---

## Phase 5 — homelab-server: puppeteer implementation

### 5a. Service definition (`homelab-services`)

- `src/services/pdf-print-service.ts`:

  ```ts
  export const PdfPrintServiceId = "homelab-api/services/printing/PdfPrintService"
  export class PdfPrintError extends Data.TaggedError("PdfPrintError")<{…}> {}
  export interface PdfPrintServiceDef {
    readonly printResume: (configBase64: string, theme: "light" | "dark") =>
      Effect.Effect<Uint8Array, PdfPrintError>
  }
  export class PdfPrintService extends Context.Tag(PdfPrintServiceId)<…> {}
  ```

- `src/config/env.ts`: add `chromeExecutable: string` and
  `resumeSiteUrl: URL` (default `https://resume.rae-hill.dev`; override for tests).
- `homelab-server/src/env.ts`: `chromeExecutable: Config.string("CHROME_EXECUTABLE")`
  (optional? — no: required when the resume group is enabled; consider
  `Config.option` + service-layer failure so other deployments (praeconinus) don't
  break. **Decision: `Config.option`**, and `PdfPrintServiceLive` fails with a clear
  `PdfPrintError` when unset.)
- Update **both** testing layers (`homelab-server/test-utils/testing-layer.ts`,
  `homelab-services-node/test-utils/testing-layer.ts`) with the new env keys.

### 5b. Implementation (`homelab-services-node`)

- Add `puppeteer-core` dep (no chrome download; matches nixpkgs `puppeteer-cli`
  pattern) → `yarn.lock` → **nix-hashes skill** again.
- `src/layers/pdf-print-service.ts`:
  - `Layer.effect(PdfPrintService, …)` yielding `Config.Env` (chromeExecutable,
    resumeSiteUrl).
  - `printResume`: build URL
    `${resumeSiteUrl}/?importPrintSettings=${encodeURIComponent(b64)}&theme=${theme}`;
    `puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox",
    "--disable-dev-shm-usage", "--disable-gpu"] })` (args required under the hardened
    systemd unit — see Phase 7); `page.goto(url, { waitUntil: "networkidle2" })`;
    `page.waitForSelector("html[data-print-ready]", { timeout })`;
    `page.pdf({ printBackground: true, preferCSSPageSize: true, format: "letter" })`;
    close browser in `Effect.acquireUseRelease` (guaranteed cleanup); wrap failures
    into `PdfPrintError`.
  - Per-request browser launch (simple, isolated); note pooling as future option.
- Shell aggregate: `src/shell/printing.ts` → `export const Aggregate =
  PdfPrintServiceLive` (deps wired per house rules); export from `shell/index.ts`.
- Handler: `homelab-server/src/handlers/resume/print.ts` —
  `Middleware.CurrentIdentity` → `AuthorizationService.canCreate(identity,
  "Resume_Print", args)` → `PdfPrintService.printResume(args.payload.config,
  args.urlParams.theme)` → map `PdfPrintError` → `ApiErrors.InternalServerError`.
  Register in `handlers/resume/index.ts` (`HttpApiBuilder.group(Homelab.HomelabApi,
  "resume", …)`) and `api.ts`; provide `Shell.Printing.Aggregate` in `main.ts`.
- Fine-grained authz matcher: add `"Resume_Print"` case in
  `homelab-services-node/src/layers/fine-grained-authorization-service.ts` (roles-based
  check suffices — the permission set already carries `Resume_Print` from the claim
  map; matcher returns `Effect.succeed(true)` and the base permission check gates it).
  Update `homelab-services-node/test/authorization-service.test.ts` params record.
- **CORS** (if not done in Phase 2): add resume origin allowlist here.

### 5c. Unit tests (`homelab-server/test/handlers/resume/print.test.ts`)

- Authorization: identity without `Resume_Print` → `AuthorizationError` (house assert
  message style).
- Happy path: mocked `PdfPrintService` layer (`Layer.succeed`) returns fake bytes;
  assert handler returns them.
- Error mapping: mocked service fails with `PdfPrintError` → `InternalServerError`.
- Service-level unit tests (`homelab-services-node/test/`): URL construction, option
  handling when `chromeExecutable` unset (no real chrome in CI).

---

## Phase 6 — resume: download FAB

- New `src/components/download-fab.tsx`: FAB stacked **above** the settings FAB
  (bottom-left; settings FAB is `bottom=[8,8,14] left=[10,10,16]` size `xl` — offset
  the download FAB by its height + gap, e.g. `bottom=[24,24,30]`), `@media print {
  display: none }`, tooltip like the settings FAB.
- Visible only when `auth.status === "signedIn"` (redux selector); optionally also
  require `reachable`.
- onClick → Effect (via shared `HomelabClient` service): `POST /resume/print` with
  `{ config: encodeBase64Config(state) }` and `theme` from `useColorMode()`; headers
  `authorization` + `dpop` per the auth flow; response bytes → `new Blob([bytes], {
  type: "application/pdf" })` → `URL.createObjectURL` → temporary `<a download
  ="resume-<date>.pdf">` click → revoke. Loading spinner state on the FAB; error
  surface (toast or inline tooltip state).
- Uses the redux print-config state at click time (current edited config).

> **De-risk (Buffer in the browser):** `homelab-services/src/schemas/Buffer.ts`
> (`StringFromUint8Array`, used by `TokenHeaders` on every endpoint) references Node's
> global `Buffer` in its **decode** direction (`Buffer.from(bytes).toString("utf-8")`).
> The references are lazy (inside arrows / an `instanceof` guard), so importing is safe;
> the client only **encodes** headers (`Uint8Array.from(str)` — no Buffer). This is why
> homelab-frontend can bundle `homelab-api` today. If resume's vite build still trips on
> `Buffer`/`global` (some transitive import evaluates it eagerly), add to
> `packages/resume/vite.config.ts`: `define: { global: "globalThis" }` and a Buffer
> polyfill, or import only the `resume` group's client. Verify with `yarn workspace
> resume build` early in Phase 6.

---

## Phase 7 — NixOS infrastructure

- `nix-config/modules/features/homelab-api/systemd-service.nix`:
  - sops template `homelab-api-env`: add `CHROME_EXECUTABLE=${cfg.chromePackage}/bin/…`
    (non-secret; could also be plain `Environment=`). Add option
    `services.homelab-api.chromePackage` (default `pkgs.google-chrome`).
  - Add `cfg.chromePackage` to the unit's `path` (runtime deps: fonts, libs).
  - **Hardening relaxations for chrome** (currently blocks it):
    - `RestrictAddressFamilies = [ ]` → `[ "AF_UNIX" "AF_INET" "AF_INET6" ]` (chrome
      needs loopback/egress; server itself only needs localhost but the unit-wide empty
      list forbids all).
    - `NoNewPrivileges=true` + `RestrictNamespaces=true` break chrome's sandboxes →
      launch with `--no-sandbox` (already in 5b args).
    - `PrivateDevices=true` → no `/dev/shm` → `--disable-dev-shm-usage` (already in
      5b args).
    - `ProtectSystem="strict"` + `PrivateTmp=true` are fine (chrome uses tmpdir);
      consider `ReadWritePaths` for a chrome profile dir if needed — prefer
      `--user-data-dir` under `/tmp` (PrivateTmp gives an isolated one).
    - `MemoryDenyWriteExecute` is NOT set (good — chrome JIT needs W^X exceptions).
    - `ProcSubset = "pid"` + `ProtectProc = "invisible"` may break chrome's zygote →
      test; relax to `ProtectProc = "default"` / `ProcSubset = "all"` if needed.
  - augustus egress to `resume.rae-hill.dev` (public internet) — verify augustus has
    outbound HTTPS (it does; caddy/ACME etc.).
- Kanidm changes from Phase 2d land here if not done earlier (oidc.nix callback +
  claim map + group provisioning).
- Feature flags: augustus defaults `["*"]` → `Resume_Print` enabled automatically.
  **praeconinus** (restricted): do NOT add `Resume_Print`; verify the restricted
  deployment degrades gracefully (feature-flag/authz rejection, not a crash) — the
  group exists in the shared API definition but must stay dark there. Also verify
  praeconinus's env doesn't require `CHROME_EXECUTABLE` (why 5a uses `Config.option`).
- Validate: `nix flake check` / `nix build .#checks.x86_64-linux.shellcheck` etc. per
  `validation` skill; `git add` new .nix files before eval.
- Consider `nix-services` skill conventions (failure-notifs) — homelab-api unit already
  has notification wiring; no new unit needed.

---

## Phase 8 — Tests

- **e2e** (`packages/homelab-e2e-tests/src/resume/print.test.ts`): follow house e2e
  template — `it.live`, `E2ETestLayer`, `getToken(TEST_API_KEY)` + `createToken`
  (DPoP) for success; `TEST_LIMITED_API_KEY` → `AuthorizationError`; build a valid
  config blob using **`shared`'s `encodeBase64Config`** over a fixture (this is the
  payoff of the shared schemas); assert response starts with `%PDF` magic bytes.
  Invalid base64/garbage config → schema `BadRequest`. **Do not start the server —
  the user runs e2e in watch mode.**
- Unit tests: Phase 1b (shared codecs), 5c (handler + service).
- Full validation sweep: `yarn lint --fix && yarn lint && yarn typecheck && yarn test`,
  `nix build .#checks.x86_64-linux.shellcheck`.

---

## Cross-cutting concerns

- **Effect 4 everywhere**: no raw promises for effectful code in FE/BE; `Effect.gen` /
  `Effect.fn("name")` per `repos/effect/AGENTS.md`; `Schema.TaggedError` /
  `Data.TaggedError` for typed errors; redux thunks should wrap Effect runtimes, not
  `async` functions, where practical.
- **Skill/doc staleness**: update `.opencode/skills/adding-endpoints/SKILL.md` (v4
  endpoint syntax) and any other stale docs encountered (user explicitly requested).
- **Commits**: `git commit --no-verify -m "…"` per phase (or logical sub-phase); never
  push.
- **Context handoff**: if context fills, summarize state into `progress.md` (what's
  done, what's next, gotchas, open questions) before handing off.
