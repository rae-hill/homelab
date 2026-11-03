import { Schema } from "effect"
import { HttpApiSchema } from "effect/http-api"

export const XMLSchema = Schema.String.pipe(
  Schema.brand("homelab/XML"),
  Schema.annotate({
    description: "An XML Document",
    title: "XML",
    examples: [
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
<plist version="1.0">
  <string>test</string>
</plist>` as any,
    ],
  }),
  HttpApiSchema.asText({
    contentType: "application/xml",
  }),
)

export type XML = typeof XMLSchema.Type

export function wrapUnsafe(str: string): XML {
  return str as XML
}
