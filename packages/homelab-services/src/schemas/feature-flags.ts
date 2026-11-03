import { Schema } from "effect"
import { Operation } from "../operation.js"
import { ListStringToSet } from "./ListStringToSet.js"
import { ResourceURISchema } from "./resource-uris.js"

export const ResourceOperationFlags = Schema.TemplateLiteral([
  ResourceURISchema,
  ".",
  Schema.Literals(Object.values(Operation)),
])

export const ResourceFlags = Schema.Union([
  ResourceURISchema,
  ResourceOperationFlags,
])

export const ResourceFlagsEnabled = Schema.TemplateLiteral([
  ResourceFlags,
  ".enabled",
])

export const AllEnabled = Schema.Literal("*")

export const FeatureFlags = Schema.Union([
  ResourceFlagsEnabled,
  AllEnabled,
])

export type FeatureFlags = typeof FeatureFlags.Type

export const FeatureFlagsSetSchema = ListStringToSet(
  Schema.String.pipe(
    Schema.decodeTo(FeatureFlags),
  ),
)

export type FeatureFlagsSet = typeof FeatureFlagsSetSchema.Type
