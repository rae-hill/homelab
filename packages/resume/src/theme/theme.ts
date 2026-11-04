import { createSystem, defaultConfig } from "@chakra-ui/react"

function getTodaysDate() {
  const fallback = new Date().toLocaleDateString()
  try {
    return `"${(window as any)["todaysDate"] ?? fallback}"`
  } catch (err) {
    return fallback
  }
}

function getPrintFooterRevision() {
  return `"${(globalThis as any)["printFooterRevision"] ?? ""}"`
}

export const theme = createSystem(defaultConfig, {
  cssVarsRoot: ":where(:root, :host)",
  globalCss: {
    html: {
      height: "unset !important",
      overflowX: "hidden",
      // Reserve the scrollbar gutter on screen so opening a modal (which locks body
      // scroll via `overflow: hidden`) doesn't reclaim the scrollbar width and shift the
      // page. Screen-only so print layout is unaffected.
      "@media screen": {
        scrollbarGutter: "stable",
      },
    },
    body: {
      height: "unset !important",
      overflowX: "hidden",
      margin: 0,
      zIndex: -2,
      // Only the root element (html) should scroll. `overflow-x: hidden` alone computes
      // overflow-y to `auto`, making body a second scroll container — with the toaster
      // mounted, real browsers gave body its own scrollbar on narrower viewports and let
      // the page scroll past the footer. Screen-only so print pagination is untouched.
      "@media screen": {
        overflow: "hidden",
      },
    },
  },
  theme: {
    recipes: {
      // Make the horizontal separator line theme-aware with better contrast than the
      // default `border` token (gray.200/gray.800 — the dark value is nearly invisible
      // against the site's dark background). Centralized here so every `<Separator>`
      // (experience, projects, etc.) picks it up.
      separator: {
        base: {
          borderColor: "fg.muted",
        },
      },
    },
    textStyles: {
      remark: {
        _dark: {
          bg: "blue.500 !important",
        },
        bg: "blue.50 !important",
        borderInlineStartColor: "blue.200",
        borderInlineStartWidth: "4px",
        borderInlineStartStyle: "solid",
        borderRadius: "lg",
        borderBottomLeftRadius: "none",
        p: 3,
        mb: 0,
        fontSize: "xs !important",
      },
      printBody: {
        "@media print": {
          fontSize: "9.5pt !important",
          lineHeight: "1.25 !important",
        },
      },
      printSubheading: {
        "@media print": {
          fontSize: "9.5pt !important",
        },
      },
      /** Section titles ("Experience", "Projects", "Featured Open Source"). */
      resumeSectionTitle: {
        fontSize: "md !important",
      },
      /**
       * Per-item headings (company / location / project title). Visually matched to the
       * surrounding body text (inherit size, normal weight) while remaining semantic
       * heading elements; print keeps the compact resume size.
       */
      resumeItemHeading: {
        fontSize: "inherit !important",
        fontWeight: "normal",
        "@media print": {
          fontSize: "9.5pt !important",
        },
      },
    },
    tokens: {
      zIndex: {
        "todays-date": {
          value: getTodaysDate(),
        },
        "print-footer-revision": {
          value: getPrintFooterRevision(),
        },
        hide: { value: -3 },
        landscape: {
          value: -1000,
        },
        "mid-ground": { value: -500 },
        foreground: { value: -250 },
      },
      fonts: {
        victor: {
          value:
            "Victor Mono, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Helvetica, Arial, sans-serif, \"Apple Color Emoji\", \"Segoe UI Emoji\", \"Segoe UI Symbol\" !important",
        },
        serifr: {
          value: `"Times New Roman", serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol" !important`,
        },
      },
    },
  },
})
