import { HashMap, Record, Schema, SchemaTransformation } from "effect"

/**
 * A transformation from Record to HashMap
 */
export function HashSetFromRecord<
  KeyOut extends string,
  KeyIn extends string,
  Out,
  In,
>(
  key: Schema.Codec<KeyOut, KeyIn>,
  value: Schema.Codec<Out, In>,
) {
  return Schema.Record(key as Schema.Codec<KeyOut, KeyIn> & Schema.Record.Key, value).pipe(
    Schema.decodeTo(
      Schema.toType(Schema.HashMap(key, value)),
      SchemaTransformation.transform({
        decode: (record: { readonly [P in KeyOut]: Out }) =>
          HashMap.fromIterable(Record.toEntries(record) as Array<[KeyOut, Out]>),
        encode: (map: HashMap.HashMap<KeyOut, Out>) =>
          Record.fromEntries(HashMap.toEntries(map)) as unknown as { readonly [P in KeyOut]: Out },
      }),
    ),
  )
}
