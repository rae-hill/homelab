import { Box, Button, HStack, Switch, Text, Textarea, VStack } from "@chakra-ui/react"
import { useEffect, useRef, useState } from "react"

import { useCanTailorResume } from "../../state/homelab/hooks"
import { useSubmitTailor } from "../../state/tailor/hooks"
import { ListingList } from "./listing-list"

const LISTING_CHAR_LIMIT = 20000
const LISTING_WARN_THRESHOLD = 18000

interface ValidationPolicy {
  enabled: boolean
  requireTagsGloballyAvailable: boolean
  rejectFabricatedMetrics: boolean
  groundTipsInListing: boolean
}

export function TailoringTab() {
  const canTailor = useCanTailorResume()
  const submitTailor = useSubmitTailor()
  const [listingText, setListingText] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const intervalRef = useRef<number | null>(null)
  const [policyExpanded, setPolicyExpanded] = useState(false)
  const [policy, setPolicy] = useState<ValidationPolicy>({
    enabled: false,
    requireTagsGloballyAvailable: true,
    rejectFabricatedMetrics: true,
    groundTipsInListing: true,
  })

  useEffect(() => {
    if (submitting) {
      setElapsed(0)
      intervalRef.current = window.setInterval(() => {
        setElapsed((prev) => prev + 1)
      }, 1000)
    } else {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current)
      }
    }
  }, [submitting])

  const handleSubmit = async () => {
    if (!listingText.trim() || !canTailor) return
    setSubmitting(true)
    try {
      // Always send the full policy object (wire schema accepts it; server applies
      // permissive defaults when fields are unset). When enabled=false, the server skips
      // semantic checks entirely.
      const tailorPolicy = {
        enabled: policy.enabled,
        requireTagsGloballyAvailable: policy.requireTagsGloballyAvailable,
        rejectFabricatedMetrics: policy.rejectFabricatedMetrics,
        groundTipsInListing: policy.groundTipsInListing,
      }
      await submitTailor(listingText, tailorPolicy)
      setListingText("")
    } finally {
      setSubmitting(false)
    }
  }

  const charCount = listingText.length
  const isOverLimit = charCount > LISTING_WARN_THRESHOLD
  const isAtLimit = charCount >= LISTING_CHAR_LIMIT

  return (
    <VStack align="stretch" gap={4}>
      {!canTailor && (
        <Text textStyle="sm" color="orange.fg">
          Sign in with the Resume_Tailor role to tailor your resume.
        </Text>
      )}
      <VStack align="stretch" gap={2}>
        <Text textStyle="sm" fontWeight="semibold">
          Paste a job listing:
        </Text>
        <Textarea
          value={listingText}
          onChange={(e) => setListingText(e.target.value)}
          placeholder="Paste the full job description here..."
          minH="200px"
          disabled={submitting}
        />
        <HStack justify="space-between">
          <Text
            textStyle="xs"
            color={isAtLimit ? "red.fg" : isOverLimit ? "orange.fg" : "fg.muted"}
          >
            {charCount.toLocaleString()} / {LISTING_CHAR_LIMIT.toLocaleString()} characters
          </Text>
        </HStack>
      </VStack>
      <Box>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setPolicyExpanded(!policyExpanded)}
          mb={2}
        >
          {policyExpanded ? "Hide" : "Show"} validation policy
        </Button>
        {policyExpanded && (
          <VStack align="stretch" gap={3} p={3} borderWidth="1px" borderRadius="md">
            <Switch.Root
              checked={policy.enabled}
              onCheckedChange={(details) => setPolicy((prev) => ({ ...prev, enabled: details.checked }))}
            >
              <Switch.HiddenInput />
              <Switch.Control />
              <Switch.Label>Enable validation</Switch.Label>
            </Switch.Root>
            <VStack align="stretch" gap={2} pl={4} opacity={policy.enabled ? 1 : 0.5}>
              <Switch.Root
                checked={policy.requireTagsGloballyAvailable}
                onCheckedChange={(details) =>
                  setPolicy((prev) => ({
                    ...prev,
                    requireTagsGloballyAvailable: details.checked,
                  }))}
                disabled={!policy.enabled}
              >
                <Switch.HiddenInput />
                <Switch.Control />
                <Switch.Label>Require tags to be globally available</Switch.Label>
              </Switch.Root>
              <Switch.Root
                checked={policy.rejectFabricatedMetrics}
                onCheckedChange={(details) =>
                  setPolicy((prev) => ({ ...prev, rejectFabricatedMetrics: details.checked }))}
                disabled={!policy.enabled}
              >
                <Switch.HiddenInput />
                <Switch.Control />
                <Switch.Label>Reject fabricated metrics</Switch.Label>
              </Switch.Root>
              <Switch.Root
                checked={policy.groundTipsInListing}
                onCheckedChange={(details) => setPolicy((prev) => ({ ...prev, groundTipsInListing: details.checked }))}
                disabled={!policy.enabled}
              >
                <Switch.HiddenInput />
                <Switch.Control />
                <Switch.Label>Ground tips in listing</Switch.Label>
              </Switch.Root>
            </VStack>
          </VStack>
        )}
      </Box>
      <HStack justify="flex-end">
        <Button
          colorPalette="teal"
          onClick={handleSubmit}
          disabled={!listingText.trim() || !canTailor || submitting || isAtLimit}
          loading={submitting}
        >
          {submitting ? `Working… ${elapsed}s` : "Tailor Resume"}
        </Button>
      </HStack>
      <ListingList />
    </VStack>
  )
}
