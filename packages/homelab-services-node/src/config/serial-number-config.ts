import { Effect, FileSystem, HashMap, Layer, Option, pipe, Schema } from "effect"
import { Config, Schemas } from "homelab-services"

const ParseSerialNumbers = Schemas.Buffer.StringFromUint8Array.pipe(
  Schema.decodeTo(
    Schema.fromJsonString(Schemas.HashMapFromRecord.HashSetFromRecord(Schemas.IpAddress.IpAddress, Schema.String)),
  ),
)

export const SerialNumberConfigLive = Layer.effect(
  Config.SerialNumberConfig.SerialNumberConfig,
  Effect.gen(function*() {
    const filePath = yield* Config.Env.serialNumbersFile

    if (Option.isNone(filePath)) {
      return new SerialNumberConfigImpl(HashMap.empty())
    }

    const fs = yield* FileSystem.FileSystem
    const serialNumbers = yield* pipe(
      fs.readFile(filePath.value),
      Effect.andThen(Schema.decodeEffect(ParseSerialNumbers)),
    )

    return new SerialNumberConfigImpl(serialNumbers)
  }),
)

class SerialNumberConfigImpl implements Config.SerialNumberConfig.SerialNumberConfigDef {
  constructor(private readonly serialNumbers: HashMap.HashMap<string, string>) {}

  resolveIp(ip: string): Option.Option<string> {
    return HashMap.get(this.serialNumbers, ip)
  }
}
