import { Effect, Option } from "effect"
import { Services } from "homelab-services"
import { useCallback, useEffect, useMemo, useState } from "react"

import { DEFAULT_PRESET_NAME } from "../../constants/print-config.constants"
import { runBrowser } from "../services"
import { decodeBase64Config, encodeBase64Config } from "./persistence"
import { printConfigActions as A } from "./slice"
import { useAppDispatch, useAppSelector } from "./store"
import { initialPrintConfigState } from "./types"
import type {
  AlignTarget,
  BlockAlign,
  DescriptionGap,
  FeaturedMode,
  HeaderDescription,
  HeaderDescriptionKind,
  HeadingGapTarget,
  IconTextSize,
  LayoutKind,
  LayoutSection,
  PrintConfigState,
  PrintToggleKey,
  SectionLayout,
  TagDisplay,
  TextAlign,
  TextAlignTarget,
} from "./types"

/**
 * Granular selector + dispatch hooks over the Redux print-config slice. Each hook selects
 * only the slice it needs, so a component re-renders only when that slice changes —
 * the whole point of moving off the single context value. Action creators are stable, so
 * the returned callbacks are stable and safe as effect/memo deps.
 */

/** Print toggles (booleans) + their setters. */
export function useToggles() {
  const dispatch = useAppDispatch()
  const toggles = useAppSelector((s) => s.printConfig.toggles)
  const isEnabled = useCallback((key: PrintToggleKey) => toggles[key], [toggles])
  const toggleOption = useCallback(
    (key: PrintToggleKey) => dispatch(A.toggleOption(key)),
    [dispatch],
  )
  const setOption = useCallback(
    (key: PrintToggleKey, value: boolean) => dispatch(A.setOption({ key, value })),
    [dispatch],
  )
  return useMemo(
    () => ({ toggles, isEnabled, toggleOption, setOption }),
    [toggles, isEnabled, toggleOption, setOption],
  )
}

/** The featured (Inline / External) render mode + setter. */
export function useFeaturedMode() {
  const dispatch = useAppDispatch()
  const featuredMode = useAppSelector((s) => s.printConfig.featuredMode)
  const setFeaturedMode = useCallback(
    (mode: FeaturedMode) => dispatch(A.setFeaturedMode(mode)),
    [dispatch],
  )
  return useMemo(
    () => ({ featuredMode, setFeaturedMode }),
    [featuredMode, setFeaturedMode],
  )
}

/** One section's layout/alignment config + its setters. Re-renders only on that section. */
export function useSectionConfig(section: LayoutSection) {
  const dispatch = useAppDispatch()
  const config = useAppSelector((s) => s.printConfig.sections[section])
  const setLayoutKind = useCallback(
    (kind: LayoutKind) => dispatch(A.setLayoutKind({ section, kind })),
    [dispatch, section],
  )
  const setLayout = useCallback(
    (layout: SectionLayout) => dispatch(A.setLayout({ section, layout })),
    [dispatch, section],
  )
  const setTextAlign = useCallback(
    (target: TextAlignTarget, textAlign: TextAlign) => dispatch(A.setTextAlign({ section, target, textAlign })),
    [dispatch, section],
  )
  const setBlockAlign = useCallback(
    (target: AlignTarget, align: BlockAlign) => dispatch(A.setBlockAlign({ section, target, align })),
    [dispatch, section],
  )
  const setGap = useCallback(
    (gap: DescriptionGap) => dispatch(A.setGap({ section, gap })),
    [dispatch, section],
  )
  const setTagDisplay = useCallback(
    (tagDisplay: TagDisplay) => dispatch(A.setTagDisplay({ section, tagDisplay })),
    [dispatch, section],
  )
  return useMemo(
    () => ({
      config,
      setLayoutKind,
      setLayout,
      setTextAlign,
      setBlockAlign,
      setGap,
      setTagDisplay,
    }),
    [config, setLayoutKind, setLayout, setTextAlign, setBlockAlign, setGap, setTagDisplay],
  )
}

