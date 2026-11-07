import { assert, describe, expect, it } from "@effect/vitest"
import { Effect, HashSet, Layer } from "effect"
import { ApiErrors, Identity, Operation, type ResourceURIs, Schemas, Services } from "homelab-services"
import { Layers } from "../src/index.js"
import { makeTestEnvWithFlags, TestNonceService, TestSerialNumberConfig } from "../test-utils/index.js"

const allOperations = Object.values(Operation)

const operationMethodMap = {
  [Operation.view]: Services.AuthorizationService.canView,
  [Operation.create]: Services.AuthorizationService.canCreate,
  [Operation.modify]: Services.AuthorizationService.canModify,
  [Operation.delete]: Services.AuthorizationService.canDelete,
} as const

describe("AuthorizationService", () => {
  describe.for(Schemas.ResourceURIs.ResourceURILiterals)("%s", (resource) => {
    describe.for(allOperations)("%s", (operation) => {
      const checkPermission = operationMethodMap[operation]
      const otherResource = getDifferentResource(resource)
      const otherOperation = getDifferentOperation(operation)

      it.effect("should allow OIDC identity with resource permission", () =>
        Effect.gen(function*() {
          const identity = createOIDCIdentity("user@example.com", [resource])
          const result = yield* checkPermission(identity, resource, setupParams(resource))

          expect(result).toBe(true)
        }).pipe(Effect.provide(TestLayer([`${resource}.enabled`]))))

      it.effect("should allow OIDC identity with all required permissions", () =>
        Effect.gen(function*() {
          const identity = createOIDCIdentity("user@example.com", getRequiredPermissions(resource, operation))
          const result = yield* checkPermission(identity, resource, setupParams(resource))

          expect(result).toBe(true)
        }).pipe(Effect.provide(TestLayer([`${resource}.enabled`]))))

      it.effect("should allow mTLS identity with resource permission", () =>
        Effect.gen(function*() {
          const identity = createMTLSIdentity("client.example.com", [resource])
          const result = yield* checkPermission(identity, resource, setupParams(resource))

          expect(result).toBe(true)
        }).pipe(Effect.provide(TestLayer([`${resource}.enabled`]))))

      it.effect("should allow mTLS identity with all required permissions", () =>
        Effect.gen(function*() {
          const identity = createMTLSIdentity("client.example.com", getRequiredPermissions(resource, operation))
          const result = yield* checkPermission(identity, resource, setupParams(resource))

          expect(result).toBe(true)
        }).pipe(Effect.provide(TestLayer([`${resource}.enabled`]))))

      it.effect("should deny when OIDC identity lacks permissions", () =>
        Effect.gen(function*() {
          const identity = createOIDCIdentity("user@example.com", [otherResource])
          const result = yield* Effect.flip(checkPermission(identity, resource, setupParams(resource)))

          assert(
            result instanceof ApiErrors.AuthorizationError,
            `Expected AuthorizationError, got ${result._tag ?? result}`,
          )

          const expectedOperation = getExpectedFailureOperation(operation)

          expect(result.operation).toBe(expectedOperation)
          expect(result.resource).toBe(resource)
          expect(result.message).toBe(`${identity} is not allowed to perform ${expectedOperation} on ${resource}`)
        }).pipe(Effect.provide(TestLayer([`${resource}.enabled`]))))

      it.effect("should deny when mTLS identity lacks permissions", () =>
        Effect.gen(function*() {
          const identity = createMTLSIdentity("client.example.com", [otherResource])
          const result = yield* Effect.flip(checkPermission(identity, resource, setupParams(resource)))

          assert(
            result instanceof ApiErrors.AuthorizationError,
            `Expected AuthorizationError, got ${result._tag ?? result}`,
          )

          const expectedOperation = getExpectedFailureOperation(operation)

          expect(result.operation).toBe(expectedOperation)
          expect(result.resource).toBe(resource)
          expect(result.message).toBe(`${identity} is not allowed to perform ${expectedOperation} on ${resource}`)
        }).pipe(Effect.provide(TestLayer([`${resource}.enabled`]))))

      it.effect("should deny when OIDC identity has permission for different resource", () =>
        Effect.gen(function*() {
          const identity = createOIDCIdentity("user@example.com", [`${otherResource}.${operation}`])
          const result = yield* Effect.flip(checkPermission(identity, resource, setupParams(resource)))

          assert(
            result instanceof ApiErrors.AuthorizationError,
            `Expected AuthorizationError, got ${result._tag ?? result}`,
          )

          const expectedOperation = getExpectedFailureOperation(operation)

          expect(result.operation).toBe(expectedOperation)
          expect(result.resource).toBe(resource)
          expect(result.message).toBe(`${identity} is not allowed to perform ${expectedOperation} on ${resource}`)
        }).pipe(Effect.provide(TestLayer(["*"]))))

      it.effect("should deny when OIDC identity has permission for different operation", () =>
        Effect.gen(function*() {
          const requiredPermissions = getRequiredPermissions(resource, operation).filter((p) =>
            p !== `${resource}.${operation}`
          )
          const identity = createOIDCIdentity("user@example.com", [
            ...requiredPermissions,
            `${resource}.${otherOperation}`,
          ])
          const result = yield* Effect.flip(checkPermission(identity, resource, setupParams(resource)))

          assert(
            result instanceof ApiErrors.AuthorizationError,
            `Expected AuthorizationError, got ${result._tag ?? result}`,
          )
          expect(result.operation).toBe(operation)
          expect(result.resource).toBe(resource)
          expect(result.message).toBe(`${identity} is not allowed to perform ${operation} on ${resource}`)
        }).pipe(Effect.provide(TestLayer(["*"]))))

      it.effect("should deny when feature flag enabled for different operation", () =>
        Effect.gen(function*() {
          const identity = createOIDCIdentity("user@example.com", [resource])
          const result = yield* Effect.flip(checkPermission(identity, resource, setupParams(resource)))

          assert(
            result instanceof ApiErrors.AuthorizationError,
            `Expected AuthorizationError, got ${result._tag ?? result}`,
          )

          const expectedOperation = getExpectedFailureOperation(operation, otherOperation)

          expect(result.operation).toBe(expectedOperation)
          expect(result.resource).toBe(resource)
          expect(result.message).toBe(`${expectedOperation} is not enabled for ${resource}`)
        }).pipe(Effect.provide(TestLayer([`${resource}.${otherOperation}.enabled`]))))

      it.effect("should deny when feature flag enabled for different resource", () =>
        Effect.gen(function*() {
          const identity = createOIDCIdentity("user@example.com", [resource])
          const result = yield* Effect.flip(checkPermission(identity, resource, setupParams(resource)))

          assert(
            result instanceof ApiErrors.AuthorizationError,
            `Expected AuthorizationError, got ${result._tag ?? result}`,
          )

          const expectedOperation = getExpectedFailureOperation(operation)

          expect(result.operation).toBe(expectedOperation)
          expect(result.resource).toBe(resource)
          expect(result.message).toBe(`${expectedOperation} is not enabled for ${resource}`)
        }).pipe(Effect.provide(TestLayer([`${otherResource}.enabled`]))))

      it.effect("should allow when wildcard feature flag is enabled", () =>
        Effect.gen(function*() {
          const identity = createOIDCIdentity("user@example.com", [resource])
          const result = yield* checkPermission(identity, resource, setupParams(resource))

          expect(result).toBe(true)
        }).pipe(Effect.provide(TestLayer(["*"]))))

      it.effect("should allow when operation-specific feature flag is enabled", () =>
        Effect.gen(function*() {
          const identity = createOIDCIdentity("user@example.com", [resource])
          const result = yield* checkPermission(identity, resource, setupParams(resource))

          expect(result).toBe(true)
        }).pipe(Effect.provide(TestLayer(getRequiredFeatureFlags(resource, operation)))))
    })
  })

  describe.for(Schemas.ResourceURIs.ResourceURILiterals)("permission hierarchy - %s", (resource) => {
    it.effect("should allow resource-level permission for any operation", () =>
      Effect.gen(function*() {
        const identity = createOIDCIdentity("admin@example.com", [resource])
        const viewResult = yield* Services.AuthorizationService.canView(identity, resource, setupParams(resource))
        const createResult = yield* Services.AuthorizationService.canCreate(
          identity,
          resource,
          setupParams(resource),
        )
        const modifyResult = yield* Services.AuthorizationService.canModify(
          identity,
          resource,
          setupParams(resource),
        )
        const deleteResult = yield* Services.AuthorizationService.canDelete(
          identity,
          resource,
          setupParams(resource),
        )

        expect(viewResult).toBe(true)
        expect(createResult).toBe(true)
        expect(modifyResult).toBe(true)
        expect(deleteResult).toBe(true)
      }).pipe(Effect.provide(TestLayer(["*"]))))

    it.effect("should enforce operation-specific permissions", () =>
      Effect.gen(function*() {
        const identity = createOIDCIdentity("user@example.com", [`${resource}.view`])
        const viewResult = yield* Services.AuthorizationService.canView(identity, resource, setupParams(resource))
        const createResult = yield* Effect.flip(
          Services.AuthorizationService.canCreate(identity, resource, setupParams(resource)),
        )
        const modifyResult = yield* Effect.flip(
          Services.AuthorizationService.canModify(identity, resource, setupParams(resource)),
        )
        const deleteResult = yield* Effect.flip(
          Services.AuthorizationService.canDelete(identity, resource, setupParams(resource)),
        )

        expect(viewResult).toBe(true)

        assert(
          createResult instanceof ApiErrors.AuthorizationError,
          `Expected AuthorizationError for create, got ${createResult._tag ?? createResult}`,
        )
        expect(createResult.operation).toBe(Operation.create)
        expect(createResult.resource).toBe(resource)
        expect(createResult.message).toBe(`${identity} is not allowed to perform ${Operation.create} on ${resource}`)

        assert(
          modifyResult instanceof ApiErrors.AuthorizationError,
          `Expected AuthorizationError for modify, got ${modifyResult._tag ?? modifyResult}`,
        )
        expect(modifyResult.operation).toBe(Operation.create)
        expect(modifyResult.resource).toBe(resource)
        expect(modifyResult.message).toBe(`${identity} is not allowed to perform ${Operation.create} on ${resource}`)

        assert(
          deleteResult instanceof ApiErrors.AuthorizationError,
          `Expected AuthorizationError for delete, got ${deleteResult._tag ?? deleteResult}`,
        )
        expect(deleteResult.operation).toBe(Operation.create)
        expect(deleteResult.resource).toBe(resource)
        expect(deleteResult.message).toBe(`${identity} is not allowed to perform ${Operation.create} on ${resource}`)
      }).pipe(Effect.provide(TestLayer(["*"]))))
  })

  describe.for(Schemas.ResourceURIs.ResourceURILiterals)("edge cases - %s", (resource) => {
    it.effect("should deny access with empty permissions", () =>
      Effect.gen(function*() {
        const identity = createOIDCIdentity("user@example.com", [])
        const result = yield* Effect.flip(
          Services.AuthorizationService.canView(identity, resource, setupParams(resource)),
        )

        assert(
          result instanceof ApiErrors.AuthorizationError,
          `Expected AuthorizationError, got ${result._tag ?? result}`,
        )
        expect(result.operation).toBe(Operation.view)
        expect(result.resource).toBe(resource)
        expect(result.message).toBe(`${identity} is not allowed to perform ${Operation.view} on ${resource}`)
      }).pipe(Effect.provide(TestLayer(["*"]))))
  })

  describe("fine-grained authorization - Config_Wifi", () => {
    it.effect("should allow OIDC identity when principle matches username", () =>
      Effect.gen(function*() {
        const identity = createOIDCIdentity("john@example.com", ["Config_Wifi"])
        const params = setupParams("Config_Wifi", {
          "Config_Wifi": { payload: { enterpriseClientType: "PEAP", username: "john" } },
        })
        const result = yield* Services.AuthorizationService.canCreate(identity, "Config_Wifi", params)

        expect(result).toBe(true)
      }).pipe(Effect.provide(TestLayer(["*"]))))

    it.effect("should deny OIDC identity when principle does not match username", () =>
      Effect.gen(function*() {
        const identity = createOIDCIdentity("john@example.com", ["Config_Wifi"])
        const params = setupParams("Config_Wifi", {
          "Config_Wifi": { payload: { enterpriseClientType: "PEAP", username: "alice" } },
        })
        const result = yield* Effect.flip(
          Services.AuthorizationService.canCreate(identity, "Config_Wifi", params),
        )

        assert(
          result instanceof ApiErrors.AuthorizationError,
          `Expected AuthorizationError, got ${result._tag ?? result}`,
        )
        expect(result.operation).toBe(Operation.view)
        expect(result.resource).toBe("Config_Wifi")
        expect(result.message).toBe("User's principle identifer must match the requested username")
      }).pipe(Effect.provide(TestLayer(["*"]))))

    it.effect("should allow OIDC identity when no username is provided", () =>
      Effect.gen(function*() {
        const identity = createOIDCIdentity("john@example.com", ["Config_Wifi"])
        const params = setupParams("Config_Wifi")
        const result = yield* Services.AuthorizationService.canCreate(identity, "Config_Wifi", params)

        expect(result).toBe(true)
      }).pipe(Effect.provide(TestLayer(["*"]))))

    it.effect("should allow any OIDC identity to create guest WiFi payload", () =>
      Effect.gen(function*() {
        const identity = createOIDCIdentity("sarah@example.com", ["Config_Wifi"])
        const params = setupParams("Config_Wifi", {
          "Config_Wifi": { payload: { enterpriseClientType: "PEAP", username: "guest" } },
        })
        const result = yield* Services.AuthorizationService.canCreate(identity, "Config_Wifi", params)

        expect(result).toBe(true)
      }).pipe(Effect.provide(TestLayer(["*"]))))

    it.effect("should deny EAP-TLS when IP address is not recognized", () =>
      Effect.gen(function*() {
        const identity = createOIDCIdentity("user@example.com", ["Config_Wifi"])
        const params = setupParams("Config_Wifi", {
          "Config_Wifi": {
            payload: { enterpriseClientType: "EAP-TLS" },
            headers: { "x-forwarded-for": "10.0.0.99" },
          },
        })
        const result = yield* Effect.flip(
          Services.AuthorizationService.canCreate(identity, "Config_Wifi", params),
        )

        assert(
          result instanceof ApiErrors.AuthorizationError,
          `Expected AuthorizationError, got ${result._tag ?? result}`,
        )
        expect(result.message).toBe("IP address not recognized")
      }).pipe(Effect.provide(TestLayer(["*"]))))
  })
})

