import { Text, VStack } from "@chakra-ui/react"
import { useContent } from "../../../state/print-config"

export function AboutMe() {
  const { content } = useContent()

  return (
    <VStack gap={0} w="full" fontFamily="serifr" alignItems="flex-start" lineHeight="shorter">
      <Text m={0}>
        {content.aboutMe}
      </Text>
    </VStack>
  )
}
