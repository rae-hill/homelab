# Effect Services & Code Patterns

## Vendored Repositories

Upstream monorepos are vendored at `./repos/` as read-only reference material via git subtrees.

| Directory                 | Source                                       | Purpose                                 |
| ------------------------- | -------------------------------------------- | --------------------------------------- |
| `repos/effect/`           | https://github.com/Effect-TS/effect.git      | Effect runtime & platform               |
| `repos/kobalte/`          | https://github.com/kobaltedev/kobalte.git    | SolidJS UI component library            |
| `repos/astro/`            | https://github.com/withastro/astro.git       | Astro framework                         |
| `repos/nanostores/`       | https://github.com/nanostores/nanostores.git | Nanostores state management             |
| `repos/nixpkgs-26.05/`    | https://github.com/NixOS/nixpkgs.git         | NixOS packages & modules (stable 26.05) |
| `repos/nixpkgs-unstable/` | https://github.com/NixOS/nixpkgs.git         | NixOS packages & modules (unstable)     |

- Prefer examples and patterns from the vendored source over generated guesses or web search results
- Do NOT edit files under `./repos/`
- Do NOT import from `./repos/` — application code imports from normal package dependencies (e.g. `effect`, `@effect/platform`, `@kobalte/core`, `nanostores`)
- Key reference packages: `repos/effect/packages/effect/`, `repos/effect/packages/platform/`, `repos/effect/packages/platform-node/`, `repos/kobalte/packages/core/`, `repos/nanostores/`
- Key NixOS reference paths: `repos/nixpkgs-26.05/nixos/modules/services/`, `repos/nixpkgs-unstable/nixos/modules/services/`, `repos/nixpkgs-26.05/pkgs/`

### Adding a New Vendored Subtree

```sh
git subtree add \
  --prefix=repos/<name> \
  <git-url> \
  <branch> \
  --squash
```

Example (Effect):

```sh
git subtree add \
  --prefix=repos/effect \
  https://github.com/Effect-TS/effect.git \
  main \
  --squash
```

Use `--squash` to avoid bringing in the full upstream commit history.

## Service Architecture

Services are split across two packages:

| Package                 | Contains                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `homelab-services`      | Service & config **definitions** (interfaces, Context tags, errors, accessor functions)     |
| `homelab-services-node` | Service & config **implementations** (Layers, Impl classes), and **shell** aggregate layers |

### Directory Layout

```
homelab-services/src/
├── services/       # Service definitions (FooService.ts)
├── config/         # Config definitions (env.ts, api-key-config.ts, etc.)
├── schemas/        # Effect Schemas
├── errors/         # Tagged errors
├── middleware/     # Middleware definitions
└── index.ts        # Barrel exports

homelab-services-node/src/
├── layers/         # Service/config implementations (foo-service.ts exports FooServiceLive)
├── config/         # Config implementations
├── shell/          # Aggregate layers grouped by domain
└── index.ts
```

## Service Definition Pattern (`homelab-services`)

A service definition file contains:

1. A **URI constant** (path-based): `"homelab-api/services/<domain>/<ServiceName>"`
2. **Tagged errors** (if any): `class FooError extends Data.TaggedError("FooError")<{...}>()`
3. An **interface** with suffix `Def`: `interface FooServiceDef { ... }`
4. A **Context tag** class: `class FooService extends Context.Tag(FooServiceId)<FooService, FooServiceDef>()`
5. **Accessor functions** that lift methods into Effect (with `{@inheritDoc}` JSDoc)

```typescript
import { Context, Data, Effect } from "effect"

export const FooServiceId = "homelab-api/services/foo/FooService"

export class FooError
  extends Data.TaggedError("FooError")<{ readonly error: unknown }>
{}

export interface FooServiceDef {
  readonly doSomething: (input: string) => Effect.Effect<string, FooError>
}

export class FooService
  extends Context.Tag(FooServiceId)<FooService, FooServiceDef>()
{}

/** {@inheritDoc FooServiceDef.doSomething} */
export function doSomething(
  input: string,
): Effect.Effect<string, FooError, FooService> {
  return FooService.pipe(Effect.flatMap((_) => _.doSomething(input)))
}
```

For services with multiple methods, use spread params for accessor functions:

```typescript
export function authenticate(
  ...params: Parameters<AuthenticationServiceDef["authenticate"]>
): Effect.Effect<Identity, AuthenticationError, AuthenticationService> {
  return AuthenticationService.pipe(
    Effect.flatMap((_) => _.authenticate(...params)),
  )
}
```

## Service Implementation Pattern (`homelab-services-node`)

An implementation file exports a **Layer** and contains a **private Impl class**.

### Simple (no dependencies) — `Layer.succeed`

When no Effect dependencies are needed, the Impl class comes **before** the layer:

