// TODO(v2): describeErrorChain retired in v2 (doc 07 §A: raw nested error JSON).
// The Schema.Defect-based serializer replaces the string-based error chain rendering —
// its tests live in packages/homelab-services/src/utils/error-json.test.ts.
// Kept as a skip-marker per the owner's directive; delete or replace with wire-level
// structured-error assertions when the skipped format tests are revisited.
import { describe, it } from "vitest"

describe.skip("describeErrorChain — retired in v2 (doc 07 §A: raw nested error JSON)", () => {
  it.todo("old string-format assertions — see error-json.test.ts for the replacement")
})
