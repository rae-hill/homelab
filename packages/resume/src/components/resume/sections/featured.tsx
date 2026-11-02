import { Heading, HStack, Icon, Separator, Text, VStack } from "@chakra-ui/react"
import type { IconType } from "react-icons"
import { MdOutlineVerified } from "react-icons/md"
import { PiGraduationCap } from "react-icons/pi"
import { useFeaturedMode, useToggles } from "../../../state/print-config"

interface FeaturedItem {
  readonly icon: IconType
  readonly iconColor: string
  readonly label: string
  readonly title: string
  readonly subtitle: string
  readonly detail: string
}

const featuredItems: ReadonlyArray<FeaturedItem> = [
  {
    icon: PiGraduationCap,
    iconColor: "var(--rh-resume-tag-colors-violet)",
    label: "Education",
    title: "BS Applied Mathematics",
    subtitle: "New Mexico State University",
    detail: "Graduated May 2022",
  },
  {
    icon: MdOutlineVerified,
    iconColor: "var(--rh-resume-tag-colors-green)",
    label: "Certification",
    title: "CompTIA Security+ (SY0-701)",
    subtitle: "Earned August 2025",
    detail: "Expires August 2028",
  },
]

interface FeaturedBoxProps extends FeaturedItem {
  /** Whether this box should appear in print output. Always shown on screen. */
  readonly printVisible: boolean
}

function FeaturedBox({
  detail,
  icon,
  iconColor,
  label,
  printVisible,
  subtitle,
  title,
}: FeaturedBoxProps) {
  return (
    <VStack
      flex="1"
      minW={0}
      gap={1}
      px={4}
      py={3}
      alignItems="center"
      justifyContent="center"
      display={printVisible ? "flex" : "none"}
    >
      <HStack gap={2}>
        <Icon as={icon} color={iconColor} boxSize={5} aria-hidden />
        <Text
          m={0}
          textStyle="sm"
          fontFamily="serifr"
        >
          {label}
        </Text>
      </HStack>
      <Heading
        as="h3"
        m={0}
        fontFamily="serifr"
        css={{
          fontSize: "sm !important",
        }}
      >
        {title}
      </Heading>
      <Text m={0} textStyle="xs" fontFamily="serifr" opacity={0.85}>
        {subtitle}
      </Text>
      <Text m={0} textStyle="xs" fontFamily="serifr" opacity={0.65}>
        {detail}
      </Text>
    </VStack>
  )
}

export function Featured() {
  const { toggles } = useToggles()
  const { featuredMode } = useFeaturedMode()
  const external = featuredMode === "External"
  const showEducation = external && toggles.education
  const showCertification = external && toggles.certification
  const showContainer = showEducation || showCertification
  return (
    <HStack
      as="section"
      w="full"
      // Full-width below 2xl; capped and centered over the Projects column at 2xl.
      maxW={{ base: "full", "2xl": "32rem" }}
      mx="auto"
      mt={5}
      mb={3}
      gap={0}
      alignItems="stretch"
      borderWidth={1}
      borderStyle="solid"
      borderColor="fg.muted"
      borderRadius="14px"
      overflow="hidden"
      display={showContainer ? "flex" : "none"}
    >
      <FeaturedBox {...featuredItems[0]} printVisible={showEducation} />
      <Separator
        orientation="vertical"
        alignSelf="stretch"
        h="auto"
        css={{
          "@media print": {
            display: showEducation && showCertification ? "block" : "none",
          },
        }}
      />
      <FeaturedBox {...featuredItems[1]} printVisible={showCertification} />
    </HStack>
  )
}
