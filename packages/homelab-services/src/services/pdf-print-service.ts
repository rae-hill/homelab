import { Context, Data, Effect } from "effect"
import type { PrintTheme } from "../schemas/resume.js"

export const PdfPrintServiceId = "homelab-api/services/printing/PdfPrintService"

/** Raised when headless chrome cannot render the resume PDF (launch, navigation, print). */
export class PdfPrintError extends Data.TaggedError("PdfPrintError")<{
  readonly message: string
  readonly error: unknown
}> {}

export interface PdfPrintServiceDef {
  /**
   * Render the resume site to a PDF with headless chrome.
   *
   * Navigates to the configured resume site URL with the base64 print config embedded in
   * the `importPrintSettings` query param and the color mode in `theme`, waits for the
   * page's print-ready signal, and returns the PDF bytes.
   */
  readonly printResume: (
    configBase64: string,
    theme: PrintTheme,
  ) => Effect.Effect<Uint8Array, PdfPrintError>
}

export class PdfPrintService extends Context.Service<PdfPrintService, PdfPrintServiceDef>()(PdfPrintServiceId) {
}

/** {@inheritDoc PdfPrintServiceDef.printResume} */
export function printResume(
  ...params: Parameters<PdfPrintServiceDef["printResume"]>
): Effect.Effect<Uint8Array, PdfPrintError, PdfPrintService> {
  return PdfPrintService.pipe(
    Effect.flatMap((_) => _.printResume(...params)),
  )
}
