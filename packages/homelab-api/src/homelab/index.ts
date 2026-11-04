import { HttpApi } from "effect/http-api"
import { CertApi } from "./cert/index.js"
import { MobileConfigApi } from "./mobile-config/index.js"
import { OAuthApi } from "./oauth/index.js"
import { ResumeApi } from "./resume/index.js"
import { StatusApi } from "./status/index.js"
import { WellKnownApi } from "./well-known/index.js"

export const HomelabApi = HttpApi.make("homelab")
  .add(CertApi)
  .add(MobileConfigApi)
  .add(OAuthApi)
  .add(ResumeApi)
  .add(StatusApi)
  .add(WellKnownApi)

export * as CertEndpoints from "./cert/index.js"
export * as MobileConfigEndpoints from "./mobile-config/index.js"
export * as OAuthEndpoints from "./oauth/index.js"
export * as ResumeEndpoints from "./resume/index.js"
export * as StatusEndpoints from "./status/index.js"
export * as WellKnownEndpoints from "./well-known/index.js"
