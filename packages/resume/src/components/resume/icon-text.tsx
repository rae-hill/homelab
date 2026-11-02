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

export function IconText({
  children,
  fontSize,
  icon,
  link,
  noMargins = false,
}: IconTextProps) {
  return link === undefined ?
    (
      <HStack {...(noMargins ? {} : { mx: "2" })} wrap="nowrap" alignItems="center">
        <Icon as={icon} color="body-text" display="flex" flexShrink={0} />
        <Text {...{ fontSize }} m={0} color="body-text" lineHeight="1">
          {children}
        </Text>
      </HStack>
    )
    : (
      <HStack {...(noMargins ? {} : { mx: "2" })} wrap="nowrap" alignItems="center">
        <Icon as={icon} color="body-text" display="flex" flexShrink={0} />
        <Link {...{ fontSize }} color="body-text" href={link} lineHeight="1">
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