/** The heading config + its setters. */
export function useHeadingConfig() {
  const dispatch = useAppDispatch()
  const heading = useAppSelector((s) => s.printConfig.heading)
  const setHeadingIconTextSize = useCallback(
    (size: IconTextSize) => dispatch(A.setHeadingIconTextSize(size)),
    [dispatch],
  )
  const setHeadingGap = useCallback(
    (target: HeadingGapTarget, gap: DescriptionGap) => dispatch(A.setHeadingGap({ target, gap })),
    [dispatch],
  )
  const setHeadingDescriptionKind = useCallback(
    (kind: HeaderDescriptionKind) => dispatch(A.setHeadingDescriptionKind(kind)),
    [dispatch],
  )
  const setHeadingDescription = useCallback(
    (description: HeaderDescription) => dispatch(A.setHeadingDescription(description)),
    [dispatch],
  )
  const setHeadingNameAlign = useCallback(
    (align: BlockAlign) => dispatch(A.setHeadingNameAlign(align)),
    [dispatch],
  )
  const setHeadingContactAlign = useCallback(
    (align: BlockAlign) => dispatch(A.setHeadingContactAlign(align)),
    [dispatch],
  )
  return useMemo(
    () => ({
      heading,
      setHeadingIconTextSize,
      setHeadingGap,
      setHeadingDescriptionKind,
      setHeadingDescription,
      setHeadingNameAlign,
      setHeadingContactAlign,
    }),
    [
      heading,
      setHeadingIconTextSize,
      setHeadingGap,
      setHeadingDescriptionKind,
      setHeadingDescription,
      setHeadingNameAlign,
      setHeadingContactAlign,
    ],
  )
}

/** The editable content + its setters. */
export function useContent() {
  const dispatch = useAppDispatch()
  const content = useAppSelector((s) => s.printConfig.content)
  const setEntryDescription = useCallback(
    (section: LayoutSection, id: string, description: string) =>
      dispatch(A.setEntryDescription({ section, id, description })),
    [dispatch],
  )
  const setEntryTags = useCallback(
    (section: LayoutSection, id: string, tags: ReadonlyArray<string>) =>
      dispatch(A.setEntryTags({ section, id, tags })),
    [dispatch],
  )
  const addBullet = useCallback(
    (entryId: string) => dispatch(A.addBullet({ entryId })),
    [dispatch],
  )
  const setBulletText = useCallback(
    (entryId: string, bulletId: string, text: string) => dispatch(A.setBulletText({ entryId, bulletId, text })),
    [dispatch],
  )
  const toggleBulletVisible = useCallback(
    (entryId: string, bulletId: string) => dispatch(A.toggleBulletVisible({ entryId, bulletId })),
    [dispatch],
  )
  const removeBullet = useCallback(
    (entryId: string, bulletId: string) => dispatch(A.removeBullet({ entryId, bulletId })),
    [dispatch],
  )
  const setBlurb = useCallback(
    (blurb: string) => dispatch(A.setBlurb(blurb)),
    [dispatch],
  )
  const setAboutMe = useCallback(
    (aboutMe: string) => dispatch(A.setAboutMe(aboutMe)),
    [dispatch],
  )
  return useMemo(
    () => ({
      content,
      setEntryDescription,
      setEntryTags,
      addBullet,
      setBulletText,
      toggleBulletVisible,
      removeBullet,
      setBlurb,
      setAboutMe,
    }),
    [
      content,
      setEntryDescription,
      setEntryTags,
      addBullet,
      setBulletText,
      toggleBulletVisible,
      removeBullet,
      setBlurb,
      setAboutMe,
    ],
  )
}

/** The Konami-gated editing flag + setter. */
export function useEditingEnabled() {
  const dispatch = useAppDispatch()
  const editingEnabled = useAppSelector((s) => s.homelab.auth.status === "signedIn" || s.printConfig.editingEnabled)
  const setEditingEnabled = useCallback(
    (enabled: boolean) => dispatch(A.setEditingEnabled(enabled)),
    [dispatch],
  )
  return useMemo(
    () => ({ editingEnabled, setEditingEnabled }),
    [editingEnabled, setEditingEnabled],
  )
}

/** Reset the whole print config to defaults. */
export function useResetPrintConfig() {
  const dispatch = useAppDispatch()
  return useCallback(() => dispatch(A.reset()), [dispatch])
}

