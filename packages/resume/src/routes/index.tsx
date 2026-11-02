import { Box, Container, VStack } from "@chakra-ui/react"
import { createFileRoute } from "@tanstack/react-router"

import * as Sections from "../components/resume"
import { useParallax } from "../hooks/useParallax"

export const Route = createFileRoute("/")({
  component: Home,
})

function Home() {
  // Preserve the cherry-blossom parallax: the background layer translates on scroll at
  // `landscape` depth (see useParallax / `.home-page-content__bg`).
  const backgroundParallaxRef = useParallax({ depth: "landscape" })

  return (
    <>
      {
        /* Cherry-blossom backdrop, parallaxed on scroll (translateY at `landscape` depth).
          Absolutely positioned so the translate reads as a slow background drift. Hidden
          in print so the resume prints on a clean page. */
      }
      <Box
        className="home-page-content__bg"
        position="absolute"
        top={0}
        left={0}
        right={0}
        height="85%"
        zIndex="landscape"
        ref={backgroundParallaxRef}
        css={{
          "@media print": {
            display: "none",
          },
        }}
      />
      <Box
        className="home-page-content__bg-glass"
        position="absolute"
        top={0}
        left={0}
        right={0}
        height="100%"
        zIndex="mid-ground"
        css={{
          "@media print": {
            display: "none",
          },
        }}
      />
      <Container
        // Single-column width by default; widen only on very large screens so
        // Experience and Projects can sit side-by-side. Print always stays 7.5in.
        maxW={{ base: "100%", sm: "7.5in", "2xl": "14in" }}
        css={{
          "@media print": {
            maxWidth: "7in",
            paddingLeft: 0,
            paddingRight: 0,
            paddingBottom: 0,
          },
        }}
        py={{ base: 8, md: 14 }}
        textStyle="printBody"
      >
        {
          /* Semi-transparent "slab of glass", matching the settings modal
            (`bg.panel/60` + blur). Reverts to a plain opaque background in print. */
        }
        <Box
          bg="bg.panel/60"
          backdropFilter="blur(8px)"
          borderRadius="l3"
          shadow="lg"
          px={{ base: 5, md: 10 }}
          py={{ base: 6, md: 10 }}
          css={{
            "@media print": {
              background: "bg",
              backdropFilter: "none",
              boxShadow: "none",
              borderRadius: 0,
              padding: 0,
            },
            "@page": {
              size: "letter portrait",
              margin: "0.75in",
              bg: "bg",
            },
          }}
        >
          <Box
            display="grid"
            alignItems={{ base: "stretch", "2xl": "center" }}
            gap={{ base: 0, "2xl": 10 }}
            gridTemplateColumns={{ base: "1fr", "2xl": "1fr 1fr" }}
          >
            <Sections.ResumeHeading />
            <Box display="flex" justifyContent="center">
              <Sections.Featured />
            </Box>
          </Box>
          <Box
            display="grid"
            alignItems={{ base: "start", "2xl": "stretch" }}
            gap={{ base: 0, "2xl": 10 }}
            gridTemplateColumns={{ base: "1fr", "2xl": "1fr 1fr" }}
            css={{
              "@media print": {
                display: "block",
              },
            }}
          >
            <Sections.Experience />
            <VStack h="full" alignItems="stretch">
              <Sections.Projects />
              <Sections.TagCloud />
            </VStack>
          </Box>
        </Box>
      </Container>
    </>
  )
}
