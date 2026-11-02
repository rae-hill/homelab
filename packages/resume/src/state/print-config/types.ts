/**
 * Print-configuration types. State shapes are **derived from the Effect schemas** in
 * `schema.ts` (the single source of truth); only the action union (which is never
 * persisted) and the initial-state value are hand-written here.
 */

import type { Schema } from "effect"

import { initialContentState } from "./content-defaults"
import type { ContentState } from "./content-types"
import type * as S from "./schema"

export { initialContentState } from "./content-defaults"
export type { BulletPoint, ContentState, ExperienceContent, ProjectContent } from "./content-types"

/* ---- Types derived from the schemas -------------------------------------------------- */

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
export type PrintConfigState = Schema.Schema.Type<typeof S.PrintConfigState>

/** The layout `kind` discriminant (for the UI). */
export type LayoutKind = SectionLayout["kind"]
/** The header-description `kind` discriminant (for the UI). */
export type HeaderDescriptionKind = HeaderDescription["kind"]

/** Which heading spacing a `SetHeadingGap` action targets. */
export type HeadingGapTarget = "header" | "contact" | "skillList"
/** Which block an alignment action targets. */
export type AlignTarget = "description" | "tag"
/** Which text block a text-align action targets. */
export type TextAlignTarget = "description" | "responsibilities"

/* ---- Actions (not persisted; hand-written tagged union) ------------------------------ */

export type PrintConfigAction =
  | { readonly type: "ToggleOption"; readonly key: PrintToggleKey }
  | { readonly type: "SetOption"; readonly key: PrintToggleKey; readonly value: boolean }
  | { readonly type: "SetFeaturedMode"; readonly mode: FeaturedMode }
  | {
    readonly type: "SetLayoutKind"
    readonly section: LayoutSection
    readonly kind: LayoutKind
  }
  | {
    readonly type: "SetLayout"
    readonly section: LayoutSection
    readonly layout: SectionLayout
  }
  | {
    readonly type: "SetTextAlign"
    readonly section: LayoutSection
    readonly target: TextAlignTarget
    readonly textAlign: TextAlign
  }
  | {
    readonly type: "SetBlockAlign"
    readonly section: LayoutSection
    readonly target: AlignTarget
    readonly align: BlockAlign
  }
  | {
    readonly type: "SetGap"
    readonly section: LayoutSection
    readonly gap: DescriptionGap
  }
  | {
    readonly type: "SetTagDisplay"
    readonly section: LayoutSection
    readonly tagDisplay: TagDisplay
  }
  | { readonly type: "SetHeadingIconTextSize"; readonly size: IconTextSize }
  | {
    readonly type: "SetHeadingGap"
    readonly target: HeadingGapTarget
    readonly gap: DescriptionGap
  }
  | {
    readonly type: "SetHeadingDescriptionKind"
    readonly kind: HeaderDescriptionKind
  }
  | { readonly type: "SetHeadingDescription"; readonly description: HeaderDescription }
  | { readonly type: "SetHeadingNameAlign"; readonly align: BlockAlign }
  | { readonly type: "SetHeadingContactAlign"; readonly align: BlockAlign }
  | { readonly type: "SetContent"; readonly content: ContentState }
  | {
    readonly type: "SetEntryDescription"
    readonly section: LayoutSection
    readonly id: string
    readonly description: string
  }
  | {
    readonly type: "SetEntryTags"
    readonly section: LayoutSection
    readonly id: string
    readonly tags: ReadonlyArray<string>
  }
  | { readonly type: "AddBullet"; readonly entryId: string }
  | {
    readonly type: "SetBulletText"
    readonly entryId: string
    readonly bulletId: string
    readonly text: string
  }
  | {
    readonly type: "ToggleBulletVisible"
    readonly entryId: string
    readonly bulletId: string
  }
  | { readonly type: "RemoveBullet"; readonly entryId: string; readonly bulletId: string }
  | { readonly type: "SetEditingEnabled"; readonly enabled: boolean }
  | { readonly type: "SetState"; readonly state: PrintConfigState }
  | { readonly type: "Reset" }

const defaultBlockAlign: BlockAlign = { vertical: "center", horizontal: "start" }
const defaultBlockCenter: BlockAlign = { vertical: "center", horizontal: "center" }

/**
 * Initial state: everything on, featured inline, items stacked, text left-aligned.
 * `editingEnabled` defaults to unlocked in dev (modal survives reloads while iterating),
 * locked in production (Konami-gated). Vite inlines `import.meta.env.PROD` at build time.
 */
export const initialPrintConfigState: PrintConfigState = {
  toggles: {
    skills: true,
    experience: true,
    projects: true,
    positionDescription: false,
    positionResponsibilities: true,
    tagCloud: false,
    positionTags: true,
    projectTags: false,
    certification: true,
    education: true,
    address: true,
    phone: true,
    email: true,
    websiteLink: true,
    githubLink: true,
    linkedinLink: true,
  },
  featuredMode: "Inline",
  sections: {
    experience: {
      layout: { kind: "Stacked", order: "TagsBelow" },
      descriptionTextAlign: "left",
      responsibilitiesTextAlign: "left",
      descriptionAlign: defaultBlockAlign,
      tagAlign: defaultBlockCenter,
      gap: 3,
      tagDisplay: "Tags",
    },
    projects: {
      layout: { kind: "Stacked", order: "TagsBelow" },
      descriptionTextAlign: "left",
      responsibilitiesTextAlign: "left",
      descriptionAlign: defaultBlockAlign,
      tagAlign: defaultBlockCenter,
      gap: 3,
      tagDisplay: "Tags",
    },
  },
  heading: {
    iconTextSize: "md",
    gap: 3,
    contactGap: 3,
    skillListGap: 1,
    nameAlign: defaultBlockCenter,
    contactAlign: defaultBlockCenter,
    description: { kind: "SkillList", align: defaultBlockCenter },
  },
  content: initialContentState,
  editingEnabled: !import.meta.env.PROD,
}
