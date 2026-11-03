import { Schema } from "effect"

export const CertFormat = Schema.Literals(["crt", "der"])

export type CertFormat = typeof CertFormat.Type
