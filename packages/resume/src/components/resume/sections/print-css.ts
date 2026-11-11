/**
 * Shared `css`-prop constants for resume section typography.
 *
 * These live in css props rather than Chakra `textStyle` tokens on purpose: the theme's
 * custom textStyles (`resumeSectionTitle`, `resumeItemHeading`, `printBody`) silently
 * dropped every declaration — Chakra v3 does not apply `!important` suffixes or nested
 * `@media print` blocks inside textStyle tokens — so headings rendered at recipe
 * defaults (larger than the body text) in print. The css prop handles both reliably.
 */

/** Section titles ("Experience", "Projects", "Education", …): `md` on screen and print. */
export const SECTION_TITLE_CSS = {
  fontSize: "md !important",
}

/**
 * Per-item headings (company / location / project title): compact resume body size plus
 * REAL bold in print. Bold matters for resume parsers — open-resume scores bold runs as
 * the company of an experience entry (and the name of a project), and falls back to
 * bold-first-line subsection splitting when line gaps are ambiguous. Screen keeps the
 * recipe's semibold `fontSize="sm"` look.
 */
export const ITEM_HEADING_CSS = {
  "@media print": {
    fontSize: "9.5pt",
    fontWeight: "bold",
    lineHeight: "1.25",
  },
}

/**
 * Print row-gap cap for the content/tags containers inside an entry. Resume parsers
 * split entries into subsections when the vertical line gap exceeds ~1.4× the typical
 * body line gap (~12pt at the 9.5pt print body); the configurable Spacing (up to 12px)
 * pushes the description→"Skills:" gap over that threshold, detaching the tags line
 * into its own subsection — parsed as a spurious empty experience entry (or worse, one
 * "company" named Skills). 4px keeps every line of an entry together while entries
 * still separate from each other via the section-level gap. Column gap (SideBySide)
 * intentionally keeps the user's setting.
 */
export const PRINT_ROW_GAP_CSS = {
  "@media print": {
    rowGap: "4px",
  },
}
