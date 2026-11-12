import { Group, IconButton, Menu, Portal, Text } from "@chakra-ui/react"
import { LuChevronDown, LuDownload } from "react-icons/lu"

import { useCallback, useState } from "react"
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
  bottom = [8, 8, 14],
  left = [100, 100, 140],
}: DownloadFabProps) {
  const [selectedFileFormat, setSelectedFileFormat] = useState<"pdf" | "docx">("pdf")
  const canPrint = useCanPrintResume()
  const { busyFormat, download } = useResumeDownload()

  const hidePrint = { "@media print": { display: "none" } }
  const busy = busyFormat !== null

  const onDownload = useCallback(() => download(selectedFileFormat), [download, selectedFileFormat])

  const onSelectPdf = useCallback(() => setSelectedFileFormat("pdf"), [])
  const onSelectDocx = useCallback(() => setSelectedFileFormat("docx"), [])

  if (!canPrint) {
    return null
  }

  return (
    <Menu.Root positioning={{ placement: "top-start" }}>
      <Group
        attached
        css={hidePrint}
        zIndex="docked"
        position="fixed"
        left={left}
        bottom={bottom}
        filter="drop-shadow(0px 8px 16px color-mix(in srgb, #18181b 10%, transparent)) drop-shadow(0px 0px 1px color-mix(in srgb, #18181b 30%, transparent))"
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
            size="lg"
            aria-disabled={busy}
            borderTopRightRadius={0}
            borderBottomRightRadius={0}
            borderTopLeftRadius="full"
            borderBottomLeftRadius="full"
            onClick={onDownload}
            colorPalette="gray"
            spinner={busy}
            px={5}
          >
            <LuDownload />
            <Text textStyle="sm">Download {selectedFileFormat.toUpperCase()}</Text>
          </IconButton>
        </Tooltip>
        <Menu.Trigger asChild>
          <IconButton
            aria-label="choose download format"
            rounded="full"
            size="lg"
            aria-disabled={busy}
            colorPalette="gray"
            variant="solid"
            spinner={busy}
            borderLeft="xs"
          >
            <LuChevronDown />
          </IconButton>
        </Menu.Trigger>
      </Group>
      <Portal>
        <Menu.Positioner>
          <Menu.Content css={hidePrint}>
            <ResumeFormatMenuItems onSelectDocx={onSelectDocx} onSelectPdf={onSelectPdf} disabled={busy} />
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  )
}
