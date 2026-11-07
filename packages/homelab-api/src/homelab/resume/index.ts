import { HttpApiGroup } from "effect/http-api"
import * as Print from "./print.js"
import * as Tailor from "./tailor.js"

export const ResumeApi = HttpApiGroup.make("resume")
  .add(Print.ResumePrint)
  .add(Tailor.ResumeTailor)

export * as Print from "./print.js"
export * as Tailor from "./tailor.js"
