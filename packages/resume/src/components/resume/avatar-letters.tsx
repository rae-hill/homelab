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
const RH_PATH =
  "M126.63 243.62Q144.35 243.62 152.04 237.03Q159.73 230.44 159.73 215.35Q159.73 200.41 152.04 193.96Q144.35 187.52 126.63 187.52H102.90V243.62ZM102.90 282.59V365.35H46.50V146.65H132.63Q175.84 146.65 195.99 161.15Q216.13 175.65 216.13 207.00Q216.13 228.68 205.65 242.60Q195.18 256.51 174.09 263.10Q185.66 265.74 194.81 275.04Q203.97 284.34 213.34 303.24L243.96 365.35H183.90L157.24 311.00Q149.18 294.60 140.91 288.59Q132.63 282.59 118.86 282.59Z M269.50 146.65H325.90V230.00H409.10V146.65H465.50V365.35H409.10V272.63H325.90V365.35H269.50Z"

export function AvatarLetters() {
  return (
    <svg
      viewBox="0 0 512 512"
      width="100%"
      height="100%"
      aria-hidden="true"
      focusable="false"
      style={{ display: "block" }}
    >
      <path d={RH_PATH} fill="var(--rh-resume-tag-text-color)" />
    </svg>
  )
}
