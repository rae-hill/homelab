import { Avatar, Box, Heading, HStack, Text, VStack } from "@chakra-ui/react"
import { AiOutlinePhone } from "react-icons/ai"
import { CiGlobe, CiLinkedin } from "react-icons/ci"
import { LuMapPin } from "react-icons/lu"
import { MdMailOutline, MdOutlineVerified } from "react-icons/md"
import { PiGraduationCap } from "react-icons/pi"
import { VscGithub } from "react-icons/vsc"
import { useContent, useFeaturedMode, useHeadingConfig, useToggles } from "../../../state/print-config"
import { IconText } from "../icon-text"
import * as Links from "../links"

/** Terse pipe-separated tagline lines shown when the mode is `SkillList`. */
const SKILL_LINES: ReadonlyArray<string> = [
  "Multilingual Full-Stack Engineer | DevOps | Agentic Workflows | Security Certified",
  "Rock Climber | Espresso Aficionado | OSS Developer | NixOS Homelab",
]

export function ResumeHeading() {
  const { toggles } = useToggles()
  const { featuredMode } = useFeaturedMode()
  const { heading } = useHeadingConfig()
  const { content } = useContent()
  const {
    contactAlign,
    contactGap,
    description,
    gap,
    iconTextSize,
    nameAlign,
    skillListGap,
  } = heading
  const showInlineEducation = featuredMode === "Inline" && toggles.education
  const showInlineCertification = featuredMode === "Inline" && toggles.certification
  /** Print-only `display` gate for a contact line, keyed by its toggle. */
  const visibilityGate = (visible: boolean) => ({
    display: visible ? undefined : "none",
  })
  /**
   * Map a {@link BlockAlign} onto a column-direction flex container: the horizontal axis
   * is the cross axis (`alignItems`) and the vertical axis is the main axis
   * (`justifyContent`). Vertical distribution is only visible when the container is taller
   * than its content, so aligned blocks are given `flex="1"` within a `minH` header.
   */
  const boxAlign = (align: { vertical: string; horizontal: string }) => ({
    alignItems: align.horizontal,
    justifyContent: align.vertical,
  })
  return (
    <VStack
      as="header"
      fontFamily="victor"
      w="full"
      pt={10}
      mb={3}
      gap={gap}
      minH={{ base: "auto", "2xl": "20rem" }}
      alignItems={{ base: "center", "2xl": "flex-start" }}
      justifyContent="center"
      textAlign={{ base: "center", "2xl": "left" }}
      cursor="default"
      css={{
        "@media print": {
          pt: 0,
          minHeight: "auto",
        },
      }}
    >
      <VStack w="full" flex="1" gap={0} {...boxAlign(nameAlign)}>
        <HStack alignItems="center" wrap="wrap">
          <Avatar.Root
            css={{
              cornerShape: "squircle",
            }}
            w={"3rem"}
            h={"3rem"}
            mr={2}
            colorPalette="green"
            borderRadius="2rem"
          >
            <Avatar.Fallback
              fontFamily="victor"
              fontWeight="bold"
              css={{
                fontSize: "2xl !important",
              }}
            >
              RH
            </Avatar.Fallback>
          </Avatar.Root>
          <Heading
            fontFamily="inherit"
            as="h1"
            css={{
              fontSize: "2xl !important",
            }}
            mb={0}
            gap={0}
          >
            Rae&nbsp;Hill
          </Heading>
          <Text textStyle="xs" alignSelf="center" mb={0} pt={2}>
            (she/her)
          </Text>
        </HStack>
      </VStack>
      <VStack
        w="full"
        flex="1"
        gap={description.kind === "SkillList" ? skillListGap : 1}
        {...(description.kind === "SkillList" ?
          boxAlign(description.align)
          : { alignItems: { base: "center", "2xl": "flex-start" } })}
      >
        {description.kind === "Blurb" ?
          (
            <Text
              m={0}
              w="full"
              fontFamily="serifr"
              fontStyle="italic"
              lineHeight="shorter"
              opacity={0.9}
              textAlign={description.textAlign}
            >
              {content.blurb}
            </Text>
          )
          : SKILL_LINES.map((line) => (
            <Text
              key={line}
              m={0}
              fontFamily="serifr"
              fontStyle="italic"
              lineHeight="shorter"
              opacity={0.9}
            >
              {line}
            </Text>
          ))}
      </VStack>
      <VStack w="full" flex="1" gap={contactGap} {...boxAlign(contactAlign)}>
        <Box css={visibilityGate(toggles.address)}>
          <IconText icon={LuMapPin} fontSize={iconTextSize}>
            2794 Barnstormer Street, Fort Collins CO 80524
          </IconText>
        </Box>
        <HStack
          w="full"
          wrap="wrap"
          gap={contactGap}
          justifyContent={contactAlign.horizontal}
        >
          <Box css={visibilityGate(toggles.phone)}>
            <IconText
              icon={AiOutlinePhone}
              link="tel:+15052903096"
              fontSize={iconTextSize}
            >
              (505)&nbsp;290-3096
            </IconText>
          </Box>

          <Box css={visibilityGate(toggles.email)}>
            <IconText icon={MdMailOutline} link={Links.EMAIL} fontSize={iconTextSize}>
              engineer@rae-hill.dev
            </IconText>
          </Box>
        </HStack>
        <HStack
          w="full"
          justifyContent={contactAlign.horizontal}
          alignItems="center"
          wrap="wrap"
          gap={contactGap}
        >
          <Box css={visibilityGate(toggles.websiteLink)}>
            <IconText icon={CiGlobe} link={Links.RESUME} fontSize={iconTextSize}>
              resume.rae-hill.dev
            </IconText>
          </Box>
          <Box css={visibilityGate(toggles.githubLink)}>
            <IconText icon={VscGithub} link={Links.GITHUB} fontSize={iconTextSize}>
              rae-hill
            </IconText>
          </Box>
          <Box css={visibilityGate(toggles.linkedinLink)}>
            <IconText icon={CiLinkedin} link={Links.LINKEDIN} fontSize={iconTextSize}>
              /in/rae-hill
            </IconText>
          </Box>
        </HStack>
        <HStack
          w="full"
          display={showInlineEducation || showInlineCertification ? "flex" : "none"}
          wrap="wrap"
          gap={contactGap}
          justifyContent={contactAlign.horizontal}
        >
          {showInlineEducation && (
            <IconText icon={PiGraduationCap} fontSize={iconTextSize}>
              BS Applied Mathematics (NMSU, May 2022)
            </IconText>
          )}
          {showInlineCertification && (
            <IconText icon={MdOutlineVerified} fontSize={iconTextSize}>
              CompTIA Security+ (SY0-701, August 2025)
            </IconText>
          )}
        </HStack>
      </VStack>
    </VStack>
  )
}
