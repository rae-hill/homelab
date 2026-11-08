import { Box, Text, VStack } from "@chakra-ui/react"
import type { Schemas } from "homelab-services"

type Tip = Schemas.ResumeTailor.FitReport["tips"][number]

interface TipsListProps {
  tips: Schemas.ResumeTailor.FitReport["tips"]
}

const SEVERITY_COLORS: Record<Tip["severity"], string> = {
  blocker: "red",
  caution: "orange",
  info: "blue",
}

const SEVERITY_ORDER: Array<Tip["severity"]> = ["blocker", "caution", "info"]

export function TipsList({ tips }: TipsListProps) {
  const sorted = [...tips].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  )

  return (
    <VStack align="stretch" gap={3}>
      <Text textStyle="sm" fontWeight="semibold">
        Recommendations
      </Text>
      {sorted.map((tip, index) => (
        <Box key={index} p={3} borderWidth="1px" borderRadius="md" bg="bg.subtle">
          <VStack align="stretch" gap={2}>
            <Box>
              <Text
                textStyle="xs"
                fontWeight="bold"
                color={`${SEVERITY_COLORS[tip.severity]}.fg`}
                textTransform="uppercase"
              >
                {tip.severity} · {tip.category}
              </Text>
              <Text textStyle="sm" fontWeight="semibold">
                {tip.title}
              </Text>
            </Box>
            <Text textStyle="sm">{tip.detail}</Text>
            {tip.evidence && (
              <Box
                as="blockquote"
                textStyle="xs"
                fontStyle="italic"
                borderLeftWidth="2px"
                borderLeftColor="fg.muted"
                pl={3}
                color="fg.muted"
              >
                &ldquo;{tip.evidence}&rdquo;
              </Box>
            )}
          </VStack>
        </Box>
      ))}
    </VStack>
  )
}
