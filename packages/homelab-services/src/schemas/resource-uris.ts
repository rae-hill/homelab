import { Schema } from "effect"

export const ResourceURISchema = Schema.Literals([
  "Config_Wifi",
  "Config_Certs",
  "Config_DNS",
  "Cert_Root",
  "Cert_Intermediate",
  "Cert_Combined",
  "Status_Health",
  "Status_Self",
  "OAuth_Token",
  "OAuth_ClaimCheck",
  "Resume_Print",
])

export const ResourceURILiterals = ResourceURISchema.literals
