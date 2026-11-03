import { Effect, Schema, SchemaIssue } from "effect"
import type { Identity } from "../identity.js"
import { Operation } from "../operation.js"
import type { ResourceURIs } from "../resource-uris.js"
import { OptionalString, OptionalUnknown } from "../schemas/optionals.js"
import { ResourceURISchema } from "../schemas/resource-uris.js"

export const BaseHttpErrorSchema = Schema.Struct({
  message: Schema.String,
})

/**
 * A single schema issue, matching the shape produced by
 * `SchemaIssue.makeFormatterStandardSchemaV1`.
 */
export const Issue = Schema.Struct({
  message: Schema.String,
  path: Schema.Array(Schema.String),
})

export const NotFoundReasonsSchema = Schema.Literal(
  "ssid-not-found",
)

export class NotFound extends Schema.TaggedError<NotFound>()(
  "NotFound",
  {
    ...BaseHttpErrorSchema.fields,
    reason: NotFoundReasonsSchema,
  },
  {
    httpApiStatus: 404,
    description: "An error raised when one or more aspects of the request are not found",
  },
) {}

export const BadRequestReasonsSchema = Schema.Literals([
  "eap-client-username-required",
  "acme-invalid-client-identifier",
  "dns-ssid-required",
])

export class BadRequest extends Schema.TaggedError<BadRequest>()(
  "BadRequest",
  {
    ...BaseHttpErrorSchema.fields,
    reason: BadRequestReasonsSchema,
  },
  {
    httpApiStatus: 400,
    description: "An error raised when one or more aspects of the request are not valid",
  },
) {}

export class InternalServerError extends Schema.TaggedError<InternalServerError>()(
  "InternalServerError",
  { ...BaseHttpErrorSchema.fields, error: OptionalUnknown },
  {
    httpApiStatus: 500,
    description: "An error raised when an unrecoverable error has occurred and warrants investigation",
  },
) {}

export class NotImplemented extends Schema.TaggedError<NotImplemented>()(
  "NotImplemented",
  {
    ...BaseHttpErrorSchema.fields,
    internalMethod: Schema.String.pipe(Schema.optionalKey),
  },
  {
    httpApiStatus: 501,
    description: "An error raised when an aspect of the request handler is not yet implemented",
  },
) {}

export const AuthenticationErrorReasonsSchema = Schema.Literals([
  "not-authenticated",
  "failed-to-verify",
  "invalid-credential",
  "expired-credential",
  "invalid-claims",
  "signature-validation-failed",
  "unrecognized-issuer",
])

export class AuthenticationError extends Schema.TaggedError<AuthenticationError>()(
  "AuthenticationError",
  {
    ...BaseHttpErrorSchema.fields,
    endpoint: OptionalString,
    reason: AuthenticationErrorReasonsSchema,
    error: OptionalUnknown,
  },
  {
    httpApiStatus: 401,
    description: "An error raised when an aspect of the request's authentication is invalid.",
  },
) {
}

export class AuthorizationError extends Schema.TaggedError<AuthorizationError>()(
  "AuthorizationError",
  { ...BaseHttpErrorSchema.fields, resource: ResourceURISchema, operation: Schema.Enum(Operation) },
  {
    httpApiStatus: 403,
    description:
      "An error raised when the authenticated caller of a request is not authorized to perform an aspect of the request.",
  },
) {
  static fromFGA(identity: Identity, operation: Operation, resource: ResourceURIs): AuthorizationError {
    return new AuthorizationError({
      message: `${identity} is not allowed to perform ${operation} on ${resource}`,
      operation,
      resource,
    })
  }

  static fromFeatureFlag(resource: ResourceURIs, operation: Operation): AuthorizationError {
    return new AuthorizationError({
      message: `${operation} is not enabled for ${resource}`,
      operation,
      resource,
    })
  }
}

export class HttpApiEncodeError extends Schema.TaggedError<HttpApiEncodeError>()(
  "HttpApiEncodeError",
  {
    issues: Schema.Array(Issue),
    message: Schema.String,
  },
  {
    httpApiStatus: 500,
    description: "There was a problem serializing the response",
  },
) {
  static fromSchemaError(error: Schema.SchemaError): Effect.Effect<never, HttpApiEncodeError> {
    const formatted = SchemaIssue.makeFormatterStandardSchemaV1()(error.issue)
    return Effect.fail(
      new HttpApiEncodeError({
        issues: formatted.issues.map((issue) => ({
          message: issue.message,
          path: (issue.path ?? []).map(String),
        })),
        message: SchemaIssue.makeFormatterDefault()(error.issue),
      }),
    )
  }
}
