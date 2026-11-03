import { Context, Effect, pipe } from "effect"
import type { AuthorizationError, InternalServerError } from "../errors/http-errors.js"
import type { Identity } from "../identity.js"
import type { Operation } from "../operation.js"
import type { ResourceURIs } from "../resource-uris.js"

export const FineGrainedAuthorizationServiceId =
  "homelab-api/services/fine-grained-authorization-service/FineGrainedAuthorizationService"

export interface FineGrainedAuthorizationServiceDef {
  /**
   * Returns an effect transformer that applies resource-level authorization checks on top of a coarse-grained allow.
   * @remarks The transformer fails with `AuthorizationError` if the identity is not permitted to perform the operation on the specific resource.
   */
  refine<E, R>(
    operation: Operation,
    identity: Identity,
    resource: ResourceURIs,
    fgaParams: unknown,
  ): (effect: Effect.Effect<true, E, R>) => Effect.Effect<true, E | AuthorizationError | InternalServerError, R>
}

export class FineGrainedAuthorizationService
  extends Context.Service<FineGrainedAuthorizationService, FineGrainedAuthorizationServiceDef>()(
    FineGrainedAuthorizationServiceId,
  )
{
}

/** {@inheritDoc FineGrainedAuthorizationServiceDef.refine} */
export function refine<E, R>(
  operation: Operation,
  identity: Identity,
  resource: ResourceURIs,
  fgaParams: unknown,
): (
  effect: Effect.Effect<true, E, R>,
) => Effect.Effect<true, E | AuthorizationError | InternalServerError, R | FineGrainedAuthorizationService> {
  return (effect) =>
    FineGrainedAuthorizationService.pipe(
      Effect.flatMap(
        (_) => pipe(effect, _.refine(operation, identity, resource, fgaParams)),
      ),
    )
}
