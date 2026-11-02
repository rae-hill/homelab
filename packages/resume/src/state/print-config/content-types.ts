import type { Schema } from "effect"

import type * as S from "./schema"

/**
 * Serializable resume-content types, now **derived from the Effect schemas** in
 * `schema.ts` (the single source of truth) rather than hand-written. Nothing here holds a
 * React component — content round-trips through localStorage; project icons are derived
 * statically at render time.
 */

export type BulletPoint = Schema.Schema.Type<typeof S.BulletPoint>
export type ExperienceContent = Schema.Schema.Type<typeof S.ExperienceContent>
export type ProjectContent = Schema.Schema.Type<typeof S.ProjectContent>
export type ContentState = Schema.Schema.Type<typeof S.ContentState>
