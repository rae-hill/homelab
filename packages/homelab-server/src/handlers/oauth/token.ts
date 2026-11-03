import { Effect, flow, Match } from "effect"
import { HttpEffect, HttpServerResponse } from "effect/http"
import type { Homelab } from "homelab-api"
import { ApiErrors, Middleware, Services } from "homelab-services"

export const handleToken = Effect.fn("handleToken")(
  function*(args: Homelab.OAuthEndpoints.Token.TokenEndpointHandlerArgs) {
    const { apiKey, dpopTokens } = yield* Middleware.BasicAuthCredentials
    const { accessToken, identity, nonce } = yield* Services.TokenIssuerService.issueToken(
      apiKey,
      dpopTokens,
    )

    yield* Services.AuthorizationService.canCreate(identity, "OAuth_Token", args)

    yield* HttpEffect.appendPreResponseHandler(
      (_, res) => Effect.succeed(HttpServerResponse.setHeader(res, "DPoP-Nonce", nonce)),
    )

    return { access_token: accessToken, token_type: "DPoP" as const }
  },
  Effect.tapError(Effect.logError),
  Effect.mapError(
    flow(
      Match.value,
      Match.tag("NonceValidationError", (e) =>
        new ApiErrors.AuthenticationError({
          reason: "invalid-credential",
          message: e.message,
        })),
      Match.tag("HMACDigestError", (e) =>
        new ApiErrors.InternalServerError({
          message: "HMAC digest error during token issuance",
          error: e,
        })),
      Match.orElse((_) => _),
    ),
  ),
)
