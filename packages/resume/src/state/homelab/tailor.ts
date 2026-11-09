import { Data, Effect, Layer, Option } from "effect"
import { FetchHttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { Homelab } from "homelab-api"
import type { Schemas } from "homelab-services"
import type { ResumeContent } from "shared"
import { AuthService } from "shared/oidc"

import { homelabEnv } from "../../env"
import { authLayer } from "./runtime"

/**
 * The remote-tailor request: POST the current content (typed ContentState) + listing + baseVersion
 * to `POST /resume/tailor` on the tailscale-only homelab API and return the decoded tailor response.
 *
 * Auth: the kanidm **id_token** is sent as `Authorization: Bearer` — homelab-server's
 * `AuthMiddleware` verifies it against the remote kanidm JWKS (aud `homelab` + `email` /
 * `roles` claims) and skips DPoP for remote issuers, so no browser DPoP is needed.
 *
 * Uses the typed `HttpApiClient` over `homelab-api` (same client the e2e tests use) so the
 * payload/query/response stay schema-checked end to end. The response's `content` arrives
 * ALREADY DECODED to `ContentState` (the edge codec applies the patch to defaults).
 */

/** No signed-in session with an id_token to authenticate the tailor request. */
export class NotSignedInError extends Data.TaggedError("NotSignedInError")<{}> {}

/** The tailor request failed (transport, auth, or server-side pipeline error). */
export class ResumeTailorRequestError extends Data.TaggedError("ResumeTailorRequestError")<{
  readonly message: string
}> {}

/** Best-effort human message from an unknown client/server error. */
function describeError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const maybe = error as { _tag?: unknown; message?: unknown }
    if (typeof maybe.message === "string" && maybe.message !== "") {
      return maybe.message
    }
    if (typeof maybe._tag === "string") {
      return maybe._tag
    }
  }
  return "The tailor request failed."
}

/** The decoded tailor response from the server. */
export interface TailorResponse {
  readonly jobTitle: string
  readonly company: string | null
  readonly content: ResumeContent.ContentState
  readonly baseVersion: string
  readonly fit: Schemas.ResumeTailor.FitReport
  readonly meta: Schemas.ResumeTailor.TailorMeta
}

export function requestTailor(
  listing: string,
  content: ResumeContent.ContentState,
  baseVersion: string,
): Effect.Effect<TailorResponse, NotSignedInError | ResumeTailorRequestError> {
  return Effect.gen(function*() {
    if (!homelabEnv.enabled) {
      return yield* new ResumeTailorRequestError({ message: "Homelab integration is not configured in this build." })
    }

    const auth = yield* AuthService
    const user = yield* auth.getUser().pipe(
      Effect.mapError((error) => new ResumeTailorRequestError({ message: describeError(error) })),
    )
    const idToken = Option.match(user, {
      onNone: () => "",
      onSome: (u) => u.idToken,
    })
    if (idToken === "") {
      return yield* new NotSignedInError()
    }

    const client = yield* HttpApiClient.make(Homelab.HomelabApi, { baseUrl: homelabEnv.apiUrl })

    const response = yield* client.resume.tailor({
      payload: { listing, content, baseVersion },
      headers: { authorization: `Bearer ${idToken}` },
    }).pipe(
      Effect.mapError((error) => new ResumeTailorRequestError({ message: describeError(error) })),
    )

    return {
      jobTitle: response.jobTitle,
      company: response.company,
      content: response.content,
      baseVersion: response.baseVersion,
      fit: response.fit,
      meta: response.meta,
    } satisfies TailorResponse
  }).pipe(
    Effect.provide(Layer.mergeAll(authLayer(), FetchHttpClient.layer)),
    Effect.catchTag("AuthError", (error) => new ResumeTailorRequestError({ message: error.message })),
  )
}
