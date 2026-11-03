import { Array, Schema, SchemaTransformation } from "effect"

export function EnsureArray<A, E, RD, RE>(schema: Schema.Codec<A, E, RD, RE>) {
  return Schema.Union([schema, Schema.Array(schema)]).pipe(
    Schema.decodeTo(
      Schema.toType(Schema.Array(schema)),
      SchemaTransformation.transform({
        decode: (input: A | ReadonlyArray<A>): ReadonlyArray<A> => isArray(input) ? input : Array.of(input),
        encode: (values: ReadonlyArray<A>): A | ReadonlyArray<A> => values,
      }),
    ),
  )
}

function isArray<T>(arr: T | ReadonlyArray<T>): arr is ReadonlyArray<T> {
  return Array.isArray(arr)
}
