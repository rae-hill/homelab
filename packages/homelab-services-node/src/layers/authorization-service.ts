import { Effect, Layer, pipe } from "effect"
import { ApiErrors, type Identity, Operation, type ResourceURIs, Services } from "homelab-services"

export const AuthorizationServiceLive = Layer.effect(
  Services.AuthorizationService.AuthorizationService,
  Effect.gen(function*() {
    return new AuthorizationServiceImpl(
      yield* Services.FeatureFlagService.FeatureFlagService,
      yield* Services.FineGrainedAuthorizationService.FineGrainedAuthorizationService,
    )
  }),
)

class AuthorizationServiceImpl implements Services.AuthorizationService.AuthorizationServiceDef {
  constructor(
    private readonly featureFlagService: typeof Services.FeatureFlagService.FeatureFlagService.Service,
    private readonly fgaService:
      typeof Services.FineGrainedAuthorizationService.FineGrainedAuthorizationService.Service,
  ) {}

  canView(identity: Identity.Identity, resource: ResourceURIs.ResourceURIs, params: unknown) {
    return this.hasFeatureFlag(resource, Operation.view).pipe(
      this.authorize(identity, Operation.view, resource),
      this.authorizeFga(identity, Operation.view, resource, params),
    )
  }

  canCreate(identity: Identity.Identity, resource: ResourceURIs.ResourceURIs, params: unknown) {
    return this.canView(identity, resource, params).pipe(
      Effect.andThen(this.hasFeatureFlag(resource, Operation.create)),
      this.authorize(identity, Operation.create, resource),
      this.authorizeFga(identity, Operation.create, resource, params),
    )
  }

  canModify(identity: Identity.Identity, resource: ResourceURIs.ResourceURIs, params: unknown) {
    return this.canCreate(identity, resource, params).pipe(
      Effect.andThen(this.hasFeatureFlag(resource, Operation.modify)),
      this.authorize(identity, Operation.modify, resource),
      this.authorizeFga(identity, Operation.modify, resource, params),
    )
  }

  canDelete(identity: Identity.Identity, resource: ResourceURIs.ResourceURIs, params: unknown) {
    return this.canModify(identity, resource, params).pipe(
      Effect.andThen(this.hasFeatureFlag(resource, Operation.delete)),
      this.authorize(identity, Operation.delete, resource),
      this.authorizeFga(identity, Operation.delete, resource, params),
    )
  }

  private authorize(
    identity: Identity.Identity,
    operation: Operation,
    resource: ResourceURIs.ResourceURIs,
  ): <E, R>(effect: Effect.Effect<true, E, R>) => Effect.Effect<true, E | ApiErrors.AuthorizationError, R> {
    return Effect.filterOrFail(
      () => identity.hasPermission(resource) || identity.hasPermission(`${resource}.${operation}`),
      () => ApiErrors.AuthorizationError.fromFGA(identity, operation, resource),
    )
  }

  private authorizeFga(
    identity: Identity.Identity,
    operation: Operation,
    resource: ResourceURIs.ResourceURIs,
    params: unknown,
  ): <E, R>(
    effect: Effect.Effect<true, E, R>,
  ) => Effect.Effect<true, E | ApiErrors.AuthorizationError | ApiErrors.InternalServerError, R> {
    return this.fgaService.refine(operation, identity, resource, params)
  }

  private hasFeatureFlag(resource: ResourceURIs.ResourceURIs, op: Operation) {
    return pipe(
      true as const,
      Effect.succeed,
      Effect.filterOrFail(
        () => this.featureFlagService.enabled(resource, op),
        () => ApiErrors.AuthorizationError.fromFeatureFlag(resource, op),
      ),
    )
  }
}
