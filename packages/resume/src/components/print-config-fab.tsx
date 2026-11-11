import {
  Box,
  Button,
  Dialog,
  HStack,
  Icon,
  IconButton,
  Portal,
  SegmentGroup,
  SimpleGrid,
  Stack,
  Switch,
  Tabs,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react"
import { useNavigate, useSearch } from "@tanstack/react-router"
import type { IconType } from "react-icons"
import { CiSettings } from "react-icons/ci"
import {
  LuAlignHorizontalDistributeCenter,
  LuAlignHorizontalJustifyCenter,
  LuAlignHorizontalJustifyEnd,
  LuAlignHorizontalJustifyStart,
  LuAlignHorizontalSpaceAround,
  LuAlignHorizontalSpaceBetween,
  LuAlignJustify,
  LuAlignLeft,
  LuAlignRight,
  LuAlignVerticalDistributeCenter,
  LuAlignVerticalJustifyCenter,
  LuAlignVerticalJustifyEnd,
  LuAlignVerticalJustifyStart,
  LuAlignVerticalSpaceAround,
  LuAlignVerticalSpaceBetween,
  LuBookmark,
  LuBriefcase,
  LuFolderGit2,
  LuShare2,
  LuUserRound,
  LuWand,
  LuX,
} from "react-icons/lu"

import { MdOutlineVisibility } from "react-icons/md"
import { useKonamiCode } from "../hooks/useKonamiCode"
import { useResizableHeight } from "../hooks/useResizableHeight"
import {
  useContent,
  useEditingEnabled,
  useFeaturedMode,
  useHeadingConfig,
  useResetPrintConfig,
  useSectionConfig,
  useToggles,
} from "../state/print-config"
import type {
  AlignValue,
  BlockAlign,
  DescriptionGap,
  DescriptionRatio,
  FeaturedMode,
  HeaderDescription,
  HeaderDescriptionKind,
  HeadingGapTarget,
  IconTextSize,
  LayoutKind,
  LayoutSection,
  PrintToggleKey,
  SectionConfig,
  SectionLayout,
  TagDisplay,
  TextAlign,
} from "../state/print-config"
import { Tooltip } from "./chakra/tooltip"
import { PresetsPanel, SharePanel } from "./config-io"
import { ContentEditor, ContentSubsectionDivider } from "./content-editor"
import { ListingDetailModal } from "./tailoring/listing-detail-modal"
import { TailoringTab } from "./tailoring/tailoring-tab"

/** Query-string flag controlling whether the settings modal is open. */
const OPEN_QUERY_PARAM = "print-options-open"

/** Query-string key selecting the active settings tab. */
const TAB_QUERY_PARAM = "print-options-tab"

/** Valid settings tabs; also the default (first) when the param is absent/invalid. */
const TABS = ["print", "heading", "experience", "projects", "presets", "share", "tailoring"] as const
type SettingsTab = (typeof TABS)[number]

interface ToggleItem {
  readonly key: PrintToggleKey
  readonly label: string
  readonly description: string
}

/** The toggles shown in the Print tab. */
const TOGGLE_ITEMS: ReadonlyArray<ToggleItem> = [
  // {
  //   key: "skills",
  //   label: "Show Skills Section",
  //   description: "Hide or show the entire skills section"
  // },
  {
    key: "experience",
    label: "Show Experience Section",
    description: "Hide or show the entire experience section",
  },
  {
    key: "projects",
    label: "Show Projects Section",
    description: "Hide or show the entire projects section",
  },
  {
    key: "positionDescription",
    label: "Show Position Description",
    description: "The summary blurb under each role.",
  },
  {
    key: "positionResponsibilities",
    label: "Show Position Responsibilities",
    description: "The bulleted accomplishments for each role.",
  },
  {
    key: "tagCloud",
    label: "Show Tag Cloud",
    description: "The cloud of skill and technology pills.",
  },
  {
    key: "positionTags",
    label: "Show Position Tags",
    description: "Technology tags attached to each role.",
  },
  {
    key: "projectTags",
    label: "Show Project Tags",
    description: "Technology tags attached to each project.",
  },
  {
    key: "certification",
    label: "Show Certification",
    description: "Your CompTIA Security+ certification.",
  },
  {
    key: "education",
    label: "Show Education",
    description: "Your degree and university.",
  },
  {
    key: "address",
    label: "Show Address",
    description: "Your mailing address in the header.",
  },
  {
    key: "phone",
    label: "Show Phone",
    description: "Your phone number in the header.",
  },
  {
    key: "email",
    label: "Show Email",
    description: "Your email address in the header.",
  },
  {
    key: "websiteLink",
    label: "Show Website Link",
    description: "Your personal website link in the header.",
  },
  {
    key: "githubLink",
    label: "Show GitHub Link",
    description: "Your GitHub profile link in the header.",
  },
  {
    key: "linkedinLink",
    label: "Show LinkedIn Link",
    description: "Your LinkedIn profile link in the header.",
  },
]

const FEATURED_MODES: ReadonlyArray<FeaturedMode> = ["Inline", "External", "Block"]

const LAYOUT_KINDS: ReadonlyArray<LayoutKind> = ["Stacked", "SideBySide"]

/** Human-readable labels for layout kinds and order options. */
const SEGMENT_LABEL: Record<string, string> = {
  Stacked: "Stacked",
  SideBySide: "Side by Side",
  TagsAbove: "Tags Above",
  TagsBelow: "Tags Below",
  DescriptionFirst: "Tags Last",
  TagsFirst: "Tags First",
}

const DESCRIPTION_RATIOS: ReadonlyArray<DescriptionRatio> = [3, 2, 1, 0.5]

const DESCRIPTION_GAPS: ReadonlyArray<DescriptionGap> = [3, 2, 1, 0]

const TAG_DISPLAYS: ReadonlyArray<TagDisplay> = ["Tags", "List"]

const ICON_TEXT_SIZES: ReadonlyArray<IconTextSize> = ["sm", "md", "lg", "xl"]

const HEADER_DESCRIPTION_KINDS: ReadonlyArray<HeaderDescriptionKind> = [
  "Blurb",
  "SkillList",
]

/** Human-readable labels for the header-description segmented control. */
const HEADER_DESCRIPTION_LABEL: Record<HeaderDescriptionKind, string> = {
  Blurb: "Blurb",
  SkillList: "Skill List",
}

/** Icon-labeled options for the `text-align` control. */
const TEXT_ALIGN_ITEMS: ReadonlyArray<{ value: TextAlign; icon: IconType }> = [
  { value: "left", icon: LuAlignLeft },
  { value: "center", icon: LuAlignJustify },
  { value: "right", icon: LuAlignRight },
]

/** Icon-labeled options for the vertical axis of a block alignment (`align-content`). */
const VERTICAL_ITEMS: ReadonlyArray<{ value: AlignValue; icon: IconType }> = [
  { value: "start", icon: LuAlignVerticalJustifyStart },
  { value: "center", icon: LuAlignVerticalJustifyCenter },
  { value: "end", icon: LuAlignVerticalJustifyEnd },
  { value: "space-between", icon: LuAlignVerticalSpaceBetween },
  { value: "space-around", icon: LuAlignVerticalSpaceAround },
  { value: "space-evenly", icon: LuAlignVerticalDistributeCenter },
]

/** Icon-labeled options for the horizontal axis of a block alignment (`justify-content`). */
const HORIZONTAL_ITEMS: ReadonlyArray<{ value: AlignValue; icon: IconType }> = [
  { value: "start", icon: LuAlignHorizontalJustifyStart },
  { value: "center", icon: LuAlignHorizontalJustifyCenter },
  { value: "end", icon: LuAlignHorizontalJustifyEnd },
  { value: "space-between", icon: LuAlignHorizontalSpaceBetween },
  { value: "space-around", icon: LuAlignHorizontalSpaceAround },
  { value: "space-evenly", icon: LuAlignHorizontalDistributeCenter },
]

/** The order options valid for a given layout kind (keeps illegal states out of the UI). */
function orderOptions(layout: SectionLayout): ReadonlyArray<SectionLayout["order"]> {
  return layout.kind === "Stacked" ?
    ["TagsAbove", "TagsBelow"]
    : ["DescriptionFirst", "TagsFirst"]
}

/**
 * A single labeled control: label stacked above the control. This vertical arrangement
 * reads well in the landscape (wide, short) settings dialog where controls flow into a
 * responsive grid.
 */
function Field({ children, label }: { label: string; children: React.ReactNode }) {
  return (
    <Stack gap={1.5} w="full" minW={0}>
      <Text m={0} fontWeight="medium" textStyle="sm">
        {label}
      </Text>
      {children}
    </Stack>
  )
}

/** A segmented control whose items are icons (used for the alignment / text controls). */
function IconSegment<T extends string>({
  items,
  onChange,
  value,
}: {
  value: T
  items: ReadonlyArray<{ value: T; icon: IconType }>
  onChange: (value: T) => void
}) {
  return (
    <SegmentGroup.Root
      w="fit-content"
      value={value}
      onValueChange={(details) => {
        if (details.value !== null) {
          onChange(details.value as T)
        }
      }}
    >
      <SegmentGroup.Indicator />
      <SegmentGroup.Items
        cursor="pointer"
        items={items.map((item) => {
          const ItemIcon = item.icon
          return { value: item.value, label: <ItemIcon /> }
        })}
      />
    </SegmentGroup.Root>
  )
}

/** A text segmented control for string-literal options. */
function TextSegment<T extends string>({
  labelFor,
  onChange,
  options,
  value,
}: {
  value: T
  options: ReadonlyArray<T>
  labelFor?: (value: T) => string
  onChange: (value: T) => void
}) {
  return (
    <SegmentGroup.Root
      w="fit-content"
      value={value}
      onValueChange={(details) => {
        if (details.value !== null) {
          onChange(details.value as T)
        }
      }}
    >
      <SegmentGroup.Indicator />
      <SegmentGroup.Items
        cursor="pointer"
        items={options.map((option) => ({
          value: option,
          label: labelFor ? labelFor(option) : option,
        }))}
      />
    </SegmentGroup.Root>
  )
}

/**
 * A block-alignment field: a single label with the vertical and horizontal icon
 * segmented controls grouped beneath it.
 */
function AlignmentField({
  align,
  label,
  onChange,
}: {
  label: string
  align: BlockAlign
  onChange: (align: BlockAlign) => void
}) {
  return (
    <Field label={label}>
      <HStack gap={2} wrap="wrap">
        <IconSegment
          value={align.vertical}
          items={VERTICAL_ITEMS}
          onChange={(vertical) => onChange({ ...align, vertical })}
        />
        <IconSegment
          value={align.horizontal}
          items={HORIZONTAL_ITEMS}
          onChange={(horizontal) => onChange({ ...align, horizontal })}
        />
      </HStack>
    </Field>
  )
}

interface SectionControlsProps {
  readonly section: LayoutSection
  readonly config: SectionConfig
  readonly onKindChange: (section: LayoutSection, kind: LayoutKind) => void
  readonly onLayoutChange: (section: LayoutSection, layout: SectionLayout) => void
  readonly onTextAlignChange: (
    section: LayoutSection,
    target: "description" | "responsibilities",
    textAlign: TextAlign,
  ) => void
  readonly onBlockAlignChange: (
    section: LayoutSection,
    target: "description" | "tag",
    align: BlockAlign,
  ) => void
  readonly onGapChange: (section: LayoutSection, gap: DescriptionGap) => void
  readonly onTagDisplayChange: (
    section: LayoutSection,
    tagDisplay: TagDisplay,
  ) => void
}

/**
 * All layout / alignment controls for a single section. Fields flow into a responsive
 * grid (landscape on desktop, single column on mobile). The layout `kind` drives which
 * order options are valid and whether the description-ratio control appears, keeping
 * illegal states unrepresentable in the UI.
 */
function SectionControls({
  config,
  onBlockAlignChange,
  onGapChange,
  onKindChange,
  onLayoutChange,
  onTagDisplayChange,
  onTextAlignChange,
  section,
}: SectionControlsProps) {
  const {
    descriptionAlign,
    descriptionTextAlign,
    gap,
    layout,
    responsibilitiesTextAlign,
    tagAlign,
    tagDisplay,
  } = config
  return (
    <SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} gap={6} w="full">
      <Field label="Layout">
        <TextSegment
          value={layout.kind}
          options={LAYOUT_KINDS}
          labelFor={(kind) => SEGMENT_LABEL[kind]}
          onChange={(kind) => onKindChange(section, kind)}
        />
      </Field>
      <Field label="Ordering">
        <TextSegment
          value={layout.order}
          options={orderOptions(layout)}
          labelFor={(order) => SEGMENT_LABEL[order]}
          onChange={(order) => onLayoutChange(section, { ...layout, order } as SectionLayout)}
        />
      </Field>
      <Field label="Description Text">
        <IconSegment
          value={descriptionTextAlign}
          items={TEXT_ALIGN_ITEMS}
          onChange={(value) => onTextAlignChange(section, "description", value)}
        />
      </Field>
      <Field label="Responsibilities Text">
        <IconSegment
          value={responsibilitiesTextAlign}
          items={TEXT_ALIGN_ITEMS}
          onChange={(value) => onTextAlignChange(section, "responsibilities", value)}
        />
      </Field>
      <Field label="Description Alignment">
        <IconSegment
          value={descriptionAlign.vertical}
          items={VERTICAL_ITEMS}
          onChange={(vertical) =>
            onBlockAlignChange(section, "description", {
              ...descriptionAlign,
              vertical,
            })}
        />
      </Field>
      <AlignmentField
        label="Tag Alignment"
        align={tagAlign}
        onChange={(align) => onBlockAlignChange(section, "tag", align)}
      />
      <Field label="Spacing">
        <TextSegment
          value={String(gap)}
          options={DESCRIPTION_GAPS.map(String)}
          onChange={(value) => onGapChange(section, Number(value) as DescriptionGap)}
        />
      </Field>
      <Field label="Display tags as:">
        <TextSegment
          value={tagDisplay}
          options={TAG_DISPLAYS}
          onChange={(value) => onTagDisplayChange(section, value)}
        />
      </Field>
      {layout.kind === "SideBySide" && (
        <Field label="Description Ratio">
          <TextSegment
            value={String(layout.ratio)}
            options={DESCRIPTION_RATIOS.map(String)}
            onChange={(value) =>
              onLayoutChange(section, {
                ...layout,
                ratio: Number(value) as DescriptionRatio,
              })}
          />
        </Field>
      )}
    </SimpleGrid>
  )
}

