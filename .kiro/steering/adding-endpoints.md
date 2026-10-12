# Adding API Endpoints

This document describes the end-to-end process for adding a new endpoint to the homelab-api project.

## Overview

Adding an endpoint involves 5 steps:

1. Add schemas (if needed) in `homelab-services`
2. Define the endpoint in `homelab-api`
3. Implement the handler in `homelab-server`
4. Write a unit test in `homelab-server/test`
5. Write an e2e test in `homelab-e2e-tests`

---

## Step 0: Determine the Group

Before creating files, decide which group the endpoint belongs to. Existing groups:

| Group           | Prefix           | Purpose                               |
| --------------- | ---------------- | ------------------------------------- |
| `status`        | `/status`        | Health checks and system status       |
| `oauth`         | `/oauth`         | Token issuance, claim checks          |
| `mobile-config` | `/mobile-config` | Apple mobileconfig profile generation |
| `cert`          | `/cert`          | Raw certificate downloads (DER/CRT)   |
| `well-known`    | `/.well-known`   | Standard well-known metadata          |

Only create a new group if the endpoint doesn't logically fit any existing group.

---

## Step 1: Schemas (`homelab-services`)

If the endpoint needs request or response schemas, add them to:

```
packages/homelab-services/src/schemas/<schema-name>.ts
```

Then register in the schemas barrel:

```typescript
// packages/homelab-services/src/schemas/index.ts
export * as MySchema from "./<schema-name>.js"
```

Schema files use Effect `Schema`:

```typescript
import { Schema } from "effect"

export const MyResponseSchema = Schema.Struct({
  foo: Schema.String,
  bar: Schema.Number,
})

export type MyResponse = typeof MyResponseSchema.Type
```

Schemas are consumed in endpoint definitions as `Schemas.MySchema.MyResponseSchema`.

---

## Step 2: API Definition (`homelab-api`)

Create the endpoint definition file:

```
packages/homelab-api/src/homelab/<group>/<endpoint>.ts
```

### Endpoint File Template

```typescript
import { HttpApiEndpoint } from "@effect/platform"
import type { Types } from "effect"
import { ApiErrors, Schemas } from "homelab-services"

export const MyEndpoint = HttpApiEndpoint.get("my-endpoint")`/my-endpoint`
  .addSuccess(Schemas.MySchema.MyResponseSchema)
  .addError(ApiErrors.AuthorizationError)
  .setHeaders(Schemas.Token.TokenHeaders)

export type MyEndpoint = typeof MyEndpoint

export type MyEndpointHandlerArgs = Types.Simplify<
  HttpApiEndpoint.HttpApiEndpoint.Request<MyEndpoint>
>
```

### Endpoint API

| Method                  | Purpose                              |
| ----------------------- | ------------------------------------ |
| `HttpApiEndpoint.get`   | GET endpoint                         |
| `HttpApiEndpoint.post`  | POST endpoint                        |
| `HttpApiEndpoint.put`   | PUT endpoint                         |
| `.addSuccess(schema)`   | Set the success response schema      |
| `.addError(errorClass)` | Add a typed error response           |
| `.setHeaders(schema)`   | Define expected request headers      |
| `.setPayload(schema)`   | Set request body/query params schema |
| `.middleware(mw)`       | Attach endpoint-level middleware     |

### Path Parameters

Use `HttpApiSchema.param` for path params in template literal paths:

```typescript
import { HttpApiSchema } from "@effect/platform"
import { Schema } from "effect"

export const IdParam = HttpApiSchema.param("id", Schema.String)

export const MyEndpoint = HttpApiEndpoint.get(
  "my-endpoint",
)`/my-endpoint/${IdParam}`
```

### Register in Group Index

Add the endpoint to the group's `index.ts`:

```typescript
// packages/homelab-api/src/homelab/<group>/index.ts
import { HttpApiGroup } from "@effect/platform"
import { Middleware } from "homelab-services"
import * as MyEndpoint from "./my-endpoint.js"

export const MyGroupApi = HttpApiGroup.make("<group>")
  .add(MyEndpoint.MyEndpoint)
  // ... existing endpoints
  .prefix("/<group>")
  .middleware(Middleware.AuthMiddleware) // if group-level auth

export * as MyEndpoint from "./my-endpoint.js"
```

