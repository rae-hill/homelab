import { Context, Data, Effect } from "effect"

import type * as Schemas from "../schemas/index.js"

export const XmlPrintingServiceId = "homelab-api/services/xml-printing-service/XmlPrintingService"

export class XmlPrintingError extends Data.TaggedError("XmlPrintingError")<{
  readonly error: unknown
}> {}

export interface XmlPrintingServiceImpl {
  /** Serializes a JSON record to an Apple MDM plist XML string. */
  printXml(json: Record<string, Schemas.JSONExt.JSONExt>): Effect.Effect<Schemas.XML.XML, XmlPrintingError>
}

export class XmlPrintingService
  extends Context.Service<XmlPrintingService, XmlPrintingServiceImpl>()(XmlPrintingServiceId)
{}

/** {@inheritDoc XmlPrintingServiceImpl.printXml} */
export const printXml = Effect.fn("XmlPrintingService.printXml")(function*(
  ...args: Parameters<XmlPrintingServiceImpl["printXml"]>
): Effect.fn.Return<Schemas.XML.XML, XmlPrintingError, XmlPrintingService> {
  const svc = yield* XmlPrintingService
  return yield* svc.printXml(...args)
})
