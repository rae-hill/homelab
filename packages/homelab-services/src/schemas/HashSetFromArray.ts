import { Array, HashSet, Schema, SchemaTransformation } from "effect"

/**
 * A transformation from Array to HashSet
 */
export function HashSetFromArray<A, E, RD, RE>(
  schema: Schema.Codec<A, E, RD, RE>,
) {
  return Schema.Array(schema).pipe(
    Schema.decodeTo(
      Schema.toType(Schema.HashSet(schema)),
      SchemaTransformation.transform({
        decode: (values: ReadonlyArray<A>) => HashSet.fromIterable(values),
        encode: (set: HashSet.HashSet<A>): ReadonlyArray<A> => Array.fromIterable(set),
      }),
    ),
  )
}
