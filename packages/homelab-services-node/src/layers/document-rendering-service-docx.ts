import HtmlToDocx from "@turbodocx/html-to-docx"
import { Effect, Layer } from "effect"
import { Services, Utils } from "homelab-services"

/**
 * Minimal structural type for the async HTML → DOCX conversion function this
 * layer wraps — satisfied by `@turbodocx/html-to-docx`'s export. Declared
 * locally (loose params/return) so the library's own types never leak across
 * the service boundary and tests can inject fakes.
 */
export type HtmlToDocxLike = (
  html: string,
  headerHtml: string | null,
  options: Record<string, unknown>,
  footerHtml: string | null,
) => Promise<unknown>

/**
 * Maps the platform-neutral `DocxDocumentOptions` onto the conversion
 * library's options bag. Unit conversions and library-specific defaults live
 * HERE — this is the seam that keeps `homelab-services` free of the library's
 * implementation details.
 */
function toLibraryOptions(
  options: Services.DocumentRenderingServiceDocx.DocxDocumentOptions | undefined,
): Record<string, unknown> {
  const library: Record<string, unknown> = {
    // Fixed adapter default: `sharp` is a real dependency (owner decision,
    // doc 08 OQ4), so inline SVGs (react-icons) rasterize to PNG for broad
    // Word compatibility instead of native SVG embedding (Office 2019+ only).
    imageProcessing: { svgHandling: "convert" },
  }
  if (options === undefined) {
    return library
  }
  if (options.orientation !== undefined) library.orientation = options.orientation
  if (options.margins !== undefined) library.margins = { ...options.margins }
  if (options.font !== undefined) library.font = options.font
  if (options.fontSizePt !== undefined) library.fontSize = options.fontSizePt * 2 // points → half-points
  if (options.title !== undefined) library.title = options.title
  if (options.subject !== undefined) library.subject = options.subject
  if (options.creator !== undefined) library.creator = options.creator
  if (options.pageNumber !== undefined) library.pageNumber = options.pageNumber
  return library
}

/**
 * Copies the conversion result into a platform-neutral `Uint8Array`. The
 * library returns a Node `Buffer` (which extends Uint8Array but may alias a
 * pooled allocation); `ArrayBuffer` is accepted for forward compatibility.
 * Anything else (e.g. a `Blob` outside Node) becomes a conversion failure.
 */
function toNeutralBytes(result: unknown): Uint8Array {
  if (result instanceof Uint8Array) {
    return new Uint8Array(result) // copy: never alias the Buffer pool
  }
  if (result instanceof ArrayBuffer) {
    return new Uint8Array(result)
  }
  throw new TypeError(`html-to-docx returned an unsupported result type: ${typeof result}`)
}

/**
 * `DocumentRenderingServiceDocx` layer factory wrapping an injected
 * conversion function (house pattern: configurable internals via `makeX`,
 * fakeable in tests without touching the real library).
 */
export const makeDocumentRenderingServiceDocx = (htmlToDocx: HtmlToDocxLike) =>
  Layer.succeed(Services.DocumentRenderingServiceDocx.DocumentRenderingServiceDocx, {
    formatHtml: Effect.fn("DocumentRenderingServiceDocx.formatHtml")(
      (
        html: string,
        options?: Services.DocumentRenderingServiceDocx.DocxDocumentOptions,
      ): Effect.Effect<Uint8Array, Services.DocumentRenderingServiceDocx.DocumentRenderingServiceError> =>
        Effect.tryPromise({
          try: async () => toNeutralBytes(await htmlToDocx(html, null, toLibraryOptions(options), null)),
          catch: (error) =>
            new Services.DocumentRenderingServiceDocx.DocumentRenderingServiceError({
              message: "html-to-docx conversion failed",
              error: Utils.errorToJson(error),
            }),
        }),
    ),
  })

/** Live layer backed by `@turbodocx/html-to-docx`. */
export const DocumentRenderingServiceDocxLive = makeDocumentRenderingServiceDocx(
  (html, headerHtml, options, footerHtml) =>
    HtmlToDocx(html, headerHtml, options as Parameters<typeof HtmlToDocx>[2], footerHtml),
)
