import { createSlice, type PayloadAction } from "@reduxjs/toolkit"
import { castDraft } from "immer"

import {
  type AlignTarget,
  type BlockAlign,
  type ContentState,
  type DescriptionGap,
  type FeaturedMode,
  type HeaderDescription,
  type HeaderDescriptionKind,
  type HeadingGapTarget,
  type IconTextSize,
  initialPrintConfigState,
  type LayoutKind,
  type LayoutSection,
  type PrintConfigState,
  type PrintToggleKey,
  type SectionLayout,
  type TagDisplay,
  type TextAlign,
  type TextAlignTarget,
} from "./types"

/**
 * Switch a section layout to a different `kind` while preserving the user's ordering
 * intent (tags-lead vs. description-lead). Pure; shared by the `setLayoutKind` reducer.
 */
function changeLayoutKind(layout: SectionLayout, kind: LayoutKind): SectionLayout {
  if (layout.kind === kind) {
    return layout
  }
  const tagsLead = layout.kind === "Stacked" ?
    layout.order === "TagsAbove"
    : layout.order === "TagsFirst"
  return kind === "Stacked" ?
    { kind: "Stacked", order: tagsLead ? "TagsAbove" : "TagsBelow" }
    : { kind: "SideBySide", order: tagsLead ? "TagsFirst" : "DescriptionFirst", ratio: 2 }
}

/** Switch the header-description mode, preserving alignment intent. Pure. */
function changeHeaderDescriptionKind(
  description: HeaderDescription,
  kind: HeaderDescriptionKind,
): HeaderDescription {
  if (description.kind === kind) {
    return description
  }
  if (description.kind === "Blurb") {
    const horizontal = description.textAlign === "left" ?
      "start"
      : description.textAlign === "right" ?
      "end"
      : "center"
    return { kind: "SkillList", align: { vertical: "center", horizontal } }
  }
  const textAlign = description.align.horizontal === "start" ?
    "left"
    : description.align.horizontal === "end" ?
    "right"
    : description.align.horizontal === "center" ?
    "center"
    : "left"
  return { kind: "Blurb", textAlign }
}

/**
 * The print-config slice. State shape is identical to the previous `useReducer` store;
 * reducers are written Immer-style (RTK wraps them), so they read as direct mutations but
 * produce immutable updates. Each reducer corresponds 1:1 to a former action variant.
 */
