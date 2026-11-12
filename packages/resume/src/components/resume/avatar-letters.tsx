import { Array } from "effect"

const START = "M126.63 243.62"

const R_INNER_CUTOUT_RIGHT = "Q144.35 243.62 152.04 237.03" +
  "Q159.73 230.44 159.73 215.35" +
  "Q159.73 200.41 152.04 193.96" +
  "Q144.35 187.52 126.63 187.52"

const R_INNER_CUTOUT_LEFT = "H102.90" +
  "V243.62Z"

const R_BASE_LEFT = "M102.90 282.59" +
  "V365.35" +
  "H46.50" +
  "V146.65"

const R_OUTER_CURVE_RIGHT_UPPER = "H132.63" +
  "Q175.84 146.65 195.99 161.15" +
  "Q216.13 175.65 216.13 207.00" +
  "Q216.13 228.68 205.65 242.60"

const R_OUTER_CURVE_RIGHT_LOWER = "Q195.18 256.51 174.09 263.10" +
  "Q185.66 265.74 194.81 275.04" +
  "Q203.97 284.34 213.34 303.24"

const R_INNER_CURVE_RIGHT_LOWER = "L243.96 365.35" +
  "H183.90" +
  "L157.24 311.00" +
  "Q149.18 294.60 140.91 288.59" +
  "Q132.63 282.59 118.86 282.59Z"

const R = Array.make(
  START,
  R_INNER_CUTOUT_RIGHT,
  R_INNER_CUTOUT_LEFT,
  R_BASE_LEFT,
  R_OUTER_CURVE_RIGHT_UPPER,
  R_OUTER_CURVE_RIGHT_LOWER,
  R_INNER_CURVE_RIGHT_LOWER,
)

const H = "M269.50 146.65" +
  "H325.90" +
  "V230.00" +
  "H409.10" +
  "V146.65" +
  "H465.50" +
  "V365.35" +
  "H409.10" +
  "V272.63" +
  "H325.90" +
  "V365.35H269.50Z"

/**
 * The "RH" avatar initials as pure SVG paths, matching the `<text>` rendering in
 * `public/img/favicon.svg` (DejaVu Sans Bold, 300px in a 512 box, -8 letter-spacing,
 * ink centered). Deliberately NOT an SVG `<text>` element: Chrome's PDF export emits
 * inline SVG text as real, extractable text runs, and resume parsers (e.g.
 * open-resume.com) then read a stray all-caps "RH" ahead of the name and misparse the
 * header. Paths yield nothing to text extraction. The green squircle background stays
 * a Chakra `Avatar` (see `sections/heading.tsx`).
 *
 * Regenerate the path data with fontTools (SVGPathPen over DejaVuSans-Bold.ttf) if the
 * letters or font ever change.
 */
const RH_PATH = Array.append(
  R,
  H,
).join("")

export function AvatarLetters() {
  return (
    <svg
      viewBox="0 0 512 512"
      width="75%"
      height="75%"
      aria-hidden="true"
      focusable="false"
      style={{ display: "block" }}
    >
      <path d={RH_PATH} fill="var(--chakra-colors-fg)" />
    </svg>
  )
}
