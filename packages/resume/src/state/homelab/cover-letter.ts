import { Data, Effect, Layer, Option } from "effect"
import { FetchHttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { Homelab } from "homelab-api"
import type { ResumeContent } from "shared"
import { AuthService } from "shared/oidc"

import { homelabEnv } from "../../env"
import { authLayer } from "./runtime"

/**
 * The remote cover-letter request: POST the entry's tailored content (typed ContentState) +
 * listing + baseVersion to `POST /resume/cover-letter` on the tailscale-only homelab API and
 * return the rendered PDF bytes. The Typst/letterloom template renders a style-matched letter
 * grounded in the tailored resume content.
 *
 * Auth: the kanidm **id_token** is sent as `Authorization: Bearer` — homelab-server's
 * `AuthMiddleware` verifies it against the remote kanidm JWKS (aud `homelab` + `email` /
 * `roles` claims) and skips DPoP for remote issuers, so no browser DPoP is needed.
 *
 * Uses the typed `HttpApiClient` over `homelab-api` (same client the e2e tests use) so the
 * payload/response stay schema-checked end to end. The payload's `content` arrives already
 * DECODED to `ContentState` at the edge (the HttpApi codec re-encodes it to base64 patch).
 */

/** No signed-in session with an id_token to authenticate the cover-letter request. */
export class NotSignedInError extends Data.TaggedError("NotSignedInError")<{}> {}

/** The cover-letter request failed (transport, auth, or server-side pipeline error). */
export class CoverLetterRequestError extends Data.TaggedError("CoverLetterRequestError")<{
  readonly reason: "transport" | "server"
  readonly error: unknown
}> {}

/** Best-effort categorization of an unknown client/server error into transport vs server. */
function categorizeError(error: unknown): "transport" | "server" {
  if (typeof error === "object" && error !== null) {
    const maybe = error as { _tag?: unknown; status?: unknown; statusCode?: unknown }
    // HTTP/API errors carry _tag, status, or statusCode — everything else is transport
    if (typeof maybe._tag === "string" || typeof maybe.status === "number" || typeof maybe.statusCode === "number") {
      return "server"
    }
  }
  return "transport"
}

export function requestCoverLetter(
  listing: string,
  content: ResumeContent.ContentState,
  baseVersion: string,
): Effect.Effect<Uint8Array, NotSignedInError | CoverLetterRequestError> {
  return Effect.gen(function*() {
    if (!homelabEnv.enabled) {
      return yield* new CoverLetterRequestError({
        reason: "server",
        error: "Homelab integration is not configured in this build.",
      })
    }

    const auth = yield* AuthService
    const user = yield* auth.getUser().pipe(
      Effect.mapError((error) => new CoverLetterRequestError({ reason: categorizeError(error), error })),
    )
    const idToken = Option.match(user, {
      onNone: () => "",
      onSome: (u) => u.idToken,
    })
    if (idToken === "") {
      return yield* new NotSignedInError()
    }

    const client = yield* HttpApiClient.make(Homelab.HomelabApi, { baseUrl: homelabEnv.apiUrl })

    return yield* client.resume["cover-letter"]({
      payload: { listing, content, baseVersion },
      headers: { authorization: `Bearer ${idToken}` },
    }).pipe(
      Effect.mapError((error) => new CoverLetterRequestError({ reason: categorizeError(error), error })),
    )
  }).pipe(
    Effect.provide(Layer.mergeAll(authLayer(), FetchHttpClient.layer)),
    Effect.catchTag("AuthError", (error) => new CoverLetterRequestError({ reason: "transport", error })),
  )
}

/**
 * Trigger a browser download of the rendered PDF bytes. Pure DOM side effect, kept separate
 * so the Effect above stays free of `document` access. Filename mirrors downloadResumeDocument's
 * date-slug mechanics: `cover-letter-${slug}-${YYYY-MM-DD}.pdf`.
 */
export function downloadCoverLetter(bytes: Uint8Array, jobTitle: string): void {
  const today = new Date()
  const days = today.getDate().toString().padStart(2, "0")
  const months = (today.getMonth() + 1).toString().padStart(2, "0")
  const year = today.getFullYear()

  // Simple slug: lowercase, collapse non-alphanumeric runs to hyphens, trim, cap length
  const slug = (jobTitle || "listing")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)

  const filename = `cover-letter-${slug}-${year}-${months}-${days}.pdf`

  const blob = new Blob([bytes as unknown as BlobPart], { type: "application/pdf" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
