import type { Types } from "effect"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiSchema } from "effect/http-api"
import { ApiErrors, Middleware, type ResourceURIs, Schemas } from "homelab-services"

export const URI = "Resume_Print" satisfies ResourceURIs.ResourceURIs
export type URI = typeof URI

/** OOXML word-processing document (DOCX) media type. */
const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

const hasMagic = (bytes: Uint8Array, magic: ReadonlyArray<number>): boolean =>
  bytes.length >= magic.length && magic.every((byte, index) => bytes[index] === byte)

/**
 * The success payload is a plain `Uint8Array` for BOTH output formats, so the two
 * response members are discriminated by container magic bytes: PDF files start
 * with `%PDF`, DOCX files are ZIP containers starting with `PK\x03\x04`.
 *
 * Why two members: the response `Content-Type` is resolved statically per
 * success-schema member, and the union encoder picks the FIRST member whose
 * Type-side checks pass — the magic-byte filters make that selection match the
 * actual bytes. The typed client dispatches on the response's content-type
 * among the declared alternatives, so both MIME types must be declared here or
 * a DOCX response would be rejected client-side (doc 08 §C4).
 */
const PdfBytes = Schema.Uint8Array.pipe(
  Schema.check(
    Schema.makeFilter((bytes) => hasMagic(bytes, [0x25, 0x50, 0x44, 0x46]), {
      message: "response bytes are not a PDF (%PDF magic header missing)",
    }),
  ),
  HttpApiSchema.asUint8Array({ contentType: "application/pdf" }),
)

const DocxBytes = Schema.Uint8Array.pipe(
  Schema.check(
    Schema.makeFilter((bytes) => hasMagic(bytes, [0x50, 0x4b, 0x03, 0x04]), {
      message: "response bytes are not a DOCX (ZIP PK magic header missing)",
    }),
  ),
  HttpApiSchema.asUint8Array({ contentType: DOCX_CONTENT_TYPE }),
)

/**
 * POST /resume/print — render the resume site in headless chrome with the given
 * print config (base64 blob, validated by the shared schema) and return the
 * document bytes in the requested `outputFormat` (default `pdf`): PDF via
 * chrome's print renderer, DOCX via full-HTML capture + conversion.
 */
export const ResumePrint = HttpApiEndpoint.post("print", "/resume/print", {
  payload: Schemas.Resume.ResumePrintRequest,
  query: Schemas.Resume.ResumePrintQuery,
  success: [PdfBytes, DocxBytes],
  error: [
    ApiErrors.AuthorizationError,
    ApiErrors.AuthenticationError,
    ApiErrors.BadRequest,
    ApiErrors.InternalServerError,
    ApiErrors.HttpApiEncodeError,
  ],
  headers: Schemas.Token.TokenHeaders,
}).middleware(Middleware.AuthMiddleware)

export type ResumePrintEndpoint = typeof ResumePrint

export type ResumePrintHandlerArgs = Types.Simplify<
  HttpApiEndpoint.Request<ResumePrintEndpoint>
>

declare module "homelab-services/resource-uris" {
  interface URIToParams {
    [URI]: ResumePrintHandlerArgs
  }
}