### If Creating a New Group

1. Create the directory `packages/homelab-api/src/homelab/<new-group>/`
2. Create the endpoint file(s) and `index.ts` as above
3. Register the group in the top-level API:

```typescript
// packages/homelab-api/src/homelab/index.ts
import { HttpApi } from "@effect/platform"
import { NewGroupApi } from "./new-group/index.js"

export const HomelabApi = HttpApi.make("homelab")
  .add(NewGroupApi)
// ... existing groups

export * as NewGroupEndpoints from "./new-group/index.js"
```

---

## Step 3: Handler Implementation (`homelab-server`)

Create the handler file:

```
packages/homelab-server/src/handlers/<group>/<endpoint>.ts
```

### Handler File Template

```typescript
import { Effect } from "effect"
import type { Homelab } from "homelab-api"
import { Middleware, Services } from "homelab-services"

export const handleMyEndpoint = Effect.fn("handleMyEndpoint")(
  function*(args: Homelab.MyGroupEndpoints.MyEndpoint.MyEndpointHandlerArgs) {
    const identity = yield* Middleware.CurrentIdentity
    yield* Services.AuthorizationService.canView(
      identity,
      "MyGroup_MyEndpoint",
      args,
    )

    // Implementation...
    return { foo: "bar", bar: 42 }
  },
)
```

### Handler Patterns

- **Auth check**: `yield* Middleware.CurrentIdentity` then `yield* Services.AuthorizationService.canView/canCreate(identity, "Resource_Name", args)`
- **Error mapping**: Optional trailing pipe argument to `Effect.fn`:
  ```typescript
  export const handleMyEndpoint = Effect.fn("handleMyEndpoint")(
    function*(args) {/* ... */},
    Effect.tapError(Console.error),
    Effect.mapError(
      flow(
        Match.value,
        Match.tag(
          "SomeInternalError",
          (e) => new ApiErrors.InternalServerError({ message: "...", error: e }),
        ),
        Match.orElse((_) => _),
      ),
    ),
  )
  ```
- **No auth** (e.g. well-known): Skip identity/authorization, just implement logic.

### Register in Group Handler Index

```typescript
// packages/homelab-server/src/handlers/<group>/index.ts
import { HttpApiBuilder } from "@effect/platform"
import { Homelab } from "homelab-api"
import { handleMyEndpoint } from "./my-endpoint.js"

export const MyGroupApiLive = HttpApiBuilder.group(
  Homelab.HomelabApi,
  "<group>",
  (handlers) =>
    handlers
      .handle("my-endpoint", handleMyEndpoint),
  // ... existing handlers
)
```

### If Creating a New Group

Register the new group layer in `api.ts`:

```typescript
// packages/homelab-server/src/api.ts
import { NewGroupApiLive } from "./handlers/new-group/index.js"

export const ApiLive = HttpApiBuilder.api(Homelab.HomelabApi).pipe(
  Layer.provide(NewGroupApiLive),
  // ... existing group layers
)
```

### Wire Dependencies in `main.ts`

If the handler uses services not already provided, add the corresponding shell aggregate:

```typescript
// packages/homelab-server/src/main.ts
import { Shell } from "homelab-services-node"

const ServerLive = HttpApiBuilder.serve(HttpMiddleware.logger).pipe(
  // ...
  Layer.provide(Shell.NewDomain.Aggregate), // Add new shell aggregate
  // ...
)
```

Shell aggregates live in `homelab-services-node/src/shell/` and compose related service layers. Use an existing aggregate if one covers the needed services.

---

## Step 4: Unit Test (`homelab-server/test`)

Create the test file mirroring the handler path:

```
packages/homelab-server/test/handlers/<group>/<endpoint>.test.ts
```

### Unit Test Template

