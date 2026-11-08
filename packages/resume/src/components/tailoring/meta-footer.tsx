import { HStack, Text, VStack } from "@chakra-ui/react"
import type { Schemas } from "homelab-services"

interface MetaFooterProps {
  meta: Schemas.ResumeTailor.TailorMeta
}

export function MetaFooter({ meta }: MetaFooterProps) {
  const totalTokens = (meta.stage1?.tokens.input ?? 0) +
    (meta.stage1?.tokens.output ?? 0) +
    (meta.stage2?.tokens.input ?? 0) +
    (meta.stage2?.tokens.output ?? 0)

  const totalLatency = (meta.stage1?.latencyMs ?? 0) + (meta.stage2?.latencyMs ?? 0)

  return (
    <VStack align="stretch" gap={2} textStyle="xs" color="fg.muted">
      <HStack justify="space-between">
        <Text>Models:</Text>
        <Text>
          {meta.stage1?.model ?? "n/a"} → {meta.stage2?.model ?? "n/a"}
        </Text>
      </HStack>
      <HStack justify="space-between">
        <Text>Tokens:</Text>
        <Text>{totalTokens.toLocaleString()}</Text>
      </HStack>
      <HStack justify="space-between">
        <Text>Latency:</Text>
        <Text>{(totalLatency / 1000).toFixed(1)}s</Text>
      </HStack>
      <HStack justify="space-between">
        <Text>Cache:</Text>
        <Text>{meta.cacheHit ? "hit" : "miss"}</Text>
      </HStack>
      <HStack justify="space-between">
        <Text>Prompt:</Text>
        <Text>{meta.promptVersion}</Text>
      </HStack>
    </VStack>
  )
}
