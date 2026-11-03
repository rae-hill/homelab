import { Inspectable, Schema, SchemaTransformation } from "effect"

/**
 * `Schema.Unknown` widened for JSON transports.
 *
 * @remarks
 * v4 validates that encoded values are JSON, so arbitrary runtime values
 * (Error instances, class instances, functions) must be normalized before
 * they go on the wire. `Inspectable.toJson` handles values with a `toJSON`
 * method (e.g. Data errors); the JSON round-trip mirrors v3's
 * `JSON.stringify` behavior for everything else (plain `Error`s become `{}`).
 * Decoding stays lossless.
 */
export const JsonUnknown: Schema.Codec<unknown, Schema.Json> = Schema.Json.pipe(
  Schema.decodeTo(
    Schema.toType(Schema.Unknown),
    SchemaTransformation.transform({
      decode: (json) => json as unknown,
      encode: (value) => JSON.parse(JSON.stringify({ v: Inspectable.toJson(value) })).v as Schema.Json,
    }),
  ),
)

export type JsonUnknown = typeof JsonUnknown.Type
