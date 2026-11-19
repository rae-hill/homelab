import type { Types } from "effect"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiSchema } from "effect/http-api"
import { ApiErrors, Middleware, type ResourceURIs, Schemas } from "homelab-services"

export const URI = "Resume_CoverLetter" satisfies ResourceURIs.ResourceURIs
export type URI = typeof URI

const hasPdfMagic = (bytes: Uint8Array): boolean =>
  bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46

/**
 * The success payload is the rendered PDF (print.ts precedent — single-member binary
 * success; no content-type discrimination needed, unlike print's pdf|docx union).
 * The %PDF magic filter fails encoding loudly if the render ever produces non-PDF bytes.
 */
export const CoverLetterPdfBytes = Schema.Uint8Array.pipe(
  Schema.check(
    Schema.makeFilter((bytes) => hasPdfMagic(bytes), {
      message: "response bytes are not a PDF (%PDF magic header missing)",
    }),
  ),
  HttpApiSchema.asUint8Array({ contentType: "application/pdf" }),
)

/**
 * POST /resume/cover-letter — generate a style-matched cover letter for the given job
 * listing (stage-1 cleanup served from the shared cache when the listing was just
 * tailored), grounded in the entry's tailored resume content, rendered to PDF via the
 * Typst/letterloom template. The payload's `content` is a base64 JSON Patch against the
 * frozen shared defaults (`ContentPatchBase64`) and decodes to a `ContentState` at the
 * edge. No Content-Disposition: the client drives the download via the anchor `download`
 * attribute (same stance as /resume/print).
 */
export const ResumeCoverLetter = HttpApiEndpoint.post("cover-letter", "/resume/cover-letter", {
  payload: Schemas.ResumeCoverLetter.ResumeCoverLetterRequest,
  success: CoverLetterPdfBytes,
  error: [
    ApiErrors.AuthorizationError,
    ApiErrors.AuthenticationError,
    ApiErrors.BadRequest,
    ApiErrors.InternalServerError,
    ApiErrors.HttpApiEncodeError,
  ],
  headers: Schemas.Token.TokenHeaders,
}).middleware(Middleware.AuthMiddleware)

export type ResumeCoverLetterEndpoint = typeof ResumeCoverLetter

export type ResumeCoverLetterHandlerArgs = Types.Simplify<
  HttpApiEndpoint.Request<ResumeCoverLetterEndpoint>
>

declare module "homelab-services/resource-uris" {
  interface URIToParams {
    [URI]: ResumeCoverLetterHandlerArgs
  }
}
