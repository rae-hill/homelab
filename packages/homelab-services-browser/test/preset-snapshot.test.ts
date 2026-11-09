import { Effect, Option } from "effect"
import { Services } from "homelab-services"
import { describe, expect, it } from "vitest"
import { PRESETS_STORAGE_KEY, PresetSnapshotServiceLive } from "../src/layers/preset-snapshot-service.js"
import type { WebStoragePort } from "../src/web-storage-port.js"

/**
 * In-memory WebStoragePort stub for testing.
 * No jsdom, no real localStorage - just a Map-backed implementation.
 */
class InMemoryStorage implements WebStoragePort {
  private store = new Map<string, string>()

  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }
}

describe("PresetSnapshotService", () => {
  const makeService = () => {
    const storage = new InMemoryStorage()
    const layer = PresetSnapshotServiceLive(storage)
    return { storage, layer }
  }

  it("should return empty array when no presets exist", async () => {
    const { layer } = makeService()
    const program = Effect.gen(function*() {
      const service = yield* Services.PresetSnapshotService.PresetSnapshotService
      return yield* service.list()
    })
    const result = await Effect.runPromise(program.pipe(Effect.provide(layer)))
    expect(result).toEqual([])
  })

  it("should save and list presets", async () => {
    const { layer } = makeService()
    const program = Effect.gen(function*() {
      const service = yield* Services.PresetSnapshotService.PresetSnapshotService
      yield* service.save("Preset 1", "base64-content-1")
      yield* service.save("Preset 2", "base64-content-2")
      return yield* service.list()
    })
    const result = await Effect.runPromise(program.pipe(Effect.provide(layer)))
    expect(result).toEqual(["Preset 1", "Preset 2"])
  })

  it("should recall a saved preset", async () => {
    const { layer } = makeService()
    const program = Effect.gen(function*() {
      const service = yield* Services.PresetSnapshotService.PresetSnapshotService
      yield* service.save("My Preset", "base64-content")
      return yield* service.recall("My Preset")
    })
    const result = await Effect.runPromise(program.pipe(Effect.provide(layer)))
    expect(Option.isSome(result)).toBe(true)
    expect(Option.getOrNull(result)).toBe("base64-content")
  })

  it("should return None when recalling non-existent preset", async () => {
    const { layer } = makeService()
    const program = Effect.gen(function*() {
      const service = yield* Services.PresetSnapshotService.PresetSnapshotService
      return yield* service.recall("Non-existent")
    })
    const result = await Effect.runPromise(program.pipe(Effect.provide(layer)))
    expect(Option.isNone(result)).toBe(true)
  })

  it("should remove a preset", async () => {
    const { layer } = makeService()
    const program = Effect.gen(function*() {
      const service = yield* Services.PresetSnapshotService.PresetSnapshotService
      yield* service.save("Preset to Remove", "base64-content")
      yield* service.remove("Preset to Remove")
      return yield* service.list()
    })
    const result = await Effect.runPromise(program.pipe(Effect.provide(layer)))
    expect(result).toEqual([])
  })

  it("should reject saving with name 'Default'", async () => {
    const { layer } = makeService()
    const program = Effect.gen(function*() {
      const service = yield* Services.PresetSnapshotService.PresetSnapshotService
      yield* service.save("Default", "base64-content")
    })
    const failed = await Effect.runPromise(
      program.pipe(
        Effect.match({
          onFailure: () => true,
          onSuccess: () => false,
        }),
        Effect.provide(layer),
      ),
    )
    expect(failed).toBe(true)
  })

  it("should reject removing preset named 'Default'", async () => {
    const { layer } = makeService()
    const program = Effect.gen(function*() {
      const service = yield* Services.PresetSnapshotService.PresetSnapshotService
      yield* service.remove("Default")
    })
    const failed = await Effect.runPromise(
      program.pipe(
        Effect.match({
          onFailure: () => true,
          onSuccess: () => false,
        }),
        Effect.provide(layer),
      ),
    )
    expect(failed).toBe(true)
  })

  it("should maintain backward compatibility with existing preset format", async () => {
    const { layer, storage } = makeService()

    // Seed storage with legacy format
    const legacyPresets = {
      "Old Preset": "old-base64-content",
      "Another Preset": "another-base64-content",
    }
    storage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(legacyPresets))

    const program = Effect.gen(function*() {
      const service = yield* Services.PresetSnapshotService.PresetSnapshotService
      const list = yield* service.list()
      const recalled = yield* service.recall("Old Preset")
      return { list, recalled }
    })

    const result = await Effect.runPromise(program.pipe(Effect.provide(layer)))
    expect(result.list).toEqual(["Another Preset", "Old Preset"])
    expect(Option.isSome(result.recalled)).toBe(true)
    expect(Option.getOrNull(result.recalled)).toBe("old-base64-content")
  })

  it("should return empty array on corrupt storage data", async () => {
    const { layer, storage } = makeService()
    storage.setItem(PRESETS_STORAGE_KEY, "not valid json")

    const program = Effect.gen(function*() {
      const service = yield* Services.PresetSnapshotService.PresetSnapshotService
      return yield* service.list()
    })

    const result = await Effect.runPromise(program.pipe(Effect.provide(layer)))
    expect(result).toEqual([])
  })

  it("should return empty array when storage contains non-object data", async () => {
    const { layer, storage } = makeService()
    storage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(["not", "an", "object"]))

    const program = Effect.gen(function*() {
      const service = yield* Services.PresetSnapshotService.PresetSnapshotService
      return yield* service.list()
    })

    const result = await Effect.runPromise(program.pipe(Effect.provide(layer)))
    expect(result).toEqual([])
  })

  it("should reject saving with empty name", async () => {
    const { layer } = makeService()
    const program = Effect.gen(function*() {
      const service = yield* Services.PresetSnapshotService.PresetSnapshotService
      yield* service.save("   ", "base64-content")
    })
    const failed = await Effect.runPromise(
      program.pipe(
        Effect.match({
          onFailure: () => true,
          onSuccess: () => false,
        }),
        Effect.provide(layer),
      ),
    )
    expect(failed).toBe(true)
  })
})

