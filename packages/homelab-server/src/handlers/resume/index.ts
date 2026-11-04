import { HttpApiBuilder } from "effect/http-api"
import { Homelab } from "homelab-api"

import { handleResumePrint } from "./print.js"

export const ResumeApiLive = HttpApiBuilder.group(
  Homelab.HomelabApi,
  "resume",
  (handlers) =>
    handlers
      .handle("print", handleResumePrint),
)
