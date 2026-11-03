import { HttpApiBuilder } from "effect/http-api"
import { Homelab } from "homelab-api"
import { handleCombined } from "./combined.js"
import { handleIntermediate } from "./intermediate.js"
import { handleRoot } from "./root.js"

export const CertApiLive = HttpApiBuilder.group(
  Homelab.HomelabApi,
  "cert",
  (handlers) =>
    handlers
      .handle("root", handleRoot)
      .handle("intermediate", handleIntermediate)
      .handle("combined", handleCombined),
)