describe("save collision behavior", () => {
  const makeService = () => {
    const storage = new InMemoryStorage()
    const layer = PresetSnapshotServiceLive(storage)
    return { storage, layer }
  }

  it("overwrites an existing name by default (legacy usePresets behavior)", async () => {
    const { layer } = makeService()
    const program = Effect.gen(function*() {
      const service = yield* Services.PresetSnapshotService.PresetSnapshotService
      yield* service.save("Preset", "base64-v1")
      const finalName = yield* service.save("Preset", "base64-v2")
      const recalled = yield* service.recall("Preset")
      const names = yield* service.list()
      return { finalName, recalled, names }
    })
    const result = await Effect.runPromise(program.pipe(Effect.provide(layer)))
    expect(result.finalName).toBe("Preset")
    expect(result.names).toEqual(["Preset"])
    expect(Option.isSome(result.recalled)).toBe(true)
    if (Option.isSome(result.recalled)) {
      expect(result.recalled.value).toBe("base64-v2")
    }
  })

  it("suffixes on collision when onCollision: 'suffix' (pre-tailor snapshots)", async () => {
    const { layer } = makeService()
    const program = Effect.gen(function*() {
      const service = yield* Services.PresetSnapshotService.PresetSnapshotService
      const first = yield* service.save("Pre-tailor: SWE", "b1", { onCollision: "suffix" })
      const second = yield* service.save("Pre-tailor: SWE", "b2", { onCollision: "suffix" })
      const names = yield* service.list()
      return { first, second, names }
    })
    const result = await Effect.runPromise(program.pipe(Effect.provide(layer)))
    expect(result.first).toBe("Pre-tailor: SWE")
    expect(result.second).toBe("Pre-tailor: SWE (1)")
    expect(result.names).toEqual(["Pre-tailor: SWE", "Pre-tailor: SWE (1)"])
  })
})

describe("resolveCollision", () => {
  it("should return original name when no collision", () => {
    const result = Services.PresetSnapshotService.resolveCollision("Test", ["Other", "Names"])
    expect(result).toBe("Test")
  })

  it("should append (1) on first collision", () => {
    const result = Services.PresetSnapshotService.resolveCollision("Test", ["Test", "Other"])
    expect(result).toBe("Test (1)")
  })

  it("should append (2) when (1) also exists", () => {
    const result = Services.PresetSnapshotService.resolveCollision("Test", ["Test", "Test (1)", "Other"])
    expect(result).toBe("Test (2)")
  })

  it("should handle multiple collisions", () => {
    const result = Services.PresetSnapshotService.resolveCollision("Test", [
      "Test",
      "Test (1)",
      "Test (2)",
      "Test (3)",
    ])
    expect(result).toBe("Test (4)")
  })
})
