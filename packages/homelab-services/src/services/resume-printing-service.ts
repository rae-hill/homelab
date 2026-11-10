import { Context, Data, Effect } from "effect"
import type { PrintTheme } from "../schemas/resume.js"

export const ResumePrintingServiceId = "homelab-api/services/printing/ResumePrintingService"

/** Raised when headless chrome cannot render the resume PDF (launch, navigation, print). */
export class ResumePrintError extends Data.TaggedError("ResumePrintError")<{
  readonly message: string
  readonly error: unknown
}> {}

export interface ResumePrintingServiceDef {
  /**
   * Render the resume site to a PDF with headless chrome.
   *
   * Seeds the base64 print config into the site's localStorage key
   * (`PrintConfig.PRINT_CONFIG_LOCAL_STORAGE_KEY` from `shared`) before navigating — the
   * SPA hydrates from localStorage on boot — and passes the color mode in the (short)
   * `theme` query param. The config is deliberately NOT embedded as an
   * `importPrintSettings` URL param: real-world configs exceed GitHub Pages'
   * request-line limit (HTTP 414, observed on augustus). Waits for the page's
   * print-ready signal and returns the PDF bytes. The whole render is bounded
   * by a backstop timeout, so callers always get a resolution (logs drained,
   * browser closed) even if the page hangs.
   */
  readonly printResume: (
    configBase64: string,
    theme: PrintTheme,
  ) => Effect.Effect<Uint8Array, ResumePrintError>
}

export class ResumePrintingService
  extends Context.Service<ResumePrintingService, ResumePrintingServiceDef>()(ResumePrintingServiceId)
{
}

/** {@inheritDoc ResumePrintingServiceDef.printResume} */
export const printResume = Effect.fn("ResumePrintingService.printResume")(function*(
  ...params: Parameters<ResumePrintingServiceDef["printResume"]>
): Effect.fn.Return<Uint8Array, ResumePrintError, ResumePrintingService> {
  const svc = yield* ResumePrintingService
  return yield* svc.printResume(...params)
})
