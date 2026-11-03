import { HttpApiClient } from "effect/http-api"
import { Homelab } from "homelab-api"

export const BASE_URL = "http://localhost:3000"

export const makeApiClient = HttpApiClient.make(Homelab.HomelabApi, {
  baseUrl: BASE_URL,
})
