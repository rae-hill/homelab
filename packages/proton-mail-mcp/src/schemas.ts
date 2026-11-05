import { Effect, Schema } from "effect"
import { type LazyArg } from "effect/Function"

// Field helpers mirroring homelab-services/src/schemas/optionals.ts (this package is standalone).

export function Optional<A, E, RD, RE>(schema: Schema.Codec<A, E, RD, RE>) {
  return schema.pipe(Schema.optionalKey)
}

export function OptionalWithDefault<A, E, RD, RE>(schema: Schema.Codec<A, E, RD, RE>, _default: LazyArg<A>) {
  return schema.pipe(Schema.withDecodingDefaultTypeKey(Effect.sync(_default)))
}

/**
 * Strip `undefined`-valued keys so object literals satisfy `exactOptionalPropertyTypes`
 * against the schema-derived domain types (optionalKey fields are `k?: T`, not `k?: T | undefined`).
 */
export const compact = <A extends object>(value: { [K in keyof A]: A[K] | undefined }): A =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as A

export const AddressSchema = Schema.Struct({
  name: Schema.NullOr(Schema.String),
  address: Schema.String,
})

export const AttachmentMetaSchema = Schema.Struct({
  filename: Schema.NullOr(Schema.String),
  mimeType: Schema.NullOr(Schema.String),
  size: Optional(Schema.Number),
})

export const FolderInfoSchema = Schema.Struct({
  path: Schema.String,
  specialUse: Optional(Schema.String),
})

export const MessageSummarySchema = Schema.Struct({
  folder: Schema.String,
  uid: Schema.Number,
  date: Optional(Schema.String),
  subject: Optional(Schema.String),
  from: Optional(AddressSchema),
  seen: Schema.Boolean,
  flagged: Schema.Boolean,
  size: Optional(Schema.Number),
})

export const MessageDetailSchema = Schema.Struct({
  folder: Schema.String,
  uid: Schema.Number,
  date: Optional(Schema.String),
  subject: Optional(Schema.String),
  from: Optional(AddressSchema),
  to: Schema.Array(AddressSchema),
  cc: Schema.Array(AddressSchema),
  messageId: Optional(Schema.String),
  /** Proton Bridge-injected header giving a stable cross-folder identity for a message. */
  gluonId: Optional(Schema.String),
  seen: Schema.Boolean,
  flagged: Schema.Boolean,
  size: Optional(Schema.Number),
  /** Plain-text body, truncated to PROTON_MCP_MAX_BODY_BYTES when `truncated` is set. */
  text: Optional(Schema.String),
  /** HTML body (same truncation). Prefer `text` for LLM consumption. */
  html: Optional(Schema.String),
  truncated: Schema.Boolean,
  /** Metadata only — attachment content is never exposed or written to disk (v1). */
  attachments: Schema.Array(AttachmentMetaSchema),
})

export const LabelInfoSchema = Schema.Struct({
  name: Schema.String,
  /** IMAP folder path backing the label (Proton Bridge exposes labels as `Labels/<name>` folders). */
  path: Schema.String,
  existsOnServer: Schema.Boolean,
})
