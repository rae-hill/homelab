import { Console, Effect, Option } from "effect"
import { HttpApiClient } from "effect/http-api"
import { Homelab } from "homelab-api"
import { API_BASE_URL } from "../env.js"
import { deriveProfile } from "./state.js"

export const downloadDnsProfile = Effect.fn("downloadDnsProfile")(
  function*(args: {
    blockAds: Option.Option<boolean>
    tailscale: Option.Option<boolean>
    keepLogs: Option.Option<boolean>
    token: Option.Option<string>
  }) {
    const tailscale = Option.getOrElse(args.tailscale, () => false)
    const blockAds = tailscale ? true : Option.getOrElse(args.blockAds, () => true)
    const keepLogs = Option.getOrElse(args.keepLogs, () => false)
    const profile = deriveProfile({ blockAds, tailscale, keepLogs })
    const token = Option.getOrUndefined(args.token)

    const apiBaseUrl = yield* API_BASE_URL
    const client = yield* HttpApiClient.make(Homelab.HomelabApi, { baseUrl: apiBaseUrl })

    const result = yield* client["mobile-config"].dns({
      params: { profile },
      query: {},
      ...token ? { headers: { authorization: `Bearer ${token}` } } : { headers: {} },
    })

    yield* Effect.sync(() => {
      const blob = new Blob([result as unknown as string], { type: "application/x-apple-aspen-config" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `dns-${profile}.mobileconfig`
      a.click()
      URL.revokeObjectURL(url)
    })
  },
  Effect.tapError(Console.error),
)

export const copyDnsDownloadLink = Effect.fn("copyDnsDownloadLink")(
  function*(args: {
    blockAds: Option.Option<boolean>
    tailscale: Option.Option<boolean>
    keepLogs: Option.Option<boolean>
  }) {
    const tailscale = Option.getOrElse(args.tailscale, () => false)
    const blockAds = tailscale ? true : Option.getOrElse(args.blockAds, () => true)
    const keepLogs = Option.getOrElse(args.keepLogs, () => false)
    const profile = deriveProfile({ blockAds, tailscale, keepLogs })

    const apiBaseUrl = yield* API_BASE_URL
    const link = `${apiBaseUrl}/mobile-config/dns/${encodeURIComponent(profile)}/_download`

    yield* Effect.promise(() => navigator.clipboard.writeText(link))
  },
  Effect.tapError(Console.error),
)
