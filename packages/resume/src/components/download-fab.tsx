import { IconButton, Spinner } from "@chakra-ui/react"
import { Effect } from "effect"
import { useCallback, useState } from "react"
import { LuDownload } from "react-icons/lu"

import { useCanPrintResume } from "../state/homelab"
import { downloadPdf, requestResumePdf } from "../state/homelab/print"
import { useConfigIO } from "../state/print-config"
import { toaster } from "./chakra/toaster"
import { Tooltip } from "./chakra/tooltip"
import { useColorMode } from "./ui/color-mode"

export interface DownloadFabProps {
  /** Placement offsets, mirroring the settings FAB (this one stacks above it). */
  readonly bottom?: ReadonlyArray<number>
  readonly left?: ReadonlyArray<number>
}

/**
 * Bottom-left floating action button — stacked directly **above** the settings FAB —
 * that renders the current print config to a PDF on the homelab server (headless chrome)
 * and downloads it. Only rendered when the tailscale-only API is reachable AND the
 * signed-in identity carries the `Resume_Print` role. Hidden in print.
 *
 * Feedback: the button shows a spinner while rendering; success/failure surface as toasts
 * (see `chakra/toaster.tsx`). The `<Toaster />` viewport is mounted once in `__root.tsx`.
 */
export function DownloadFab({
  bottom = [22, 22, 28],
  left = [10, 10, 16],
}: DownloadFabProps) {
  const canPrint = useCanPrintResume()
  const { exportBase64 } = useConfigIO()
  const { colorMode } = useColorMode()
  const [busy, setBusy] = useState(false)

  const handleClick = useCallback(() => {
    if (busy) {
      return
    }
    setBusy(true)
    const theme = colorMode === "dark" ? "dark" : "light"
    void Effect.runPromise(
      requestResumePdf(exportBase64(), theme).pipe(
        Effect.tap((pdf) =>
          Effect.sync(() => {
            downloadPdf(pdf)
            toaster.create({
              title: "PDF ready",
              description: "Your resume PDF has been downloaded.",
              type: "success",
            })
          })
        ),
        Effect.catch((err) =>
          Effect.sync(() =>
            toaster.create({
              title: "Couldn't download PDF",
              description: err.message,
              type: "error",
            })
          )
        ),
      ),
    ).then(() => setBusy(false))
  }, [busy, colorMode, exportBase64])

  if (!canPrint) {
    return null
  }

  const hidePrint = { "@media print": { display: "none" } }

  return (
    <Tooltip
      showArrow
      openDelay={200}
      closeDelay={100}
      positioning={{ placement: "top" }}
      content={busy ? "Rendering PDF…" : "Download PDF (headless chrome on the homelab)"}
      contentProps={{ css: hidePrint }}
    >
      <IconButton
        css={hidePrint}
        zIndex="docked"
        aria-label="download pdf"
        position="fixed"
        left={left}
        bottom={bottom}
        rounded="full"
        size="xl"
        shadow="lg"
        colorPalette="purple"
        aria-disabled={busy}
        onClick={handleClick}
      >
        {busy ? <Spinner size="sm" /> : <LuDownload />}
      </IconButton>
    </Tooltip>
  )
}
