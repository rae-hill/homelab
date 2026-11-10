import { ResumePrintingServiceLive } from "../layers/resume-printing-service.js"

/**
 * Resume-printing domain aggregate: the puppeteer-backed resume renderer.
 * ResumePrintingServiceLive composes its own PuppeteerServiceLive (browser plumbing:
 * launch, handlers, log queue, finalizers); both only depend on `Config.Env`
 * (provided globally), so the aggregate stays a single layer.
 */
export const Aggregate = ResumePrintingServiceLive