/**
 * Import/export of the whole config via the base64 schema codec. Used by the Settings
 * Import/Export controls and the Presets tab. `importBase64` returns whether the blob
 * decoded successfully (false → caller shows an inline error; state unchanged).
 */
export function useConfigIO() {
  const dispatch = useAppDispatch()
  const state = useAppSelector((s) => s.printConfig)

  const exportBase64 = useCallback(() => encodeBase64Config(state), [state])

  const applyConfig = useCallback(
    (next: PrintConfigState) => dispatch(A.applyConfig(next)),
    [dispatch],
  )

  const importBase64 = useCallback(
    (base64: string): boolean => {
      const decoded = decodeBase64Config(base64)
      if (decoded === null) {
        return false
      }
      dispatch(A.applyConfig(decoded))
      return true
    },
    [dispatch],
  )

  return useMemo(
    () => ({ state, exportBase64, importBase64, applyConfig }),
    [state, exportBase64, importBase64, applyConfig],
  )
}

/** A single preset entry with name, base64-encoded config, and whether it's built-in */
export interface PresetEntry {
  name: string
  base64: string
  builtIn: boolean
}

/**
 * Named presets stored via PresetSnapshotService, plus a built-in read-only **Default** preset
 * (the `initialPrintConfigState`) that always appears first and is the Reset target.
 * Saving under the reserved name "Default" is rejected.
 */
export function usePresets() {
  const dispatch = useAppDispatch()
  const [record, setRecord] = useState<Record<string, string>>({})

  // Load once on mount (client-only; SSR renders with the built-in Default only).
  useEffect(() => {
    void runBrowser(
      Effect.gen(function*() {
        const service = yield* Services.PresetSnapshotService.PresetSnapshotService
        const names = yield* service.list()
        const loaded: Record<string, string> = {}
        for (const name of names) {
          const result = yield* service.recall(name)
          if (Option.isSome(result)) {
            loaded[name] = result.value
          }
        }
        setRecord(loaded)
      }),
    )
  }, [])

  /** Built-in Default first, then user presets alphabetically. */
  const presets = useMemo<ReadonlyArray<PresetEntry>>(() => {
    const builtIn: PresetEntry = {
      name: DEFAULT_PRESET_NAME,
      base64: encodeBase64Config(initialPrintConfigState),
      builtIn: true,
    }
    const user = Object.entries(record)
      .map(([name, base64]) => ({ name, base64, builtIn: false }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return [builtIn, ...user]
  }, [record])

  /** Save the current config under `name`. Returns false if the name is reserved/empty. */
  const save = useCallback(
    (name: string, state: PrintConfigState): boolean => {
      const trimmed = name.trim()
      if (trimmed === "" || trimmed === DEFAULT_PRESET_NAME) {
        return false
      }
      const base64 = encodeBase64Config(state)
      void runBrowser(
        Effect.gen(function*() {
          const service = yield* Services.PresetSnapshotService.PresetSnapshotService
          const result = yield* Effect.match(service.save(trimmed, base64), {
            onFailure: () => null,
            onSuccess: (finalName) => finalName,
          })
          if (result !== null) {
            setRecord((prev) => ({ ...prev, [result]: base64 }))
          }
        }),
      )
      return true
    },
    [],
  )

  const remove = useCallback(
    (name: string) => {
      if (name === DEFAULT_PRESET_NAME) {
        return
      }
      void runBrowser(
        Effect.gen(function*() {
          const service = yield* Services.PresetSnapshotService.PresetSnapshotService
          yield* service.remove(name)
          setRecord((prev) => {
            const next = { ...prev }
            delete next[name]
            return next
          })
        }),
      )
    },
    [],
  )

  /** Recall a preset into the store (preserving `editingEnabled`). Returns success. */
  const recall = useCallback(
    (preset: PresetEntry): boolean => {
      const decoded = decodeBase64Config(preset.base64)
      if (decoded === null) {
        return false
      }
      dispatch(A.applyConfig(decoded))
      return true
    },
    [dispatch],
  )

  return useMemo(
    () => ({ presets, save, recall, remove }),
    [presets, save, recall, remove],
  )
}
