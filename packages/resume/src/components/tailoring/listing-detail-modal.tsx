import { Badge, Box, Button, Dialog, HStack, Portal, Tabs, Text, VStack } from "@chakra-ui/react"
import type { Schemas } from "homelab-services"
import { useState } from "react"

import { useApplyEntry, useCloseDetail, useRemoveEntry, useTailorDetail } from "../../state/tailor"
import { CollapsibleListing } from "./collapsible-listing"
import { FitSummary } from "./fit-summary"
import { KeywordCoverage } from "./keyword-coverage"
import { MetaFooter } from "./meta-footer"
import { StatusBadge } from "./status-badge"
import { TipsList } from "./tips-list"
import { VerdictBadge } from "./verdict-badge"

/**
 * The review modal for a tailor entry (T17). Tabs: Summary (existing analysis) and Changes
 * (the structured list of JsonPatch mutations). Primary action "Apply changes to resume" lives
 * in the Changes tab. Overwrite confirmation dialog stacks on top when current content differs
 * from defaults (M8/C1).
 */
export function ListingDetailModal() {
  const entry = useTailorDetail()
  const closeDetail = useCloseDetail()
  const removeEntry = useRemoveEntry()
  const { cancel, confirm, confirmationPending, requestApply } = useApplyEntry()
  const [activeTab, setActiveTab] = useState("summary")

  const handleDelete = () => {
    if (entry === null) return
    removeEntry(entry.id)
  }

  if (entry === null) {
    return null
  }

  const title = entry.jobTitle ?? "Untitled listing"
  const createdAt = new Date(entry.createdAt).toLocaleString()
  const hasFit = entry.fit !== null
  const hasMeta = entry.meta !== null

  return (
    <>
      <Dialog.Root
        open={true}
        onOpenChange={(details) => {
          if (!details.open) {
            closeDetail()
          }
        }}
        placement="center"
        scrollBehavior="inside"
      >
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content maxW="6xl" w="90%" maxH="85dvh" display="flex" flexDirection="column">
              <Dialog.Header>
                <VStack align="start" gap={1}>
                  <HStack gap={2} flexWrap="wrap">
                    <Dialog.Title textStyle="lg">{title}</Dialog.Title>
                    {hasFit && <VerdictBadge verdict={entry.fit!.verdict} />}
                    <StatusBadge status={entry.status} />
                    {entry.meta?.degraded === true && (
                      <Badge colorPalette="orange" variant="subtle">
                        degraded
                      </Badge>
                    )}
                  </HStack>
                  <Text textStyle="xs" color="fg.muted">
                    {entry.company ?? "—"} · {createdAt}
                  </Text>
                </VStack>
              </Dialog.Header>
              <Dialog.Body flex="1" minH={0}>
                <Tabs.Root
                  value={activeTab}
                  onValueChange={(details) => setActiveTab(details.value)}
                  h="full"
                  display="flex"
                  flexDirection="column"
                >
                  <Tabs.List flexShrink={0}>
                    <Tabs.Trigger value="summary">Summary</Tabs.Trigger>
                    <Tabs.Trigger value="changes">Changes</Tabs.Trigger>
                    <Tabs.Indicator />
                  </Tabs.List>
                  <Box flex="1" minH={0} overflowY="auto" pt={4}>
                    <Tabs.Content value="summary" mt={0}>
                      <VStack align="stretch" gap={6}>
                        {entry.error && (
                          <Box p={3} borderWidth="1px" borderColor="red.fg" borderRadius="md" bg="red.subtle">
                            <Text textStyle="sm" color="red.fg">
                              {entry.error}
                            </Text>
                          </Box>
                        )}
                        {hasFit && (
                          <>
                            <FitSummary summary={entry.fit!.summary} />
                            <KeywordCoverage coverage={entry.fit!.keywordCoverage} />
                            <TipsList tips={entry.fit!.tips} />
                          </>
                        )}
                        <CollapsibleListing listingText={entry.listingText} />
                        {hasMeta && (
                          <Box borderTopWidth="1px" pt={4}>
                            <MetaFooter meta={entry.meta!} />
                          </Box>
                        )}
                      </VStack>
                    </Tabs.Content>
                    <Tabs.Content value="changes" mt={0}>
                      <VStack align="stretch" gap={4}>
                        <Text textStyle="sm" fontWeight="semibold">
                          Changes
                        </Text>
                        <ChangesList changes={entry.changes} />
                        <Button
                          colorPalette="teal"
                          onClick={() => requestApply(entry)}
                          disabled={(entry.status !== "success" && entry.status !== "degraded") ||
                            entry.contentPatch === null}
                        >
                          Apply changes to resume
                        </Button>
                      </VStack>
                    </Tabs.Content>
                  </Box>
                </Tabs.Root>
              </Dialog.Body>
              <Dialog.Footer gap={3}>
                <Button variant="outline" colorPalette="red" onClick={handleDelete}>
                  Delete
                </Button>
              </Dialog.Footer>
              <Dialog.CloseTrigger asChild>
                <Button variant="ghost" size="sm" position="absolute" top={2} insetEnd={2}>
                  ×
                </Button>
              </Dialog.CloseTrigger>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

      {/* Confirmation dialog (stacked over the detail modal) */}
      <Dialog.Root
        open={confirmationPending}
        onOpenChange={(details) => {
          if (!details.open) {
            cancel()
          }
        }}
        placement="center"
      >
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content maxW="md">
              <Dialog.Header>
                <Dialog.Title>Apply tailored content?</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body>
                <Text textStyle="sm">
                  Are you sure you want to apply this tailoring? Your existing configuration will be overwritten.
                </Text>
              </Dialog.Body>
              <Dialog.Footer gap={3}>
                <Button variant="outline" onClick={cancel}>
                  Cancel
                </Button>
                <Button
                  colorPalette="teal"
                  onClick={() => {
                    confirm()
                  }}
                >
                  Confirm
                </Button>
              </Dialog.Footer>
              <Dialog.CloseTrigger asChild>
                <Button variant="ghost" size="sm" position="absolute" top={2} insetEnd={2}>
                  ×
                </Button>
              </Dialog.CloseTrigger>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </>
  )
}

