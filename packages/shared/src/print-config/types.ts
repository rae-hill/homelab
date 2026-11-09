/**
 * Print-configuration types **derived from the Effect schemas** in `schema.ts` (the
 * single source of truth), shared by the resume frontend (redux state, UI) and the
 * homelab backend (API payloads, e2e fixtures). Nothing here holds resume content data —
 * the initial/default values live in the resume app (`content-defaults`).
 */

import type { Schema } from "effect"

import type * as S from "./schema.js"

/* ---- Content (re-exported from ResumeContent for compatibility) -------------------------- */

export type BulletPoint = Schema.Schema.Type<typeof S.BulletPoint>
export type ExperienceContent = Schema.Schema.Type<typeof S.ExperienceContent>
export type ProjectContent = Schema.Schema.Type<typeof S.ProjectContent>
export type ContentState = Schema.Schema.Type<typeof S.ContentState>

/* ---- Layout / heading ------------------------------------------------------------------ */

export type AlignValue = Schema.Schema.Type<typeof S.AlignValue>
export type BlockAlign = Schema.Schema.Type<typeof S.BlockAlign>
export type TextAlign = Schema.Schema.Type<typeof S.TextAlign>
export type TagDisplay = Schema.Schema.Type<typeof S.TagDisplay>
export type IconTextSize = Schema.Schema.Type<typeof S.IconTextSize>
export type FeaturedMode = Schema.Schema.Type<typeof S.FeaturedMode>
export type LayoutSection = Schema.Schema.Type<typeof S.LayoutSection>
export type DescriptionRatio = Schema.Schema.Type<typeof S.DescriptionRatio>
export type DescriptionGap = Schema.Schema.Type<typeof S.DescriptionGap>
export type SectionLayout = Schema.Schema.Type<typeof S.SectionLayout>
export type HeaderDescription = Schema.Schema.Type<typeof S.HeaderDescription>
export type PrintToggleKey = Schema.Schema.Type<typeof S.PrintToggleKey>
export type SectionConfig = Schema.Schema.Type<typeof S.SectionConfig>
export type HeadingConfig = Schema.Schema.Type<typeof S.HeadingConfig>

/* ---- Top-level state ------------------------------------------------------------------- */

/** The full runtime state, including the ephemeral `editingEnabled` flag. */
export type PrintConfigState = Schema.Schema.Type<typeof S.PrintConfigState>

/** The persisted projection (everything except `editingEnabled`) — the wire format. */
export type PersistedConfig = Schema.Schema.Type<typeof S.PersistedPrintConfig>

/** The layout `kind` discriminant (for the UI). */
export type LayoutKind = SectionLayout["kind"]
/** The header-description `kind` discriminant (for the UI). */
export type HeaderDescriptionKind = HeaderDescription["kind"]