function getRequiredPermissions(
  resource: ResourceURIs.ResourceURIs,
  minPermission: Operation,
): Array<Schemas.ScopeGroups.ScopeOrGroup> {
  const permissions: Array<Schemas.ScopeGroups.ScopeOrGroup> = [`${resource}.${minPermission}`]
  if (minPermission === Operation.create) {
    permissions.push(`${resource}.${Operation.view}`)
  } else if (minPermission === Operation.modify) {
    permissions.push(`${resource}.${Operation.view}`, `${resource}.${Operation.create}`)
  } else if (minPermission === Operation.delete) {
    permissions.push(
      `${resource}.${Operation.view}`,
      `${resource}.${Operation.create}`,
      `${resource}.${Operation.modify}`,
    )
  }
  return permissions
}

function getRequiredFeatureFlags(
  resource: ResourceURIs.ResourceURIs,
  minPermission: Operation,
): Array<Schemas.FeatureFlags.FeatureFlags> {
  const flags: Array<Schemas.FeatureFlags.FeatureFlags> = [`${resource}.${minPermission}.enabled`]
  if (minPermission === Operation.create) {
    flags.push(`${resource}.${Operation.view}.enabled`)
  } else if (minPermission === Operation.modify) {
    flags.push(`${resource}.${Operation.view}.enabled`, `${resource}.${Operation.create}.enabled`)
  } else if (minPermission === Operation.delete) {
    flags.push(
      `${resource}.${Operation.view}.enabled`,
      `${resource}.${Operation.create}.enabled`,
      `${resource}.${Operation.modify}.enabled`,
    )
  }
  return flags
}

