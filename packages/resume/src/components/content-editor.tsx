import {
  Box,
  Button,
  Checkbox,
  Editable,
  Heading,
  HStack,
  IconButton,
  Separator,
  Stack,
  TagsInput,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react"
import { LuPlus, LuTrash2 } from "react-icons/lu"

import { useContent } from "../state/print-config"
import type { BulletPoint, LayoutSection } from "../state/print-config"
import { ALL_KNOWN_TAGS } from "./resume/sections/technologies-list"

/** A small titled field wrapper, matching the settings dialog's label style. */
function EditorField({
  children,
  label,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <Stack gap={1.5} w="full" minW={0}>
      <Text m={0} fontWeight="medium" textStyle="sm">
        {label}
      </Text>
      {children}
    </Stack>
  )
}

/** The Chakra v3 `TagsInput` bound to a value/onChange pair, seeded with the tag pool. */
function TagEditor({
  onChange,
  value,
}: {
  value: ReadonlyArray<string>
  onChange: (tags: ReadonlyArray<string>) => void
}) {
  return (
    <TagsInput.Root
      value={[...value]}
      onValueChange={(details) => onChange(details.value)}
      editable
    >
      <TagsInput.Context>
        {(api) => (
          <TagsInput.Control>
            {api.value.map((tag, index) => (
              <TagsInput.Item key={`${tag}-${index}`} index={index} value={tag}>
                <TagsInput.ItemPreview>
                  <TagsInput.ItemText>{tag}</TagsInput.ItemText>
                  <TagsInput.ItemDeleteTrigger />
                </TagsInput.ItemPreview>
                <TagsInput.ItemInput />
              </TagsInput.Item>
            ))}
            <TagsInput.Input placeholder="Add a tag…" />
          </TagsInput.Control>
        )}
      </TagsInput.Context>
      <TagsInput.HiddenInput />
      {/* The available pool of known tags, click to add. */}
      <HStack wrap="wrap" gap={1} mt={2}>
        {ALL_KNOWN_TAGS.filter((tag) => !value.includes(tag)).map((tag) => (
          <Button
            key={tag}
            size="2xs"
            variant="outline"
            onClick={() => onChange([...value, tag])}
          >
            {tag}
          </Button>
        ))}
      </HStack>
    </TagsInput.Root>
  )
}

/** One bullet row: visibility checkbox + inline-editable text + delete. */
function BulletRow({
  bullet,
  entryId,
}: {
  entryId: string
  bullet: BulletPoint
}) {
  const { removeBullet, setBulletText, toggleBulletVisible } = useContent()
  return (
    <HStack w="full" gap={2} align="center">
      <Checkbox.Root
        checked={bullet.visible}
        onCheckedChange={() => toggleBulletVisible(entryId, bullet.id)}
      >
        <Checkbox.HiddenInput />
        <Checkbox.Control />
      </Checkbox.Root>
      <Editable.Root
        flex="1"
        minW={0}
        value={bullet.text}
        onValueChange={(details) => setBulletText(entryId, bullet.id, details.value)}
        placeholder="Bullet text…"
      >
        <Editable.Preview
          w="full"
          opacity={bullet.visible ? 1 : 0.5}
          textDecoration={bullet.visible ? undefined : "line-through"}
        />
        <Editable.Input />
      </Editable.Root>
      <IconButton
        aria-label="Remove bullet"
        size="xs"
        variant="ghost"
        colorPalette="red"
        onClick={() => removeBullet(entryId, bullet.id)}
      >
        <LuTrash2 />
      </IconButton>
    </HStack>
  )
}

/** The bullet-point editor for a single experience entry: Add button + list of rows. */
function BulletEditor({
  bullets,
  entryId,
}: {
  entryId: string
  bullets: ReadonlyArray<BulletPoint>
}) {
  const { addBullet } = useContent()
  return (
    <EditorField label="Responsibilities">
      <VStack w="full" gap={2} align="stretch">
        {bullets.map((bullet) => <BulletRow key={bullet.id} entryId={entryId} bullet={bullet} />)}
        <Button
          size="xs"
          variant="outline"
          alignSelf="flex-start"
          onClick={() => addBullet(entryId)}
        >
          <LuPlus /> Add
        </Button>
      </VStack>
    </EditorField>
  )
}

export interface ContentEditorProps {
  readonly section: LayoutSection
}

/**
 * Per-entry content editor for one resume section. Rendered inside the section's settings
 * tab (beneath its layout controls). Experience entries additionally expose a bullet
 * editor; both sections expose a description `Textarea` and a `TagsInput`.
 */
export function ContentEditor({ section }: ContentEditorProps) {
  const { content, setEntryDescription, setEntryTags } = useContent()
  const entries = section === "experience" ? content.experience : content.projects
  return (
    <VStack w="full" align="stretch" gap={6}>
      {entries.map((entry) => {
        const heading = "company" in entry ? entry.company : entry.title
        return (
          <VStack
            key={entry.id}
            w="full"
            align="stretch"
            gap={3}
            p={4}
            borderWidth="1px"
            borderColor="border"
            borderRadius="l2"
          >
            <Heading as="h4" m={0} textStyle="sm" fontWeight="semibold">
              {heading}
            </Heading>
            <EditorField label="Description">
              <Textarea
                value={entry.description}
                onChange={(e) => setEntryDescription(section, entry.id, e.target.value)}
                rows={3}
                autoresize
              />
            </EditorField>
            {"bulletPoints" in entry && <BulletEditor entryId={entry.id} bullets={entry.bulletPoints} />}
            <EditorField label="Tags">
              <TagEditor
                value={entry.tags}
                onChange={(tags) => setEntryTags(section, entry.id, tags)}
              />
            </EditorField>
          </VStack>
        )
      })}
    </VStack>
  )
}

/** A labeled divider introducing the Content subsection within a settings tab. */
export function ContentSubsectionDivider() {
  return (
    <Box w="full" pt={2}>
      <Separator />
      <Heading as="h3" mt={4} mb={2} textStyle="md" fontWeight="semibold">
        Content
      </Heading>
    </Box>
  )
}
