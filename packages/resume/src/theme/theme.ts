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
      // NOTE: the former printBody / printSubheading / resumeSectionTitle /
      // resumeItemHeading textStyles were REMOVED: Chakra v3 silently drops textStyle
      // declarations containing `!important` values or nested `@media print` blocks, so
      // none of them ever applied (print body text fell back to 16px — bigger than the
      // headings — and spilled across pages). Their replacements live in
      // `components/resume/sections/print-css.ts` and the route/component `css` props,
      // which handle both reliably.
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
        // Every stack is a var() reference into css/custom.css, which defines the
        // screen values on :root and swaps them under @media print for static,
        // parser-friendly families (Carlito/Caladea/...). The indirection is required
        // because Chakra INLINES token values verbatim into each generated rule (the
        // Heading recipe emits the literal stack, not var(--fonts-heading)), so a
        // literal here could never be repointed at print time. `heading`/`body`
        // override the Chakra defaults (Inter — a variable font that is usually not
        // installed; chrome fragments its PDF text runs per glyph, which breaks
        // resume parsers' line reconstruction).
        // NOTE: no `!important` in these values — it used to be baked into the token
        // strings; nothing needs it (style props beat recipes via layer order).
        heading: { value: "var(--rh-fonts-heading)" },
        body: { value: "var(--rh-fonts-body)" },
        victor: { value: "var(--rh-fonts-victor)" },
        serifr: { value: "var(--rh-fonts-serifr)" },
      },
    },
  },
})
