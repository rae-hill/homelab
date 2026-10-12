# EAP-TLS Prerequisites Implementation Plan

This document outlines the implementation steps for the four prerequisites needed before integrating EAP-TLS payloads into the wifi endpoints.

---

## 1. Add `Status_Self` Endpoint

A new endpoint in the `status` group that returns identity information and Tailscale network detection.

### Response Schema

```typescript
Schema.Struct({
  isTailscale: Schema.Boolean,
  permissions: Schemas.ScopeGroups.ScopeGroupSetSchema,
  principal: Schema.String,
  fullname: Schema.OptionFromNullOr(Schema.String),
})
```

- `isTailscale` — derived from `X-Forwarded-For` header (Tailscale CGNAT `100.*` or ULA `fd7a:115c:a1e0*`)
- `permissions` — the identity's permission set, serialized via `ScopeGroupSetSchema` (HashSet → Array over the wire)
- `principal` — the identity's principal identifier (`identity.principle`)
- `fullname` — `Option<string>`, serialized as `string | null`. `None` for Guests, `None` if the OIDC id-token lacks a `name` claim

### Identity Changes

The `OIDCIdentity` class needs a new optional `fullname` constructor param and a public accessor so the handler can read it. The `IdentityBase` should expose an abstract `fullname` getter returning `Option<string>`:

- `GuestIdentity.fullname` → `Option.none()`
- `OIDCIdentity.fullname` → `Option.fromNullable(this._fullname)` (new 4th constructor param)
- `MTLSIdentity.fullname` → `Option.none()`

The `HomelabIdentityJWT` schema needs an optional `name` field:

```typescript
name: Optional(Schema.String),
```

The `OIDCAuthenticationServiceImpl` passes `parsedJwt.name` to the new constructor param.

The identity classes get a public `permissionSet` getter returning the `ScopeOrGroupSet` so the handler can serialize it.

### Implementation Steps

#### 1a. Schema (`homelab-services/src/schemas/status-self.ts`)

```typescript
import { Schema } from "effect"
import { ScopeGroupSetSchema } from "./scope-groups.js"

export const StatusSelfResponseSchema = Schema.Struct({
  isTailscale: Schema.Boolean,
  permissions: ScopeGroupSetSchema,
  principal: Schema.String,
  fullname: Schema.OptionFromNullOr(Schema.String),
})

export type StatusSelfResponse = typeof StatusSelfResponseSchema.Type
```

Register in `schemas/index.ts`:

```typescript
export * as StatusSelf from "./status-self.js"
```

#### 1b. Identity Modifications (`homelab-services/src/identity.ts`)

Add to `IdentityBase`:

```typescript
abstract readonly fullname: Option.Option<string>
abstract readonly permissionSet: ScopeOrGroupSet
```

Implement in each identity class:

- `GuestIdentity`: `fullname = Option.none()`, `get permissionSet() { return this.permissions }`
- `OIDCIdentity`: Add `fullname?: string` as 4th constructor param, `get fullname() { return Option.fromNullable(this._fullname) }`, `get permissionSet() { return this.groups }`
- `MTLSIdentity`: `fullname = Option.none()`, `get permissionSet() { return this.scopes }`

#### 1c. JWT Schema + Authentication Service

Add `name: Optional(Schema.String)` to `HomelabIdentityJWT` in `homelab-services/src/schemas/OAuth.ts`.

In `homelab-services-node/src/layers/oidc-authentication-service.ts`, pass `parsedJwt.name` as 4th arg:

```typescript
return new Identity.OIDCIdentity(
  parsedJwt.email,
  parsedJwt[Constants.JWT_ROLES_KEY],
  parsedJwt.preferred_username?.split("@")[0],
  parsedJwt.name,
)
```

#### 1d. Resource URI

Add `"Status_Self"` to `ResourceURISchema` in `homelab-services/src/schemas/resource-uris.ts`.

#### 1e. Fine-Grained Authorization

Add `"Status_Self": () => Effect.succeed(true as const)` matcher in `homelab-services-node/src/layers/fine-grained-authorization-service.ts`.

#### 1f. Guest Permissions

Add `"Status_Self.view"` to `GuestIdentity.permissions` in `homelab-services/src/identity.ts`.

#### 1g. Endpoint Definition (`homelab-api/src/homelab/status/self.ts`)

