import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient"
import { Layer } from "effect"
import { DPoPTokenCreatorServiceLive } from "./dpop-tokens.js"

export const TEST_API_KEY = "test-api-key-1"
export const TEST_LIMITED_API_KEY = "test-limited-api-key-1"
export const TEST_LIMITED_CERTS_KEY = "test-limited-api-key-2"

export const E2ETestLayer = Layer.mergeAll(
  NodeHttpClient.layerFetch,
  DPoPTokenCreatorServiceLive,
)
