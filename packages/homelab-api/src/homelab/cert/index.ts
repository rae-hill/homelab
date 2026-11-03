import { HttpApiGroup } from "effect/http-api"
import * as Combined from "./combined.js"
import * as Intermediate from "./intermediate.js"
import * as Root from "./root.js"

export const CertApi = HttpApiGroup.make("cert")
  .add(Root.RootCert)
  .add(Intermediate.IntermediateCert)
  .add(Combined.CombinedCert)

export * as Combined from "./combined.js"
export * as Intermediate from "./intermediate.js"
export * as Root from "./root.js"
