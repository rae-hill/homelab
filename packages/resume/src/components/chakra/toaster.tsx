import { createToaster, Toast, Toaster as ChakraToaster } from "@chakra-ui/react"

/**
 * App-wide toast singleton (Chakra v3 / ark-ui toaster). Import `toaster` from anywhere
 * to raise toasts (`toaster.create({ title, description, type })`); mount `<Toaster />`
 * exactly once inside the ChakraProvider (see `routes/__root.tsx`).
 */
export const toaster = createToaster({
  placement: "bottom-end",
  pauseOnPageIdle: true,
})

/** The mounted toaster viewport. Hidden in print. */
export function Toaster() {
  return (
    <ChakraToaster toaster={toaster}>
      {(toast) => (
        <Toast.Root
          width={{ base: "90dvw", md: "24rem" }}
          css={{ "@media print": { display: "none" } }}
        >
          <Toast.Title>{toast.title}</Toast.Title>
          <Toast.Description>{toast.description}</Toast.Description>
          <Toast.CloseTrigger />
        </Toast.Root>
      )}
    </ChakraToaster>
  )
}
