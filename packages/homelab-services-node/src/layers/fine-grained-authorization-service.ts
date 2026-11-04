import { Effect, Layer, Option } from "effect"
import { ApiErrors, Config, type Identity, type Operation, ResourceURIs, Services } from "homelab-services"
import { match, P } from "ts-pattern"
import "homelab-api"

export const FineGrainedAuthorizationServiceLive = Layer.effect(
  Services.FineGrainedAuthorizationService.FineGrainedAuthorizationService,
  Effect.gen(function*() {
    const serialNumberResolver = yield* Config.SerialNumberConfig.SerialNumberConfig

    return new FineGrainedAuthorizationServiceImpl(serialNumberResolver)
  }),
)

class FineGrainedAuthorizationServiceImpl
  implements Services.FineGrainedAuthorizationService.FineGrainedAuthorizationServiceDef
{
  constructor(
    private readonly serialNumberResolver: typeof Config.SerialNumberConfig.SerialNumberConfig.Service,
  ) {}

  refine<E, R>(
    operation: Operation,
    identity: Identity.Identity,
    resource: ResourceURIs.DeclaredURIs,
    fgaParams: ResourceURIs.AllParams,
  ): (
    effect: Effect.Effect<true, E, R>,
  ) => Effect.Effect<true, E | ApiErrors.AuthorizationError | ApiErrors.InternalServerError, R> {
    const serialNumberResolver = this.serialNumberResolver

    return Effect.andThen(
      ResourceURIs.match(
        resource,
        fgaParams,
        operation,
        identity,
      )({
        "Config_Wifi": Effect.fn("fga.config.wifi")(function*(params, operation, identity) {
          return yield* match(params).with(
            {
              payload: {
                enterpriseClientType: "PEAP",
                username: "guest",
              },
            },
            () => Effect.succeed(true as const),
          ).with(
            {
              payload: {
                enterpriseClientType: "PEAP",
                username: P.select(),
              },
            },
            (requestedUsername) => {
              if (identity.principle !== requestedUsername) {
                return Effect.fail(
                  new ApiErrors.AuthorizationError({
                    resource,
                    operation,
                    message: `User's principle identifer must match the requested username`,
                  }),
                )
              }

              return Effect.succeed(true as const)
            },
          ).with(
            {
              payload: {
                enterpriseClientType: "EAP-TLS",
              },
              headers: {
                "x-forwarded-for": P.select(),
              },
            },
            (ipAddress) => {
              if (!ipAddress) {
                return Effect.fail(
                  new ApiErrors.InternalServerError({
                    message: "expected 'x-forwarded-for' to be set",
                  }),
                )
              }

              const resolvedSerialNumber = serialNumberResolver.resolveIp(ipAddress)

              return resolvedSerialNumber.pipe(
                Option.match({
                  onNone() {
                    return Effect.fail(
                      new ApiErrors.AuthorizationError({
                        resource,
                        operation,
                        message: `IP address not recognized`,
                      }),
                    )
                  },
                  onSome() {
                    return Effect.succeed(true as const)
                  },
                }),
              )
            },
          ).otherwise(
            () => Effect.succeed(true as const),
          )
        }),
        "Config_Certs": () => Effect.succeed(true as const),
        "Config_DNS": () => Effect.succeed(true as const),
        "Cert_Root": () => Effect.succeed(true as const),
        "Cert_Intermediate": () => Effect.succeed(true as const),
        "Cert_Combined": () => Effect.succeed(true as const),
        "Status_Health": () => Effect.succeed(true as const),
        "Status_Self": () => Effect.succeed(true as const),
        "OAuth_Token": () => Effect.succeed(true as const),
        "OAuth_ClaimCheck": () => Effect.succeed(true as const),
        "Resume_Print": () => Effect.succeed(true as const),
      }),
    )
  }
}
