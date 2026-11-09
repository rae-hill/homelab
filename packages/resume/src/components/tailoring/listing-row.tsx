import { HStack, IconButton, Text, VStack } from "@chakra-ui/react"
import { LuTrash2 } from "react-icons/lu"

import type { TailorEntry } from "../../state/tailor"
import { useOpenDetail, useRemoveEntry } from "../../state/tailor"
import { StatusBadge } from "./status-badge"
import { VerdictBadge } from "./verdict-badge"

interface ListingRowProps {
  entry: TailorEntry
}

export function ListingRow({ entry }: ListingRowProps) {
  const openDetail = useOpenDetail()
  const removeEntry = useRemoveEntry()

  const title = entry.jobTitle ?? (entry.status === "pending" ? "Pending…" : "Failed")
  const company = entry.company ?? ""
  const date = new Date(entry.createdAt).toLocaleDateString()

  return (
    <HStack
      w="full"
      p={3}
      borderWidth="1px"
      borderRadius="md"
      bg="bg.surface"
      cursor="pointer"
      _hover={{ bg: "bg.muted" }}
      onClick={() => openDetail(entry.id)}
    >
      <HStack flex="1" gap={3}>
        <VStack align="start" gap={0} flex="1">
          <Text textStyle="sm" fontWeight="semibold">
            {title}
          </Text>
          {company && (
            <Text textStyle="xs" color="fg.muted">
              {company}
            </Text>
          )}
          <Text textStyle="xs" color="fg.muted">
            {date}
          </Text>
        </VStack>
        <HStack gap={2}>
          {entry.status !== "pending" && entry.fit && <VerdictBadge verdict={entry.fit.verdict} />}
          <StatusBadge status={entry.status} />
        </HStack>
      </HStack>
      <IconButton
        aria-label="Delete listing"
        variant="ghost"
        size="sm"
        colorPalette="red"
        onClick={(e) => {
          e.stopPropagation()
          removeEntry(entry.id)
        }}
      >
        <LuTrash2 />
      </IconButton>
    </HStack>
  )
}
