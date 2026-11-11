import { chakra, Heading, HStack, Icon, Link, Separator, SimpleGrid, Tag, Text, VStack } from "@chakra-ui/react"
import { Fragment } from "react"

import {
  blockAlignProps,
  gridTemplateColumns,
  useContent,
  useSectionConfig,
  useToggles,
} from "../../../state/print-config"
import { githubIcon } from "../resume-data"
import { ITEM_HEADING_CSS, PRINT_ROW_GAP_CSS, SECTION_TITLE_CSS } from "./print-css"
import * as Tech from "./technologies-list"

export function Projects() {
  const { toggles } = useToggles()
  const { config } = useSectionConfig("projects")
  const { content } = useContent()
  const { descriptionAlign, descriptionTextAlign, gap, layout, tagAlign, tagDisplay } = config
  const columns = layout.kind === "SideBySide"
  const tagsFirst = layout.kind === "Stacked" ?
    layout.order === "TagsAbove"
    : layout.order === "TagsFirst"
  return (
    <VStack
      display={toggles.projects ? undefined : "none"}
      gap={1}
      mb={2}
      w="full"
      alignItems="flex-start"
      fontFamily="serifr"
    >
      <Heading as="h2" m={0} fontWeight="light" css={SECTION_TITLE_CSS}>
        Projects
      </Heading>
      {content.projects.map(({ description, githubLink, id, tags, title }, i) => (
        <Fragment key={id}>
          {i > 0 && <Separator w="full" my={1} />}
          <chakra.section w="full">
            <VStack w="full" gap={0} alignItems="flex-start">
              {(() => {
                const tagsBlock = tagDisplay === "List" ?
                  (
                    <Text
                      m={0}
                      w="full"
                      lineHeight="shorter"
                      display={toggles.projectTags ? undefined : "none"}
                      css={{
                        "@media print": {
                          breakInside: "avoid",
                          pageBreakInside: "avoid",
                        },
                      }}
                    >
                      {
                        /* NOT bold: parsers split entries on bold runs and would read
                          a bold "Skills:" as the next company/project heading. */
                      }
                      <chakra.span>Skills:</chakra.span> {tags.join(", ")}
                    </Text>
                  )
                  : <HStack
                    h="full"
                    wrap="wrap"
                    {...blockAlignProps(tagAlign)}
                    display={toggles.projectTags ? "flex" : "none"}
                    css={{
                      "@media print": {
                        // Keep wrapped pill rows tight so parsers don't detach a
                        // wrapped row into its own (junk) subsection.
                        rowGap: "4px",
                        breakInside: "avoid",
                        pageBreakInside: "avoid",
                      },
                    }}
                  >
                    {tags.map((tag) => (
                      <Tag.Root
                        key={tag}
                        fontWeight="bolder"
                        fontFamily="victor"
                        backgroundColor={Tech.techColor(tag)}
                        color="var(--rh-resume-tag-text-color)"
                        variant="solid"
                        css={{
                          "@media print": {
                            // See experience.tsx: compact pills keep wrapped rows
                            // under the parsers' subsection line-gap threshold.
                            minHeight: "0",
                            paddingBlock: "1px",
                            breakInside: "avoid",
                          },
                        }}
                      >
                        <Tag.Label css={{ "@media print": { lineHeight: "1" } }}>
                          {tag}
                        </Tag.Label>
                      </Tag.Root>
                    ))}
                  </HStack>

                // The title and description belong together and are aligned as a unit.
                // NOTE: no print `breakInside: avoid` here — this is the LEADING block
                // of a project entry; pushing it whole to the next page would make the
                // page start with a project title, which open-resume merges into the
                // previous entry (its page-boundary line gap goes negative), losing the
                // project. Letting the block flow keeps every title parseable; the
                // trailing tag blocks below keep their `avoid` (pushing those is
                // parser-neutral — they merge back into their own entry).
                const titleAndDescriptionBlock = (
                  <VStack
                    w="full"
                    h="full"
                    gap={0}
                    justifyContent={descriptionAlign.vertical}
                  >
                    <HStack w="full" justifyContent="flex-start" wrap="nowrap">
                      <Link
                        color="body-text"
                        href={githubLink}
                        aria-label={`${title} on GitHub`}
                        display="inline-flex"
                        gap={1}
                        alignItems="center"
                      >
                        <Icon as={githubIcon} boxSize={5} pb={1} />
                        {
                          /* Bold in print so parsers pick up the project name; the
                            link wrapper stays (PDF link annotations don't affect
                            text extraction). */
                        }
                        <Heading fontSize="sm" as="h3" m={0} css={ITEM_HEADING_CSS}>
                          {title}
                        </Heading>
                      </Link>
                    </HStack>
                    <Text
                      m={0}
                      w="full"
                      textAlign={descriptionTextAlign}
                      lineHeight="shorter"
                    >
                      <em>{description}</em>
                    </Text>
                  </VStack>
                )

                return columns && layout.kind === "SideBySide" ?
                  (
                    <SimpleGrid
                      w="full"
                      gap={gap}
                      alignItems="stretch"
                      gridTemplateColumns={gridTemplateColumns(layout)}
                      css={PRINT_ROW_GAP_CSS}
                    >
                      {tagsFirst ?
                        (
                          <>
                            {tagsBlock}
                            {titleAndDescriptionBlock}
                          </>
                        )
                        : (
                          <>
                            {titleAndDescriptionBlock}
                            {tagsBlock}
                          </>
                        )}
                    </SimpleGrid>
                  )
                  : (
                    <VStack w="full" gap={gap} align="stretch" css={PRINT_ROW_GAP_CSS}>
                      {tagsFirst ?
                        (
                          <>
                            {tagsBlock}
                            {titleAndDescriptionBlock}
                          </>
                        )
                        : (
                          <>
                            {titleAndDescriptionBlock}
                            {tagsBlock}
                          </>
                        )}
                    </VStack>
                  )
              })()}
            </VStack>
          </chakra.section>
        </Fragment>
      ))}
    </VStack>
  )
}
