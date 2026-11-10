import { Context, Data, Effect } from "effect"

export const DocumentRenderingServiceDocxId = "homelab-api/services/rendering/DocumentRenderingServiceDocx"

/** Raised when HTML → DOCX conversion fails. */
export class DocumentRenderingServiceError extends Data.TaggedError("DocumentRenderingServiceError")<{
  readonly message: string
  readonly error: unknown
}> {}

/**
 * DOCX page margins in TWIPs (twentieths of a point — the OOXML-native unit;
 * 1440 = 1 inch). Per-side values are optional; the implementation applies
 * its own defaults for omitted sides.
 */
export interface DocxPageMargins {
  readonly top?: number
  readonly right?: number
  readonly bottom?: number
  readonly left?: number
}

/**
 * Platform-neutral DOCX generation options.
 *
 * Deliberately homelab-services' OWN definition — not tied to any conversion
 * library's types. The implementation adapter in `homelab-services-node` maps
 * these onto the concrete library's option shape, owning unit conversions
 * (e.g. points → half-points) and library-specific defaults.
 */
export interface DocxDocumentOptions {
  /** Page orientation; implementations default to portrait. */
  readonly orientation?: "portrait" | "landscape"
  /** Page margins in TWIPs (1440 = 1 inch). */
  readonly margins?: DocxPageMargins
  /** Default font family name (e.g. `"Calibri"`). */
  readonly font?: string
  /** Default font size in POINTS; the adapter converts to the library's unit. */
  readonly fontSizePt?: number
  /** Document title metadata. */
  readonly title?: string
  /** Document subject metadata. */
  readonly subject?: string
  /** Document author/creator metadata. */
  readonly creator?: string
  /** Render page numbers in the footer. */
  readonly pageNumber?: boolean
}

export interface DocumentRenderingServiceDocxDef {
  /**
   * Convert a fully rendered HTML document string into DOCX bytes.
   *
   * The HTML must be self-contained for conversion purposes: styling that
   * should affect the output has to be inline on the elements (HTML→DOCX
   * converters neither fetch external stylesheets nor resolve the CSS
   * cascade). Returns platform-neutral `Uint8Array` bytes — never a Node
   * `Buffer` instance — so consumers stay runtime-agnostic.
   */
  readonly formatHtml: (
    html: string,
    options?: DocxDocumentOptions,
  ) => Effect.Effect<Uint8Array, DocumentRenderingServiceError>
}

export class DocumentRenderingServiceDocx extends Context.Service<
  DocumentRenderingServiceDocx,
  DocumentRenderingServiceDocxDef
>()(DocumentRenderingServiceDocxId) {}

/** {@inheritDoc DocumentRenderingServiceDocxDef.formatHtml} */
export const formatHtml = Effect.fn("DocumentRenderingServiceDocx.formatHtml")(function*(
  ...params: Parameters<DocumentRenderingServiceDocxDef["formatHtml"]>
): Effect.fn.Return<Uint8Array, DocumentRenderingServiceError, DocumentRenderingServiceDocx> {
  const svc = yield* DocumentRenderingServiceDocx
  return yield* svc.formatHtml(...params)
})
