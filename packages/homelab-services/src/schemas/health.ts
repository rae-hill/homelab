import { Array, flow, pipe, Record, Schema, SchemaTransformation, String } from "effect"
import { HttpApiSchema } from "effect/http-api"

export const ServiceNameSchema = Schema.Literals([
  "Jellyfin",
  "Kanidm",
  "Step-CA",
])

export const StatusSchema = Schema.Literals([
  "Unreachable",
  "Unhealthy",
])

export const UnhealthyResponseMessage = Schema.TemplateLiteral([
  ServiceNameSchema,
  " is ",
  StatusSchema,
  Schema.String,
])

export const HealthyResponseMessage = Schema.Literal(
  "All services healthy",
)

export const HealthResponseSchemaWire = Schema.Union([
  UnhealthyResponseMessage,
  HealthyResponseMessage,
]).pipe(
  Schema.annotate({
    description: "Lists services that are unreachable or have indicated an unhealthy status",
  }),
  HttpApiSchema.asText({
    contentType: "text/plain",
  }),
)

export const HealthResponseSchemaType = Schema.Record(
  ServiceNameSchema,
  Schema.Literals([...StatusSchema.literals, "Healthy"]),
)

export const HealthResponseSchema = HealthResponseSchemaWire.pipe(
  Schema.decodeTo(
    HealthResponseSchemaType,
    SchemaTransformation.transform({
      decode: (fromA: typeof HealthResponseSchemaWire.Type): typeof HealthResponseSchemaType.Encoded => {
        const healthy = {
          Jellyfin: "Healthy",
          Kanidm: "Healthy",
          "Step-CA": "Healthy",
        } as const

        if (
          fromA === "All services healthy"
        ) {
          return healthy
        }

        const unhealthies = pipe(
          splitTemplateComma(fromA),
          fromEntriesLiteral,
        )

        return { ...healthy, ...unhealthies }
      },
      encode: (struct: typeof HealthResponseSchemaType.Encoded): typeof HealthResponseSchemaWire.Type => {
        if (
          Record.every(
            struct,
            (status) => status === "Healthy",
          )
        ) {
          return "All services healthy" as const
        }

        const unhealthies: Array<typeof UnhealthyResponseMessage.Type> = []
        for (const [key, status] of Record.toEntries(struct)) {
          if (status !== "Healthy") {
            unhealthies.push(`${key} is ${status}`)
          }
        }
        return joinTemplatesComma(unhealthies)
      },
    }),
  ),
  HttpApiSchema.asText({
    contentType: "text/plain",
  }),
)

function joinTemplatesComma<S extends string>(strs: ReadonlyArray<S>): `${S}${string}` {
  return Array.join(strs, ", ") as `${S}${string}`
}

function splitTemplateComma<Joined extends `${typeof UnhealthyResponseMessage.Type}${string}`>(
  str: Joined,
): ReadonlyArray<readonly [typeof ServiceNameSchema.Type, typeof StatusSchema.Type]> {
  return pipe(
    String.split(str, ", "),
    Array.map(
      flow(
        String.split(" is "),
        ([service, status]) => [service as typeof ServiceNameSchema.Type, status as typeof StatusSchema.Type] as const,
      ),
    ),
  )
}

function fromEntriesLiteral<K extends string, V extends string>(
  entries: ReadonlyArray<
    readonly [key: K, value: V]
  >,
): Record<K, V> {
  return Record.fromEntries(entries) as Record<K, V>
}
