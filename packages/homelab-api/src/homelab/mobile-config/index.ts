import { HttpApiGroup } from "effect/http-api"
import * as CertsDownload from "./certs-download.js"
import * as Certs from "./certs.js"
import * as DnsDownload from "./dns-download.js"
import * as Dns from "./dns.js"
import * as WifiDownload from "./wifi-download.js"
import * as Wifi from "./wifi.js"

export const MobileConfigApi = HttpApiGroup.make("mobile-config")
  .add(Certs.Certs)
  .add(CertsDownload.CertsDownload)
  .add(Dns.Dns)
  .add(DnsDownload.DnsDownload)
  .add(Wifi.WifiMobileConfig)
  .add(WifiDownload.WifiMobileConfigDownload)

export * as CertsDownload from "./certs-download.js"
export * as Certs from "./certs.js"
export * as DnsDownload from "./dns-download.js"
export * as Dns from "./dns.js"
export * as WifiDownload from "./wifi-download.js"
export * as Wifi from "./wifi.js"
