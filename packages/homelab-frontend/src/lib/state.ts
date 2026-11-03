import { Option, Record } from "effect"
import { createSignal } from "solid-js"
import { TAB_STORAGE_KEY } from "./constants"

export type Tab = "apple" | "android"

export type AppParams = {
  tab: Tab
  ssid: Option.Option<string>
  encryption: Option.Option<"WPA2" | "WPA3">
  password: Option.Option<string>
  username: Option.Option<string>
  disableMACRandomization: Option.Option<boolean>
  includeEthernetProfile: Option.Option<boolean>
  blockAds: Option.Option<boolean>
  tailscale: Option.Option<boolean>
  keepLogs: Option.Option<boolean>
}

function readTab(): Tab {
  const stored = localStorage.getItem(TAB_STORAGE_KEY)
  return stored === "android" ? "android" : "apple"
}

function readURL(): Omit<AppParams, "tab"> {
  const params = new URLSearchParams(window.location.search)
  const enc = params.get("encryption")
  const dmr = params.get("disableMACRandomization")
  const includeEthernetProfile = params.get("includeEthernetProfile")
  const blockAds = params.get("blockAds")
  const tailscale = params.get("tailscale")
  const keepLogs = params.get("keepLogs")

  return {
    ssid: Option.fromNullishOr(params.get("ssid") || null),
    encryption: Option.some(enc === "WPA2" || enc === "WPA3" ? enc : "WPA3" as const),
    password: Option.fromNullishOr(params.get("password") || null),
    username: Option.fromNullishOr(params.get("username") || null),
    disableMACRandomization: Option.fromNullishOr(dmr === "true" ? true : dmr === "false" ? false : null),
    includeEthernetProfile: Option.fromNullishOr(
      includeEthernetProfile === "true" ? true : includeEthernetProfile === "false" ? false : null,
    ),
    blockAds: Option.fromNullishOr(blockAds === "true" ? true : blockAds === "false" ? false : null),
    tailscale: Option.fromNullishOr(tailscale === "true" ? true : tailscale === "false" ? false : null),
    keepLogs: Option.fromNullishOr(keepLogs === "true" ? true : keepLogs === "false" ? false : null),
  }
}

function syncURL(p: Omit<AppParams, "tab">) {
  const somes = Record.getSomes({
    ssid: p.ssid,
    encryption: p.encryption,
    password: p.password,
    username: p.username,
    disableMACRandomization: Option.map(p.disableMACRandomization, String),
    includeEthernetProfile: Option.map(p.includeEthernetProfile, String),
    blockAds: Option.map(p.blockAds, String),
    tailscale: Option.map(p.tailscale, String),
    keepLogs: Option.map(p.keepLogs, String),
  })

  const qs = new URLSearchParams(somes).toString()
  const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname
  history.replaceState(history.state, "", newUrl)
}

function buildQueryString(p: Omit<AppParams, "tab">): string {
  const somes = Record.getSomes({
    ssid: p.ssid,
    encryption: p.encryption,
    password: p.password,
    username: p.username,
    disableMACRandomization: Option.map(p.disableMACRandomization, String),
    includeEthernetProfile: Option.map(p.includeEthernetProfile, String),
    blockAds: Option.map(p.blockAds, String),
    tailscale: Option.map(p.tailscale, String),
    keepLogs: Option.map(p.keepLogs, String),
  })
  return new URLSearchParams(somes).toString()
}

export function useAppParams() {
  const [params, setParams] = createSignal<AppParams>({ tab: readTab(), ...readURL() })

  const update = (patch: Partial<AppParams>) => {
    setParams((prev) => {
      const next = { ...prev, ...patch }
      if (Object.hasOwn(patch, "tab")) {
        localStorage.setItem(TAB_STORAGE_KEY, next.tab)
      }
      syncURL(next)
      return next
    })
  }

  const queryString = () => buildQueryString(params())

  return {
    params,
    queryString,
    setTab: (t: Tab) => update({ tab: t }),
    setSSID: (v: Option.Option<string>) => update({ ssid: v }),
    setEncryption: (v: Option.Option<"WPA2" | "WPA3">) => update({ encryption: v }),
    setPassword: (v: Option.Option<string>) => update({ password: v }),
    setUsername: (v: Option.Option<string>) => update({ username: v }),
    setDisableMACRandomization: (v: Option.Option<boolean>) => update({ disableMACRandomization: v }),
    setIncludeEthernetProfile: (v: Option.Option<boolean>) => update({ includeEthernetProfile: v }),
    setBlockAds: (v: Option.Option<boolean>) => update({ blockAds: v }),
    setTailscale: (v: Option.Option<boolean>) => update({ tailscale: v }),
    setKeepLogs: (v: Option.Option<boolean>) => update({ keepLogs: v }),
  }
}

export type UseAppParams = ReturnType<typeof useAppParams>
