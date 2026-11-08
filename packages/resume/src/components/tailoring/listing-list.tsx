import { Text, VStack } from "@chakra-ui/react"

import { useTailorEntries } from "../../state/tailor"
import { ListingRow } from "./listing-row"

export function ListingList() {
  const entries = useTailorEntries()

  if (entries.length === 0) {
    return (
      <Text textStyle="sm" color="fg.muted" textAlign="center" py={8}>
        No listings yet. Paste a job listing above to get started.
      </Text>
    )
  }

  return (
    <VStack align="stretch" gap={2}>
      {entries.map((entry) => <ListingRow key={entry.id} entry={entry} />)}
    </VStack>
  )
}
