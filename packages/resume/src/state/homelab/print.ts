import { Data, Effect, Layer, Option } from "effect"
import { FetchHttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { Homelab } from "homelab-api"
import { AuthService } from "shared/oidc"

import { homelabEnv } from "../../env"
import { authLayer } from "./runtime"

/**
 * The remote-print request: POST the current config (base64) + theme + output
 * format to `POST /resume/print` on the tailscale-only homelab API and return
 * the rendered document bytes. Headless chrome renders the resume SPA for both
 * formats; DOCX is converted server-side from the captured, fully styled HTML.
 *
 * Auth: the kanidm **id_token** is sent as `Authorization: Bearer` — homelab-server's
 * `AuthMiddleware` verifies it against the remote kanidm JWKS (aud `homelab` + `email` /
 * `roles` claims) and skips DPoP for remote issuers, so no browser DPoP is needed.
 *
 * Uses the typed `HttpApiClient` over `homelab-api` (same client the e2e tests use) so the
 * payload/query/response stay schema-checked end to end.
 */

/** Output formats the print endpoint serves (mirrors `Schemas.Resume.PrintOutputFormat`). */
export type ResumeDocumentFormat = "pdf" | "docx"

/** Per-format download metadata (blob MIME + file extension). */
const DOCUMENT_META: Record<ResumeDocumentFormat, { readonly mime: string; readonly extension: string }> = {
  pdf: { mime: "application/pdf", extension: "pdf" },
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extension: "docx",
  },
}

/** No signed-in session with an id_token to authenticate the print request. */
export class NotSignedInError extends Data.TaggedError("NotSignedInError")<{}> {}

/** The print request failed (transport, auth, or server-side render error). */
export class ResumePrintRequestError extends Data.TaggedError("ResumePrintRequestError")<{
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
  return "The print request failed."
}

export function requestResumeDocument(
  config: string,
  theme: "light" | "dark",
  outputFormat: ResumeDocumentFormat,
): Effect.Effect<Uint8Array, NotSignedInError | ResumePrintRequestError> {
  return Effect.gen(function*() {
    if (!homelabEnv.enabled) {
      return yield* new ResumePrintRequestError({ message: "Homelab integration is not configured in this build." })
    }

    const auth = yield* AuthService
    const user = yield* auth.getUser().pipe(
      Effect.mapError((error) => new ResumePrintRequestError({ message: describeError(error) })),
    )
    const idToken = Option.match(user, {
      onNone: () => "",
      onSome: (u) => u.idToken,
    })
    if (idToken === "") {
      return yield* new NotSignedInError()
    }

    const client = yield* HttpApiClient.make(Homelab.HomelabApi, { baseUrl: homelabEnv.apiUrl })

    return yield* client.resume.print({
      payload: { config },
      query: { theme, outputFormat },
      headers: { authorization: `Bearer ${idToken}` },
    }).pipe(
      Effect.mapError((error) => new ResumePrintRequestError({ message: describeError(error) })),
    )
  }).pipe(
    Effect.provide(Layer.mergeAll(authLayer(), FetchHttpClient.layer)),
    Effect.catchTag("AuthError", (error) => new ResumePrintRequestError({ message: error.message })),
  )
}

/**
 * Trigger a browser download of the rendered document bytes. Pure DOM side effect, kept
 * separate so the Effect above stays free of `document` access.
 */
export function downloadResumeDocument(
  bytes: Uint8Array,
  format: ResumeDocumentFormat,
  filename_?: string,
): void {
  const meta = DOCUMENT_META[format]
  const today = new Date()
  const days = today.getDate().toString().padStart(2, "0")
  const months = (today.getMonth() + 1).toString().padStart(2, "0")
  const year = today.getFullYear()
  const rhex = Math.random().toString(16).substring(2, 10)
  const filename = filename_ ?? `resume-rae-hill-${year}-${months}-${days}-${rhex}.${meta.extension}`

  const blob = new Blob([bytes as unknown as BlobPart], { type: meta.mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
