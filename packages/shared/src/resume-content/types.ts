/**
 * Type aliases for the resume content schemas. These are derived from the Effect schemas
 * in schema.ts using Schema.Schema.Type, matching the pattern used throughout the codebase.
 */

import type { Schema } from "effect"

import type * as S from "./schema.js"

export type BulletPoint = Schema.Schema.Type<typeof S.BulletPoint>
export type ExperienceContent = Schema.Schema.Type<typeof S.ExperienceContent>
export type ProjectContent = Schema.Schema.Type<typeof S.ProjectContent>
export type ContentState = Schema.Schema.Type<typeof S.ContentState>
