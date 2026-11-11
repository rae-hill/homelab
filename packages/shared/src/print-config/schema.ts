import { Schema } from "effect"
import { BulletPoint, ContentState, ExperienceContent, ProjectContent } from "../resume-content/schema.js"

/**
 * Effect v4 schemas for the print-config state — the single source of truth. All TS types
 * are derived from these via `Schema.Schema.Type<typeof X>` (see `types.ts`), and
 * persistence decodes/encodes through them (see `persistence.ts`), so there is no drift
 * between the runtime validators and the compile-time types.
 *
 * Tagged unions (`SectionLayout`, `HeaderDescription`) use `Schema.Union` of
 * `Schema.Struct`s discriminated on a literal `kind` field — Effect narrows these
 * automatically on decode.
 */

/** A CSS box-distribution value (maps to justify-content / align-content). */
export const AlignValue = Schema.Literals([
  "start",
  "center",
  "end",
  "space-between",
  "space-around",
  "space-evenly",
])

/** 2D placement of a block on both axes. */
export const BlockAlign = Schema.Struct({
  vertical: AlignValue,
  horizontal: AlignValue,
})

export const TextAlign = Schema.Literals(["left", "center", "right"])

export const TagDisplay = Schema.Literals(["Tags", "List"])

export const IconTextSize = Schema.Literals(["sm", "md", "lg", "xl"])

/**
 * How the featured items (education, certification) are displayed:
 * - `Inline`: contact-line style entries in the resume heading
 * - `External`: side-by-side bordered boxes under the heading
 * - `Block`: plain full-width "EDUCATION" / "CERTIFICATIONS" paragraph sections —
 *   the parser-friendly rendering (heading + one line per attribute, bold-uppercase
 *   section headings that resume parsers reliably detect)
 */
export const FeaturedMode = Schema.Literals(["Inline", "External", "Block"])

export const LayoutSection = Schema.Literals(["experience", "projects"])

/** Description column ratio (relative to the tags column) in a side-by-side layout. */
export const DescriptionRatio = Schema.Literals([3, 2, 1, 0.5])

/** Inter-block gap in Chakra spacing units. */
export const DescriptionGap = Schema.Literals([3, 2, 1, 0])

/** Tagged union: how an item arranges its tags vs. its content. */
export const SectionLayout = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("Stacked"),
    order: Schema.Literals(["TagsAbove", "TagsBelow"]),
  }),
  Schema.Struct({
    kind: Schema.Literal("SideBySide"),
    order: Schema.Literals(["DescriptionFirst", "TagsFirst"]),
    ratio: DescriptionRatio,
  }),
])

/** Tagged union: what the heading description renders + its matching alignment. */
export const HeaderDescription = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("Blurb"),
    textAlign: TextAlign,
  }),
  Schema.Struct({
    kind: Schema.Literal("SkillList"),
    align: BlockAlign,
  }),
])

export const PrintToggleKey = Schema.Literals([
  "experience",
  "projects",
  "skills",
  "positionDescription",
  "positionResponsibilities",
  "tagCloud",
  "positionTags",
  "projectTags",
  "certification",
  "education",
  "address",
  "phone",
  "email",
  "websiteLink",
  "githubLink",
  "linkedinLink",
])

/** All boolean toggles, keyed by {@link PrintToggleKey}. */
export const Toggles = Schema.Struct({
  skills: Schema.Boolean,
  experience: Schema.Boolean,
  projects: Schema.Boolean,
  positionDescription: Schema.Boolean,
  positionResponsibilities: Schema.Boolean,
  tagCloud: Schema.Boolean,
  positionTags: Schema.Boolean,
  projectTags: Schema.Boolean,
  certification: Schema.Boolean,
  education: Schema.Boolean,
  address: Schema.Boolean,
  phone: Schema.Boolean,
  email: Schema.Boolean,
  websiteLink: Schema.Boolean,
  githubLink: Schema.Boolean,
  linkedinLink: Schema.Boolean,
})

export const SectionConfig = Schema.Struct({
  layout: SectionLayout,
  descriptionTextAlign: TextAlign,
  responsibilitiesTextAlign: TextAlign,
  descriptionAlign: BlockAlign,
  tagAlign: BlockAlign,
  gap: DescriptionGap,
  tagDisplay: TagDisplay,
})

export const HeadingConfig = Schema.Struct({
  iconTextSize: IconTextSize,
  gap: DescriptionGap,
  contactGap: DescriptionGap,
  skillListGap: DescriptionGap,
  nameAlign: BlockAlign,
  contactAlign: BlockAlign,
  description: HeaderDescription,
})

/* ---- Content (moved to resume-content; re-exported for compatibility) -------------------- */

export { BulletPoint, ContentState, ExperienceContent, ProjectContent }

/* ---- Top-level state ----------------------------------------------------------------- */

export const Sections = Schema.Struct({
  experience: SectionConfig,
  projects: SectionConfig,
})

/**
 * The full print-config state. `editingEnabled` is part of the runtime state but is NOT
 * part of the persisted schema (see {@link PersistedPrintConfig}) — it stays ephemeral.
 */
export const PrintConfigState = Schema.Struct({
  toggles: Toggles,
  featuredMode: FeaturedMode,
  sections: Sections,
  heading: HeadingConfig,
  content: ContentState,
  editingEnabled: Schema.Boolean,
})

/**
 * The persisted projection: everything except `editingEnabled` (so the Konami unlock
 * can't be made sticky via localStorage). This is the schema used for import/export and
 * presets as well, keeping one codec for all three.
 */
export const PersistedPrintConfig = Schema.Struct({
  toggles: Toggles,
  featuredMode: FeaturedMode,
  sections: Sections,
  heading: HeadingConfig,
  content: ContentState,
})
