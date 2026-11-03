import { Context, Schema } from "effect"
import { HttpApiMiddleware } from "effect/http-api"
import * as ApiErrors from "../errors/http-errors.js"
import type { Identity } from "../identity.js"

export class CurrentIdentity extends Context.Service<CurrentIdentity, Identity>()("homelab-api/CurrentIdentity") {}

export class AuthMiddleware extends HttpApiMiddleware.Service<AuthMiddleware, {
  provides: CurrentIdentity
}>()("AuthMiddleware", {
  error: Schema.Union([ApiErrors.AuthenticationError, ApiErrors.BadRequest, ApiErrors.InternalServerError]),
}) {}
