import { Schema } from "effect"
import { GenericPayloadSchema } from "./payload-generic.js"

export const AcmeConfigSchema = GenericPayloadSchema.pipe(
  Schema.fieldsAssign(
    {
      Attest: Schema.Boolean,
      ClientIdentifier: Schema.String,
      DirectoryURL: Schema.URLFromString,
      HardwareBound: Schema.Boolean,
      KeySize: Schema.Int.check(Schema.isGreaterThan(0)),
      KeyType: Schema.String,
      Subject: Schema.NonEmptyArray(Schema.NonEmptyArray(Schema.Tuple([Schema.String, Schema.String]))),
    },
  ),
)

export type AcmeConfig = typeof AcmeConfigSchema.Type
export type AcmeConfigWire = typeof AcmeConfigSchema.Encoded
