import { Box, Heading, HStack, Icon, Image, Link, Text, VStack } from "@chakra-ui/react"
import type { IconType } from "react-icons"
import { FaRust } from "react-icons/fa"
import { SiTypescript } from "react-icons/si"
import { VscGithub } from "react-icons/vsc"

type OSS = {
  readonly title: string
  readonly githubLink: string
  readonly badges: ReadonlyArray<readonly [string, string?]>
  readonly description: string
  readonly icon: IconType
  readonly color: string
}

const makeBadges: (
  prefix: string,
  repoName: string,
) => ReadonlyArray<readonly [imageUrl: string, link?: string]> = (prefix, repoName) => [
  [
    `https://img.shields.io/npm/v/${prefix}${repoName}?style=plastic&logo=npm&color=CC3534`,
    `https://www.npmjs.com/package/${prefix}${repoName}`,
  ],
  // [
  //   `https://img.shields.io/badge/TypeScript-4.5%2B-blue?style=flat-square&logo=TypeScript`,
  //   'https://www.typescriptlang.org/',
  // ],
  // [
  //   `https://img.shields.io/coverallsCoverage/github/rae-hill/${repoName}?style=flat-square`,
  //   'https://coveralls.io/',
  // ],
  [
    `https://img.shields.io/npm/dt/${prefix}${repoName}?style=plastic&color=seagreen`,
    `https://www.npmjs.com/package/${prefix}${repoName}`,
  ],
]

const OSSs: ReadonlyArray<OSS> = [
  {
    title: "schemata-ts",
    githubLink: "https://github.com/rae-hill/schemata-ts",
    badges: makeBadges("", "schemata-ts"),
    icon: SiTypescript,
    color: "#3178C6",
    description: "A powerful schema engine for parsing, validation, json-schema, fast-check, and more.",
  },
  {
    title: "chain-rec",
    githubLink: "https://github.com/rae-hill/chain-rec",
    badges: makeBadges("@jacob-alford/", "chain-rec"),
    icon: SiTypescript,
    color: "#3178C6",
    description: "Tail-recursion monadic instances using the Done or Continue technique for fp-ts.",
  },
  // {
  //   title: 'bifold-traverse',
  //   githubLink: 'https://github.com/rae-hill/bifold-traverse',
  //   badges: makeBadges('@jacob-alford/', 'bifold-traverse'),
  //   icon: SiTypescript,
  //   color: '#3178C6',
  //   description: 'Bifoldable and Bitraversable binary typeclasses for fp-ts data types.',
  // },
  {
    title: "@fp-tx/core",
    githubLink: "https://github.com/fp-tx/core",
    badges: makeBadges("@fp-tx/", "core"),
    icon: SiTypescript,
    color: "#3178C6",
    description: "fp-tx is a superset of fp-ts, an fp-centric standard library for TypeScript, featuring do notation.",
  },
  {
    title: "@fp-tx/build-tools",
    githubLink: "https://fp-tx.org",
    badges: makeBadges("@fp-tx/", "build-tools"),
    icon: SiTypescript,
    color: "#3178C6",
    description: "A TypeScript type-bundler with maximal compatibility between NodeJS-ESM and CJS.",
  },
  {
    title: "@fp-tx/documenter",
    githubLink: "https://documenter.fp-tx.org",
    badges: makeBadges("@fp-tx/", "documenter"),
    icon: SiTypescript,
    color: "#3178C6",
    description: "Generate markdown from TSDoc comments using @microsoft/api-extractor.",
  },
  {
    title: "rrpn",
    githubLink: "https://github.com/rae-hill/rrpn",
    badges: [
      [
        "https://img.shields.io/github/license/rae-hill/rrpn?style=plastic&color=teal",
        "https://github.com/rae-hill/rrpn/blob/main/LICENSE",
      ],
    ],
    icon: FaRust,
    color: "#CE422B",
    description: "A work-in-progress native RPN calculator app built with Rust and Dioxus.",
  },
  // {
  //   title: 'wpa3-uri',
  //   githubLink: 'https://github.com/rae-hill/wpa3-uri',
  //   badges: [
  //     [
  //       'https://img.shields.io/github/license/rae-hill/wpa3-uri?style=plastic&color=teal',
  //       'https://github.com/rae-hill/wpa3-uri/blob/main/LICENSE',
  //     ],
  //   ],
  //   icon: FaRust,
  //   color: '#CE422B',
  //   description: 'A WPA3 URI generator for making WPA3 based wifi QR codes.',
  // },
]

export function OpenSource() {
  return (
    <VStack
      as="section"
      // sx={{
      //   '@media print': {
      //     display: 'none',
      //   },
      // }}
      w="full"
      alignItems="flex-start"
      fontFamily="serifr"
    >
      <Heading textStyle="resumeSectionTitle" fontFamily="victor" as="h2" m={0}>
        Featured Open Source
      </Heading>
      <VStack w="full" gap={0}>
        {OSSs.map(({ badges, color, description, githubLink, icon, title }) => (
          <Box w="full" key={title}>
            <HStack w="full" wrap="nowrap" justifyContent="space-between">
              <Link color="body-text" href={githubLink}>
                <Icon color={color} as={icon} pr="px" />
                <Icon as={VscGithub} />
                <Heading
                  css={{
                    "@media print": {
                      fontSize: "0.75rem",
                    },
                    fontSize: "xs !important",
                  }}
                  bg="gray.600"
                  color="white"
                  p="2px"
                  borderRadius="md"
                  fontFamily="victor"
                  pl={1}
                  as="h2"
                  m={0}
                  fontWeight="700"
                  fontStyle="italic"
                >
                  {title}
                </Heading>
              </Link>
              <HStack>
                {badges.map(([badge, link]) => (
                  <Link as="a" href={link} key={badge}>
                    <Image h={4} src={badge} alt={`${title} badge ${1}`} key={badge} />
                  </Link>
                ))}
              </HStack>
            </HStack>
            <HStack alignSelf="flex-start">
              <Text as="em">{description}</Text>
            </HStack>
          </Box>
        ))}
      </VStack>
    </VStack>
  )
}