export const printConfigSlice = createSlice({
  name: "printConfig",
  initialState: initialPrintConfigState,
  reducers: {
    toggleOption(state, action: PayloadAction<PrintToggleKey>) {
      state.toggles[action.payload] = !state.toggles[action.payload]
    },
    setOption(
      state,
      action: PayloadAction<{ key: PrintToggleKey; value: boolean }>,
    ) {
      state.toggles[action.payload.key] = action.payload.value
    },
    setFeaturedMode(state, action: PayloadAction<FeaturedMode>) {
      state.featuredMode = action.payload
    },
    setLayoutKind(
      state,
      action: PayloadAction<{ section: LayoutSection; kind: LayoutKind }>,
    ) {
      const section = state.sections[action.payload.section]
      section.layout = changeLayoutKind(section.layout, action.payload.kind)
    },
    setLayout(
      state,
      action: PayloadAction<{ section: LayoutSection; layout: SectionLayout }>,
    ) {
      state.sections[action.payload.section].layout = action.payload.layout
    },
    setTextAlign(
      state,
      action: PayloadAction<{
        section: LayoutSection
        target: TextAlignTarget
        textAlign: TextAlign
      }>,
    ) {
      const section = state.sections[action.payload.section]
      if (action.payload.target === "description") {
        section.descriptionTextAlign = action.payload.textAlign
      } else {
        section.responsibilitiesTextAlign = action.payload.textAlign
      }
    },
    setBlockAlign(
      state,
      action: PayloadAction<{
        section: LayoutSection
        target: AlignTarget
        align: BlockAlign
      }>,
    ) {
      const section = state.sections[action.payload.section]
      if (action.payload.target === "description") {
        section.descriptionAlign = action.payload.align
      } else {
        section.tagAlign = action.payload.align
      }
    },
    setGap(
      state,
      action: PayloadAction<{ section: LayoutSection; gap: DescriptionGap }>,
    ) {
      state.sections[action.payload.section].gap = action.payload.gap
    },
    setTagDisplay(
      state,
      action: PayloadAction<{ section: LayoutSection; tagDisplay: TagDisplay }>,
    ) {
      state.sections[action.payload.section].tagDisplay = action.payload.tagDisplay
    },
    setHeadingIconTextSize(state, action: PayloadAction<IconTextSize>) {
      state.heading.iconTextSize = action.payload
    },
    setHeadingGap(
      state,
      action: PayloadAction<{ target: HeadingGapTarget; gap: DescriptionGap }>,
    ) {
      const { gap, target } = action.payload
      if (target === "header") {
        state.heading.gap = gap
      } else if (target === "contact") {
        state.heading.contactGap = gap
      } else {
        state.heading.skillListGap = gap
      }
    },
    setHeadingDescriptionKind(state, action: PayloadAction<HeaderDescriptionKind>) {
      state.heading.description = changeHeaderDescriptionKind(
        state.heading.description,
        action.payload,
      )
    },
    setHeadingDescription(state, action: PayloadAction<HeaderDescription>) {
      state.heading.description = action.payload
    },
    setHeadingNameAlign(state, action: PayloadAction<BlockAlign>) {
      state.heading.nameAlign = action.payload
    },
    setHeadingContactAlign(state, action: PayloadAction<BlockAlign>) {
      state.heading.contactAlign = action.payload
    },
    setContent(state, action: PayloadAction<ContentState>) {
      state.content = castDraft(action.payload)
    },
    setEntryDescription(
      state,
      action: PayloadAction<{
        section: LayoutSection
        id: string
        description: string
      }>,
    ) {
      const { description, id, section } = action.payload
      const list = section === "experience" ? state.content.experience : state.content.projects
      const entry = list.find((e) => e.id === id)
      if (entry !== undefined) {
        entry.description = description
      }
    },
    setEntryTags(
      state,
      action: PayloadAction<{
        section: LayoutSection
        id: string
        tags: ReadonlyArray<string>
      }>,
    ) {
      const { id, section, tags } = action.payload
      const list = section === "experience" ? state.content.experience : state.content.projects
      const entry = list.find((e) => e.id === id)
      if (entry !== undefined) {
        entry.tags = [...tags]
      }
    },
    addBullet(state, action: PayloadAction<{ entryId: string }>) {
      const entry = state.content.experience.find((e) => e.id === action.payload.entryId)
      if (entry !== undefined) {
        entry.bulletPoints.push({
          id: `${action.payload.entryId}__b${Date.now().toString(36)}`,
          text: "New responsibility",
          visible: true,
        })
      }
    },
    setBulletText(
      state,
      action: PayloadAction<{ entryId: string; bulletId: string; text: string }>,
    ) {
      const entry = state.content.experience.find((e) => e.id === action.payload.entryId)
      const bullet = entry?.bulletPoints.find((b) => b.id === action.payload.bulletId)
      if (bullet !== undefined) {
        bullet.text = action.payload.text
      }
    },
    toggleBulletVisible(
      state,
      action: PayloadAction<{ entryId: string; bulletId: string }>,
    ) {
      const entry = state.content.experience.find((e) => e.id === action.payload.entryId)
      const bullet = entry?.bulletPoints.find((b) => b.id === action.payload.bulletId)
      if (bullet !== undefined) {
        bullet.visible = !bullet.visible
      }
    },
    removeBullet(
      state,
      action: PayloadAction<{ entryId: string; bulletId: string }>,
    ) {
      const entry = state.content.experience.find((e) => e.id === action.payload.entryId)
      if (entry !== undefined) {
        entry.bulletPoints = entry.bulletPoints.filter(
          (b) => b.id !== action.payload.bulletId,
        )
      }
    },
    setEditingEnabled(state, action: PayloadAction<boolean>) {
      state.editingEnabled = action.payload
    },
    /** Replace the entire slice (used by one-shot hydration from localStorage). */
    hydrate(_state, action: PayloadAction<PrintConfigState>) {
      return action.payload
    },
    /**
     * Apply an imported / recalled config, preserving the current `editingEnabled` (so
     * importing a preset mid-session doesn't re-lock the editor). Used by import + presets.
     */
    applyConfig(state, action: PayloadAction<PrintConfigState>) {
      return { ...action.payload, editingEnabled: state.editingEnabled }
    },
    reset() {
      return initialPrintConfigState
    },
  },
})

export const printConfigActions = printConfigSlice.actions
export const printConfigReducer = printConfigSlice.reducer
