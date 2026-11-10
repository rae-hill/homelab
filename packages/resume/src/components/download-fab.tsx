import { Group, IconButton, Menu, Portal, Spinner } from "@chakra-ui/react"
import { LuChevronDown, LuDownload } from "react-icons/lu"

import { useCanPrintResume } from "../state/homelab"
import { Tooltip } from "./chakra/tooltip"
import { ResumeFormatMenuItems, useResumeDownload } from "./resume-download"

export interface DownloadFabProps {
  /** Placement offsets, mirroring the settings FAB (this one stacks above it). */
  readonly bottom?: ReadonlyArray<number>
  readonly left?: ReadonlyArray<number>
}

/**
 * Bottom-left floating split button — stacked directly **above** the settings FAB —
 * that renders the current print config to a document on the homelab server
 * (headless chrome) and downloads it. The main button renders a PDF (the historical
 * default); the attached chevron opens a menu offering PDF or DOCX (Word). Only
 * rendered when the tailscale-only API is reachable AND the signed-in identity
 * carries the `Resume_Print` role. Hidden in print.
 *
 * Feedback: the buttons show a spinner while rendering; success/failure surface as
 * toasts (see `chakra/toaster.tsx`). The `<Toaster />` viewport is mounted once in
 * `__root.tsx`.
 */
export function DownloadFab({
  bottom = [100, 100, 14],
  left = [10, 10, 140],
}: DownloadFabProps) {
  const canPrint = useCanPrintResume()
  const { busyFormat, download } = useResumeDownload()

  if (!canPrint) {
    return null
  }

  const hidePrint = { "@media print": { display: "none" } }
  const busy = busyFormat !== null

  return (
    <Menu.Root positioning={{ placement: "top-start" }}>
      <Group
        attached
        css={hidePrint}
        zIndex="docked"
        position="fixed"
        left={left}
        bottom={bottom}
        shadow="lg"
      >
        <Tooltip
          showArrow
          openDelay={200}
          closeDelay={100}
          positioning={{ placement: "top" }}
          content={busyFormat !== null
            ? `Rendering ${busyFormat.toUpperCase()}…`
            : "Download PDF (headless chrome on the homelab)"}
          contentProps={{ css: hidePrint }}
        >
          <IconButton
            aria-label="download resume pdf"
            rounded="full"
            size="xl"
            colorPalette="purple"
            aria-disabled={busy}
            onClick={() => download("pdf")}
          >
            {busyFormat === "pdf" ? <Spinner size="sm" /> : <LuDownload />}
          </IconButton>
        </Tooltip>
        <Menu.Trigger asChild>
          <IconButton
            aria-label="choose download format"
            rounded="full"
            size="lg"
            colorPalette="purple"
            aria-disabled={busy}
          >
            {busyFormat === "docx" ? <Spinner size="sm" /> : <LuChevronDown />}
          </IconButton>
        </Menu.Trigger>
      </Group>
      <Portal>
        <Menu.Positioner>
          <Menu.Content css={hidePrint}>
            <ResumeFormatMenuItems download={download} disabled={busy} />
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  )
}
