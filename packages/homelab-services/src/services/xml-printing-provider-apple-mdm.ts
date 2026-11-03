import { Context } from "effect"

export const AppleMdmXmlPrintingConfigId = "AppleMdmXmlPrintingServiceConfig"

export class AppleMdmXmlPrintingConfig extends Context.Service<AppleMdmXmlPrintingConfig, {
  encoding?: string
  newline?: string
  indent?: string
}>()(AppleMdmXmlPrintingConfigId) {}
