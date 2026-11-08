import { Badge } from "@chakra-ui/react"
import type { Schemas } from "homelab-services"

interface VerdictBadgeProps {
  verdict: Schemas.ResumeTailor.FitReport["verdict"]
}

const VERDICT_COLORS: Record<Schemas.ResumeTailor.FitReport["verdict"], string> = {
  strong: "green",
  partial: "orange",
  weak: "red",
}

export function VerdictBadge({ verdict }: VerdictBadgeProps) {
  return (
    <Badge colorPalette={VERDICT_COLORS[verdict]} variant="solid">
      {verdict}
    </Badge>
  )
}