function getExpectedFailureOperation(requestedOperation: Operation, enabledOperation?: Operation): Operation {
  if (requestedOperation === Operation.view) {
    return Operation.view
  } else if (requestedOperation === Operation.create) {
    return enabledOperation === Operation.view ? Operation.create : Operation.view
  } else if (requestedOperation === Operation.modify) {
    return enabledOperation === Operation.view ?
      Operation.create :
      enabledOperation === Operation.create
      ? Operation.modify
      : Operation.view
  } else {
    return enabledOperation === Operation.view ?
      Operation.create :
      enabledOperation === Operation.create ?
      Operation.modify :
      enabledOperation === Operation.modify
      ? Operation.delete
      : Operation.view
  }
}

function createOIDCIdentity(email: string, groups: Array<Schemas.ScopeGroups.ScopeOrGroup>): Identity.Identity {
  return new Identity.OIDCIdentity(email, HashSet.fromIterable(groups))
}

function createMTLSIdentity(commonName: string, scopes: Array<Schemas.ScopeGroups.ScopeOrGroup>): Identity.Identity {
  return new Identity.MTLSIdentity(commonName, HashSet.fromIterable(scopes))
}

function TestLayer(flags: Array<Schemas.FeatureFlags.FeatureFlags>) {
  return Layers.AuthorizationService.AuthorizationServiceLive.pipe(
    Layer.provideMerge(Layers.FeatureFlagService.FeatureFlagServiceLive),
    Layer.provideMerge(Layers.FineGrainedAuthorizationService.FineGrainedAuthorizationServiceLive),
    Layer.provideMerge(TestSerialNumberConfig),
    Layer.provideMerge(makeTestEnvWithFlags(HashSet.fromIterable(flags))),
    Layer.provideMerge(TestNonceService),
  )
}