interface HeadingControlsProps {
  readonly iconTextSize: IconTextSize
  readonly gap: DescriptionGap
  readonly contactGap: DescriptionGap
  readonly skillListGap: DescriptionGap
  readonly nameAlign: BlockAlign
  readonly contactAlign: BlockAlign
  readonly description: HeaderDescription
  readonly featuredMode: FeaturedMode
  readonly onFeaturedModeChange: (mode: FeaturedMode) => void
  readonly onIconTextSizeChange: (size: IconTextSize) => void
  readonly onGapChange: (target: HeadingGapTarget, gap: DescriptionGap) => void
  readonly onNameAlignChange: (align: BlockAlign) => void
  readonly onContactAlignChange: (align: BlockAlign) => void
  readonly onDescriptionKindChange: (kind: HeaderDescriptionKind) => void
  readonly onDescriptionChange: (description: HeaderDescription) => void
}

/**
 * Controls for the resume heading. The description-mode `kind` drives which alignment
 * control is shown: a 1D text-align for `Blurb`, a 2D block-align for `SkillList` —
 * keeping mode/alignment combinations that can't exist out of the UI.
 */
function HeadingControls({
  contactAlign,
  contactGap,
  description,
  featuredMode,
  gap,
  iconTextSize,
  nameAlign,
  onContactAlignChange,
  onDescriptionChange,
  onDescriptionKindChange,
  onFeaturedModeChange,
  onGapChange,
  onIconTextSizeChange,
  onNameAlignChange,
  skillListGap,
}: HeadingControlsProps) {
  return (
    <SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} gap={6} w="full">
      <Field label="Feature Items Display">
        <TextSegment
          value={featuredMode}
          options={FEATURED_MODES}
          onChange={(mode) => onFeaturedModeChange(mode)}
        />
      </Field>
      <Field label="Contact Text Size">
        <TextSegment
          value={iconTextSize}
          options={ICON_TEXT_SIZES}
          onChange={onIconTextSizeChange}
        />
      </Field>
      <Field label="Header Spacing">
        <TextSegment
          value={String(gap)}
          options={DESCRIPTION_GAPS.map(String)}
          onChange={(value) => onGapChange("header", Number(value) as DescriptionGap)}
        />
      </Field>
      <Field label="Contact Spacing">
        <TextSegment
          value={String(contactGap)}
          options={DESCRIPTION_GAPS.map(String)}
          onChange={(value) => onGapChange("contact", Number(value) as DescriptionGap)}
        />
      </Field>
      <Field label="Header description:">
        <TextSegment
          value={description.kind}
          options={HEADER_DESCRIPTION_KINDS}
          labelFor={(kind) => HEADER_DESCRIPTION_LABEL[kind]}
          onChange={onDescriptionKindChange}
        />
      </Field>
      {description.kind === "Blurb" ?
        (
          <Field label="Blurb Text">
            <IconSegment
              value={description.textAlign}
              items={TEXT_ALIGN_ITEMS}
              onChange={(textAlign) => onDescriptionChange({ kind: "Blurb", textAlign })}
            />
          </Field>
        )
        : (
          <>
            <AlignmentField
              label="Skill List Alignment"
              align={description.align}
              onChange={(align) => onDescriptionChange({ kind: "SkillList", align })}
            />
            <Field label="Skill List Spacing">
              <TextSegment
                value={String(skillListGap)}
                options={DESCRIPTION_GAPS.map(String)}
                onChange={(value) => onGapChange("skillList", Number(value) as DescriptionGap)}
              />
            </Field>
          </>
        )}
      <AlignmentField
        label="Name Alignment"
        align={nameAlign}
        onChange={onNameAlignChange}
      />
      <AlignmentField
        label="Contact Alignment"
        align={contactAlign}
        onChange={onContactAlignChange}
      />
    </SimpleGrid>
  )
}

