import { Schema } from "effect"

export const HTTPMethod = Schema.Literals([
  "GET",
  "HEAD",
  "PUT",
  "PATCH",
  "POST",
  "DELETE",
  "CONNECT",
  "TRACE",
])

export type HTTPMethod = typeof HTTPMethod.Type