```typescript
import { HttpApiEndpoint } from "@effect/platform"
import type { Types } from "effect"
import { Schema } from "effect"
import { ApiErrors, Schemas } from "homelab-services"

const SelfHeaders = Schema.Struct({
  ...Schemas.Token.TokenHeaders.fields,
  "x-forwarded-for": Schema.optionalWith(Schema.String, { exact: true }),
})

export const SelfEndpoint = HttpApiEndpoint.get("self")`/self`
  .addSuccess(Schemas.StatusSelf.StatusSelfResponseSchema)
  .addError(ApiErrors.AuthorizationError)
  .addError(ApiErrors.InternalServerError)
  .setHeaders(SelfHeaders)

export type SelfEndpoint = typeof SelfEndpoint

export type SelfEndpointHandlerArgs = Types.Simplify<
  HttpApiEndpoint.HttpApiEndpoint.Request<SelfEndpoint>
>
```

#### 1h. Register in Status Group (`homelab-api/src/homelab/status/index.ts`)

Add `.add(Self.SelfEndpoint)` to `StatusApi`. Add `export * as Self from "./self.js"`.

#### 1i. Handler (`homelab-server/src/handlers/status/self.ts`)

```typescript
import { Effect } from "effect"
import type { Homelab } from "homelab-api"
import { ApiErrors, Middleware, Services } from "homelab-services"

export const handleSelf = Effect.fn("handleSelf")(
  function*(args: Homelab.StatusEndpoints.Self.SelfEndpointHandlerArgs) {
    const identity = yield* Middleware.CurrentIdentity
    yield* Services.AuthorizationService.canView(identity, "Status_Self", args)

    const xForwardedFor = args.headers["x-forwarded-for"]
    if (!xForwardedFor) {
      return yield* new ApiErrors.InternalServerError({
        message: "missing X-Forwarded-For header",
      })
    }

    const isTailscale = xForwardedFor.startsWith("100.")
      || xForwardedFor.startsWith("fd7a:115c:a1e0")

    return {
      isTailscale,
      permissions: identity.permissionSet,
      principal: identity.principle,
      fullname: identity.fullname,
    }
  },
)
```

#### 1j. Register Handler (`homelab-server/src/handlers/status/index.ts`)

Add `.handle("self", handleSelf)` to `StatusApiLive`.

#### 1k. Feature Flags — Augustus Only

**`nix-config/modules/_private/augustus/programs.nix`:**

- Add `"Status_Self"` to `services.homelab-api.apiKeys.jacob.permissions`

**`nix-config/modules/_private/praeconinus/programs.nix`:**

- Do NOT add `Status_Self` to `featureFlags` (already restricted to explicit list)

**`nix-config/modules/features/homelab-api/systemd-service.nix`:**

- Add `"Status_Self"` to the permissions enum

**`nix-config/modules/features/homelab-api/kanidm.nix`:**

- Add `"Status_Self"` to `homelab.admins` claim map values
- Add `"Status_Self"` to `homelab.access` claim map values (users should see their own identity)

#### 1l. Authorization Test Params

In `homelab-services-node/test/authorization-service.test.ts`, add to `defaults`:

```typescript
"Status_Self": {},
```

#### 1m. Unit Test (`homelab-server/test/handlers/status/self.test.ts`)

Test cases:

- **Authorization:** Reject identity without `Status_Self` permission
- **Missing header:** Return `InternalServerError` when `x-forwarded-for` is absent from args
- **Happy path (non-Tailscale):** `x-forwarded-for: "192.168.1.1"` → `isTailscale: false`
- **Happy path (Tailscale IPv4):** `x-forwarded-for: "100.64.0.1"` → `isTailscale: true`
- **Happy path (Tailscale IPv6):** `x-forwarded-for: "fd7a:115c:a1e0::1"` → `isTailscale: true`
- **Permissions check:** Verify the response `permissions` matches identity's permission set
- **Fullname None:** Guest identity returns `fullname: Option.none()`

#### 1n. E2E Test (`homelab-e2e-tests/src/status/self.test.ts`)

Test cases:

