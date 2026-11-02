import { IconButton } from "@chakra-ui/react"
import { useCallback } from "react"
import { AiOutlineEyeInvisible } from "react-icons/ai"
import { GiThreeLeaves } from "react-icons/gi"
import { IoReload } from "react-icons/io5"
import { HIDE_EFFECTS_LOCAL_STORAGE_KEY } from "../constants/effects.constants"
import { useCorrectConfettiZIndex } from "../hooks/useCorrectConfettiZIndex"
import { hideCherryBlossoms, useInitialHideCherryBlossoms } from "../hooks/useHideCherryBlossoms"
import { useInitialHideEffectContext } from "../hooks/useInitialEffectsValue"
import { useLocalStorage } from "../hooks/useLocalStorage"
import { Tooltip } from "./chakra/tooltip"

declare global {
  var ConfettiPage:
    | {
      play(): void
    }
    | undefined
}

export function EffectsFab() {
  useCorrectConfettiZIndex()

  const [hideEffects, setHideEffects] = useLocalStorage(
    HIDE_EFFECTS_LOCAL_STORAGE_KEY,
    "false",
  )

  const initialHideEffects = useInitialHideEffectContext()

  useInitialHideCherryBlossoms(hideEffects === "true")

  const toggleEffects = useCallback(() => {
    const newValue = hideEffects === "true" ? "false" : "true"
    hideCherryBlossoms(newValue === "true")
    setHideEffects(newValue)

    if (initialHideEffects === "true") {
      window.location.reload()
    }
  }, [hideEffects])

  return (
    hideEffects && (
      <Tooltip
        disabled={initialHideEffects !== "true"}
        content="Reload window for effects"
        positioning={{
          placement: "top",
        }}
      >
        <IconButton
          css={{
            "@media print": {
              display: "none",
            },
          }}
          zIndex="docked"
          aria-label="toggle effects"
          position="fixed"
          right={[10, 10, 16]}
          rounded="full"
          bottom={[8, 8, 14]}
          size="xl"
          shadow="lg"
          colorPalette={hideEffects === "true" ? "gray" : "pink"}
          onClick={toggleEffects}
        >
          {initialHideEffects === "true" ?
            <IoReload />
            : hideEffects === "true" ?
            <AiOutlineEyeInvisible />
            : <GiThreeLeaves />}
        </IconButton>
      </Tooltip>
    )
  )
}
