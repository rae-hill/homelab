import { HashSet, Option } from "effect"
import type { ScopeOrGroup, ScopeOrGroupSet } from "./schemas/scope-groups.js"

const IdentityTag = Symbol.for("homelab-api/identity")

export type IdentityTag = typeof IdentityTag

export enum IdentityType {
  OIDC = "OIDC",
  mTLS = "mTLS",
  Guest = "Guest",
}

export type Identity = GuestIdentity | OIDCIdentity | MTLSIdentity

export abstract class IdentityBase {
  abstract readonly [IdentityTag]: IdentityType
  abstract readonly principle: string
  abstract readonly fullname: Option.Option<string>
  abstract readonly permissionSet: ScopeOrGroupSet

  constructor(
    readonly identifier: string,
  ) {}

  [Symbol.toPrimitive](hint: "number" | "string" | "default") {
    if (hint === "string" || hint === "default") {
      return `${this.identifier} (${this[IdentityTag]})`
    }

    throw new TypeError(`Unable to coerce ${this[IdentityTag].toUpperCase()}Identity into a number`)
  }
}

export class GuestIdentity extends IdentityBase implements Permissions {
  readonly [IdentityTag] = IdentityType.Guest
  readonly principle = "guest"
  readonly fullname = Option.none<string>()

  constructor() {
    super("guest")
  }

  get permissionSet(): ScopeOrGroupSet {
    return this.permissions
  }

  hasPermission(identifier: ScopeOrGroup): boolean {
    return HashSet.has(this.permissions, identifier)
  }

  private readonly permissions: HashSet.HashSet<ScopeOrGroup> = HashSet.fromIterable([
    "Config_Wifi.view",
    "Config_Wifi.create",
    "Config_Certs.view",
    "Config_Certs.create",
    "Config_DNS.view",
    "Cert_Root.view",
    "Cert_Intermediate.view",
    "Cert_Combined.view",
    "Status_Health.view",
    "Status_Self.view",
  ])
}

export class OIDCIdentity extends IdentityBase implements Permissions {
  readonly [IdentityTag] = IdentityType.OIDC

  constructor(
    public readonly email: string,
    private readonly groups: ScopeOrGroupSet,
    private readonly username?: string,
    private readonly _fullname?: string,
  ) {
    super(email)
  }

  get principle() {
    const emailName = this.email.split("@")[0]

    return this.username ?? emailName
  }

  get fullname(): Option.Option<string> {
    return Option.fromNullishOr(this._fullname)
  }

  get permissionSet(): ScopeOrGroupSet {
    return this.groups
  }

  hasPermission(group: ScopeOrGroup) {
    return HashSet.has(this.groups, group)
  }
}

export class MTLSIdentity extends IdentityBase implements Permissions {
  readonly [IdentityTag] = IdentityType.mTLS
  readonly fullname = Option.none<string>()

  constructor(
    public readonly commonName: string,
    private readonly scopes: ScopeOrGroupSet,
  ) {
    super(commonName)
  }

  get principle() {
    return this.commonName
  }

  get permissionSet(): ScopeOrGroupSet {
    return this.scopes
  }

  hasPermission(role: ScopeOrGroup): boolean {
    return HashSet.has(this.scopes, role)
  }
}

export interface Permissions {
  hasPermission(identifier: ScopeOrGroup): boolean
}
