import { Text } from "@chakra-ui/react"
import type { Schemas } from "homelab-services"

interface FitSummaryProps {
  summary: Schemas.ResumeTailor.FitReport["summary"]
}

export function FitSummary({ summary }: FitSummaryProps) {
  return (
    <Text textStyle="sm" lineHeight="tall">
      {summary}
    </Text>
  )
}
