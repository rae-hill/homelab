import {
  Array,
  Effect,
  FileSystem,
  HashMap,
  Layer,
  Option,
  pipe,
  Redacted,
  Schema,
  SchemaTransformation,
  Tuple,
} from "effect"
import { Config, Schemas } from "homelab-services"

const ApiKeyEntrySchema = Schema.Struct({
  apiKey: Schema.RedactedFromValue(Schema.String),
  email: Schema.String,
  permissions: Schemas.HashSetFromArray.HashSetFromArray(Schemas.ScopeGroups.ScopeGroupSchema),
})

type ApiKeyEntry = typeof ApiKeyEntrySchema.Type

type ApiKeyMap = HashMap.HashMap<
  Redacted.Redacted<string>,
  readonly [Schemas.ScopeGroups.ScopeOrGroupSet, string]
>

const ApiKeyMapSchema = Schema.Array(ApiKeyEntrySchema).pipe(
  Schema.decodeTo(
    Schema.toType(
      Schema.HashMap(
        Schema.RedactedFromValue(Schema.String),
        Schema.Tuple([
          Schemas.HashSetFromArray.HashSetFromArray(Schemas.ScopeGroups.ScopeGroupSchema),
          Schema.String,
        ]),
      ),
    ),
    SchemaTransformation.transform({
      decode: (entries: ReadonlyArray<ApiKeyEntry>): ApiKeyMap =>
        HashMap.fromIterable(
          Array.map(entries, ({ apiKey, email, permissions }) => Tuple.make(apiKey, Tuple.make(permissions, email))),
        ),
      encode: (apiKeys: ApiKeyMap): ReadonlyArray<ApiKeyEntry> =>
        Array.map(HashMap.toEntries(apiKeys), ([apiKey, [permissions, email]]) => ({
          apiKey,
          email,
          permissions,
        })),
    }),
  ),
)

const ParseApiKeys = Schemas.Buffer.StringFromUint8Array.pipe(
  Schema.decodeTo(Schema.fromJsonString(ApiKeyMapSchema)),
)

export const ApiKeyConfigLive = Layer.effect(
  Config.ApiKeyConfig.ApiKeyConfig,
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const apiKeysFilePath = yield* Config.Env.apiKeysFilePath

    const apiKeys = yield* pipe(
      fs.readFile(apiKeysFilePath),
      Effect.andThen(Schema.decodeEffect(ParseApiKeys)),
    )

    return new ApiKeyConfigImpl(apiKeys)
  }),
)

class ApiKeyConfigImpl implements Config.ApiKeyConfig.ApiKeyConfigDef {
  constructor(
    private readonly apiKeys: HashMap.HashMap<
      Redacted.Redacted<string>,
      readonly [
        scopes: Schemas.ScopeGroups.ScopeOrGroupSet,
        email: string,
      ]
    >,
  ) {
  }

  getRoles(apiKey: string): Option.Option<Schemas.ScopeGroups.ScopeOrGroupSet> {
    return HashMap.get(this.apiKeys, Redacted.make(apiKey)).pipe(
      Option.map(
        Tuple.get(0),
      ),
    )
  }

  getEmail(apiKey: string): Option.Option<string> {
    return HashMap.get(this.apiKeys, Redacted.make(apiKey)).pipe(
      Option.map(
        Tuple.get(1),
      ),
    )
  }
}
