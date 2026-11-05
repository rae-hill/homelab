import { Context, Effect } from "effect"
import type { AuthorizationError, InternalServerError } from "../errors/http-errors.js"
import type { Identity } from "../identity.js"
import type { Operation } from "../operation.js"
import type { ResourceURIs } from "../resource-uris.js"

export const AuthorizationServiceId = "homelab-api/services/authorization-service/AuthorizationService"

/**
 * Checks whether an identity is permitted to perform an operation on a resource.
 * @remarks Methods are generated from the `Operation` union as `can${Capitalize<Operation>}` — e.g. `canView`, `canModify`, `canCreate`, `canDelete`. Each fails with `AuthorizationError` if the identity lacks permission.
 */
export type AuthorizationServiceDef = {
  +readonly [K in Operation as `can${Capitalize<K>}`]: (
    identity: Identity,
    resource: ResourceURIs,
    params: unknown,
  ) => Effect.Effect<true, AuthorizationError | InternalServerError>
}

export class AuthorizationService
  extends Context.Service<AuthorizationService, AuthorizationServiceDef>()(AuthorizationServiceId)
{
}

/** Checks whether the identity is authorized to view the given resource. */
export const canView = Effect.fn("AuthorizationService.canView")(function*(
  ...params: Parameters<AuthorizationServiceDef["canView"]>
): Effect.fn.Return<true, AuthorizationError | InternalServerError, AuthorizationService> {
  const svc = yield* AuthorizationService
  return yield* svc.canView(...params)
})

/** Checks whether the identity is authorized to modify the given resource. */
export const canModify = Effect.fn("AuthorizationService.canModify")(function*(
  ...params: Parameters<AuthorizationServiceDef["canModify"]>
): Effect.fn.Return<true, AuthorizationError | InternalServerError, AuthorizationService> {
  const svc = yield* AuthorizationService
  return yield* svc.canModify(...params)
})

/** Checks whether the identity is authorized to create the given resource. */
export const canCreate = Effect.fn("AuthorizationService.canCreate")(function*(
  ...params: Parameters<AuthorizationServiceDef["canCreate"]>
): Effect.fn.Return<true, AuthorizationError | InternalServerError, AuthorizationService> {
  const svc = yield* AuthorizationService
  return yield* svc.canCreate(...params)
})

/** Checks whether the identity is authorized to delete the given resource. */
export const canDelete = Effect.fn("AuthorizationService.canDelete")(function*(
  ...params: Parameters<AuthorizationServiceDef["canDelete"]>
): Effect.fn.Return<true, AuthorizationError | InternalServerError, AuthorizationService> {
  const svc = yield* AuthorizationService
  return yield* svc.canDelete(...params)
})
