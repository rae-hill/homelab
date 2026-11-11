import { Box, chakra, Heading, HStack, List, Separator, SimpleGrid, Tag, Text, VStack } from "@chakra-ui/react"

import {
  blockAlignProps,
  gridTemplateColumns,
  useContent,
  useSectionConfig,
  useToggles,
} from "../../../state/print-config"
import { ITEM_HEADING_CSS, PRINT_ROW_GAP_CSS, SECTION_TITLE_CSS } from "./print-css"
import * as Tech from "./technologies-list"

export function Experience() {
  const { toggles } = useToggles()
  const { config } = useSectionConfig("experience")
  const { content } = useContent()
  const {
    descriptionAlign,
    descriptionTextAlign,
    gap,
    layout,
    responsibilitiesTextAlign,
    tagAlign,
    tagDisplay,
  } = config
  const columns = layout.kind === "SideBySide"
  const tagsFirst = layout.kind === "Stacked" ?
    layout.order === "TagsAbove"
    : layout.order === "TagsFirst"
  return (
    <VStack
      display={toggles.experience ? "flex" : "none"}
      gap={2}
      mb={2}
      w="full"
      alignItems="flex-start"
      fontFamily="serifr"
    >
      <Heading as="h2" m={0} fontWeight="light" css={SECTION_TITLE_CSS}>
        Experience
      </Heading>
      {content.experience.map(
        ({ bulletPoints, company, description, id, location, roles, tags }) => (
          <chakra.section
            css={{
              "@media print": {
                // Deliberately NOT `breakInside: avoid` on the whole entry: forcing
                // page breaks to land exactly between entries is the WORST case for
                // resume parsers — open-resume computes subsection line gaps as
                // prevY - y, which goes negative across a page boundary, so the first
                // entry on page 2 silently merges into the last entry of page 1 (a
                // whole job vanishes). Allowing breaks between bullet lines keeps
                // every entry's lines stream-adjacent, so all entries parse correctly
                // even across pages. Line-level `breakInside: avoid` (bullets, tag
                // rows) still prevents mid-line splits.
                breakInside: "auto",
              },
            }}
            key={id}
            w="full"
          >
            <VStack
              gap={0}
              justifyContent="end"
            >
              <VStack w="full" gap={0}>
                <HStack w="full" justifyContent="space-between">
                  <Box>
                    <Heading
                      lineHeight="shorter"
                      fontSize="sm"
                      as="h3"
                      m={0}
                      css={ITEM_HEADING_CSS}
                    >
                      {company}
                    </Heading>
                  </Box>
                  <Box>
                    <Heading
                      lineHeight="shorter"
                      as="h3"
                      fontSize="sm"
                      m={0}
                      css={ITEM_HEADING_CSS}
                    >
                      {location}
                    </Heading>
                  </Box>
                </HStack>
                <Separator w="full" my={0} />
              </VStack>
              {roles.map(({ date, title }) => (
                <HStack key={title} w="full" justifyContent="space-between">
                  <Box>
                    <Text m={0}>{title}</Text>
                  </Box>
                  <Box>
                    <Text m={0}>{date}</Text>
                  </Box>
                </HStack>
              ))}
            </VStack>
            {(() => {
              const tagsBlock = tagDisplay === "List" ?
                (
                  <Text
                    m={0}
                    w="full"
                    lineHeight="shorter"
                    css={{
                      display: toggles.positionTags ? undefined : "none",
                    }}
                  >
                    {
                      /* NOT bold: resume parsers split experience entries on bold
                        runs and would treat a bold "Skills:" as the next company
                        heading. */
                    }
                    <chakra.span>Skills:</chakra.span> {tags.join(", ")}
                  </Text>
                )
                : (
                  <HStack
                    h="full"
                    wrap="wrap"
                    {...blockAlignProps(tagAlign)}
                    display={toggles.positionTags ? "flex" : "none"}
                    css={PRINT_ROW_GAP_CSS}
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
                            // Keep the tag row intact across page breaks — move the whole block
                            // to the next page rather than splitting mid-row.
                            breakInside: "avoid",
                            // Compact pill boxes so WRAPPED pill rows stay within the
                            // parsers' subsection line-gap threshold (~1.4× body line
                            // gap); otherwise a wrapped row (e.g. a lone "Rails" pill)
                            // detaches into its own subsection and parses as a junk
                            // experience entry. minHeight releases the recipe's
                            // `minH: 5` (20px) which otherwise dominates the pill
                            // height; the Label's line-height override pairs with it.
                            minHeight: "0",
                            paddingBlock: "1px",
                          },
                        }}
                      >
                        {
                          /* Compact pill boxes so WRAPPED pill rows stay within the
                            parsers' subsection line-gap threshold (~1.4× body line
                            gap); otherwise a wrapped row (e.g. a lone "Rails" pill)
                            detaches into its own subsection and parses as a junk
                            experience entry. The lineHeight override must live on
                            the Label — its `sm` textStyle line-height (1.25rem)
                            dictates the pill height. */
                        }
                        <Tag.Label css={{ "@media print": { lineHeight: "1" } }}>
                          {tag}
                        </Tag.Label>
                      </Tag.Root>
                    ))}
                  </HStack>
                )

              const contentBlock = (
                <VStack
                  w="full"
                  h="full"
                  gap={0}
                  justifyContent={descriptionAlign.vertical}
                >
                  <Text
                    m={0}
                    w="full"
                    textAlign={descriptionTextAlign}
                    lineHeight="shorter"
                    display={toggles.positionDescription ? undefined : "none"}
                  >
                    <em>{description}</em>
                  </Text>
                  {bulletPoints.some((b) => b.visible) ?
                    (
                      <List.Root
                        w="full"
                        textAlign={responsibilitiesTextAlign}
                        display={toggles.positionResponsibilities ? undefined : "none"}
                        lineHeight="shorter"
                        mb={0}
                        marginInlineStart={0}
                        pl={5}
                      >
                        {bulletPoints
                          .filter((b) => b.visible)
                          .map((bullet) => (
                            <List.Item
                              css={{
                                breakInside: "avoid",
                              }}
                              key={bullet.id}
                              _marker={{
                                m: 0,
                              }}
                            >
                              <Text m={0} as="span">
                                {bullet.text}
                              </Text>
                            </List.Item>
                          ))}
                      </List.Root>
                    )
                    : null}
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
                          {contentBlock}
                        </>
                      )
                      : (
                        <>
                          {contentBlock}
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
                          {contentBlock}
                        </>
                      )
                      : (
                        <>
                          {contentBlock}
                          {tagsBlock}
                        </>
                      )}
                  </VStack>
                )
            })()}
          </chakra.section>
        ),
      )}
    </VStack>
  )
}
