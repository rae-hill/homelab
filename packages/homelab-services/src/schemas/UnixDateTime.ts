import { DateTime, Effect, Schema, SchemaGetter, SchemaIssue } from "effect"

/**
 * A unix timestamp to DateTime
 *
 * @remarks
 * why isn't this part of the base library?
 * @remarks
 * schemata-ts was better #biased
 */
export const UnixDateTime = Schema.Number.check(Schema.isGreaterThan(0)).pipe(
  Schema.decodeTo(Schema.DateTimeUtc, {
    decode: SchemaGetter.transformEffect((seconds: number) =>
      Effect.fromOption(
        DateTime.make(seconds * 1000),
        () => new SchemaIssue.InvalidValue({ message: "Failed to parse number into Date" }),
      )
    ),
    encode: SchemaGetter.transform((dateTime) => DateTime.toEpochMillis(dateTime) / 1000),
  }),
)

export const OptionalUnixDateTime = UnixDateTime.pipe(
  Schema.optionalKey,
)
