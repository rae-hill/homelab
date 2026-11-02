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
      <Heading textStyle="resumeSectionTitle" as="h2" m={0} fontWeight="light">
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
                      <chakra.span fontWeight="bold">Skills:</chakra.span> {tags.join(", ")}
                    </Text>
                  )
                  : <HStack
                    h="full"
                    wrap="wrap"
                    {...blockAlignProps(tagAlign)}
                    display={toggles.projectTags ? "flex" : "none"}
                    css={{
                      "@media print": {
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
                      >
                        <Tag.Label>{tag}</Tag.Label>
                      </Tag.Root>
                    ))}
                  </HStack>

                // The title and description belong together and are aligned as a unit.
                const titleAndDescriptionBlock = (
                  <VStack
                    w="full"
                    h="full"
                    gap={0}
                    justifyContent={descriptionAlign.vertical}
                    css={{
                      "@media print": {
                        breakInside: "avoid",
                        pageBreakInside: "avoid",
                      },
                    }}
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
                        <Heading textStyle="resumeItemHeading" fontSize="sm" as="h3" m={0}>
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
                    <VStack w="full" gap={gap} align="stretch">
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
