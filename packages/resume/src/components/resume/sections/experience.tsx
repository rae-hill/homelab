import { Box, chakra, Heading, HStack, List, Separator, SimpleGrid, Tag, Text, VStack } from "@chakra-ui/react"

import {
  blockAlignProps,
  gridTemplateColumns,
  useContent,
  useSectionConfig,
  useToggles,
} from "../../../state/print-config"
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
      <Heading textStyle="resumeSectionTitle" as="h2" m={0} fontWeight="light">
        Experience
      </Heading>
      {content.experience.map(
        ({ bulletPoints, company, description, id, location, roles, tags }) => (
          <chakra.section
            css={{
              "@media print": {
                breakInside: "avoid",
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
                    <Heading textStyle="resumeItemHeading" lineHeight="shorter" fontSize="sm" as="h3" m={0}>
                      {company}
                    </Heading>
                  </Box>
                  <Box>
                    <Heading textStyle="resumeItemHeading" lineHeight="shorter" as="h3" fontSize="sm" m={0}>
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
                    <chakra.span fontWeight="bold">Skills:</chakra.span> {tags.join(", ")}
                  </Text>
                )
                : (
                  <HStack
                    h="full"
                    wrap="wrap"
                    {...blockAlignProps(tagAlign)}
                    display={toggles.positionTags ? "flex" : "none"}
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
                          },
                        }}
                      >
                        <Tag.Label>{tag}</Tag.Label>
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
                  <VStack w="full" gap={gap} align="stretch">
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
