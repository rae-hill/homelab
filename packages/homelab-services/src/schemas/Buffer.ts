import { Schema, SchemaTransformation } from "effect"
import { Base64 } from "./Base64.js"
import { Optional } from "./optionals.js"

export const BufferSchema = Schema.declare(
  (input): input is Buffer => input instanceof Buffer,
  {
    identifier: "Buffer",
    description: "The NodeJS Buffer type",
    toCodecArbitrary: () =>
      Schema.link<Buffer>()(
        Schema.String,
        SchemaTransformation.transform({
          decode: (s: string): Buffer => Buffer.from(s, "base64"),
          encode: (b: Buffer) => b.toString("base64"),
        }),
      ),
  },
)

export const BufferFromBase64 = Base64.pipe(
  Schema.decodeTo(
    BufferSchema,
    SchemaTransformation.transform({
      decode: (base64: string): Buffer => Buffer.from(base64, "hex"),
      encode: (buffer: Buffer): string => buffer.toString("base64"),
    }),
  ),
)

export const OptionalBufferFromBase64 = Optional(BufferFromBase64)

export const StringFromUint8Array = Schema.Uint8Array.pipe(
  Schema.decodeTo(
    Schema.String,
    SchemaTransformation.transform({
      decode: (bytes: Uint8Array): string => Buffer.from(bytes).toString("utf-8"),
      encode: (str: string): Uint8Array => Uint8Array.from(str),
    }),
  ),
)