```typescript
import { assert, describe, expect, it } from "@effect/vitest"
import { Effect, HashSet, Layer } from "effect"
import { type Homelab } from "homelab-api"
import { ApiErrors, Identity, Middleware } from "homelab-services"
import { handleMyEndpoint } from "../../../src/handlers/<group>/my-endpoint.js"
import { HandlerTestLayer } from "../../../test-utils/testing-layer.js"

const withIdentity = (identity: Identity.Identity) =>
  Layer.succeed(Middleware.CurrentIdentity, identity)

const myEndpointArgs = (overrides?: {
  // optional override fields
}): Homelab.MyGroupEndpoints.MyEndpoint.MyEndpointHandlerArgs => ({
  request: {} as any,
  headers: {} as any,
  // ... default args
})

const authorizedIdentity = new Identity.OIDCIdentity(
  "user@example.com",
  HashSet.fromIterable(["MyGroup_MyEndpoint"]),
)

describe("handleMyEndpoint", () => {
  describe("authorization", () => {
    it.effect("rejects identity without required permission", () =>
      Effect.gen(function*() {
        const unauthorized = new Identity.OIDCIdentity(
          "user@example.com",
          HashSet.empty(),
        )
        const result = yield* Effect.flip(handleMyEndpoint(myEndpointArgs()))
        assert(
          result instanceof ApiErrors.AuthorizationError,
          `Expected AuthorizationError, got ${result._tag ?? result}`,
        )
      }).pipe(
        Effect.provide(
          Layer.provideMerge(withIdentity(unauthorized), HandlerTestLayer),
        ),
      ))
  })

  describe("happy path", () => {
    it.effect("returns expected result", () =>
      Effect.gen(function*() {
        const result = yield* handleMyEndpoint(myEndpointArgs())
        expect(result).toEqual({ foo: "bar", bar: 42 })
      }).pipe(
        Effect.provide(
          Layer.provideMerge(
            withIdentity(authorizedIdentity),
            HandlerTestLayer,
          ),
        ),
      ))
  })
})
```

### Test Conventions

- Use `@effect/vitest` — `it.effect()` for effectful tests
- Provide layers via `Effect.provide(Layer.provideMerge(withIdentity(...), HandlerTestLayer))`
- `HandlerTestLayer` (from `test-utils/testing-layer.ts`) provides all mocked/test services
- Use `Effect.flip` to assert on errors, then `assert` with a descriptive message:
  ```typescript
  assert(
    result instanceof ApiErrors.AuthorizationError,
    `Expected AuthorizationError, got ${result._tag ?? result}`,
  )
  ```
  Always include an error message in `assert` — bare `assert(x instanceof Y)` produces unhelpful failure output.
- Create an args factory function with sensible defaults and optional overrides
- Group tests into `authorization`, `happy path`, and `error cases` describe blocks
- Override specific services per-test with `Layer.provideMerge(HandlerTestLayer, overrideLayer)`

---

## Step 5: E2E Test (`homelab-e2e-tests`)

Create the test file:

```
packages/homelab-e2e-tests/src/<group>/<endpoint>.test.ts
```

### E2E Test Template

```typescript
import { assert, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { ApiErrors } from "homelab-services"
import {
  BASE_URL,
  createToken,
  E2ETestLayer,
  getToken,
  makeApiClient,
  TEST_API_KEY,
  TEST_LIMITED_API_KEY,
} from "../../test-utils/index.js"

const ENDPOINT_URL = new URL(`${BASE_URL}/<group>/my-endpoint`)

describe("GET /<group>/my-endpoint", () => {
  describe("authorization", () => {
    it.live("rejects a request with insufficient permissions", () =>
      Effect.gen(function*() {
        const client = yield* makeApiClient
        const { access_token, nonce, token_type } = yield* getToken(
          TEST_LIMITED_API_KEY,
        )
        const dpopProof = yield* createToken({
          htu: ENDPOINT_URL,
          htm: "GET",
          nonce,
          accessToken: access_token,
        })
        const result = yield* Effect.flip(
          client["<group>"]["my-endpoint"]({
            headers: {
              dpop: dpopProof,
              authorization: `${token_type} ${access_token}`,
            },
          }),
        )
        assert(
          result instanceof ApiErrors.AuthorizationError,
          `Expected AuthorizationError, got ${result._tag ?? result}`,
        )
      }).pipe(Effect.provide(E2ETestLayer)))
  })

  describe("success", () => {
    it.live("returns expected result for authenticated request", () =>
      Effect.gen(function*() {
        const client = yield* makeApiClient
        const { access_token, nonce, token_type } = yield* getToken(
          TEST_API_KEY,
        )
        const dpopProof = yield* createToken({
          htu: ENDPOINT_URL,
          htm: "GET",
          nonce,
          accessToken: access_token,
        })
        const result = yield* client["<group>"]["my-endpoint"]({
          headers: {
            dpop: dpopProof,
            authorization: `${token_type} ${access_token}`,
          },
        })
        expect(result.foo).toBe("bar")
      }).pipe(Effect.provide(E2ETestLayer)))
  })
})
```

