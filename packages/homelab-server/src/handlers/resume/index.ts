import { HttpApiBuilder } from "effect/http-api"
import { Homelab } from "homelab-api"

import { handleResumeCoverLetter } from "./cover-letter.js"
import { handleResumePrint } from "./print.js"
import { handleResumeTailor } from "./tailor.js"

export const ResumeApiLive = HttpApiBuilder.group(
  Homelab.HomelabApi,
  "resume",
  (handlers) =>
    handlers
      .handle("print", handleResumePrint)
      .handle("tailor", handleResumeTailor)
      .handle("cover-letter", handleResumeCoverLetter),
)
