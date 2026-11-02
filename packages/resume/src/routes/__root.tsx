import { Box, ChakraProvider, Text } from "@chakra-ui/react"
import { createRootRoute, Outlet } from "@tanstack/react-router"

import { EffectsFab } from "../components/effects-fab"
import { Header } from "../components/header"
import { PrintConfigFab } from "../components/print-config-fab"
import { ColorModeProvider } from "../components/ui/color-mode"
import { PrintConfigProvider } from "../state/print-config"
import { theme } from "../theme/theme"

/**
 * Search params the app reads from the URL. Declared here so TanStack Router preserves
 * them instead of stripping unknown params — this is what lets the print-settings modal be
 * driven (and deep-linked) via `?print-options-open` / `?print-options-tab`.
 */
export interface RootSearch {
  readonly "print-options-open"?: boolean
  readonly "print-options-tab"?: string
}

export const Route = createRootRoute({
  validateSearch: (search: Record<string, unknown>): RootSearch => ({
    "print-options-open": search["print-options-open"] === true ||
        search["print-options-open"] === "true" ?
      true
      : undefined,
    "print-options-tab": typeof search["print-options-tab"] === "string" ?
      (search["print-options-tab"] as string)
      : undefined,
  }),
  component: RootComponent,
})

/**
 * App shell (replaces the former Docusaurus `src/theme/Root.tsx`). Provider order for CSR:
 * next-themes color mode → Chakra (our system theme) → Redux print-config store, then the
 * header, the routed page outlet, and the two floating action buttons.
 */
function RootComponent() {
  return (
    <ColorModeProvider>
      <ChakraProvider value={theme}>
        <PrintConfigProvider>
          <Header />
          <Outlet />
          <Footer />
          <EffectsFab />
          <PrintConfigFab />
        </PrintConfigProvider>
      </ChakraProvider>
    </ColorModeProvider>
  )
}

/** Human-crafted footer sentiment, preserved from the old Docusaurus footer config. */
function Footer() {
  return (
    <Box
      as="footer"
      textAlign="center"
      // Fixed-height footer in normal flow, below the content, separated by a top margin.
      // Its own opaque background (and a stacking context above the negative-z parallax
      // layers) masks the bottom edge of the backdrop so you can't see it shifting.
      mt={16}
      h="240px"
      position="relative"
      zIndex={1}
      bg="bg"
      display="flex"
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
      fontFamily="victor"
      css={{ "@media print": { display: "none" } }}
    >
      <Text m={0} fontSize="sm" color="fg.muted">
        Lovingly crafted in Fort Collins, CO
      </Text>
      <Text my={1} fontSize="sm" color="fg.muted">
        Copyright © 2026 Rae Hill
      </Text>
    </Box>
  )
}
