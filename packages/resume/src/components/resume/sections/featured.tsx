import { Heading, HStack, Icon, Separator, Text, VStack } from "@chakra-ui/react"
import type { IconType } from "react-icons"
import { MdOutlineVerified } from "react-icons/md"
import { PiGraduationCap } from "react-icons/pi"
import { useContent, useFeaturedMode, useHeadingConfig, useToggles } from "../../../state/print-config"
import { SECTION_TITLE_CSS } from "./print-css"

interface FeaturedItem {
  readonly icon: IconType
  readonly iconColor: string
  readonly label: string
  /** Section heading used by the `Block` display mode. */
  readonly blockLabel: string
  readonly title: string
  readonly subtitle: string
  readonly detail?: string
}

const featuredItems: ReadonlyArray<FeaturedItem> = [
  {
    icon: PiGraduationCap,
    iconColor: "var(--rh-resume-tag-colors-violet)",
    label: "Education",
    blockLabel: "Education",
    title: "Bachelor of Mathematics",
    subtitle: "New Mexico State University",
    detail: "August 2018 - May 2022",
  },
  {
    icon: MdOutlineVerified,
    iconColor: "var(--rh-resume-tag-colors-green)",
    label: "Certification",
    blockLabel: "Certifications",
    title: "CompTIA Security+ (SY0-701)",
    subtitle: "August 2025 - August 2028",
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
      {detail !== undefined && (
        <Text m={0} textStyle="xs" fontFamily="serifr" opacity={0.65}>
          {detail}
        </Text>
      )}
    </VStack>
  )
}

/**
 * `Block` display: a featured item as a plain full-width paragraph section — a
 * bold all-caps heading, then one line per attribute (degree, school, date). This is
 * the parser-friendly rendering: resume parsers (e.g. open-resume) detect section
 * titles primarily by bold + all-uppercase single-item lines, and score school /
 * degree / date from SEPARATE lines — combining them into one sentence triggers the
 * scorers' cross-penalties (degree-in-school-line etc.) and extracts nothing. The
 * uppercase heading also matters for "Certifications", which matches none of the
 * parsers' section-title keywords and is only detectable via bold+uppercase.
 */
function FeaturedBlock({ blockLabel, detail, subtitle, title }: FeaturedItem) {
  return (
    <VStack w="full" alignItems="flex-start" gap={0} fontFamily="serifr">
      <Heading
        as="h2"
        m={0}
        fontWeight="light"
        lineHeight="shorter"
        // textTransform="uppercase"
        // letterSpacing="wide"
        css={SECTION_TITLE_CSS}
      >
        {blockLabel}
      </Heading>
      <Text m={0} lineHeight="shorter">
        {title}
      </Text>
      <Text m={0} lineHeight="shorter">
        {subtitle}
      </Text>
      <Text m={0} lineHeight="shorter">
        {detail}
      </Text>
    </VStack>
  )
}

export function Featured() {
  const { toggles } = useToggles()
  const { featuredMode } = useFeaturedMode()
  const { heading: { description, gap } } = useHeadingConfig()
  const { content: { blurb } } = useContent()
  const external = featuredMode === "External"
  const block = featuredMode === "Block"
  const showEducation = (external || block) && toggles.education
  const showCertification = (external || block) && toggles.certification
  const showContainer = showEducation || showCertification

  if (block) {
    return (
      <VStack
        as="section"
        w="full"
        alignItems="stretch"
        mt={gap}
        mb={2}
        gap={2}
        display={showContainer ? "flex" : "none"}
      >
        {showEducation && <FeaturedBlock {...featuredItems[0]} />}
        {showCertification && <FeaturedBlock {...featuredItems[1]} />}
        {description.kind === "Blurb" && (
          <VStack
            w="full"
            flex="1"
            gap={0}
            display={{ base: "none", "2xl": "flex" }}
            alignItems="flex-start"
          >
            <Heading lineHeight="shorter" as="h2" m={0} display="none" fontWeight="light" css={SECTION_TITLE_CSS}>
              Summary
            </Heading>
            <Text
              m={0}
              w="full"
              fontFamily="serifr"
              lineHeight="shorter"
              opacity={0.9}
              textAlign={description.textAlign}
            >
              {blurb}
            </Text>
          </VStack>
        )}
      </VStack>
    )
  }

  return (
    <VStack>
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
      {description.kind === "Blurb" && (
        <VStack
          w="full"
          flex="1"
          gap={0}
          display={{ base: "none", "2xl": "flex" }}
          alignItems={{ base: "center", "2xl": "flex-start" }}
        >
          <Text
            m={0}
            w="full"
            fontFamily="serifr"
            lineHeight="shorter"
            opacity={0.9}
            textAlign={description.textAlign}
          >
            {blurb}
          </Text>
        </VStack>
      )}
    </VStack>
  )
}
