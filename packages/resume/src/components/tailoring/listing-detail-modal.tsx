import { Badge, Box, Button, Dialog, HStack, Portal, Text, VStack } from "@chakra-ui/react"
import { useCloseDetail, useRecallEntry, useRemoveEntry, useTailorDetail } from "../../state/tailor"
import { CollapsibleListing } from "./collapsible-listing"
import { FitSummary } from "./fit-summary"
import { KeywordCoverage } from "./keyword-coverage"
import { MetaFooter } from "./meta-footer"
import { StatusBadge } from "./status-badge"
import { TipsList } from "./tips-list"
import { VerdictBadge } from "./verdict-badge"

/**
 * The read-only analysis modal for a tailor entry (D7). Plain centered Dialog layered over
 * the settings bottom sheet — last-rendered in the tree = topmost. Closes on backdrop click
 * and Esc. Actions: "Apply to resume" (re-applies the stored content patch to the resume) and
 * "Delete" (removes the entry).
 */
export function ListingDetailModal() {
  const entry = useTailorDetail()
  const closeDetail = useCloseDetail()
  const recallEntry = useRecallEntry()
  const removeEntry = useRemoveEntry()

  const handleApply = async () => {
    if (entry === null) return
    await recallEntry(entry)
  }

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
            </Dialog.Body>
            <Dialog.Footer gap={3}>
              <Button variant="outline" colorPalette="red" onClick={handleDelete}>
                Delete
              </Button>
              <Button
                colorPalette="teal"
                onClick={handleApply}
                disabled={entry.status === "error" || entry.status === "pending" || entry.contentPatch === null}
              >
                Apply to resume
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
  )
}
