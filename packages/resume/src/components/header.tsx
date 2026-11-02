import { HStack, IconButton, Link, Spacer } from "@chakra-ui/react"
import { VscGithub } from "react-icons/vsc"

import { ColorModeButton } from "./ui/color-mode"

const GITHUB_URL = "https://github.com/rae-hill"

/**
 * Minimal site header: a GitHub link and the light/dark toggle, right-aligned. Sticky and
 * glassy (matching the résumé container's `bg.panel/60` + blur). It slides up out of view
 * on scroll-down and slides back in on scroll-up (see `useHideOnScroll`). Hidden in print.
 */
export function Header() {
  return (
    <HStack
      as="header"
      position="sticky"
      top={0}
      zIndex="banner"
      w="full"
      px={{ base: 3, md: 5 }}
      py={2}
      css={{ "@media print": { display: "none" } }}
    >
      <Spacer />
      <Link
        href={GITHUB_URL}
        aria-label="GitHub"
        target="_blank"
        rel="noreferrer noopener"
      >
        <IconButton aria-label="GitHub" variant="ghost" size="md">
          <VscGithub style={{ width: "1.5rem", height: "1.5rem" }} />
        </IconButton>
      </Link>
      <ColorModeButton />
    </HStack>
  )
}
