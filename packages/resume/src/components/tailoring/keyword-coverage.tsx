import { HStack, Tag, Text, VStack } from "@chakra-ui/react"
import type { Schemas } from "homelab-services"

interface KeywordCoverageProps {
  coverage: Schemas.ResumeTailor.FitReport["keywordCoverage"]
}

export function KeywordCoverage({ coverage }: KeywordCoverageProps) {
  return (
    <VStack align="stretch" gap={3}>
      <Text textStyle="sm" fontWeight="semibold">
        Keyword Coverage
      </Text>
      <HStack flexWrap="wrap" gap={2}>
        {coverage.matched.map((keyword) => (
          <Tag.Root key={keyword}>
            <Tag.Label color="green.fg" bg="green.subtle" px={2} py={1} borderRadius="md">
              {keyword}
            </Tag.Label>
          </Tag.Root>
        ))}
        {coverage.missing.map((keyword) => (
          <Tag.Root key={keyword}>
            <Tag.Label
              color="red.fg"
              bg="red.subtle"
              px={2}
              py={1}
              borderRadius="md"
              borderWidth="1px"
              borderColor="red.muted"
            >
              {keyword}
            </Tag.Label>
          </Tag.Root>
        ))}
      </HStack>
    </VStack>
  )
}