/**
 * Render the structured list of JsonPatch mutations. null changes → "No changes recorded
 * (pre-v2 entry)". Empty array → "No changes." Otherwise render each change with op badge,
 * humanized path, and previous → value.
 */
function ChangesList({
  changes,
}: {
  changes: ReadonlyArray<Schemas.ResumeTailor.TailorChange> | null
}) {
  if (changes === null) {
    return (
      <Text textStyle="sm" color="fg.muted">
        No changes recorded (pre-v2 entry).
      </Text>
    )
  }

  if (changes.length === 0) {
    return (
      <Text textStyle="sm" color="fg.muted">
        No changes.
      </Text>
    )
  }

  return (
    <VStack align="stretch" gap={3}>
      {changes.map((change, idx) => <ChangeItem key={idx} change={change} />)}
    </VStack>
  )
}

/** Render a single change: op badge + humanized path + previous → value. */
function ChangeItem({ change }: { change: Schemas.ResumeTailor.TailorChange }) {
  const { patch, previous } = change
  const opLabel = patch.op === "add" ? "Added" : patch.op === "remove" ? "Removed" : "Updated"
  const opColor = patch.op === "add" ? "green" : patch.op === "remove" ? "red" : "blue"

  // Humanize the JSON pointer path: strip leading slash, split segments.
  const pathSegments = patch.path.replace(/^\//, "").split("/")
  const humanizedPath = pathSegments.join(" › ")

  const previousStr = formatValue(previous)
  const valueStr = "value" in patch ? formatValue(patch.value) : ""

  return (
    <Box p={3} borderWidth="1px" borderRadius="md">
      <HStack gap={2} mb={2}>
        <Badge colorPalette={opColor} variant="subtle">
          {opLabel}
        </Badge>
        <Text textStyle="xs" color="fg.muted" fontFamily="mono">
          {humanizedPath}
        </Text>
      </HStack>
      <VStack align="stretch" gap={1}>
        {previous !== undefined && (
          <HStack gap={2}>
            <Text textStyle="xs" color="fg.muted" minW="60px">
              Previous:
            </Text>
            <Text textStyle="xs" fontFamily="mono" flex={1} lineClamp={2}>
              {previousStr}
            </Text>
          </HStack>
        )}
        {patch.op !== "remove" && (
          <HStack gap={2}>
            <Text textStyle="xs" color="fg.muted" minW="60px">
              Value:
            </Text>
            <Text textStyle="xs" fontFamily="mono" flex={1} lineClamp={2}>
              {valueStr}
            </Text>
          </HStack>
        )}
      </VStack>
    </Box>
  )
}

/** Format a value for display: JSON.stringify non-strings, cap ~120 chars. */
function formatValue(value: unknown): string {
  if (value === undefined) return ""
  const str = typeof value === "string" ? value : JSON.stringify(value)
  return str.length > 120 ? str.slice(0, 117) + "..." : str
}
