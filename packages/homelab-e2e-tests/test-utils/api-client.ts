import { HttpApiClient } from "effect/http-api"
import { Homelab } from "homelab-api"

/**
 * Base URL of the live homelab-server under test. Defaults to the dev-server port;
 * override with `E2E_BASE_URL` (e.g. when running a second server instance with extra
 * env like CHROME_EXECUTABLE on another port).
 */
export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000"

export const makeApiClient = HttpApiClient.make(Homelab.HomelabApi, {
  baseUrl: BASE_URL,
})
