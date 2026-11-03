import { Schema } from "effect"
import { Optional } from "./optionals.js"

export const Base64 = Schema.String.pipe(
  // https://regex101.com/library/lXFWqM
  Schema.check(Schema.isPattern(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{4}|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}={2})$/g)),
)

export const Base64Url = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Za-z0-9_-]+$/g)),
)

export const OptionalBase64Url = Optional(Base64Url)
