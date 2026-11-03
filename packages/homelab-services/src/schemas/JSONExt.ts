import { Schema } from "effect"

import { BufferSchema } from "./Buffer.js"

export const JSONPrimitiveSchema = Schema.Union([
  Schema.String,
  Schema.Finite,
  Schema.Boolean,
  Schema.Null,
])

export type JSONPrimitive = typeof JSONPrimitiveSchema.Type

export const JSONExtensions = Schema.Union([
  BufferSchema,
])

export type JSONExtensions = typeof JSONExtensions.Type

export const JSONObjectSchema: Schema.Schema<Record<string, JSONExt>> = Schema.suspend(() =>
  Schema.Record(Schema.String, JSONSchema)
)

export const JSONArraySchema: Schema.Schema<ReadonlyArray<JSONExt>> = Schema.suspend(() => Schema.Array(JSONSchema))

export const JSONSchema = Schema.Union([JSONPrimitiveSchema, JSONExtensions, JSONObjectSchema, JSONArraySchema])

export interface JSONRecord {
  readonly [key: string]: JSONExt
}

export type JSONArray = ReadonlyArray<JSONExt>

export type JSONExt = JSONPrimitive | JSONExtensions | JSONRecord | JSONArray
