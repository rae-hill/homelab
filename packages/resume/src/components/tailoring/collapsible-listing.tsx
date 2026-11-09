import { Box, Button, Textarea } from "@chakra-ui/react"
import { useState } from "react"

interface CollapsibleListingProps {
  listingText: string
}

export function CollapsibleListing({ listingText }: CollapsibleListingProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <Box>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setExpanded(!expanded)}
        mb={2}
      >
        {expanded ? "Hide" : "Show"} raw listing
      </Button>
      {expanded && (
        <Textarea
          value={listingText}
          readOnly
          minH="20rem"
          fontFamily="mono"
          textStyle="xs"
          resize="vertical"
        />
      )}
    </Box>
  )
}
