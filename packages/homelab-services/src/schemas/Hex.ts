import { Schema, SchemaTransformation } from "effect"
import { Optional } from "./optionals.js"

export const Hex = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-fA-F\d]+$/)),
  Schema.decodeTo(
    Schema.String.check(Schema.isLowercased()),
    SchemaTransformation.toLowerCase(),
  ),
)

export const OptionalHex = Optional(Hex)