export interface PrintConfigFabProps {
  /** Placement offsets, mirroring the effects FAB. Overridable for testing/layout. */
  readonly bottom?: ReadonlyArray<number>
  readonly left?: ReadonlyArray<number>
}

/**
 * Bottom-left floating action button that opens the settings modal — a bottom sheet with
 * Print / Experience / Projects tabs for configuring print output. The FAB and modal are
 * hidden in print (`@media print`), matching the effects FAB.
 */
export function PrintConfigFab({
  bottom = [8, 8, 14],
  left = [10, 10, 16],
}: PrintConfigFabProps) {
  const navigate = useNavigate()
  const search = useSearch({ strict: false })
  const { toggleOption, toggles } = useToggles()
  const { featuredMode, setFeaturedMode } = useFeaturedMode()
  const experienceCfg = useSectionConfig("experience")
  const projectsCfg = useSectionConfig("projects")
  const {
    heading,
    setHeadingContactAlign,
    setHeadingDescription,
    setHeadingDescriptionKind,
    setHeadingGap,
    setHeadingIconTextSize,
    setHeadingNameAlign,
  } = useHeadingConfig()
  const { editingEnabled, setEditingEnabled } = useEditingEnabled()
  const { content, setAboutMe, setBlurb } = useContent()
  const reset = useResetPrintConfig()

  // Per-section config, keyed for the two SectionControls panels.
  const sections = {
    experience: experienceCfg.config,
    projects: projectsCfg.config,
  }
  const sectionHooks = { experience: experienceCfg, projects: projectsCfg }

  // Section-routing adapters so SectionControls can keep its `(section, …)` callback API
  // while dispatching through the correct per-section hook.
  const setLayoutKind = (section: LayoutSection, kind: LayoutKind) => sectionHooks[section].setLayoutKind(kind)
  const setLayout = (section: LayoutSection, layout: SectionLayout) => sectionHooks[section].setLayout(layout)
  const setTextAlign = (
    section: LayoutSection,
    target: "description" | "responsibilities",
    textAlign: TextAlign,
  ) => sectionHooks[section].setTextAlign(target, textAlign)
  const setBlockAlign = (
    section: LayoutSection,
    target: "description" | "tag",
    align: BlockAlign,
  ) => sectionHooks[section].setBlockAlign(target, align)
  const setGap = (section: LayoutSection, gap: DescriptionGap) => sectionHooks[section].setGap(gap)
  const setTagDisplay = (section: LayoutSection, tagDisplay: TagDisplay) =>
    sectionHooks[section].setTagDisplay(tagDisplay)

  // Unlock runtime editing with the Konami code.
  useKonamiCode(() => setEditingEnabled(true))

  // Imperative drag-to-resize for the modal (height mutated directly, no re-render).
  const { handleProps, ref: resizeRef } = useResizableHeight({ minPx: 160 })

  const searchParams = search as {
    [OPEN_QUERY_PARAM]?: boolean | string
    [TAB_QUERY_PARAM]?: string
  }
  // Only open when editing is unlocked — guards against a stale `?...open=true` URL.
  const open = editingEnabled &&
    (searchParams[OPEN_QUERY_PARAM] === true ||
      searchParams[OPEN_QUERY_PARAM] === "true")
  const rawTab = searchParams[TAB_QUERY_PARAM]
  const tab: SettingsTab = TABS.includes(rawTab as SettingsTab) ? (rawTab as SettingsTab) : "print"

  function setOpen(next: boolean) {
    navigate({
      to: ".",
      search: (prev) => ({
        ...prev,
        [OPEN_QUERY_PARAM]: next ? true : undefined,
      }),
      replace: true,
    })
  }

  function setTab(next: string) {
    navigate({
      to: ".",
      search: (prev) => ({
        ...prev,
        // Keep the URL clean: omit the param when it's the default tab.
        [TAB_QUERY_PARAM]: next === "print" ? undefined : next,
      }),
      replace: true,
    })
  }

  function handlePrint() {
    if (typeof window !== "undefined") {
      window.print()
    }
  }

  const hidePrint = { "@media print": { display: "none" } }

  return (
    <>
      <Dialog.Root
        open={open}
        onOpenChange={(details) => setOpen(details.open)}
        placement="bottom"
        motionPreset="slide-in-bottom"
        scrollBehavior="inside"
      >
        <Tooltip
          showArrow
          openDelay={200}
          closeDelay={100}
          positioning={{ placement: "top" }}
          content={editingEnabled ? "Tweak resume" : "You need a cheatcode for this feature"}
          contentProps={{ css: hidePrint }}
        >
          <IconButton
            css={{
              ...hidePrint,
              "&[aria-disabled=\"true\"]": { opacity: 0.5, cursor: "not-allowed" },
            }}
            zIndex="docked"
            aria-label="settings"
            position="fixed"
            left={left}
            bottom={bottom}
            rounded="full"
            size="xl"
            shadow="lg"
            colorPalette="teal"
            // Use `aria-disabled` rather than the native `disabled` attribute so the button
            // still receives hover events and the "cheatcode" tooltip shows while locked.
            aria-disabled={!editingEnabled}
            // The dialog is controlled (open / onOpenChange), so we open it directly here
            // instead of via Dialog.Trigger — a Trigger wrapped around the Tooltip wrapper
            // loses its click handler, which previously made the button unresponsive.
            onClick={() => {
              if (editingEnabled) {
                setOpen(true)
              }
            }}
          >
            <CiSettings />
          </IconButton>
        </Tooltip>
        <Portal>
          <Dialog.Backdrop css={hidePrint} bg="transparent" backdropFilter="none" />
          <Dialog.Positioner css={hidePrint}>
            <Dialog.Content
              ref={resizeRef}
              w="100dvw"
              maxW="100dvw"
              h={{ base: "100dvh", md: "40dvh" }}
              m={0}
              borderBottomRadius={0}
              borderTopRadius={{ base: 0, md: "l3" }}
              display="flex"
              flexDirection="column"
              bg="bg.panel/60"
              backdropFilter="blur(8px)"
            >
              {
                /* Drag bar: pointer-drag to resize the panel height (imperative, no state).
                `touchAction: none` keeps the gesture from scrolling on touch devices. */
              }
              <Box
                {...handleProps}
                css={hidePrint}
                flexShrink={0}
                display="flex"
                justifyContent="center"
                alignItems="center"
                h={5}
                cursor="ns-resize"
                style={{ touchAction: "none" }}
              >
                <Box w={10} h="4px" borderRadius="full" bg="fg.muted" opacity={0.5} />
              </Box>
              <Dialog.Header pt={1}>
                <Dialog.Title>Settings</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body flex="1" minH={0}>
                <Tabs.Root
                  value={tab}
                  onValueChange={(details) => setTab(details.value)}
                  h="full"
                  display="flex"
                  flexDirection="column"
                >
                  <Tabs.List
                    flexShrink={0}
                    overflowX="auto"
                    overflowY="hidden"
                    css={{
                      // Single scrollable row on narrow (mobile) screens instead of wrapping
                      // or overflowing; triggers keep their size, the row scrolls sideways.
                      "& button": { flexShrink: 0 },
                      scrollbarWidth: "none",
                      "&::-webkit-scrollbar": { display: "none" },
                    }}
                  >
                    <Tabs.Trigger value="print">
                      <Icon as={MdOutlineVisibility} />
                      Visibility
                    </Tabs.Trigger>
                    <Tabs.Trigger value="heading">
                      <Icon as={LuUserRound} />
                      Heading
                    </Tabs.Trigger>
                    <Tabs.Trigger value="experience">
                      <Icon as={LuBriefcase} />
                      Experience
                    </Tabs.Trigger>
                    <Tabs.Trigger value="projects">
                      <Icon as={LuFolderGit2} />
                      Projects
                    </Tabs.Trigger>
                    <Tabs.Trigger value="presets">
                      <Icon as={LuBookmark} />
                      Presets
                    </Tabs.Trigger>
                    <Tabs.Trigger value="share">
                      <Icon as={LuShare2} />
                      Share
                    </Tabs.Trigger>
                    <Tabs.Trigger value="tailoring">
                      <Icon as={LuWand} />
                      Tailoring
                    </Tabs.Trigger>
                    <Tabs.Indicator />
                  </Tabs.List>
                  <Box flex="1" minH={0} overflowY="auto" pt={4}>
                    <Tabs.Content value="print" mt={0}>
                      <VStack align="stretch" gap={6}>
                        <SimpleGrid columns={{ base: 1, sm: 2, lg: 3 }} gap={4} w="full">
                          {TOGGLE_ITEMS.map(({ description, key, label }) => (
                            <Stack key={key} gap={1}>
                              <Switch.Root
                                checked={toggles[key]}
                                onCheckedChange={() => toggleOption(key)}
                              >
                                <Switch.HiddenInput />
                                <Switch.Control />
                                <Switch.Label>{label}</Switch.Label>
                              </Switch.Root>
                              <Text m={0} textStyle="xs" color="fg.muted">
                                {description}
                              </Text>
                            </Stack>
                          ))}
                        </SimpleGrid>
                      </VStack>
                    </Tabs.Content>
                    <Tabs.Content value="heading" mt={0}>
                      <HeadingControls
                        iconTextSize={heading.iconTextSize}
                        gap={heading.gap}
                        contactGap={heading.contactGap}
                        skillListGap={heading.skillListGap}
                        nameAlign={heading.nameAlign}
                        contactAlign={heading.contactAlign}
                        description={heading.description}
                        featuredMode={featuredMode}
                        onFeaturedModeChange={setFeaturedMode}
                        onIconTextSizeChange={setHeadingIconTextSize}
                        onGapChange={setHeadingGap}
                        onNameAlignChange={setHeadingNameAlign}
                        onContactAlignChange={setHeadingContactAlign}
                        onDescriptionKindChange={setHeadingDescriptionKind}
                        onDescriptionChange={setHeadingDescription}
                      />
                      {editingEnabled && (
                        <VStack align="stretch" gap={4} mt={6}>
                          <Field label="Blurb">
                            <Textarea
                              value={content.blurb}
                              onChange={(e) => setBlurb(e.target.value)}
                              rows={4}
                              placeholder="Personal summary shown in the header blurb mode..."
                            />
                          </Field>
                          <Field label="About Me">
                            <Textarea
                              value={content.aboutMe}
                              onChange={(e) => setAboutMe(e.target.value)}
                              rows={6}
                              placeholder="About Me section content..."
                            />
                          </Field>
                        </VStack>
                      )}
                    </Tabs.Content>
                    <Tabs.Content value="experience" mt={0}>
                      <VStack w="full" align="stretch" gap={0}>
                        <SectionControls
                          section="experience"
                          config={sections.experience}
                          onKindChange={setLayoutKind}
                          onLayoutChange={setLayout}
                          onTextAlignChange={setTextAlign}
                          onBlockAlignChange={setBlockAlign}
                          onGapChange={setGap}
                          onTagDisplayChange={setTagDisplay}
                        />
                        <ContentSubsectionDivider />
                        <ContentEditor section="experience" />
                      </VStack>
                    </Tabs.Content>
                    <Tabs.Content value="projects" mt={0}>
                      <VStack w="full" align="stretch" gap={0}>
                        <SectionControls
                          section="projects"
                          config={sections.projects}
                          onKindChange={setLayoutKind}
                          onLayoutChange={setLayout}
                          onTextAlignChange={setTextAlign}
                          onBlockAlignChange={setBlockAlign}
                          onGapChange={setGap}
                          onTagDisplayChange={setTagDisplay}
                        />
                        <ContentSubsectionDivider />
                        <ContentEditor section="projects" />
                      </VStack>
                    </Tabs.Content>
                    <Tabs.Content value="presets" mt={0}>
                      <PresetsPanel />
                    </Tabs.Content>
                    <Tabs.Content value="share" mt={0}>
                      <SharePanel />
                    </Tabs.Content>
                    <Tabs.Content value="tailoring" mt={0}>
                      <TailoringTab />
                    </Tabs.Content>
                  </Box>
                </Tabs.Root>
              </Dialog.Body>
              <Dialog.Footer justifyContent="space-between">
                <Button variant="outline" colorPalette="red" onClick={reset}>
                  Reset
                </Button>
                <HStack gap={3}>
                  <Button variant="outline" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button colorPalette="teal" onClick={handlePrint}>
                    Print
                  </Button>
                </HStack>
              </Dialog.Footer>
              <Dialog.CloseTrigger asChild>
                <IconButton
                  aria-label="close settings"
                  variant="ghost"
                  size="sm"
                  position="absolute"
                  top={2}
                  insetEnd={2}
                >
                  <LuX />
                </IconButton>
              </Dialog.CloseTrigger>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
      <ListingDetailModal />
    </>
  )
}
