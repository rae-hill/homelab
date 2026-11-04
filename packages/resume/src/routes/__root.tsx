import { Box, ChakraProvider, Text } from "@chakra-ui/react"
import { createRootRoute, Outlet, useNavigate, useSearch } from "@tanstack/react-router"
import { useEffect } from "react"

import { DownloadFab } from "../components/download-fab"
import { EffectsFab } from "../components/effects-fab"
import { Header } from "../components/header"
import { PrintConfigFab } from "../components/print-config-fab"
import { ColorModeProvider } from "../components/ui/color-mode"
import { useHomelabBootstrap } from "../state/homelab"
import { PrintConfigProvider } from "../state/print-config"
import { theme } from "../theme/theme"

/**
 * Search params the app reads from the URL. Declared here so TanStack Router preserves
 * them instead of stripping unknown params — this is what lets the print-settings modal be
 * driven (and deep-linked) via `?print-options-open` / `?print-options-tab`, the remote
 * print flow inject a config via `?importPrintSettings=<base64>`, and force the color mode
 * via `?theme=light|dark`.
 */
export interface RootSearch {
  readonly "print-options-open"?: boolean
  readonly "print-options-tab"?: string
  /** Base64 persisted print config applied on load (puppeteer print flow / share links). */
  readonly importPrintSettings?: string
  /** Forced color mode; absent → the visitor's stored preference. */
  readonly theme?: "light" | "dark"
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
    importPrintSettings: typeof search["importPrintSettings"] === "string" ?
      (search["importPrintSettings"] as string)
      : undefined,
    theme: search["theme"] === "light" || search["theme"] === "dark" ?
      (search["theme"] as "light" | "dark")
      : undefined,
  }),
  component: RootComponent,
})

/**
 * App shell (replaces the former Docusaurus `src/theme/Root.tsx`). Provider order for CSR:
 * next-themes color mode (forced by `?theme` when present) → Chakra (our system theme) →
 * Redux app store (print-config + homelab), then the homelab bootstrap (reachability
 * probe + OIDC session restore), the header, the routed page outlet, and the FABs.
 */
function RootComponent() {
  const search = useSearch({ strict: false }) as RootSearch
  const navigate = useNavigate()

  // The import param is one-shot: the store provider applies it (over localStorage)
  // during its mount effect, which runs before this parent effect. Strip it afterwards
  // so reloads and later search-param updates don't re-apply a stale config over the
  // visitor's edits.
  useEffect(() => {
    if (search.importPrintSettings === undefined) {
      return
    }
    void navigate({
      to: ".",
      search: (prev) => ({ ...prev, importPrintSettings: undefined }),
      replace: true,
    })
  }, [search.importPrintSettings, navigate])

  return (
    <ColorModeProvider forcedTheme={search.theme}>
      <ChakraProvider value={theme}>
        <PrintConfigProvider>
          <HomelabBootstrap />
          <Header />
          <Outlet />
          <Footer />
          <EffectsFab />
          <DownloadFab />
          <PrintConfigFab />
        </PrintConfigProvider>
      </ChakraProvider>
    </ColorModeProvider>
  )
}

/** Runs the homelab bootstrap effects once on mount; renders nothing. */
function HomelabBootstrap() {
  useHomelabBootstrap()
  return null
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