### E2E Test Conventions

- Use `it.live` (not `it.effect`) — these run against a live server at `http://localhost:3000`
- Provide `E2ETestLayer` which includes `NodeHttpClient` and `DPoPTokenCreatorService`
- Use `makeApiClient` to get a typed API client (`HttpApiClient.make(Homelab.HomelabApi, ...)`)
- Call endpoints via `client["<group>"]["<endpoint-name>"]({ headers, payload, path })`
- For authenticated endpoints: `getToken(TEST_API_KEY)` → `createToken(...)` → pass headers
- For unauthenticated endpoints (e.g. well-known): call directly without auth headers
- `TEST_API_KEY` has full permissions; `TEST_LIMITED_API_KEY` has restricted permissions
- Always include a descriptive message in `assert` calls (same rule as unit tests)
- The server must be running before e2e tests execute

---

## Checklist

- [ ] Schema added to `homelab-services/src/schemas/` and registered in `schemas/index.ts`
- [ ] Endpoint defined in `homelab-api/src/homelab/<group>/<endpoint>.ts`
- [ ] Endpoint registered in group's `index.ts` (and group registered in top-level `index.ts` if new)
- [ ] Handler implemented in `homelab-server/src/handlers/<group>/<endpoint>.ts`
- [ ] Handler registered in group handler `index.ts` (and in `api.ts` if new group)
- [ ] Dependencies wired in `main.ts` (new `Shell.X.Aggregate` if needed)
- [ ] Unit test added to `homelab-server/test/handlers/<group>/<endpoint>.test.ts`
- [ ] E2E test added to `homelab-e2e-tests/src/<group>/<endpoint>.test.ts`
- [ ] Resource URI added to `homelab-services/src/schemas/resource-uris.ts`
- [ ] Fine-grained authorization matcher added in `homelab-services-node/src/layers/fine-grained-authorization-service.ts`
- [ ] Guest permissions updated in `homelab-services/src/identity.ts` (if guest-accessible)
- [ ] Test env config updated in `homelab-server/test-utils/testing-layer.ts` and `homelab-services-node/test-utils/testing-layer.ts`
- [ ] Authorization test params record updated in `homelab-services-node/test/authorization-service.test.ts`

---

## Authorization Resource URIs

Every endpoint that uses `AuthorizationService.canView/canCreate` requires a **resource URI** registered in the system. The naming convention is `<Group>_<Resource>`.

### Existing Resource URIs

| URI                 | Group         | Purpose                          |
| ------------------- | ------------- | -------------------------------- |
| `Config_Wifi`       | mobile-config | Wifi profile generation          |
| `Config_ACME`       | mobile-config | ACME profile generation          |
| `Config_Certs`      | mobile-config | Certificate mobileconfig profile |
| `Cert_Root`         | cert          | Raw root CA download             |
| `Cert_Intermediate` | cert          | Raw intermediate CA download     |
| `Cert_Combined`     | cert          | Combined PEM CA bundle           |
| `Status_Health`     | status        | Health check                     |
| `OAuth_Token`       | oauth         | Token issuance                   |
| `OAuth_ClaimCheck`  | oauth         | Claim check creation             |

### Adding a New Resource URI

1. Add the literal to `homelab-services/src/schemas/resource-uris.ts`:
   ```typescript
   export const ResourceURISchema = Schema.Literal(
     // ... existing
     "NewGroup_NewResource",
   )
   ```

