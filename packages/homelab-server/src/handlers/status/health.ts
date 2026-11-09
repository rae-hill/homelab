import { Effect, Record, Result } from "effect"
import { HttpClient } from "effect/http"
import type { Homelab } from "homelab-api"
import { Middleware, Services } from "homelab-services"
import { match, P } from "ts-pattern"

/**
 * One bounded reachability probe. The timeout is load-bearing: these hosts resolve to
 * tailnet-only addresses that BLACKHOLE from outside (e.g. CI runners) — without it a
 * dropped SYN makes the kernel retry for minutes and every health request (and any
 * probe loop waiting on it, like scripts/e2e.sh) hangs with it. House precedent:
 * shared/src/oidc/reachability.ts.
 */
const reachabilityCheck = (url: string) => HttpClient.get(url).pipe(Effect.timeout("5 seconds"))

export const handleHealth = Effect.fn("handleHealth")(
  function*(args: Homelab.StatusEndpoints.Health.HealthEndpointHandlerArgs) {
    const identity = yield* Middleware.CurrentIdentity
    yield* Services.AuthorizationService.canView(identity, "Status_Health", args)

    return yield* Effect.all({
      Kanidm: reachabilityCheck("https://idm.plato-splunk.media/status"),
      Jellyfin: reachabilityCheck("https://jellyfin.plato-splunk.media/health"),
      "Step-CA": reachabilityCheck("https://ca.plato-splunk.media/health"),
    }, {
      mode: "result",
    }).pipe(
      Effect.map(
        Record.map(
          Result.match({
            onFailure(err) {
              // v4 surfaces HttpClientError with a `reason`; status failures are
              // StatusCodeError and request/transport failures are the
              // RequestError reason union. Effect.timeout failures are Cause.TimeoutError.
              return match(err)
                .with({ _tag: "TimeoutError" }, () => "Unreachable" as const)
                .with({
                  reason: {
                    _tag: "StatusCodeError",
                    response: {
                      status: P.union(408, 429, 500, 502, 503, 504),
                    },
                  },
                }, () => "Unreachable" as const)
                .with(
                  {
                    reason: {
                      _tag: P.union("TransportError", "EncodeError", "InvalidUrlError"),
                    },
                  },
                  () => "Unreachable" as const,
                ).otherwise(
                  () => "Unhealthy" as const,
                )
            },

            onSuccess(res) {
              return match(res)
                .with({
                  status: P.number.between(200, 299),
                }, () => "Healthy" as const)
                .otherwise(
                  () => "Unhealthy" as const,
                )
            },
          }),
        ),
      ),
    )
  },
)
