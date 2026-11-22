import { Button, HStack, Text, VStack } from "@chakra-ui/react"
import { LuSparkles } from "react-icons/lu"

import { useCanCoverLetter } from "../../state/homelab/hooks"
import { useDownloadCoverLetter } from "../../state/tailor/hooks"
import type { TailorEntry } from "../../state/tailor/types"

/**
 * Actions tab: cover-letter download button for the current tailor entry.
 * Follows doc 04 §D layout — heading with icon, helper text, full-width teal button
 * (spinner + elapsed while busy), orange role hint when !useCanCoverLetter().
 */
export function ActionsTab({ entry }: { entry: TailorEntry }) {
  const canCoverLetter = useCanCoverLetter()
  const { busy, download, elapsed } = useDownloadCoverLetter(entry)

  const isDisabled = !canCoverLetter ||
    (entry.status !== "success" && entry.status !== "degraded") ||
    entry.contentPatch === null ||
    busy

  return (
    <VStack align="stretch" gap={4}>
      <HStack gap={2}>
        <LuSparkles size={20} />
        <Text textStyle="md" fontWeight="semibold">
          Cover letter
        </Text>
      </HStack>

      <Text textStyle="sm" color="fg.muted">
        Generate a letter in your voice for this listing, matched to the tailored resume in this entry. Takes ~15–45 s.
      </Text>

      <Button
        colorPalette="teal"
        size="lg"
        w="full"
        disabled={isDisabled}
        loading={busy}
        onClick={download}
      >
        {busy ? `Working… ${elapsed}s` : "Download cover letter"}
      </Button>

      {!canCoverLetter && (
        <Text textStyle="sm" color="orange.fg">
          Sign in with the Resume_CoverLetter role to generate cover letters.
        </Text>
      )}
    </VStack>
  )
}