- **Authorization:** Reject `TEST_LIMITED_API_KEY` if it lacks `Status_Self`
- **Success (guest):** Unauthenticated request returns `principal: "guest"`, `fullname: null`, correct guest permissions
- **Success (authenticated):** Request with `TEST_API_KEY` returns correct `principal`, `permissions`
- **Header presence:** Verify the response contains `isTailscale` as a boolean (don't assert specific value since OS-controlled)
- **Do NOT test:** Specific Tailscale IP detection (controlled by network environment)

---

## 2. Remove ACME Endpoints

Remove the `acme` and `acme-download` endpoints entirely. **Keep** `AcmeConfigService`, `AcmeProfileGeneratorService`, and their tests/implementations.

### Files to Delete

| File                                                                        | Purpose               |
| --------------------------------------------------------------------------- | --------------------- |
| `packages/homelab-api/src/homelab/mobile-config/acme.ts`                    | Endpoint definition   |
| `packages/homelab-api/src/homelab/mobile-config/acme-download.ts`           | Endpoint definition   |
| `packages/homelab-server/src/handlers/mobile-config/acme.ts`                | Handler               |
| `packages/homelab-server/src/handlers/mobile-config/acme-download.ts`       | Handler               |
| `packages/homelab-server/test/handlers/mobile-config/acme.test.ts`          | Unit test             |
| `packages/homelab-server/test/handlers/mobile-config/acme-download.test.ts` | Unit test (if exists) |
| `packages/homelab-e2e-tests/src/mobile-config/acme.test.ts`                 | E2E test              |
| `packages/homelab-e2e-tests/src/mobile-config/acme-download.test.ts`        | E2E test (if exists)  |

### Files to Modify

| File                                                                              | Change                                                                      |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `packages/homelab-api/src/homelab/mobile-config/index.ts`                         | Remove `Acme` and `AcmeDownload` imports, `.add(...)` calls, and re-exports |
| `packages/homelab-server/src/handlers/mobile-config/index.ts`                     | Remove `handleAcme`/`handleAcmeDownload` imports and `.handle(...)` calls   |
| `packages/homelab-services/src/schemas/resource-uris.ts`                          | Remove `"Config_ACME"` from `ResourceURISchema`                             |
| `packages/homelab-services-node/src/layers/fine-grained-authorization-service.ts` | Remove `"Config_ACME"` matcher                                              |
| `packages/homelab-services-node/test/authorization-service.test.ts`               | Remove `"Config_ACME"` from `defaults` record                               |
| `nix-config/modules/features/homelab-api/systemd-service.nix`                     | Remove `"Config_ACME"` from permissions enum                                |
| `nix-config/modules/features/homelab-api/kanidm.nix`                              | Remove `"Config_ACME"` from `homelab.admins` claim map                      |
| `nix-config/modules/_private/augustus/programs.nix`                               | Remove `"Config_ACME"` from `apiKeys.jacob.permissions`                     |

### Files to Keep (Unchanged)

- `packages/homelab-services-node/src/layers/acme-config-service.ts`
- `packages/homelab-services-node/src/layers/acme-profile-generator-service.ts`
- `packages/homelab-services/src/services/acme-config-service.ts`
- `packages/homelab-services/src/services/acme-profile-generator-service.ts`
- `packages/homelab-services/src/schemas/config-acme.ts`
- Any tests for the config service or profile generator itself

---

## 3. Add `SerialNumberConfig` Service

A new config service that resolves IP addresses to device serial numbers from a JSON file.

### File Format

Plain JSON object mapping IP addresses to serial number strings:

```json
{
  "100.104.220.114": "ABCDEF123",
  "fd7a:115c:a1e0::6f01:dc8c": "ABCDEF123",
  "100.69.89.38": "456789GHI"
}
```

### New Schema Required

#### `homelab-services/src/schemas/IpAddress.ts`

```typescript
import { Schema } from "effect"

export const IpAddress = Schema.String.pipe(
  Schema.brand("IpAddress"),
)

export type IpAddress = typeof IpAddress.Type
```

Register in `schemas/index.ts`:

```typescript
export * as IpAddress from "./IpAddress.js"
```

### Implementation Steps

#### 3a. Service Definition (`homelab-services/src/config/serial-number-config.ts`)

```typescript
import { Context, Effect, Option } from "effect"

export const SerialNumberConfigId = "homelab-api/config/serial-number-config/SerialNumberConfig"

export interface SerialNumberConfigDef {
  /** Resolves an IP address to a device serial number, or None if not found. */
  readonly resolveIp: (ip: string) => Option.Option<string>
}

export class SerialNumberConfig extends Context.Tag(SerialNumberConfigId)<
  SerialNumberConfig,
  SerialNumberConfigDef
>() {}

/** {@inheritDoc SerialNumberConfigDef.resolveIp} */
export function resolveIp(
  ip: string,
): Effect.Effect<Option.Option<string>, never, SerialNumberConfig> {
  return SerialNumberConfig.pipe(Effect.map((_) => _.resolveIp(ip)))
}
```

Register in `homelab-services/src/config/index.ts`:

```typescript
export * as SerialNumberConfig from "./serial-number-config.js"
```

#### 3b. Env Config Addition

**`homelab-services/src/config/env.ts`:**

- Add `readonly serialNumbersFile: Option.Option<string>` to `EnvDef`
- Add accessor: `export const serialNumbersFile = Env.pipe(Effect.map((_) => _.serialNumbersFile))`

**`packages/homelab-server/src/env.ts`:**

- Add `serialNumbersFile: Config.option(Config.string("SERIAL_NUMBERS_FILE"))` to `Config.all`

#### 3c. Implementation (`homelab-services-node/src/config/serial-number-config.ts`)

```typescript
import { FileSystem } from "@effect/platform"
import { Effect, HashMap, Layer, Option, pipe, Schema } from "effect"
import { Config, Schemas } from "homelab-services"

const ParseSerialNumbers = Schema.compose(
  Schemas.Buffer.StringFromUint8Array,
  Schema.parseJson(
    Schemas.HashMapFromRecord.HashSetFromRecord(
      Schemas.IpAddress.IpAddress,
      Schema.String,
    ),
  ),
)

export const SerialNumberConfigLive = Layer.effect(
  Config.SerialNumberConfig.SerialNumberConfig,
  Effect.gen(function*() {
    const filePath = yield* Config.Env.serialNumbersFile

    if (Option.isNone(filePath)) {
      return new SerialNumberConfigImpl(HashMap.empty())
    }

    const fs = yield* FileSystem.FileSystem
    const serialNumbers = yield* pipe(
      fs.readFile(filePath.value),
      Effect.andThen(Schema.decode(ParseSerialNumbers)),
    )

    return new SerialNumberConfigImpl(serialNumbers)
  }),
)

class SerialNumberConfigImpl implements Config.SerialNumberConfig.SerialNumberConfigDef {
  constructor(
    private readonly serialNumbers: HashMap.HashMap<string, string>,
  ) {}

  resolveIp(ip: string): Option.Option<string> {
    return HashMap.get(this.serialNumbers, ip)
  }
}
```

Register in `homelab-services-node/src/config/index.ts`:

```typescript
export * from "./serial-number-config.js"
```

#### 3d. Testing Layer Updates

**`packages/homelab-server/test-utils/testing-layer.ts`:**

- Add `["SERIAL_NUMBERS_FILE", path.join(privateDir, "serial-numbers.json")]` to `ConfigProvider.fromMap`

**`packages/homelab-services-node/test-utils/testing-layer.ts`:**

- Add `["SERIAL_NUMBERS_FILE", path.join(privateDir, "serial-numbers.json")]` to `ConfigProvider.fromMap`
- Add `serialNumbersFile: Option.some(path.join(privateDir, "serial-numbers.json"))` to `makeTestEnvWithFlags`

Create test fixture `packages/homelab-server/private/serial-numbers.json` (and equivalent in `homelab-services-node/private/`):

```json
{
  "192.168.1.10": "TEST-SERIAL-001",
  "100.64.0.1": "TEST-SERIAL-002"
}
```

#### 3e. Unit Test (`homelab-services-node/test/serial-number-config.test.ts`)

Test cases:

- `resolveIp` returns `Some(serial)` for a known IP
- `resolveIp` returns `None` for an unknown IP
- Empty file (or None path) produces empty HashMap (returns None for any IP)

---

## 4. Nix Configuration for Serial Numbers

### 4a. Systemd Service Option (`nix-config/modules/features/homelab-api/systemd-service.nix`)

Add a new option:

```nix
serialNumbersFile = lib.mkOption {
  type = lib.types.nullOr lib.types.str;
  description = "Path to a JSON file mapping IP addresses to device serial numbers";
  default = null;
};
```

In the `sops.templates."homelab-api-env"` content, conditionally add:

```nix
${if cfg.serialNumbersFile != null then "SERIAL_NUMBERS_FILE=${cfg.serialNumbersFile}" else ""}
```

### 4b. Augustus SOPS Secrets (`nix-config/modules/_private/augustus/sops.nix`)

Add secrets:

```nix
sops.secrets.ipad_serial_number = {
  owner = "homelab-api";
  group = "homelab-api";
};

sops.secrets.iphone_serial_number = {
  owner = "homelab-api";
  group = "homelab-api";
};
```

Add SOPS template for the serial numbers JSON file:

```nix
sops.templates."serial-numbers-file" = {
  owner = "homelab-api";
  group = "homelab-api";
  content = builtins.toJSON {
    "100.104.220.114" = config.sops.placeholder.ipad_serial_number;
    "fd7a:115c:a1e0::6f01:dc8c" = config.sops.placeholder.ipad_serial_number;
    "100.69.89.38" = config.sops.placeholder.iphone_serial_number;
    "fd7a:115c:a1e0::601:5927" = config.sops.placeholder.iphone_serial_number;
  };
};
```

### 4c. Augustus Programs (`nix-config/modules/_private/augustus/programs.nix`)

Set the serial numbers file path:

```nix
services.homelab-api = {
  # ... existing config
  serialNumbersFile = config.sops.templates."serial-numbers-file".path;
};
```

### 4d. Praeconinus

No changes needed — `serialNumbersFile` defaults to `null`, so `SERIAL_NUMBERS_FILE` won't be set in the environment.

---

## 5. Summary of Cross-Cutting Changes

### `homelab-services/src/schemas/resource-uris.ts`

Final state after removing `Config_ACME` and adding `Status_Self`:

```typescript
export const ResourceURISchema = Schema.Literal(
  "Config_Wifi",
  "Config_Certs",
  "Config_DNS",
  "Cert_Root",
  "Cert_Intermediate",
  "Cert_Combined",
  "Status_Health",
  "Status_Self",
  "OAuth_Token",
  "OAuth_ClaimCheck",
)
```

### `homelab-services-node/src/layers/fine-grained-authorization-service.ts`

Remove `"Config_ACME"` matcher, add `"Status_Self": () => Effect.succeed(true as const)`.

### `homelab-services-node/test/authorization-service.test.ts`

Remove `"Config_ACME"` from defaults, add `"Status_Self": {}`.

### `nix-config/modules/features/homelab-api/systemd-service.nix`

Permissions enum:

```nix
lib.types.enum [
  "Config_Wifi"
  "Config_Certs"
  "Cert_Root"
  "Cert_Intermediate"
  "Cert_Combined"
  "Status_Health"
  "Status_Self"
  "OAuth_Token"
  "OAuth_ClaimCheck"
]
```

Add `serialNumbersFile` option. Add conditional `SERIAL_NUMBERS_FILE` to env template.

### Testing Layer ConfigProviders

Both `homelab-server/test-utils/testing-layer.ts` and `homelab-services-node/test-utils/testing-layer.ts` need:

- `SERIAL_NUMBERS_FILE` added to the config map
- `serialNumbersFile` added to `makeTestEnvWithFlags`

---

## Execution Order

1. **Create new schemas** (`IpAddress.ts`, `status-self.ts`) and register in barrel
2. **Modify Identity** (add `fullname`, `permissionSet` to base + all subclasses)
3. **Modify JWT schema + OIDC auth** (add `name` to `HomelabIdentityJWT`, pass through)
4. **Remove ACME endpoints** (delete files, update registrations, remove `Config_ACME` from resource URIs)
5. **Add `Status_Self` resource URI + FGA + guest permissions**
6. **Add `SerialNumberConfig` service** (definition + implementation)
7. **Add `Status_Self` endpoint definition + handler + register**
8. **Update Nix config** (feature flags, env vars, permissions, SOPS secrets/templates)
9. **Update testing layers** (config providers, test fixtures)
10. **Write unit tests**
11. **Write e2e tests**
12. **Validate:** `dprint fmt .`, `yarn lint --fix`, `yarn lint`, `yarn typecheck`, `yarn test`
