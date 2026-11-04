import { HttpApiGroup } from "effect/http-api"
import * as Print from "./print.js"

export const ResumeApi = HttpApiGroup.make("resume")
  .add(Print.ResumePrint)

export * as Print from "./print.js"
