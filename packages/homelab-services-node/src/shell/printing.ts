import { PdfPrintServiceLive } from "../layers/pdf-print-service.js"

/**
 * Resume-printing domain aggregate: the puppeteer-backed PDF renderer.
 * PdfPrintServiceLive composes its own PuppeteerServiceLive (browser plumbing:
 * launch, handlers, log queue, finalizers); both only depend on `Config.Env`
 * (provided globally), so the aggregate stays a single layer.
 */
export const Aggregate = PdfPrintServiceLive