2. Add a matcher in `homelab-services-node/src/layers/fine-grained-authorization-service.ts`:
   ```typescript
   "NewGroup_NewResource": () => Effect.succeed(true as const),
   ```
   For complex authorization logic (e.g. checking that a user's principle matches a requested username), implement it in the matcher function.

3. If the endpoint should be guest-accessible, add permissions to `GuestIdentity` in `homelab-services/src/identity.ts`:
   ```typescript
   private readonly permissions: HashSet.HashSet<ScopeOrGroup> = HashSet.fromIterable([
     // ... existing
     "NewGroup_NewResource.view",
   ])
   ```

4. Update the test params record in `homelab-services-node/test/authorization-service.test.ts`:
   ```typescript
   const defaults: Record<ResourceURIs.ResourceURIs, unknown> = {
     // ... existing
     "NewGroup_NewResource": {},
   }
   ```

---

## Environment Configuration

When a new endpoint requires filesystem paths or environment variables:

### Adding Env Config

1. Add the field to `EnvDef` in `homelab-services/src/config/env.ts`:
   ```typescript
   export interface EnvDef {
     // ... existing
     readonly myNewPath: string
   }
   ```

2. Add an accessor function in the same file:
   ```typescript
   /** {@inheritDoc EnvDef.myNewPath} */
   export const myNewPath = Env.pipe(Effect.map((_) => _.myNewPath))
   ```

3. Wire the env var in `homelab-server/src/env.ts`:
   ```typescript
   export const EnvLive = Layer.effect(
     HomelabConfig.Env.Env,
     Config.all({
       // ... existing
       myNewPath: Config.string("MY_NEW_PATH"),
     }),
   )
   ```

4. Update **both** testing layers with the new env var:
   - `packages/homelab-server/test-utils/testing-layer.ts` — add to the `ConfigProvider.fromMap`
   - `packages/homelab-services-node/test-utils/testing-layer.ts` — add to both `ConfigProvider.fromMap` AND `makeTestEnvWithFlags`

### Current Env Vars (Certificate Paths)

| Env Var                 | Purpose                                   | Example path                  |
| ----------------------- | ----------------------------------------- | ----------------------------- |
| `ROOT_CERT_DER`         | Root CA certificate in DER format         | `certs/alford-root.der`       |
| `INTERMEDIATE_CERT_DER` | Intermediate CA certificate in DER format | `certs/intermediate_ca_2.der` |
| `ROOT_CERT_CRT`         | Root CA certificate in CRT (PEM) format   | `certs/alford-root.crt`       |
| `INTERMEDIATE_CERT_CRT` | Intermediate CA certificate in CRT (PEM)  | `certs/intermediate_ca_2.crt` |

---

## Binary / Download Responses

For endpoints that serve binary file downloads:

### Encoding

Use `HttpApiSchema.Uint8Array()` for binary response bodies:

```typescript
import { HttpApiEndpoint, HttpApiSchema } from "@effect/platform"

export const MyDownload = HttpApiEndpoint.get("my-download")`/my-download`
  .addSuccess(HttpApiSchema.Uint8Array())
```

For text responses with a custom content-type (e.g. XML), use `HttpApiSchema.withEncoding`:

```typescript
Schema.String.pipe(
  HttpApiSchema.withEncoding({ kind: "Text", contentType: "application/xml" }),
)
```

> **Note:** `HttpApiSchema.Uint8Array()` does not support custom `contentType` — it always serves as `application/octet-stream`. Use `HttpApiSchema.Text(...)` for text with a custom content-type.

### Content-Disposition (Download Header)

To trigger a browser download with a filename, use `HttpApp.appendPreResponseHandler`:

```typescript
import { HttpApp, HttpServerResponse } from "@effect/platform"
import { Effect } from "effect"

yield* HttpApp.appendPreResponseHandler(
  (_, res) =>
    Effect.succeed(
      HttpServerResponse.setHeaders(res, {
        "Content-Disposition": `attachment; filename="my-file.ext"`,
      }),
    ),
)
```

---

## Direct Service Access in Handlers

When a handler needs a service directly (not through a profile generator or aggregate), provide the service's live layer explicitly in `main.ts`:

```typescript
import { Layers } from "homelab-services-node"

const ServerLive = HttpApiBuilder.serve(HttpMiddleware.logger).pipe(
  // ...
  Layer.provide(Layers.MyService.MyServiceLive),
  // ...
)
```

If the service is already a dependency inside a shell aggregate (e.g. `CertificateService` in `ProfilePayload.Aggregate`), it is NOT automatically exposed in the aggregate's output type. You must provide it separately if handlers yield it directly.
