---
applyTo: "packages/homelab-api/src/homelab/**,packages/homelab-server/src/handlers/**"
---

# Adding a New Endpoint

This document covers standing up a new HTTP endpoint across both the API definition package
(`homelab-api`) and the server handler package (`homelab-server`).

Endpoints follow a two-package pattern:

- **`homelab-api`** owns the _definition_ — route, schemas, errors, middleware
- **`homelab-server`** owns the _handler_ — the Effect business logic for that route

## Step 1 — Define the endpoint in homelab-api

### 1a. Create the endpoint file

Create `packages/homelab-api/src/homelab/<group>/<endpoint-name>.ts`.

```typescript
import { HttpApiEndpoint } from "@effect/platform"
import type { Types } from "effect"
import * as ApiErrors from "../../errors/http-errors.js"
import * as Schemas from "../../schemas/index.js"

export const MyEndpoint = HttpApiEndpoint.get("my-endpoint")`/path`
  .addSuccess(Schemas.SomeResponse)
  .addError(ApiErrors.AuthenticationError)
  .addError(ApiErrors.InternalServerError)

export type MyEndpoint = typeof MyEndpoint

export type MyEndpointHandlerArgs = Types.Simplify<
  HttpApiEndpoint.HttpApiEndpoint.Request<MyEndpoint>
>
```

Notes:

- The string passed to `HttpApiEndpoint.get(...)` (or `.post`, `.put`, etc.) is the
  **endpoint name** — it must be unique across the API and is used as the handler key.
- Use `.addSuccess(schema)` and `.addError(errorClass)` to declare the full response
  surface; these drive the OpenAPI docs and the handler's type-checked return/error types.
- If the endpoint performs an action that needs authorization, add a
  `declare module` augmentation for `resource-uris.ts` (see existing endpoints for the
  pattern) and call `Services.AuthorizationService.canView/canCreate` in the handler.

### 1b. Add the endpoint to its group

Either create or update `packages/homelab-api/src/homelab/<group>/index.ts`:

```typescript
import { HttpApiGroup } from "@effect/platform"
import { AuthMiddleware } from "../../middleware/auth-middleware.js"
import * as MyEndpoint from "./my-endpoint.js"

export const MyGroupApi = HttpApiGroup.make("my-group")
  .add(MyEndpoint.MyEndpoint)
  .prefix("/my-group")
  .middleware(AuthMiddleware) // omit if the group is public

export * as MyEndpoint from "./my-endpoint.js"
```

- Apply `.middleware(AuthMiddleware)` for endpoints that require bearer-token auth.
- Apply `.middleware(BasicAuthMiddleware)` for endpoints that use HTTP Basic auth +
  DPoP extraction (e.g., the OAuth token endpoint).
- Omit `.middleware(...)` for fully public endpoints (e.g., `/.well-known`).

### 1c. Register the group in the top-level API

Update `packages/homelab-api/src/homelab/index.ts`:

```typescript
import { MyGroupApi } from "./my-group/index.js"

export const HomelabApi = HttpApi.make("homelab")
  // ...existing groups...
  .add(MyGroupApi)

export * as MyGroupEndpoints from "./my-group/index.js"
```

## Step 2 — Implement the handler in homelab-server

### 2a. Create the handler file

Create `packages/homelab-server/src/handlers/<group>/<endpoint-name>.ts`:

```typescript
import { Effect } from "effect"
import type { Homelab } from "homelab-api"
import { Middleware, Services } from "homelab-api"

export const handleMyEndpoint = Effect.fn("handleMyEndpoint")(
  function*(args: Homelab.MyGroupEndpoints.MyEndpoint.MyEndpointHandlerArgs) {
    const identity = yield* Middleware.CurrentIdentity
    yield* Services.AuthorizationService.canView(
      identity,
      "MyGroup.MyEndpoint",
      args,
    )

    // ... business logic ...

    return result
  },
)
```

- The handler name string in `Effect.fn(...)` is used for tracing — keep it unique and
  descriptive.
- Import handler args type from the `Homelab` namespace exported by `homelab-api`. The
  path mirrors the endpoint's position in the group tree:
  `Homelab.<GroupEndpoints>.<EndpointModule>.<HandlerArgsType>`.
- Use `HttpApp.appendPreResponseHandler` (from `@effect/platform`) to set custom
  response headers (e.g., `DPoP-Nonce`):
  ```typescript
  yield * HttpApp.appendPreResponseHandler(
    (_, res) => Effect.succeed(HttpServerResponse.setHeader(res, "My-Header", value)),
  )
  ```

### 2b. Wire the handler into its group

Create or update `packages/homelab-server/src/handlers/<group>/index.ts`:

```typescript
import { HttpApiBuilder } from "@effect/platform"
import { Homelab } from "homelab-api"
import { handleMyEndpoint } from "./my-endpoint.js"

export const MyGroupApiLive = HttpApiBuilder.group(
  Homelab.HomelabApi,
  "my-group",
  (handlers) =>
    handlers
      .handle("my-endpoint", handleMyEndpoint),
)
```

The group name (`"my-group"`) must match the name used in `HttpApiGroup.make(...)`.
Each `.handle(name, fn)` call must reference the endpoint name from the definition.

### 2c. Provide the handler group in api.ts

Update `packages/homelab-server/src/api.ts`:

```typescript
import { MyGroupApiLive } from "./handlers/my-group/index.js"

export const ApiLive = HttpApiBuilder.api(Homelab.HomelabApi).pipe(
  // ...existing provides...
  Layer.provide(MyGroupApiLive),
)
```

If the new endpoint depends on a service not yet in the layer graph, add a
`Layer.provide(Services.MyService.MyServiceLive)` here as well. Check `main.ts` to see
which shell aggregates are already wired in (Authentication, Authorization, Crypto,
ProfilePayload) before adding new layers unnecessarily.

## Step 3 — Add new schemas or errors (if needed)

- **Response schemas**: add to `packages/homelab-api/src/schemas/` (pick the most
  relevant existing file, e.g., `OAuth.ts`, or create a new one). Export the namespace
  from `schemas/index.ts`.
- **Error types**: add a new `Schema.TaggedError` class to
  `packages/homelab-api/src/errors/http-errors.ts` with an `HttpApiSchema.annotations`
  status code. Add any new `reason` literals to the corresponding `*ReasonsSchema`.
- **Middleware**: create a new file in `packages/homelab-api/src/middleware/` and export
  it from `middleware/index.ts`. Provide the Live layer in `api.ts`.

## Verification

After making changes, run:

```bash
nix develop --command yarn workspace homelab-api typecheck
nix develop --command yarn workspace homelab-server typecheck
```
