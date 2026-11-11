import { Menu } from "@chakra-ui/react"
import { Effect } from "effect"
import { useCallback, useState } from "react"

import { downloadResumeDocument, requestResumeDocument, type ResumeDocumentFormat } from "../state/homelab/print"
import { useConfigIO } from "../state/print-config"
import { toaster } from "./chakra/toaster"
import { useColorMode } from "./ui/color-mode"

/** Human-facing format labels for toasts. */
const FORMAT_LABELS: Record<ResumeDocumentFormat, string> = {
  pdf: "PDF",
  docx: "DOCX",
}

export interface ResumeDownloadState {
  /** The format currently rendering, or null when idle (drives spinners/disabled states). */
  readonly busyFormat: ResumeDocumentFormat | null
  /** Request + download the resume rendered in the given format. No-op while busy. */
  readonly download: (format: ResumeDocumentFormat) => void
}

/**
 * Shared server-render download flow behind both split menus (the Download FAB
 * and the settings dialog's Print button): request the resume from homelab-api
 * in the chosen format (headless chrome on the homelab), trigger the browser
 * download, and surface toasts. One render at a time (`busyFormat`).
 *
 * DOCX renders force the light theme (doc 08 OQ7 recommendation): the server
 * inlines computed colors into the document, and the dark theme's light text
 * would land on Word's white page.
 */
export function useResumeDownload(): ResumeDownloadState {
  const { exportBase64 } = useConfigIO()
  const { colorMode } = useColorMode()
  const [busyFormat, setBusyFormat] = useState<ResumeDocumentFormat | null>(null)

  const download = useCallback((format: ResumeDocumentFormat) => {
    if (busyFormat !== null) {
      return
    }
    setBusyFormat(format)
    const theme = format === "docx" || colorMode !== "dark" ? "light" : "dark"
    const label = FORMAT_LABELS[format]
    void Effect.runPromise(
      requestResumeDocument(exportBase64(), theme, format).pipe(
        Effect.tap((bytes) =>
          Effect.sync(() => {
            downloadResumeDocument(bytes, format)
            toaster.create({
              title: `${label} ready`,
              description: `Your resume ${label} has been downloaded.`,
              type: "success",
            })
          })
        ),
        Effect.catch((err) =>
          Effect.sync(() =>
            toaster.create({
              title: `Couldn't download ${label}`,
              description: err.message,
              type: "error",
            })
          )
        ),
      ),
    ).then(() => setBusyFormat(null))
  }, [busyFormat, colorMode, exportBase64])

  return { busyFormat, download }
}

export interface ResumeFormatMenuItemsProps {
  readonly download: (format: ResumeDocumentFormat) => void
  readonly disabled?: boolean
}

/**
 * The two format options shared by both split menus. Render inside a
 * `Menu.Content`.
 */
export function ResumeFormatMenuItems({ disabled = false, download }: ResumeFormatMenuItemsProps) {
  return (
    <>
      <Menu.Item value="pdf" disabled={disabled} onClick={() => download("pdf")}>
        PDF
      </Menu.Item>
      <Menu.Item value="docx" disabled={disabled} onClick={() => download("docx")}>
        DOCX (Word)
      </Menu.Item>
    </>
  )
}
