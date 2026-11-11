import { Heading, HStack, Tag, VStack } from "@chakra-ui/react"
import { useContent, useToggles } from "../../../state/print-config"
import { SECTION_TITLE_CSS } from "./print-css"

export function Skills() {
  const { toggles } = useToggles()
  const content = useContent()

  return (
    <VStack
      display={toggles.skills ? undefined : "none"}
      gap={1}
      mb={2}
      w="full"
      alignItems="flex-start"
      fontFamily="serifr"
      as="header"
      pt={10}
      minH={{ base: "auto", "2xl": "20rem" }}
      css={{
        "@media print": {
          pt: 0,
          minHeight: "auto",
        },
      }}
    >
      <Heading as="h2" m={0} fontWeight="light" css={SECTION_TITLE_CSS}>
        Skills
      </Heading>
      <HStack w="full" flex="1" gap={0} alignItems="center" justifyItems="flex-start">
        {content.content.skills.map(
          (tag) => (
            <Tag.Root
              key={tag}
              fontWeight="bolder"
              fontFamily="victor"
              backgroundColor="white"
              color="var(--rh-resume-tag-text-color)"
              variant="solid"
              css={{
                "@media print": {
                  // Keep the tag row intact across page breaks — move the whole block
                  // to the next page rather than splitting mid-row.
                  breakInside: "avoid",
                },
              }}
            >
              <Tag.Label>{tag}</Tag.Label>
            </Tag.Root>
          ),
        )}
      </HStack>
    </VStack>
  )
}
