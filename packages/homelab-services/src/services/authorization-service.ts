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
export function canView(
  ...params: Parameters<AuthorizationServiceDef["canView"]>
): Effect.Effect<true, AuthorizationError | InternalServerError, AuthorizationService> {
  return AuthorizationService.pipe(
    Effect.flatMap(
      (_) => _.canView(...params),
    ),
  )
}

/** Checks whether the identity is authorized to modify the given resource. */
export function canModify(
  ...params: Parameters<AuthorizationServiceDef["canModify"]>
): Effect.Effect<true, AuthorizationError | InternalServerError, AuthorizationService> {
  return AuthorizationService.pipe(
    Effect.flatMap(
      (_) => _.canModify(...params),
    ),
  )
}

/** Checks whether the identity is authorized to create the given resource. */
export function canCreate(
  ...params: Parameters<AuthorizationServiceDef["canCreate"]>
): Effect.Effect<true, AuthorizationError | InternalServerError, AuthorizationService> {
  return AuthorizationService.pipe(
    Effect.flatMap(
      (_) => _.canCreate(...params),
    ),
  )
}

/** Checks whether the identity is authorized to delete the given resource. */
export function canDelete(
  ...params: Parameters<AuthorizationServiceDef["canDelete"]>
): Effect.Effect<true, AuthorizationError | InternalServerError, AuthorizationService> {
  return AuthorizationService.pipe(
    Effect.flatMap(
      (_) => _.canDelete(...params),
    ),
  )
}
