import { Context, Effect, Layer } from "effect"
import { Env } from "../env.js"

/**
 * Derived, runtime-checkable policy view of the env config. Consulted by tool visibility
 * gates, tool handlers, AND the IMAP layer (defense in depth).
 */
export interface PolicyServiceDef {
  readonly readEnabled: boolean
  readonly labelEnabled: boolean
  /** Exact label names this server may add/remove. */
  readonly allowedLabels: ReadonlyArray<string>
  readonly isLabelAllowed: (label: string) => boolean
  readonly maxBodyBytes: number
  readonly maxListMessages: number
}

export class PolicyService extends Context.Service<PolicyService, PolicyServiceDef>()(
  "proton-mail-mcp/services/PolicyService",
) {}

export const PolicyServiceLive = Layer.effect(
  PolicyService,
  Effect.map(Env, policyFromEnv),
)

/** Pure derivation used by both the live layer and tests. */
export function policyFromEnv(env: {
  readonly operations: ReadonlySet<string>
  readonly allowedLabels: ReadonlyArray<string>
  readonly maxBodyBytes: number
  readonly maxListMessages: number
}): PolicyServiceDef {
  return {
    readEnabled: env.operations.has("read"),
    labelEnabled: env.operations.has("label"),
    allowedLabels: env.allowedLabels,
    isLabelAllowed: (label: string) => env.allowedLabels.includes(label),
    maxBodyBytes: env.maxBodyBytes,
    maxListMessages: env.maxListMessages,
  }
}
