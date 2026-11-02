import { Text, VStack } from "@chakra-ui/react"

export function AboutMe() {
  return (
    <VStack gap={0} w="full" fontFamily="serifr" alignItems="flex-start" lineHeight="shorter">
      <Text m={0}>
        Multilingual full-stack engineer and mathematician seeking a software engineering role with an emphasis in
        frontend or backend development. Dedicated to the craft of principled engineering and systematized approaches to
        AI workflow integration. Experienced in TypeScript, Python, frontend frameworks, systems design, and backend
        microservice architecture. Skilled at building secure, distributed, scalable, observable systems with strong
        performance characteristics.
      </Text>
    </VStack>
  )
}
