import { Button, HStack, Text, Textarea, VStack } from "@chakra-ui/react"
import { useEffect, useRef, useState } from "react"

import { useCanTailorResume } from "../../state/homelab/hooks"
import { useSubmitTailor } from "../../state/tailor/hooks"
import { ListingList } from "./listing-list"

const LISTING_CHAR_LIMIT = 20000
const LISTING_WARN_THRESHOLD = 18000

export function TailoringTab() {
  const canTailor = useCanTailorResume()
  const submitTailor = useSubmitTailor()
  const [listingText, setListingText] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const intervalRef = useRef<number | null>(null)

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
      await submitTailor(listingText)
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
