import { Schema } from "effect"
import { JSONExtensions } from "./JSONExt.js"
import { Optional } from "./optionals.js"

export const GenericPayloadSchema = Schema.Struct({
  PayloadContent: Optional(JSONExtensions),
  PayloadDescription: Schema.String,
  PayloadDisplayName: Schema.String,
  PayloadIdentifier: Schema.String,
  PayloadOrganization: Optional(Schema.String),
  PayloadRemovalDisallowed: Optional(Schema.Boolean),
  PayloadType: Schema.String,
  PayloadScope: Optional(Schema.String),
  PayloadUUID: Schema.String.check(Schema.isUUID()),
  PayloadVersion: Schema.Int.check(Schema.isGreaterThan(0)),
})
