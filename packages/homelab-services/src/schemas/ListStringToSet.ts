import { HashSet, Schema, SchemaTransformation } from "effect"

/**
 * Represents a comma separated list string parsed
 * into a HashSet
 */
export function ListStringToSet<S extends string, RD, RE>(
  stringSchema: Schema.Codec<S, string, RD, RE>,
) {
  return Schema.String.pipe(
    Schema.decodeTo(
      Schema.Array(stringSchema),
      SchemaTransformation.transform({
        decode: (s: string): ReadonlyArray<string> => s.split(","),
        encode: (values: ReadonlyArray<string>): string => values.join(","),
      }),
    ),
    Schema.decodeTo(
      Schema.toType(Schema.HashSet(stringSchema)),
      SchemaTransformation.transform({
        decode: (values: ReadonlyArray<S>) => HashSet.fromIterable(values),
        encode: (set: HashSet.HashSet<S>) => HashSetToArray(set),
      }),
    ),
  )
}

function HashSetToArray<S extends string>(set: HashSet.HashSet<S>): ReadonlyArray<S> {
  return Array.from(set)
}
