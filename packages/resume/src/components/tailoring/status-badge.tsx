import { Badge } from "@chakra-ui/react"
import type { TailorStatus } from "../../state/tailor"

interface StatusBadgeProps {
  status: TailorStatus
}

const STATUS_COLORS: Record<TailorStatus, string> = {
  pending: "gray",
  success: "green",
  degraded: "orange",
  error: "red",
}

const STATUS_LABELS: Record<TailorStatus, string> = {
  pending: "pending",
  success: "success",
  degraded: "degraded",
  error: "error",
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <Badge colorPalette={STATUS_COLORS[status]} variant="subtle">
      {STATUS_LABELS[status]}
    </Badge>
  )
}
