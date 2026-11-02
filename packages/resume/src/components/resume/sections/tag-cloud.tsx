import { Box, HStack, Text } from "@chakra-ui/react"

import { useToggles } from "../../../state/print-config"
import { allTags } from "../resume-data"
import * as Tech from "./technologies-list"
import { rfcTags } from "./technologies-list"

/**
 * Deterministic pseudo-random value in [0, 1) derived from a string. Using a
 * stable hash (rather than `Math.random`) keeps ordering identical between the
 * static (SSR) and SPA (client hydration) builds, avoiding mismatch warnings.
 */
function hash01(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i)
    hash |= 0
  }
  return (Math.abs(hash) % 10000) / 10000
}

/**
 * A deterministic "random" ordering of the primary tags. Computed once at module
 * load so the server and client agree. Each tag is keyed by a hash seeded with a
 * fixed salt, then sorted by that key.
 */
const shuffledTags: ReadonlyArray<string> = [...allTags].sort(
  (a, b) => hash01(`${a}~seed`) - hash01(`${b}~seed`),
)

interface TagPillProps {
  readonly tag: string
}

/**
 * A single cloud tag rendered as a pill. The category hue is used as the pill
 * background paired with the fixed dark tag-text color, so contrast stays
 * compliant in both light and dark mode (both colors are theme-independent).
 * Tags with no category color fall back to a neutral subtle background.
 */
function TagPill({ tag }: TagPillProps) {
  const hue = Tech.techColor(tag)
  return (
    <Text
      as="span"
      m={0}
      px={2}
      py="1px"
      pb={0}
      lineHeight="1.3"
      fontFamily="victor"
      fontSize="0.7rem"
      borderRadius="full"
      backgroundColor={hue ?? "bg.muted"}
      color={hue ? "var(--rh-resume-tag-text-color)" : "fg.muted"}
    >
      {tag}
    </Text>
  )
}

export function TagCloud() {
  const { toggles } = useToggles()
  return (
    <Box
      as="section"
      w="full"
      mt={6}
      flexGrow={{ base: 0, "2xl": 1 }}
      flexDirection="column"
      justifyContent={{ base: "flex-start", "2xl": "center" }}
      display={toggles.tagCloud ? "flex" : "none"}
    >
      <HStack
        wrap="wrap"
        justifyContent="center"
        alignItems="center"
        gap={2}
        maxW="32rem"
        mx="auto"
      >
        {shuffledTags.map((tag) => <TagPill key={tag} tag={tag} />)}
      </HStack>
      <HStack
        wrap="wrap"
        justifyContent="center"
        alignItems="center"
        gap={2}
        maxW="32rem"
        mx="auto"
        mt={6}
      >
        {rfcTags.map((tag) => <TagPill key={tag} tag={tag} />)}
      </HStack>
    </Box>
  )
}
