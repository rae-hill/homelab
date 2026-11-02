import { Button, HStack, IconButton, Input, Separator, Stack, Text, Textarea, VStack } from "@chakra-ui/react"
import { useState } from "react"
import { LuCheck, LuCopy, LuDownload, LuTrash2, LuUpload } from "react-icons/lu"

import { useConfigIO, usePresets } from "../state/print-config"

/**
 * Import / Export panel (the "Share" tab). Export encodes the current config to a base64
 * blob (copyable); Import decodes a pasted blob and applies it, showing an inline error on
 * failure. Base64 avoids whitespace/paste corruption. Both reuse the schema codec.
 */
export function SharePanel() {
  const { exportBase64, importBase64 } = useConfigIO()
  const [exported, setExported] = useState("")
  const [importText, setImportText] = useState("")
  const [copied, setCopied] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importOk, setImportOk] = useState(false)

  function handleExport() {
    setExported(exportBase64())
    setCopied(false)
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(exported)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  function handleImport() {
    const ok = importBase64(importText)
    setImportOk(ok)
    setImportError(ok ? null : "Could not decode that config. Check the pasted code.")
  }

  return (
    <VStack w="full" align="stretch" gap={6}>
      <Stack gap={2}>
        <Text m={0} fontWeight="medium" textStyle="sm">
          Export
        </Text>
        <Text m={0} textStyle="xs" color="fg.muted">
          Generate a shareable code of your current configuration.
        </Text>
        <HStack>
          <Button size="sm" variant="outline" onClick={handleExport}>
            <LuDownload /> Generate code
          </Button>
          {exported !== "" && (
            <Button size="sm" variant="ghost" onClick={handleCopy}>
              {copied ? <LuCheck /> : <LuCopy />}
              {copied ? "Copied" : "Copy"}
            </Button>
          )}
        </HStack>
        {exported !== "" && <Textarea value={exported} readOnly rows={4} fontFamily="mono" fontSize="xs" />}
      </Stack>

      <Separator />

      <Stack gap={2}>
        <Text m={0} fontWeight="medium" textStyle="sm">
          Import
        </Text>
        <Text m={0} textStyle="xs" color="fg.muted">
          Paste a config code to apply it.
        </Text>
        <Textarea
          value={importText}
          onChange={(e) => {
            setImportText(e.target.value)
            setImportError(null)
            setImportOk(false)
          }}
          placeholder="Paste config code…"
          rows={4}
          fontFamily="mono"
          fontSize="xs"
        />
        <HStack>
          <Button
            size="sm"
            colorPalette="teal"
            onClick={handleImport}
            disabled={importText.trim() === ""}
          >
            <LuUpload /> Apply
          </Button>
          {importOk && (
            <Text m={0} textStyle="xs" color="green.fg">
              Applied.
            </Text>
          )}
        </HStack>
        {importError !== null && (
          <Text m={0} textStyle="xs" color="red.fg">
            {importError}
          </Text>
        )}
      </Stack>
    </VStack>
  )
}

/**
 * Presets panel (the "Presets" tab). Save the current config under a name (stored in
 * localStorage), and recall/delete saved presets. A built-in, read-only **Default** preset
 * always appears first and is the same config the Reset button restores.
 */
export function PresetsPanel() {
  const { state } = useConfigIO()
  const { presets, recall, remove, save } = usePresets()
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)

  function handleSave() {
    const ok = save(name, state)
    if (ok) {
      setName("")
      setError(null)
    } else {
      setError("Enter a name (and not the reserved name \"Default\").")
    }
  }

  return (
    <VStack w="full" align="stretch" gap={6}>
      <Stack gap={2}>
        <Text m={0} fontWeight="medium" textStyle="sm">
          Save current as preset
        </Text>
        <HStack>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setError(null)
            }}
            placeholder="Preset name…"
            size="sm"
            maxW="20rem"
          />
          <Button size="sm" colorPalette="teal" onClick={handleSave}>
            Save
          </Button>
        </HStack>
        {error !== null && (
          <Text m={0} textStyle="xs" color="red.fg">
            {error}
          </Text>
        )}
      </Stack>

      <Separator />

      <Stack gap={2}>
        <Text m={0} fontWeight="medium" textStyle="sm">
          Saved presets
        </Text>
        <VStack w="full" align="stretch" gap={1}>
          {presets.map((preset) => (
            <HStack
              key={preset.name}
              w="full"
              justifyContent="space-between"
              px={3}
              py={2}
              borderWidth="1px"
              borderColor="border"
              borderRadius="l2"
            >
              <HStack gap={2} minW={0}>
                <Text m={0} textStyle="sm" truncate>
                  {preset.name}
                </Text>
                {preset.builtIn && (
                  <Text m={0} textStyle="xs" color="fg.muted">
                    (built-in)
                  </Text>
                )}
              </HStack>
              <HStack gap={2}>
                <Button size="xs" variant="outline" onClick={() => recall(preset)}>
                  Recall
                </Button>
                {!preset.builtIn && (
                  <IconButton
                    aria-label={`Delete preset ${preset.name}`}
                    size="xs"
                    variant="ghost"
                    colorPalette="red"
                    onClick={() => remove(preset.name)}
                  >
                    <LuTrash2 />
                  </IconButton>
                )}
              </HStack>
            </HStack>
          ))}
        </VStack>
      </Stack>
    </VStack>
  )
}