function getDifferentResource<T extends ResourceURIs.ResourceURIs>(current: T): Exclude<ResourceURIs.ResourceURIs, T> {
  return Schemas.ResourceURIs.ResourceURILiterals.find((r): r is Exclude<ResourceURIs.ResourceURIs, T> =>
    r !== current
  )!
}

function getDifferentOperation<T extends Operation>(current: T): Exclude<Operation, T> {
  return allOperations.find((op): op is Exclude<Operation, T> => op !== current)!
}

function setupParams<Res extends ResourceURIs.ResourceURIs>(
  resource: Res,
  overrides: Record<string, unknown> = {},
): unknown {
  const defaults: Record<ResourceURIs.ResourceURIs, unknown> = {
    "Config_Wifi": {
      path: { ssid: "test-ssid", encryption: "WPA3", ...(overrides["Config_Wifi"] as any)?.path },
      payload: {
        password: "test-password",
        disableMACRandomization: false,
        ...(overrides["Config_Wifi"] as any)?.payload,
      },
      headers: {
        ...(overrides["Config_Wifi"] as any)?.headers,
      },
    },
    "Config_Certs": {},
    "Config_DNS": {},
    "Cert_Root": {},
    "Cert_Intermediate": {},
    "Cert_Combined": {},
    "Status_Health": {},
    "Status_Self": {},
    "OAuth_Token": {},
    "OAuth_ClaimCheck": {},
    "Resume_Print": {},
    "Resume_Tailor": {},
  }

  return defaults[resource]
}
