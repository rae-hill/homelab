/**
 * Print-configuration types for the resume app. The schema-derived types come from the
 * `shared` package (single source of truth for schemas + wire codecs, shared with the
 * homelab backend); this file adds the app-specific pieces: the action union (never
 * persisted), the UI target unions, and the initial state value.
 */

import { ResumeContent } from "shared"
import type { PrintConfig } from "shared"

export const initialContentState = ResumeContent.INITIAL_CONTENT_STATE

/* ---- Schema-derived types (re-exported from shared) ----------------------------------- */

export type AlignValue = PrintConfig.AlignValue
export type BlockAlign = PrintConfig.BlockAlign
export type BulletPoint = PrintConfig.BulletPoint
export type ContentState = PrintConfig.ContentState
export type DescriptionGap = PrintConfig.DescriptionGap
export type DescriptionRatio = PrintConfig.DescriptionRatio
export type ExperienceContent = PrintConfig.ExperienceContent
export type FeaturedMode = PrintConfig.FeaturedMode
export type HeaderDescription = PrintConfig.HeaderDescription
export type HeaderDescriptionKind = PrintConfig.HeaderDescriptionKind
export type HeadingConfig = PrintConfig.HeadingConfig
export type IconTextSize = PrintConfig.IconTextSize
export type LayoutKind = PrintConfig.LayoutKind
export type LayoutSection = PrintConfig.LayoutSection
export type PersistedConfig = PrintConfig.PersistedConfig
export type PrintConfigState = PrintConfig.PrintConfigState
export type PrintToggleKey = PrintConfig.PrintToggleKey
export type ProjectContent = PrintConfig.ProjectContent
export type SectionConfig = PrintConfig.SectionConfig
export type SectionLayout = PrintConfig.SectionLayout
export type TagDisplay = PrintConfig.TagDisplay
export type TextAlign = PrintConfig.TextAlign

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
  featuredMode: "External",
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
