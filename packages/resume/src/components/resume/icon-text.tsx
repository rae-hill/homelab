import { HStack, Icon, Link, Text } from "@chakra-ui/react"
import { forwardRef } from "react"
import type { IconType } from "react-icons"

export type IconTextProps = {
  readonly icon: IconType
  readonly link?: string
  readonly children: string
  readonly defaultIconColor?: boolean
  readonly noMargins?: boolean
  readonly fontSize?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl"
  readonly onClick?: () => void
}

/**
 * Print font sizes mapped from the on-screen `fontSize` token. Screen tokens (14–20px+)
 * are far too large next to the 9.5pt print body, and the Chakra `textStyle` mechanism
 * silently drops `!important`/`@media print` values, so the mapping is applied here via
 * the `css` prop (which handles nested media queries reliably). Keeps the relative
 * sizing intent of the Contact Text Size setting in print.
 */
const PRINT_FONT_SIZE: Record<NonNullable<IconTextProps["fontSize"]>, string> = {
  sm: "8.5pt",
  md: "9.5pt",
  lg: "10.5pt",
  xl: "11.5pt",
  "2xl": "13pt",
  "3xl": "15pt",
  "4xl": "17pt",
}

/** Print-media font-size override for a given token (undefined → no override). */
function printSizeCss(fontSize: IconTextProps["fontSize"]) {
  return fontSize === undefined ? {} : { "@media print": { fontSize: PRINT_FONT_SIZE[fontSize] } }
}

export function IconText({
  children,
  fontSize,
  icon,
  link,
  noMargins = false,
}: IconTextProps) {
  // nowrap keeps each contact a single unbroken PDF text run — parsers match
  // phone/email/URL regexes against individual runs, so mid-item wrapping or
  // splitting loses the value.
  const textCss = { whiteSpace: "nowrap" as const, ...printSizeCss(fontSize) }
  return link === undefined ?
    (
      <HStack {...(noMargins ? {} : { mx: "2" })} wrap="nowrap" alignItems="center">
        <Icon as={icon} color="body-text" display="flex" flexShrink={0} css={printSizeCss(fontSize)} />
        <Text {...{ fontSize }} m={0} color="body-text" lineHeight="1" css={textCss}>
          {children}
        </Text>
      </HStack>
    )
    : (
      <HStack {...(noMargins ? {} : { mx: "2" })} wrap="nowrap" alignItems="center">
        <Icon as={icon} color="body-text" display="flex" flexShrink={0} css={printSizeCss(fontSize)} />
        <Link {...{ fontSize }} color="body-text" href={link} lineHeight="1" css={textCss}>
          {children}
        </Link>
      </HStack>
    )
}

// interface IconTextButtonProps extends Omit<IconTextProps, 'link'> {
//   readonly onClick?: () => void
// }

export const IconTextButton = forwardRef<HTMLAnchorElement, IconTextProps>(
  ({ children, fontSize, icon, noMargins = false, onClick }, ref) => {
    return (
      <HStack {...(noMargins ? {} : { mx: "2" })} wrap="nowrap" alignItems="center">
        <Icon as={icon} color="body-text" display="flex" flexShrink={0} />
        <Link
          fontWeight="inherit"
          ref={ref}
          onClick={onClick}
          color="body-text"
          lineHeight="1"
          css={{
            "@media print": {
              fontSize: "18px",
            },
          }}
          {...{ fontSize }}
        >
          {children}
        </Link>
      </HStack>
    )
  },
)
