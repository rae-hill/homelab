import { Schema } from "effect"
import { constFalse } from "effect/Function"
import { Optional, OptionalWithDefault } from "./optionals.js"
import { GenericPayloadSchema } from "./payload-generic.js"

export const DNSSettingsBase = Schema.Struct({
  AllowFailover: OptionalWithDefault(Schema.Boolean, constFalse),
  ServerAddresses: Optional(Schema.Array(Schema.String)),
})

export const DNSSettingsHttps = DNSSettingsBase.pipe(
  Schema.fieldsAssign(
    {
      DNSProtocol: Schema.Literal("HTTPS"),
      ServerURL: Schema.URLFromString,
    },
  ),
)

export const DNSSettingsTLS = DNSSettingsBase.pipe(
  Schema.fieldsAssign(
    {
      DNSProtocol: Schema.Literal("TLS"),
      ServerName: Schema.String,
      ServerURL: Optional(Schema.URLFromString),
    },
  ),
)

export const DNSSettings = Schema.Union([
  DNSSettingsHttps,
  DNSSettingsTLS,
])

export const OnDemandRulesBase = Schema.Struct({
  DNSDomainMatch: Optional(Schema.Array(Schema.URLFromString)),
  DNSServerAddressMatch: Optional(Schema.String),
  InterfaceTypeMatch: Optional(Schema.Literals(["Ethernet", "WiFi", "Cellular"])),
  SSIDMatch: Optional(Schema.Array(Schema.String)),
  URLStringProbe: Optional(Schema.URLFromString),
})

export const OnDemandRulesConnect = OnDemandRulesBase.pipe(
  Schema.fieldsAssign(
    {
      Action: Schema.Literal("Connect"),
    },
  ),
)

export const OnDemandRulesDisconnect = OnDemandRulesBase.pipe(
  Schema.fieldsAssign(
    {
      Action: Schema.Literal("Disconnect"),
    },
  ),
)

export const OnDemandRulesActionParameters = Schema.Struct({
  DomainAction: Schema.Literals(["NeverConnect", "ConnectIfNeeded"]),
  Domains: Schema.Array(Schema.URLFromString),
})

export const OnDemandRulesEvaluateConnection = OnDemandRulesBase.pipe(
  Schema.fieldsAssign(
    {
      Action: Schema.Literal("EvaluateConnection"),
      ActionParameters: Optional(Schema.Array(OnDemandRulesActionParameters)),
    },
  ),
)

export const OnDemandRules = Schema.Union([
  OnDemandRulesDisconnect,
  OnDemandRulesConnect,
  OnDemandRulesEvaluateConnection,
])

export const DNSConfigSchema = GenericPayloadSchema.pipe(
  Schema.fieldsAssign(
    {
      DNSSettings,
      OnDemandRules: Optional(Schema.Array(OnDemandRules)),
      ProhibitDisablement: OptionalWithDefault(Schema.Boolean, constFalse),
    },
  ),
)

export type DNSConfig = typeof DNSConfigSchema.Type
