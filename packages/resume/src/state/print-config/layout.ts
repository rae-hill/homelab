import type { AlignValue, BlockAlign, SectionLayout } from "./types"

/** CSS `grid-template-columns` for a side-by-side layout, derived from order + ratio. */
export function gridTemplateColumns(
  layout: Extract<SectionLayout, { kind: "SideBySide" }>,
): string {
  // Description leads → description column uses the ratio; tags leads → tags column is
  // `1fr` and the description (second column) uses the ratio.
  return layout.order === "DescriptionFirst" ?
    `${layout.ratio}fr 1fr`
    : `1fr ${layout.ratio}fr`
}

/** `AlignValue` passes through to CSS; `start`/`end` are valid `*-content` keywords. */
function toCss(value: AlignValue): string {
  return value
}

/**
 * Flex box-alignment props positioning a block (tags / description) within its container
 * on both axes. The block is a column-direction, wrapping flex, so the vertical axis is
 * `alignContent` and the horizontal axis is `justifyContent`.
 */
export function blockAlignProps(align: BlockAlign): {
  justifyContent: string
  alignContent: string
} {
  return {
    justifyContent: toCss(align.horizontal),
    alignContent: toCss(align.vertical),
  }
}
