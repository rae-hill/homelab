import { Schema } from "effect"
import { OptionalWithDefault } from "../schemas/optionals.js"
import { ABOUT_ME_DEFAULT, BLURB_DEFAULT } from "./defaults.js"

/**
 * Content schemas for the resume — extracted from print-config/schema.ts to be shared
 * across frontend and backend. Extended with blurb and aboutMe fields (decision D2)
 * using OptionalWithDefault so old persisted blobs still decode.
 */

/* ---- Content ------------------------------------------------------------------------- */

export const BulletPoint = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  visible: Schema.Boolean,
})

export const ExperienceContent = Schema.Struct({
  id: Schema.String,
  company: Schema.String,
  location: Schema.String,
  roles: Schema.Array(
    Schema.Struct({ title: Schema.String, date: Schema.String }),
  ),
  description: Schema.String,
  bulletPoints: Schema.Array(BulletPoint),
  tags: Schema.Array(Schema.String),
})

export const ProjectContent = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
  githubLink: Schema.String,
  tags: Schema.Array(Schema.String),
})

/**
 * The resume content state — experience, projects, skills, plus blurb and aboutMe.
 * blurb and aboutMe use OptionalWithDefault so old persisted blobs (without these fields)
 * still decode; the defaults materialize on decode.
 */
export const ContentState = Schema.Struct({
  blurb: OptionalWithDefault(Schema.String, () => BLURB_DEFAULT),
  aboutMe: OptionalWithDefault(Schema.String, () => ABOUT_ME_DEFAULT),
  experience: Schema.Array(ExperienceContent),
  projects: Schema.Array(ProjectContent),
  skills: Schema.Array(Schema.String),
})