```typescript
import { Layer } from "effect"
import { Services } from "homelab-services"

class FooServiceImpl implements Services.FooService.FooServiceDef {
  doSomething(input: string) {
    return Effect.succeed(input.toUpperCase())
  }
}

export const FooServiceLive = Layer.succeed(
  Services.FooService.FooService,
  new FooServiceImpl(),
)
```

### With dependencies — `Layer.effect`

When dependencies are needed, the layer comes **first** (yields dependencies), then the Impl class follows:

```typescript
import { Effect, Layer } from "effect"
import { Config, Services } from "homelab-services"

export const FooServiceLive = Layer.effect(
  Services.FooService.FooService,
  Effect.gen(function*() {
    const env = yield* Config.Env.Env
    const bar = yield* Services.BarService.BarService
    return new FooServiceImpl(env, bar)
  }),
)

class FooServiceImpl implements Services.FooService.FooServiceDef {
  constructor(
    private readonly env: typeof Config.Env.Env.Service,
    private readonly bar: typeof Services.BarService.BarService.Service,
  ) {}

  doSomething(input: string) {
    return Effect.gen(this, function*() {
      // use this.env, this.bar, etc.
      return input
    })
  }
}
```

Key rules:

- The Impl class is **never exported**
- Dependencies are `yield*`'d in the layer effect and passed via constructor
- Type constructor params with `typeof Services.Foo.Foo.Service`
- Use `Effect.gen(this, function*() { ... })` in methods that reference `this`
- Inter-layer dependencies are wired in shell aggregates, not inline with `Layer.provide`

## Shell Aggregates (`homelab-services-node/src/shell/`)

Shell files compose related layers into domain-specific aggregates. This is where inter-layer dependencies are wired using `Layer.provide`, `Layer.provideMerge`, and `Layer.merge`:

```typescript
// shell/authentication.ts
import { Layer } from "effect"
import { AuthenticationServiceLive } from "../layers/authentication-service.js"
import { ClaimCheckServiceLive } from "../layers/claim-check-service.js"
import { OIDCAuthenticationServiceLive } from "../layers/oidc-authentication-service.js"
import { TokenIssuerServiceLive } from "../layers/token-issuer-service.js"

export const Aggregate = AuthenticationServiceLive.pipe(
  Layer.provide(OIDCAuthenticationServiceLive),
  Layer.provideMerge(ClaimCheckServiceLive),
  Layer.provideMerge(TokenIssuerServiceLive),
)
```

Shell aggregates are re-exported from `shell/index.ts` as namespaces:

```typescript
export * as Authentication from "./authentication.js"
export * as Authorization from "./authorization.js"
export * as Crypto from "./crypto.js"
export * as ProfilePayload from "./profile-payload.js"
```

### `Layer.provide` vs `Layer.provideMerge` in Aggregates

Understanding the distinction is critical for correct dependency wiring:

- **`Layer.provide(dep)`** — feeds `dep` as an input to the layer being piped. The dependency is consumed but NOT included in the aggregate's output. Handlers cannot `yield*` it directly.
- **`Layer.provideMerge(dep)`** — provides `dep` as an input AND merges it into the output. Downstream consumers (including handlers) CAN `yield*` it.

```typescript
// CertificateServiceLive is provided as input only — NOT in aggregate output
const ServiceDeps = RootPayloadServiceLive.pipe(
  Layer.provideMerge(CertificateServiceLive), // available to sibling deps
)

export const Aggregate = CertProfileServiceLive.pipe(
  Layer.provide(ServiceDeps), // ServiceDeps consumed, NOT exposed
)
```

In this example, `CertificateService` is available to layers inside `ServiceDeps` and to `CertProfileServiceLive`, but handlers using this aggregate cannot `yield* CertificateService` directly. If a handler needs it, provide it separately in `main.ts` via `Layer.provide(Layers.CertificateService.CertificateServiceLive)`.

## Config Definition Pattern

Configs follow the same Def/Tag/accessor pattern as services:

```typescript
export interface EnvDef {
  readonly originUrl: URL
  readonly hmacSecretFilePath: Option.Option<string>
}

export class Env
  extends Context.Tag("homelab-api/config/env/Env")<Env, EnvDef>()
{}

export const originUrl = Env.pipe(Effect.map((_) => _.originUrl))
```

Config implementations are in `homelab-services-node/src/config/` and exported as layers (e.g. `ApiKeyConfigLive`).

## General Effect Conventions

- Use `Option<T>` (never empty strings or null) for values that may be absent
- Use `Data.TaggedError` for all typed errors
- Use `Effect.gen` + `yield*` for sequencing effects
- Use `Effect.try` / `Effect.tryPromise` for wrapping fallible operations
- Use `Schema.decode` for runtime validation
- Use `HashMap` over plain objects when keys are dynamic
- Import from `homelab-services` using namespace barrel: `import { Config, Services, Schemas } from "homelab-services"`
