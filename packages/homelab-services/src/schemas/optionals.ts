import { Effect, Schema } from "effect"
import { type LazyArg } from "effect/Function"
import { JsonUnknown } from "./JsonUnknown.js"

export const OptionalStringOrArray = Optional(
  Schema.Union([Schema.String, Schema.Array(Schema.String)]),
)

export const OptionalString = Optional(
  Schema.String,
)

export const OptionalUrl = Optional(Schema.URLFromString)

export const OptionalUnknown = Optional(JsonUnknown)

export function OptionalArray<A, E, RD, RE>(schema: Schema.Codec<A, E, RD, RE>) {
  return Optional(Schema.Array(schema))
}

export function Optional<A, E, RD, RE>(schema: Schema.Codec<A, E, RD, RE>) {
  return schema.pipe(
    Schema.optionalKey,
  )
}

export function OptionalWithDefault<A, E, RD, RE>(schema: Schema.Codec<A, E, RD, RE>, _default: LazyArg<A>) {
  return schema.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.sync(_default)),
  )
}
