import { PdfPrintServiceLive } from "../layers/pdf-print-service.js"

/**
 * Resume-printing domain aggregate: the puppeteer-backed PDF renderer. Only depends on
 * `Config.Env` (provided globally), so the aggregate is a single layer.
 */
export const Aggregate = PdfPrintServiceLive
